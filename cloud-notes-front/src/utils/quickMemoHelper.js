export const MAX_TEXT_MEMO_BYTES = 50 * 1024; // 50KB
export const MAX_SINGLE_FILE_SIZE = 100 * 1024 * 1024; // 100MB
export const MAX_TOTAL_BATCH_SIZE = 500 * 1024 * 1024; // 500MB
export const DEFAULT_TEMP_TTL_MINUTES = 20;

const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"'`\u3000-\u303f\uff00-\uffef]+/gi;
const TRAILING_PUNCTUATION_PATTERN = /[.,;:!?}>"'，。；：！？）》】」』、]+$/;

function countChar(str, ch) {
    let count = 0;
    for (let i = 0; i < str.length; i += 1) {
        if (str[i] === ch) count += 1;
    }
    return count;
}

/**
 * 裁剪 URL 尾部非成对标点，保留维基/Markdown 链接中的成对 () 与 []
 * @param {string} rawUrl
 * @returns {string}
 */
export function stripTrailingUrlPunctuation(rawUrl = '') {
    let candidate = String(rawUrl || '').trim();
    let prev;
    do {
        prev = candidate;
        candidate = candidate.replace(TRAILING_PUNCTUATION_PATTERN, '');
        while (candidate.endsWith(')') && countChar(candidate, '(') < countChar(candidate, ')')) {
            candidate = candidate.slice(0, -1);
        }
        while (candidate.endsWith(']') && countChar(candidate, '[') < countChar(candidate, ']')) {
            candidate = candidate.slice(0, -1);
        }
    } while (candidate !== prev);
    return candidate;
}

/**
 * 校验并标准化安全 HTTP/HTTPS 外链，拦截 javascript:/data:/file: 等非安全协议
 * @param {string} rawUrl
 * @returns {{ url: string, host: string } | null}
 */
export function parseSafeHttpUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    const cleaned = stripTrailingUrlPunctuation(rawUrl);
    if (!cleaned) return null;

    try {
        const parsed = new URL(cleaned);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return null;
        }
        return {
            url: parsed.href,
            host: parsed.host
        };
    } catch {
        return null;
    }
}

/**
 * 从文本中提取去重后的安全 http/https 链接列表
 * @param {string} text
 * @returns {Array<{ url: string, host: string }>}
 */
export function extractSafeUrls(text = '') {
    if (!text || typeof text !== 'string') return [];
    const seen = new Set();
    const results = [];
    const matches = text.match(HTTP_URL_PATTERN) || [];

    for (const raw of matches) {
        const parsed = parseSafeHttpUrl(raw);
        if (parsed && !seen.has(parsed.url)) {
            seen.add(parsed.url);
            results.push(parsed);
        }
    }
    return results;
}

/**
 * 将纯文本拆分为普通文本与安全外链片段，供 UI 无 XSS 风险渲染
 * @param {string} text
 * @returns {Array<{ type: 'text'|'link', value: string, href?: string }>}
 */
export function splitTextWithSafeLinks(text = '') {
    if (!text || typeof text !== 'string') return [];
    const segments = [];
    const pushText = val => {
        if (!val) return;
        const last = segments[segments.length - 1];
        if (last && last.type === 'text') {
            last.value += val;
        } else {
            segments.push({ type: 'text', value: val });
        }
    };

    const regex = new RegExp(HTTP_URL_PATTERN.source, 'gi');
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            pushText(text.slice(lastIndex, match.index));
        }

        const rawMatch = match[0];
        const strippedMatch = stripTrailingUrlPunctuation(rawMatch);
        const trailing = rawMatch.slice(strippedMatch.length);
        const parsed = parseSafeHttpUrl(strippedMatch);

        if (parsed) {
            segments.push({ type: 'link', value: strippedMatch, href: parsed.url });
        } else {
            pushText(strippedMatch);
        }
        pushText(trailing);
        lastIndex = match.index + rawMatch.length;
    }

    if (lastIndex < text.length) {
        pushText(text.slice(lastIndex));
    }
    return segments;
}

/**
 * 格式化文件体积
 * @param {number} bytes
 * @param {number} [decimals=1]
 */
export function formatBytes(bytes = 0, decimals = 1) {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * 计算服务端与本地时钟偏差（ms）
 * @param {string|Date} serverTime
 * @param {number} [nowMs=Date.now()]
 */
export function computeServerClockOffset(serverTime, nowMs = Date.now()) {
    if (!serverTime) return 0;
    const serverMs = new Date(serverTime).getTime();
    if (Number.isNaN(serverMs)) return 0;
    return serverMs - nowMs;
}

/**
 * 基于 expireAt 与服务端时差计算当前剩余秒数
 * @param {string|Date|null} expireAt
 * @param {number} [clockOffsetMs=0]
 * @param {number} [nowMs=Date.now()]
 * @returns {number|null}
 */
export function computeRemainingSeconds(expireAt, clockOffsetMs = 0, nowMs = Date.now()) {
    if (!expireAt) return null;
    const expireMs = new Date(expireAt).getTime();
    if (Number.isNaN(expireMs)) return null;
    return Math.max(0, Math.floor((expireMs - (nowMs + clockOffsetMs)) / 1000));
}

/**
 * 格式化倒计时 MM:SS
 * @param {number|null} totalSeconds
 */
export function formatCountdownMMSS(totalSeconds) {
    if (totalSeconds == null || totalSeconds <= 0) return '00:00';
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    if (hours > 0) {
        return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * 根据时间生成截图默认文件名
 * @param {string} [mimeType='image/png']
 * @param {Date} [now=new Date()]
 */
export function buildClipboardImageName(mimeType = 'image/png', now = new Date()) {
    const pad = n => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const extMap = {
        'image/jpeg': 'jpg',
        'image/webp': 'webp',
        'image/gif': 'gif',
        'image/bmp': 'bmp',
        'image/svg+xml': 'svg'
    };
    const ext = extMap[mimeType] || 'png';
    return `screenshot-${stamp}.${ext}`;
}

/**
 * 构造待发送附件胶囊对象
 * @param {File} file
 * @param {object} [options] - { relativePath, folderName, fromClipboard, previewUrl }
 */
export function createPendingAttachment(file, options = {}) {
    const isImage = Boolean(
        (file?.type && file.type.startsWith('image/')) ||
        /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file?.name || '')
    );
    const rawName = file?.name || '';
    const shouldRenameClipboardImage =
        options.fromClipboard && isImage && (!rawName || /^image\.(png|jpe?g|webp|gif|bmp)$/i.test(rawName));
    const displayName = shouldRenameClipboardImage ? buildClipboardImageName(file?.type) : (rawName || '未命名文件');

    let normalizedFile = file;
    if (shouldRenameClipboardImage && typeof File !== 'undefined' && file) {
        try {
            normalizedFile = new File([file], displayName, {
                type: file.type || 'image/png',
                lastModified: file.lastModified || Date.now()
            });
        } catch {
            normalizedFile = file;
        }
    }

    return {
        uid: `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        file: normalizedFile,
        name: displayName,
        size: file?.size || 0,
        mimetype: file?.type || '',
        isImage,
        previewUrl: options.previewUrl || null,
        relativePath: options.relativePath || displayName,
        folderName: options.folderName || ''
    };
}

/**
 * 校验待上传附件批次的单文件与总大小限制
 * @param {Array<object>} items
 * @returns {{ ok: boolean, error?: string, totalSize: number }}
 */
export function validateQuickMemoBatch(items = []) {
    let totalSize = 0;
    for (const item of items) {
        const size = item?.file?.size ?? item?.size ?? 0;
        const name = item?.name || item?.file?.name || '未命名文件';
        if (size > MAX_SINGLE_FILE_SIZE) {
            return {
                ok: false,
                error: `文件【${name}】超出单文件 100MB 限制（当前: ${formatBytes(size)}）`,
                totalSize
            };
        }
        totalSize += size;
    }
    if (totalSize > MAX_TOTAL_BATCH_SIZE) {
        return {
            ok: false,
            error: `批量上传总容量超出 500MB 上限（当前: ${formatBytes(totalSize)}），请分批上传`,
            totalSize
        };
    }
    return { ok: true, totalSize };
}

/**
 * 获取随心记条目统一 ID
 * @param {object} item
 */
export function getMemoId(item) {
    return String(item?._id || item?.id || '');
}

/**
 * 判断条目是否为图片类或文件类附件
 * @param {object} item
 */
export function isMemoVisualImage(item) {
    if (!item?.attachment) return false;
    if (item.kind === 'image') return true;
    const mimetype = item.attachment.mimetype || '';
    const name = item.attachment.originalName || item.attachment.filename || '';
    return mimetype.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(name);
}

/**
 * 合并 /quick-notes/delta 增量返回（支持新增/更新、isDeleted 软删墓碑、legacyItems 存量同步及时间升序排列）
 * @param {Array<object>} currentItems
 * @param {object} deltaRes
 * @returns {Array<object>}
 */
export function mergeQuickMemoDelta(currentItems = [], deltaRes = {}) {
    const itemMap = new Map();
    const hasLegacySnapshot = Array.isArray(deltaRes?.legacyItems);

    for (const existing of currentItems) {
        const id = getMemoId(existing);
        if (!id) continue;
        if (hasLegacySnapshot && existing.legacySource === 'stash') {
            continue;
        }
        itemMap.set(id, existing);
    }

    if (hasLegacySnapshot) {
        for (const legacy of deltaRes.legacyItems) {
            const id = getMemoId(legacy);
            if (id && !legacy.isDeleted) {
                itemMap.set(id, legacy);
            }
        }
    }

    const deltaItems = Array.isArray(deltaRes?.items) ? deltaRes.items : [];
    for (const incoming of deltaItems) {
        const id = getMemoId(incoming);
        if (!id) continue;
        if (incoming.isDeleted) {
            itemMap.delete(id);
        } else {
            itemMap.set(id, incoming);
        }
    }

    return Array.from(itemMap.values()).sort((a, b) => {
        const ta = new Date(a?.createdAt || 0).getTime();
        const tb = new Date(b?.createdAt || 0).getTime();
        if (ta !== tb) return ta - tb;
        return getMemoId(a).localeCompare(getMemoId(b));
    });
}

/**
 * 统计随心记计数（兼容服务端 counts 字段与本地剔除后重算）
 * @param {Array<object>} items
 */
export function computeQuickMemoCounts(items = []) {
    let temp = 0;
    let permanent = 0;
    for (const item of items) {
        if (item?.storageType === 'temp') temp += 1;
        else permanent += 1;
    }
    return {
        all: items.length,
        temp,
        permanent
    };
}

/**
 * 根据随心记条目自动推导转存笔记默认标题
 * @param {object} memo
 */
export function deriveNoteTitleFromMemo(memo) {
    if (!memo) return '随心记转存';

    if (memo.attachment?.originalName) {
        const stripped = memo.attachment.originalName.replace(/\.[^.]+$/, '').trim();
        return (stripped || memo.attachment.originalName).slice(0, 50);
    }

    const text = String(memo.content || '').trim();
    if (text) {
        const firstLine = text.split(/\r?\n/).find(line => line.trim()) || '';
        const cleanedLine = firstLine.trim();
        if (cleanedLine && !/^https?:\/\//i.test(cleanedLine)) {
            return cleanedLine.slice(0, 40);
        }
    }

    const firstLink = memo.links?.[0] || extractSafeUrls(text)[0];
    if (firstLink?.host) {
        return `${firstLink.host} 链接摘录`.slice(0, 50);
    }

    return '随心记摘录';
}

/**
 * 生成前端幂等 clientId
 * @param {string} [prefix='qm']
 */
export function generateClientId(prefix = 'qm') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
