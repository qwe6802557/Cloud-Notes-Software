import { deltaSyncNotes } from '@/api/notes';

/**
 * 判断当前是否处于带 mirror IPC 能力的 Electron 桌面端环境
 */
export function isDesktopMirrorSupported() {
    return typeof window !== 'undefined' && Boolean(window.electronAPI?.mirror);
}

/**
 * 在渲染进程通过 deltaSyncNotes 游标增量拉取全库笔记本与笔记变更，并交由主进程 MirrorService 落盘
 *
 * @param {object} [options] - { fullSync?: boolean, limit?: number }
 */
export async function runLocalMirrorSync(options = {}) {
    if (!isDesktopMirrorSupported()) {
        return { ok: false, unsupported: true, error: '当前环境不支持本地目录镜像，请使用桌面客户端' };
    }

    const fullSync = Boolean(options.fullSync);
    const limit = options.limit || 100;
    const mirrorApi = window.electronAPI.mirror;

    const config = await mirrorApi.getConfig();
    if (!config?.rootDir) {
        return { ok: false, error: '请先选择授权本地镜像目录' };
    }

    let since = fullSync ? undefined : (config.lastSyncAt || undefined);
    let cursorId = undefined;
    let hasMore = true;
    let serverTime = null;
    let notebooks = [];
    const items = [];
    const MAX_PAGES = 200;
    let pageCount = 0;

    while (hasMore && pageCount < MAX_PAGES) {
        pageCount += 1;
        const res = await deltaSyncNotes({
            since,
            cursorId,
            limit,
            includeContent: true
        }, { skipErrorToast: true });

        if (Array.isArray(res?.notebooks) && res.notebooks.length > 0) {
            notebooks = res.notebooks;
        }
        if (Array.isArray(res?.items) && res.items.length > 0) {
            items.push(...res.items);
        }
        if (res?.serverTime) {
            serverTime = res.serverTime;
        }

        // 后端 nextCursor 结构为 { since, cursorId } | null，翻页需同时推进游标并防死循环
        const nextCursor = res?.nextCursor;
        const nextSince = nextCursor && typeof nextCursor === 'object' ? nextCursor.since : since;
        const nextCursorId = nextCursor && typeof nextCursor === 'object' ? nextCursor.cursorId : nextCursor;
        const cursorStuck = nextSince === since && nextCursorId === cursorId;

        hasMore = Boolean(res?.hasMore && nextCursor && (nextSince || nextCursorId) && !cursorStuck);
        if (hasMore) {
            since = nextSince || undefined;
            cursorId = nextCursorId || undefined;
        }
    }

    return mirrorApi.runSync({
        items,
        notebooks,
        serverTime,
        fullSync,
        isFinalPage: true
    });
}
