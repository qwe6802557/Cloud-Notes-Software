const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_FILE_NAME = 'mirror-config.json';
const INDEX_FILE_NAME = '.cloud-notes-mirror.json';

/**
 * 过滤路径片段中的非法文件名字符（杜绝路径分隔符、控制字符及 .. 越界片段）
 * @param {string} rawName
 * @param {string} [fallback='未命名']
 */
function sanitizeSegment(rawName, fallback = '未命名') {
    const cleaned = Array.from(String(rawName || ''))
        .map(ch => {
            const code = ch.charCodeAt(0);
            if (code < 32 || '<>:"/\\|?*'.includes(ch)) {
                return '-';
            }
            return ch;
        })
        .join('')
        .replace(/\s+/g, ' ')
        .replace(/^\.+|\.+$/g, '')
        .trim();

    if (!cleaned || cleaned === '.' || cleaned === '..') {
        return fallback;
    }
    return cleaned.slice(0, 100);
}

/**
 * 纯 Node 本地目录镜像同步引擎：
 * - 严格限制所有读写落盘必须位于用户 dialog 授权选定的 rootDir 内（禁止 .. 与越界路径）
 * - 使用 .cloud-notes-mirror.json 增量记录索引与内容 SHA-256 哈希，自动清理删除与迁移旧文件
 * - 强制跳过 isEncrypted: true 端到端加密笔记，返回 skippedEncrypted 统计
 */
class MirrorService {
    constructor({ getUserDataPath, dialog, shell }) {
        this.getUserDataPath = getUserDataPath;
        this.dialog = dialog;
        this.shell = shell;
        this.isSyncing = false;
    }

    getConfigPath() {
        return path.join(this.getUserDataPath(), CONFIG_FILE_NAME);
    }

    readConfigFile() {
        const defaults = {
            enabled: false,
            autoSync: false,
            rootDir: '',
            lastSyncAt: null,
            lastStats: null
        };
        try {
            const cfgPath = this.getConfigPath();
            if (!fs.existsSync(cfgPath)) {
                return defaults;
            }
            const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
            return {
                ...defaults,
                ...parsed,
                enabled: Boolean(parsed?.enabled),
                autoSync: Boolean(parsed?.autoSync),
                rootDir: typeof parsed?.rootDir === 'string' ? parsed.rootDir : ''
            };
        } catch {
            return defaults;
        }
    }

    async writeConfigFile(config) {
        const cfgPath = this.getConfigPath();
        await fs.promises.mkdir(path.dirname(cfgPath), { recursive: true });
        await fs.promises.writeFile(cfgPath, JSON.stringify(config, null, 2), 'utf8');
        return config;
    }

    isInsideRoot(rootDir, targetPath) {
        if (!rootDir || !targetPath) return false;
        const resolvedRoot = path.resolve(rootDir);
        const resolvedTarget = path.resolve(targetPath);
        if (resolvedTarget === resolvedRoot) return true;
        const rel = path.relative(resolvedRoot, resolvedTarget);
        return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
    }

    resolveSafePath(rootDir, relPath) {
        if (!rootDir || !relPath) return null;
        if (path.isAbsolute(relPath)) return null;
        const normalizedParts = relPath.split(/[\\/]+/).filter(Boolean);
        if (normalizedParts.some(seg => seg === '..' || seg === '.')) {
            return null;
        }
        const candidate = path.resolve(rootDir, ...normalizedParts);
        if (!this.isInsideRoot(rootDir, candidate)) {
            return null;
        }
        return candidate;
    }

    async getConfig() {
        const cfg = this.readConfigFile();
        return {
            ...cfg,
            rootExists: Boolean(cfg.rootDir && fs.existsSync(cfg.rootDir))
        };
    }

    /**
     * 更新开关配置（禁止未经过系统对话框直接传入任意本地 rootDir 越权覆盖）
     */
    async setConfig(patch = {}) {
        const current = this.readConfigFile();
        const next = {
            ...current,
            enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : current.enabled,
            autoSync: patch.autoSync !== undefined ? Boolean(patch.autoSync) : current.autoSync
        };

        // 仅允许清空目录绑定，拒绝注入未经授权路径
        if (patch.rootDir === '') {
            next.rootDir = '';
            next.lastSyncAt = null;
        }
        if (patch.resetCursor) {
            next.lastSyncAt = null;
        }

        await this.writeConfigFile(next);
        return this.getConfig();
    }

    /**
     * 唤起系统文件夹选择对话框获取用户授权根目录
     */
    async selectDir(parentWindow) {
        const result = await this.dialog.showOpenDialog(parentWindow || undefined, {
            title: '选择本地 Markdown 镜像目录',
            properties: ['openDirectory', 'createDirectory']
        });

        if (result.canceled || !Array.isArray(result.filePaths) || !result.filePaths[0]) {
            return { canceled: true, config: await this.getConfig() };
        }

        const chosenDir = path.resolve(result.filePaths[0]);
        const current = this.readConfigFile();
        const dirChanged = current.rootDir !== chosenDir;

        const next = {
            ...current,
            rootDir: chosenDir,
            enabled: true,
            lastSyncAt: dirChanged ? null : current.lastSyncAt,
            lastStats: dirChanged ? null : current.lastStats
        };

        await this.writeConfigFile(next);
        return {
            canceled: false,
            config: await this.getConfig()
        };
    }

    /**
     * 在系统文件管理器中打开已授权镜像目录
     */
    async openDir() {
        const cfg = this.readConfigFile();
        if (!cfg.rootDir || !fs.existsSync(cfg.rootDir)) {
            return { ok: false, error: '未配置有效镜像目录或目录不存在' };
        }
        const openResult = await this.shell.openPath(cfg.rootDir);
        if (openResult) {
            return { ok: false, error: openResult };
        }
        return { ok: true };
    }

    readMirrorIndex(rootDir, forceReset = false) {
        const empty = {
            version: 1,
            cursorSince: null,
            notebooks: {},
            folders: {},
            notes: {}
        };
        if (forceReset) return empty;
        const idxPath = this.resolveSafePath(rootDir, INDEX_FILE_NAME);
        if (!idxPath || !fs.existsSync(idxPath)) return empty;
        try {
            const parsed = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
            return {
                version: 1,
                cursorSince: parsed?.cursorSince || null,
                notebooks: parsed?.notebooks || {},
                folders: parsed?.folders || {},
                notes: parsed?.notes || {}
            };
        } catch {
            return empty;
        }
    }

    async writeMirrorIndex(rootDir, indexData) {
        const idxPath = this.resolveSafePath(rootDir, INDEX_FILE_NAME);
        if (!idxPath) {
            throw new Error('镜像索引路径校验失败');
        }
        await fs.promises.writeFile(idxPath, JSON.stringify(indexData, null, 2), 'utf8');
    }

    async safeUnlink(rootDir, relPath) {
        const fullPath = this.resolveSafePath(rootDir, relPath);
        if (!fullPath || path.basename(fullPath) === INDEX_FILE_NAME) return false;
        try {
            if (fs.existsSync(fullPath)) {
                await fs.promises.unlink(fullPath);
                await this.pruneEmptyDirs(rootDir, path.dirname(fullPath));
                return true;
            }
        } catch (err) {
            console.warn('[MirrorService] Unlink warning:', err.message);
        }
        return false;
    }

    async pruneEmptyDirs(rootDir, startDir) {
        const resolvedRoot = path.resolve(rootDir);
        let current = path.resolve(startDir);
        while (current !== resolvedRoot && this.isInsideRoot(resolvedRoot, current)) {
            try {
                const entries = await fs.promises.readdir(current);
                if (entries.length > 0) break;
                await fs.promises.rmdir(current);
                current = path.dirname(current);
            } catch {
                break;
            }
        }
    }

    buildFolderChainSegments(folderId, foldersMap, visited = new Set()) {
        if (!folderId || visited.has(folderId)) return [];
        const folder = foldersMap[folderId];
        if (!folder || folder.isDeleted) return [];
        visited.add(folderId);
        const parentSegments = folder.parentId
            ? this.buildFolderChainSegments(folder.parentId, foldersMap, visited)
            : [];
        return [...parentSegments, sanitizeSegment(folder.title, '未命名文件夹')];
    }

    computeContentHash(text) {
        return crypto.createHash('sha256').update(text || '', 'utf8').digest('hex');
    }

    /**
     * 执行镜像落盘同步：
     * @param {object} payload - { items, notebooks, serverTime, fullSync, isFinalPage }
     */
    async runSync(payload = {}) {
        const cfg = this.readConfigFile();
        if (!cfg.rootDir) {
            return { ok: false, error: '尚未选择授权本地镜像目录' };
        }
        if (!fs.existsSync(cfg.rootDir)) {
            return { ok: false, error: '授权本地镜像目录不存在，请重新选择目录' };
        }
        if (this.isSyncing) {
            return { ok: false, busy: true, error: '镜像同步正在执行中' };
        }

        this.isSyncing = true;
        const rootDir = path.resolve(cfg.rootDir);
        const fullSync = Boolean(payload.fullSync);

        try {
            const indexData = this.readMirrorIndex(rootDir, fullSync);
            const items = Array.isArray(payload.items) ? payload.items : [];
            const notebooks = Array.isArray(payload.notebooks) ? payload.notebooks : [];

            // 1. 刷新笔记本名称映射
            notebooks.forEach(nb => {
                const nbId = String(nb?._id || nb?.id || '');
                if (!nbId) return;
                indexData.notebooks[nbId] = {
                    name: sanitizeSegment(nb.name || nb.title, '默认笔记本'),
                    isEncrypted: Boolean(nb.isEncrypted)
                };
            });

            // 2. 先更新目录树元数据（folders）
            const folderChangedIds = new Set();
            items.forEach(item => {
                const id = String(item?._id || item?.id || '');
                if (!id) return;
                const itemType = item.type || item.noteType;
                if (itemType !== 'folder') return;

                const isDeleted = Boolean(item.isDeleted || item.deletedAt);
                if (isDeleted) {
                    if (indexData.folders[id]) {
                        indexData.folders[id].isDeleted = true;
                        folderChangedIds.add(id);
                    }
                    return;
                }

                const nbId = String(item.notebookId?._id || item.notebookId || '');
                const parentId = item.parentId ? String(item.parentId?._id || item.parentId) : null;
                const prev = indexData.folders[id];
                const nextTitle = sanitizeSegment(item.title, '未命名文件夹');

                if (!prev || prev.title !== nextTitle || prev.parentId !== parentId || prev.notebookId !== nbId) {
                    folderChangedIds.add(id);
                }

                indexData.folders[id] = {
                    title: nextTitle,
                    parentId,
                    notebookId: nbId,
                    isDeleted: false
                };
            });

            // 构建当前已占用小写相对路径映射（防止 Windows 大小写不敏感覆盖同名笔记）
            const usedPathsLower = new Map();
            Object.entries(indexData.notes).forEach(([nId, entry]) => {
                if (entry?.relPath) {
                    usedPathsLower.set(entry.relPath.toLowerCase(), nId);
                }
            });

            const stats = {
                written: 0,
                moved: 0,
                removed: 0,
                skippedEncrypted: 0,
                unchanged: 0,
                totalTracked: 0,
                syncedAt: new Date().toISOString()
            };

            const resolveNoteRelPath = ({ id, title, notebookId, parentId }) => {
                const nbName = indexData.notebooks[notebookId]?.name || '默认笔记本';
                const folderSegs = parentId
                    ? this.buildFolderChainSegments(parentId, indexData.folders)
                    : [];
                const dirParts = [nbName, ...folderSegs];
                const baseTitle = sanitizeSegment(title, '无标题笔记');
                const shortId = String(id).slice(-6) || 'note';

                const primaryRel = path.posix.join(...dirParts, `${baseTitle}.md`);
                const owner = usedPathsLower.get(primaryRel.toLowerCase());
                if (!owner || owner === id) {
                    return primaryRel;
                }
                return path.posix.join(...dirParts, `${baseTitle}_${shortId}.md`);
            };

            // 3. 处理每篇笔记条目（严格跳过加密笔记）
            for (const item of items) {
                const id = String(item?._id || item?.id || '');
                if (!id) continue;
                const itemType = item.type || item.noteType || 'note';
                if (itemType === 'folder') continue;

                const nbId = String(item.notebookId?._id || item.notebookId || '');
                const parentId = item.parentId ? String(item.parentId?._id || item.parentId) : null;
                const existingEntry = indexData.notes[id];

                // 强制跳过端到端加密笔记或所属加密笔记本内的条目
                if (item.isEncrypted || indexData.notebooks[nbId]?.isEncrypted) {
                    stats.skippedEncrypted += 1;
                    // 若该笔记此前为明文镜像、现已升级加密，删除磁盘残留明文
                    if (existingEntry?.relPath) {
                        await this.safeUnlink(rootDir, existingEntry.relPath);
                        usedPathsLower.delete(existingEntry.relPath.toLowerCase());
                        delete indexData.notes[id];
                    }
                    continue;
                }

                const isDeleted = Boolean(item.isDeleted || item.deletedAt);
                if (isDeleted) {
                    if (existingEntry?.relPath) {
                        const deleted = await this.safeUnlink(rootDir, existingEntry.relPath);
                        if (deleted) stats.removed += 1;
                        usedPathsLower.delete(existingEntry.relPath.toLowerCase());
                        delete indexData.notes[id];
                    }
                    continue;
                }

                const nextRelPath = resolveNoteRelPath({
                    id,
                    title: item.title,
                    notebookId: nbId,
                    parentId
                });
                const targetFullPath = this.resolveSafePath(rootDir, nextRelPath);
                if (!targetFullPath) {
                    throw new Error(`非法镜像目标路径被拦截: ${nextRelPath}`);
                }

                const mdContent = typeof item.content === 'string' ? item.content : '';
                const nextHash = this.computeContentHash(mdContent);
                const moved = Boolean(existingEntry && existingEntry.relPath !== nextRelPath);

                if (moved) {
                    await this.safeUnlink(rootDir, existingEntry.relPath);
                    usedPathsLower.delete(existingEntry.relPath.toLowerCase());
                }

                const fileMissing = !fs.existsSync(targetFullPath);
                if (moved || !existingEntry || existingEntry.hash !== nextHash || fileMissing) {
                    await fs.promises.mkdir(path.dirname(targetFullPath), { recursive: true });
                    await fs.promises.writeFile(targetFullPath, mdContent, 'utf8');
                    if (moved) {
                        stats.moved += 1;
                    } else {
                        stats.written += 1;
                    }
                } else {
                    stats.unchanged += 1;
                }

                usedPathsLower.set(nextRelPath.toLowerCase(), id);
                indexData.notes[id] = {
                    relPath: nextRelPath,
                    hash: nextHash,
                    title: item.title || '无标题笔记',
                    notebookId: nbId,
                    parentId,
                    updatedAt: item.updatedAt || null,
                    contentVersion: item.contentVersion ?? null
                };
            }

            // 4. 若全量同步，清理云端已不存在的孤儿历史文件
            if (fullSync) {
                const seenNoteIds = new Set(
                    items
                        .filter(i => (i?.type || i?.noteType || 'note') !== 'folder' && !(i?.isDeleted || i?.deletedAt))
                        .map(i => String(i._id || i.id))
                );
                for (const oldId of Object.keys(indexData.notes)) {
                    if (!seenNoteIds.has(oldId)) {
                        const oldEntry = indexData.notes[oldId];
                        if (oldEntry?.relPath) {
                            const removed = await this.safeUnlink(rootDir, oldEntry.relPath);
                            if (removed) stats.removed += 1;
                            usedPathsLower.delete(oldEntry.relPath.toLowerCase());
                        }
                        delete indexData.notes[oldId];
                    }
                }
            } else if (folderChangedIds.size > 0) {
                // 增量同步时若文件夹改名或移动，迁移其下挂已缓存且未出现在本批 items 内的笔记文件
                const batchIds = new Set(items.map(i => String(i?._id || i?.id || '')));
                for (const [nId, entry] of Object.entries(indexData.notes)) {
                    if (batchIds.has(nId) || !entry?.parentId) continue;
                    const expectedRel = resolveNoteRelPath({
                        id: nId,
                        title: entry.title,
                        notebookId: entry.notebookId,
                        parentId: entry.parentId
                    });
                    if (expectedRel !== entry.relPath) {
                        const oldFull = this.resolveSafePath(rootDir, entry.relPath);
                        const newFull = this.resolveSafePath(rootDir, expectedRel);
                        if (oldFull && newFull && fs.existsSync(oldFull)) {
                            await fs.promises.mkdir(path.dirname(newFull), { recursive: true });
                            await fs.promises.rename(oldFull, newFull);
                            await this.pruneEmptyDirs(rootDir, path.dirname(oldFull));
                            usedPathsLower.delete(entry.relPath.toLowerCase());
                            usedPathsLower.set(expectedRel.toLowerCase(), nId);
                            entry.relPath = expectedRel;
                            stats.moved += 1;
                        }
                    }
                }
            }

            if (payload.isFinalPage !== false && payload.serverTime) {
                indexData.cursorSince = payload.serverTime;
            }
            await this.writeMirrorIndex(rootDir, indexData);

            stats.totalTracked = Object.keys(indexData.notes).length;

            const updatedConfig = {
                ...cfg,
                lastSyncAt: payload.isFinalPage !== false && payload.serverTime ? payload.serverTime : cfg.lastSyncAt,
                lastStats: stats
            };
            await this.writeConfigFile(updatedConfig);

            return {
                ok: true,
                stats,
                config: await this.getConfig()
            };
        } catch (err) {
            console.error('[MirrorService] runSync error:', err);
            return { ok: false, error: err.message || '镜像同步写入失败' };
        } finally {
            this.isSyncing = false;
        }
    }
}

module.exports = MirrorService;
