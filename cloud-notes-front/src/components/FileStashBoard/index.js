import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Button, Empty, Progress, Segmented, Tooltip, message } from 'antd';
import {
    CloudUploadOutlined,
    CopyOutlined,
    DeleteOutlined,
    DownloadOutlined,
    ExportOutlined,
    EyeOutlined,
    FileAddOutlined,
    FolderOutlined,
    PlusCircleOutlined,
    ReloadOutlined,
    SaveOutlined,
    SendOutlined,
    UnorderedListOutlined,
    VerticalAlignBottomOutlined
} from '@ant-design/icons';
import {
    createQuickTextMemo,
    deleteQuickMemo,
    deleteQuickMemoFolder,
    deltaSyncQuickNotes,
    downloadQuickMemoFolder,
    extendQuickMemo,
    getQuickNotes,
    promoteQuickMemo,
    promoteQuickMemoFolder,
    uploadQuickMemoFile
} from '@/api/quickNotes';
import ContextMenu from '@/components/ContextMenu';
import { resolveAssetUrl } from '@/utils/env';
import {
    computeQuickMemoCounts,
    computeServerClockOffset,
    createPendingAttachment,
    DEFAULT_TEMP_TTL_MINUTES,
    extractSafeUrls,
    formatBytes,
    generateClientId,
    getMemoId,
    isMemoVisualImage,
    MAX_TEXT_MEMO_BYTES,
    mergeQuickMemoDelta,
    parseSafeHttpUrl,
    validateQuickMemoBatch
} from '@/utils/quickMemoHelper';
import FilePreviewPanel from './FilePreviewPanel';
import QuickMemoCard from './QuickMemoCard';
import QuickMemoComposer from './QuickMemoComposer';
import ConvertToNoteModal from './ConvertToNoteModal';
import FolderExplorerView from './FolderExplorerView';
import './index.less';

const POLL_INTERVAL_MS = 5000;

const readAllDirectoryEntries = async directoryReader => {
    const entries = [];
    const readBatch = () => new Promise((resolve, reject) => {
        directoryReader.readEntries(resolve, reject);
    });
    let batch = await readBatch();
    while (batch && batch.length > 0) {
        entries.push(...batch);
        batch = await readBatch();
    }
    return entries;
};

const traverseEntry = async (entry, pathPrefix = '') => {
    const result = [];
    if (entry.isFile) {
        const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
        const relativePath = pathPrefix ? `${pathPrefix}/${file.name}` : file.name;
        result.push({
            file,
            relativePath,
            folderName: pathPrefix ? pathPrefix.split('/')[0] : ''
        });
    } else if (entry.isDirectory) {
        const dirReader = entry.createReader();
        const currentPath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;
        const entries = await readAllDirectoryEntries(dirReader);
        for (const child of entries) {
            const childFiles = await traverseEntry(child, currentPath);
            result.push(...childFiles);
        }
    }
    return result;
};

const parseDropItems = async dataTransfer => {
    const items = dataTransfer.items;
    const filesToUpload = [];

    if (items && items.length > 0 && items[0].webkitGetAsEntry) {
        for (let i = 0; i < items.length; i += 1) {
            const item = items[i];
            if (item.kind === 'file') {
                const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
                if (entry) {
                    const scanned = await traverseEntry(entry, '');
                    filesToUpload.push(...scanned);
                }
            }
        }
    } else if (dataTransfer.files && dataTransfer.files.length > 0) {
        for (let i = 0; i < dataTransfer.files.length; i += 1) {
            const f = dataTransfer.files[i];
            filesToUpload.push({
                file: f,
                relativePath: f.webkitRelativePath || f.name,
                folderName: f.webkitRelativePath && f.webkitRelativePath.includes('/') ? f.webkitRelativePath.split('/')[0] : ''
            });
        }
    }

    return filesToUpload;
};

const copyToClipboard = async (value, successMsg = '已复制') => {
    if (!value) return;
    try {
        if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
        } else {
            const textarea = document.createElement('textarea');
            textarea.value = value;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        }
        message.success(successMsg);
    } catch {
        message.error('复制失败，请检查剪贴板权限');
    }
};

export default function FileStashBoard({
    active = true,
    activeNotebookId = null,
    focusTrigger = 0,
    onNoteCreated,
    onOpenNote
}) {
    const [items, setItems] = useState([]);
    const counts = useMemo(() => computeQuickMemoCounts(items), [items]);
    const [quota, setQuota] = useState({ permanentUsedBytes: 0, permanentLimitBytes: 2 * 1024 * 1024 * 1024 });
    const [clockOffsetMs, setClockOffsetMs] = useState(0);
    const [loading, setLoading] = useState(false);

    const [storageFilter, setStorageFilter] = useState('all'); // 'all' | 'temp' | 'permanent'
    const [kindFilter, setKindFilter] = useState('all'); // 'all' | 'text_link' | 'image' | 'file'
    const [viewMode, setViewMode] = useState('timeline'); // 'timeline' | 'folder'
    const [currentPath, setCurrentPath] = useState('');

    // 输入与待发附件胶囊状态
    const [composerStorageType, setComposerStorageType] = useState('temp');
    const [composerText, setComposerText] = useState('');
    const [pendingAttachments, setPendingAttachments] = useState([]);
    const [sending, setSending] = useState(false);

    // 批量上传进度
    const [uploading, setUploading] = useState(false);
    const [uploadPercent, setUploadPercent] = useState(0);
    const [uploadingFileName, setUploadingFileName] = useState('');
    const [uploadCompletedCount, setUploadCompletedCount] = useState(0);
    const [uploadTotalCount, setUploadTotalCount] = useState(0);

    // 全容器拖拽状态
    const [isDragOver, setIsDragOver] = useState(false);
    const dragCounterRef = useRef(0);

    // 右侧即时预览与平滑卸载缓存
    const [previewItem, setPreviewItem] = useState(null);
    const [renderedPreviewItem, setRenderedPreviewItem] = useState(null);
    const [isFullScreen, setIsFullScreen] = useState(false);

    // 转存为笔记弹窗与右键菜单
    const [convertTarget, setConvertTarget] = useState(null);
    const [contextMenu, setContextMenu] = useState({ open: false, x: 0, y: 0, item: null });
    const [hasNewBelow, setHasNewBelow] = useState(false);

    const fileInputRef = useRef(null);
    const folderInputRef = useRef(null);
    const composerInputRef = useRef(null);
    const feedScrollRef = useRef(null);
    const boardRootRef = useRef(null);
    const cursorRef = useRef({ since: null, cursorId: null });
    const isSyncingRef = useRef(false);
    const objectUrlsRef = useRef(new Set());
    const initialLoadedRef = useRef(false);
    const knownItemIdsRef = useRef(new Set());

    useEffect(() => {
        knownItemIdsRef.current = new Set(items.map(getMemoId));
    }, [items]);

    const isNearBottom = useCallback(() => {
        const el = feedScrollRef.current;
        if (!el) return true;
        return el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    }, []);

    const scrollToBottom = useCallback((behavior = 'smooth') => {
        requestAnimationFrame(() => {
            const el = feedScrollRef.current;
            if (!el) return;
            el.scrollTo({ top: el.scrollHeight, behavior });
            setHasNewBelow(false);
        });
    }, []);

    useEffect(() => {
        if (previewItem) {
            setRenderedPreviewItem(previewItem);
        } else {
            setIsFullScreen(false);
            const timer = setTimeout(() => {
                setRenderedPreviewItem(null);
            }, 320);
            return () => clearTimeout(timer);
        }
        return undefined;
    }, [previewItem]);

    useEffect(() => {
        const urls = objectUrlsRef.current;
        return () => {
            urls.forEach(url => URL.revokeObjectURL(url));
            urls.clear();
        };
    }, []);

    const revokeAttachmentUrl = useCallback(att => {
        if (att?.previewUrl && objectUrlsRef.current.has(att.previewUrl)) {
            URL.revokeObjectURL(att.previewUrl);
            objectUrlsRef.current.delete(att.previewUrl);
        }
    }, []);

    const activePreviewItem = previewItem || renderedPreviewItem;
    const previewItemId = previewItem ? getMemoId(previewItem) : null;

    // 切换分栏过滤时联动默认存储倾向（切全部保持现有选择）
    const handleStorageFilterChange = val => {
        setStorageFilter(val);
        if (val === 'temp' || val === 'permanent') {
            setComposerStorageType(val);
        }
        setCurrentPath('');
    };

    const fetchFullList = useCallback(async ({ silent = false, scrollBottom = false } = {}) => {
        if (isSyncingRef.current) return;
        isSyncingRef.current = true;
        if (!silent) setLoading(true);

        try {
            const res = await getQuickNotes({ limit: 500 }, { skipErrorToast: silent });
            const list = Array.isArray(res?.items) ? res.items : [];
            setItems(list);
            if (res?.quota) setQuota(res.quota);
            if (res?.serverTime) {
                setClockOffsetMs(computeServerClockOffset(res.serverTime));
            }
            if (res?.nextCursor) {
                cursorRef.current = res.nextCursor;
            } else if (res?.serverTime) {
                cursorRef.current = { since: res.serverTime, cursorId: null };
            }
            initialLoadedRef.current = true;

            if (scrollBottom) {
                scrollToBottom('auto');
            }
        } catch {
            if (!silent) {
                message.error('加载随心记列表失败');
            }
        } finally {
            isSyncingRef.current = false;
            if (!silent) setLoading(false);
        }
    }, [scrollToBottom]);

    const runDeltaSync = useCallback(async () => {
        if (!active || document.hidden || isSyncingRef.current) return;
        if (!cursorRef.current?.since) {
            await fetchFullList({ silent: true, scrollBottom: !initialLoadedRef.current });
            return;
        }

        isSyncingRef.current = true;
        const wasNearBottom = isNearBottom();
        let nextSince = cursorRef.current.since;
        let nextCursorId = cursorRef.current.cursorId;
        let hasMore = true;
        let pageCount = 0;
        const deltaPages = [];
        let latestRes = null;

        try {
            while (hasMore && pageCount < 10) {
                pageCount += 1;
                const res = await deltaSyncQuickNotes({
                    since: nextSince,
                    cursorId: nextCursorId || undefined,
                    limit: 200
                }, { skipErrorToast: true });

                latestRes = res;
                if (res?.items?.length > 0 || Array.isArray(res?.legacyItems)) {
                    deltaPages.push(res);
                }

                const cursorObj = res?.nextCursor;
                const candidateSince = cursorObj?.since || res?.serverTime || nextSince;
                const candidateId = cursorObj?.cursorId || null;
                const stuck = candidateSince === nextSince && candidateId === nextCursorId;

                nextSince = candidateSince;
                nextCursorId = candidateId;
                hasMore = Boolean(res?.hasMore && !stuck);
            }

            const addedAny = deltaPages.some(
                p =>
                    (Array.isArray(p?.items) && p.items.some(it => !it.isDeleted && !knownItemIdsRef.current.has(getMemoId(it)))) ||
                    (Array.isArray(p?.legacyItems) && p.legacyItems.some(it => !it.isDeleted && !knownItemIdsRef.current.has(getMemoId(it))))
            );
            if (deltaPages.length > 0) {
                setItems(prev => {
                    let merged = prev;
                    for (const page of deltaPages) {
                        merged = mergeQuickMemoDelta(merged, page);
                    }
                    return merged;
                });
            }

            if (latestRes?.quota) setQuota(latestRes.quota);
            if (latestRes?.serverTime) {
                setClockOffsetMs(computeServerClockOffset(latestRes.serverTime));
            }

            if (latestRes) {
                cursorRef.current = {
                    since: nextSince,
                    cursorId: nextCursorId
                };
            }

            // 同步刷新当前右侧预览项状态（转永久/已删除）
            if (deltaPages.length > 0) {
                const flatDeltaItems = deltaPages.flatMap(p => p?.items || []);
                setPreviewItem(curr => {
                    if (!curr) return null;
                    const currId = getMemoId(curr);
                    const updated = flatDeltaItems.find(it => getMemoId(it) === currId);
                    if (!updated) return curr;
                    return updated.isDeleted ? null : updated;
                });
            }

            if (addedAny) {
                if (wasNearBottom) {
                    scrollToBottom('smooth');
                } else {
                    setHasNewBelow(true);
                }
            }
        } catch {
            // 静默增量失败不打断用户当前输入
        } finally {
            isSyncingRef.current = false;
        }
    }, [active, fetchFullList, isNearBottom, scrollToBottom]);

    // 初次挂载加载全量
    useEffect(() => {
        fetchFullList({ scrollBottom: true });
    }, [fetchFullList]);

    // 激活态且页面可见时启用 5s 增量轮询；失活/后台即刻清理，聚焦即拉
    useEffect(() => {
        if (!active) return undefined;

        let pollTimer = null;
        const startPolling = () => {
            if (pollTimer) clearInterval(pollTimer);
            if (!document.hidden) {
                pollTimer = setInterval(runDeltaSync, POLL_INTERVAL_MS);
            }
        };

        const handleVisibilityOrFocus = () => {
            if (document.hidden) {
                if (pollTimer) {
                    clearInterval(pollTimer);
                    pollTimer = null;
                }
            } else {
                runDeltaSync();
                startPolling();
            }
        };

        runDeltaSync();
        startPolling();
        window.addEventListener('focus', handleVisibilityOrFocus);
        document.addEventListener('visibilitychange', handleVisibilityOrFocus);

        return () => {
            if (pollTimer) clearInterval(pollTimer);
            window.removeEventListener('focus', handleVisibilityOrFocus);
            document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
        };
    }, [active, runDeltaSync]);

    // 响应快捷入口唤起聚焦输入框
    useEffect(() => {
        if (active && focusTrigger > 0) {
            setTimeout(() => {
                composerInputRef.current?.focus();
            }, 60);
        }
    }, [active, focusTrigger]);

    // 暂存待发送附件胶囊（Ctrl+V 截图/文件）
    const stageAttachments = useCallback((rawEntries, { fromClipboard = false } = {}) => {
        if (!rawEntries || rawEntries.length === 0) return;

        const created = rawEntries.map(entry => {
            const file = entry?.file || entry;
            const isImg = Boolean(
                (file?.type && file.type.startsWith('image/')) ||
                /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file?.name || '')
            );
            let previewUrl = null;
            if (isImg && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
                previewUrl = URL.createObjectURL(file);
                objectUrlsRef.current.add(previewUrl);
            }
            return createPendingAttachment(file, {
                fromClipboard,
                previewUrl,
                relativePath: entry?.relativePath,
                folderName: entry?.folderName
            });
        });

        setPendingAttachments(prev => {
            const combined = [...prev, ...created];
            const check = validateQuickMemoBatch(combined);
            if (!check.ok) {
                created.forEach(revokeAttachmentUrl);
                message.error(check.error);
                return prev;
            }
            return combined;
        });

        setTimeout(() => composerInputRef.current?.focus(), 30);
    }, [revokeAttachmentUrl]);

    // 面板内任意位置按 Ctrl+V 粘贴图片/文件捕获为待发胶囊
    useEffect(() => {
        if (!active) return undefined;

        const handleGlobalPaste = e => {
            const target = e.target;
            if (target === composerInputRef.current) return;
            if (target?.closest?.('.ant-modal, input, textarea, [contenteditable="true"]')) return;

            const clipItems = Array.from(e.clipboardData?.items || []);
            const files = clipItems
                .filter(it => it.kind === 'file')
                .map(it => it.getAsFile())
                .filter(Boolean);

            if (files.length > 0) {
                e.preventDefault();
                stageAttachments(files, { fromClipboard: true });
            }
        };

        const rootEl = boardRootRef.current;
        if (!rootEl) return undefined;
        window.addEventListener('paste', handleGlobalPaste);
        return () => window.removeEventListener('paste', handleGlobalPaste);
    }, [active, stageAttachments]);

    const handleRemoveAttachment = useCallback(uid => {
        setPendingAttachments(prev => {
            const target = prev.find(it => it.uid === uid);
            if (target) revokeAttachmentUrl(target);
            return prev.filter(it => it.uid !== uid);
        });
    }, [revokeAttachmentUrl]);

    const handleClearAttachments = useCallback(() => {
        setPendingAttachments(prev => {
            prev.forEach(revokeAttachmentUrl);
            return [];
        });
    }, [revokeAttachmentUrl]);

    // 批量文件上传执行器（3 并发 + 20m TTL / 永久）
    const runUploadQueue = useCallback(async (uploadItems, storageType, captionText = '') => {
        if (!uploadItems || uploadItems.length === 0) return;

        const check = validateQuickMemoBatch(uploadItems);
        if (!check.ok) {
            message.error(check.error);
            return;
        }

        const totalSize = check.totalSize;
        setUploading(true);
        setUploadTotalCount(uploadItems.length);
        setUploadCompletedCount(0);
        setUploadPercent(0);

        const batchExpireAt = storageType === 'temp'
            ? new Date(Date.now() + DEFAULT_TEMP_TTL_MINUTES * 60 * 1000).toISOString()
            : null;

        const CONCURRENCY = 3;
        let currentIndex = 0;
        let finishedCount = 0;
        const fileLoadedMap = new Map();
        const uploadedMemos = [];

        const handleProgress = (fileIdx, progressEvent) => {
            fileLoadedMap.set(fileIdx, progressEvent.loaded || 0);
            let totalLoaded = 0;
            fileLoadedMap.forEach(v => {
                totalLoaded += v;
            });
            const pct = totalSize > 0
                ? Math.round((totalLoaded * 100) / totalSize)
                : Math.round((finishedCount * 100) / uploadItems.length);
            setUploadPercent(Math.min(99, pct));
        };

        const worker = async () => {
            while (currentIndex < uploadItems.length) {
                const index = currentIndex;
                currentIndex += 1;
                const entry = uploadItems[index];
                const file = entry.file || entry;
                const displayPath = entry.relativePath || entry.name || file.name;
                setUploadingFileName(displayPath);

                const formData = new FormData();
                formData.append('file', file);
                formData.append('originalName', entry.name || file.name);
                formData.append('storageType', storageType);
                formData.append('ttlMinutes', String(DEFAULT_TEMP_TTL_MINUTES));
                formData.append('clientId', generateClientId('qmf'));
                if (entry.relativePath) formData.append('relativePath', entry.relativePath);
                if (entry.folderName) formData.append('folderName', entry.folderName);
                if (batchExpireAt) formData.append('batchExpireAt', batchExpireAt);
                if (captionText && uploadItems.length === 1 && index === 0) {
                    formData.append('content', captionText);
                }

                try {
                    const created = await uploadQuickMemoFile(formData, e => handleProgress(index, e));
                    if (created) uploadedMemos.push(created);
                    finishedCount += 1;
                    setUploadCompletedCount(finishedCount);
                } catch {
                    // 单文件错误提示已由 request 拦截器处理
                }
            }
        };

        const workers = [];
        for (let i = 0; i < Math.min(CONCURRENCY, uploadItems.length); i += 1) {
            workers.push(worker());
        }
        await Promise.all(workers);

        setUploadPercent(100);
        setTimeout(() => {
            setUploading(false);
            setUploadPercent(0);
            setUploadingFileName('');
        }, 400);

        if (uploadedMemos.length > 0) {
            setItems(prev => mergeQuickMemoDelta(prev, { items: uploadedMemos }));
            scrollToBottom('smooth');
            fetchFullList({ silent: true });

            if (uploadItems.length === 1) {
                message.success(
                    storageType === 'temp'
                        ? `已发送至临时随心记（${DEFAULT_TEMP_TTL_MINUTES}分钟后自动销毁）`
                        : '已发送并永久保存'
                );
            } else {
                message.success(`批量发送完成：成功 ${uploadedMemos.length}/${uploadItems.length} 个文件`);
            }
        }
    }, [fetchFullList, scrollToBottom]);

    // 提交文本/链接或待发附件胶囊
    const handleSend = useCallback(async () => {
        if (sending || uploading) return;
        const trimmed = composerText.trim();
        const hasText = Boolean(trimmed);
        const hasAttachments = pendingAttachments.length > 0;
        if (!hasText && !hasAttachments) return;

        if (hasText && new Blob([composerText]).size > MAX_TEXT_MEMO_BYTES) {
            message.warning('单条文本内容不能超过 50KB');
            return;
        }

        if (hasAttachments) {
            const batchSnapshot = [...pendingAttachments];
            const captionForSingle = batchSnapshot.length === 1 && hasText ? composerText : '';
            const separateText = batchSnapshot.length > 1 && hasText ? composerText : '';

            setPendingAttachments([]);
            setComposerText('');

            if (separateText) {
                try {
                    const createdText = await createQuickTextMemo({
                        content: separateText,
                        storageType: composerStorageType,
                        ttlMinutes: DEFAULT_TEMP_TTL_MINUTES,
                        clientId: generateClientId('qmt')
                    });
                    if (createdText) {
                        setItems(prev => mergeQuickMemoDelta(prev, { items: [createdText] }));
                    }
                } catch {
                    // error toasted by interceptor
                }
            }

            await runUploadQueue(batchSnapshot, composerStorageType, captionForSingle);
            batchSnapshot.forEach(revokeAttachmentUrl);
            return;
        }

        setSending(true);
        try {
            const created = await createQuickTextMemo({
                content: composerText,
                storageType: composerStorageType,
                ttlMinutes: DEFAULT_TEMP_TTL_MINUTES,
                clientId: generateClientId('qmt')
            });
            setComposerText('');
            if (created) {
                setItems(prev => mergeQuickMemoDelta(prev, { items: [created] }));
                scrollToBottom('smooth');
            }
            fetchFullList({ silent: true });
        } catch {
            // error toasted by interceptor
        } finally {
            setSending(false);
        }
    }, [
        composerStorageType,
        composerText,
        fetchFullList,
        pendingAttachments,
        revokeAttachmentUrl,
        runUploadQueue,
        scrollToBottom,
        sending,
        uploading
    ]);

    // 容器级拖拽（全区域覆盖遮罩，直接触发批量上传）
    const handleContainerDragEnter = e => {
        if (!e.dataTransfer?.types?.includes('Files')) return;
        e.preventDefault();
        dragCounterRef.current += 1;
        setIsDragOver(true);
    };

    const handleContainerDragOver = e => {
        if (!e.dataTransfer?.types?.includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    };

    const handleContainerDragLeave = e => {
        if (!e.dataTransfer?.types?.includes('Files')) return;
        e.preventDefault();
        dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
        if (dragCounterRef.current === 0) {
            setIsDragOver(false);
        }
    };

    const handleContainerDrop = async e => {
        if (!e.dataTransfer?.types?.includes('Files')) return;
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current = 0;
        setIsDragOver(false);

        if (uploading) {
            message.warning('当前已有上传任务正在进行中，请稍候');
            return;
        }

        try {
            const dropped = await parseDropItems(e.dataTransfer);
            if (!dropped || dropped.length === 0) {
                message.warning('未检测到可上传的文件或文件夹');
                return;
            }
            if (viewMode === 'folder' && currentPath) {
                dropped.forEach(it => {
                    if (!it.relativePath.startsWith(`${currentPath}/`)) {
                        it.relativePath = `${currentPath}/${it.relativePath}`;
                        it.folderName = currentPath.split('/')[0];
                    }
                });
            }
            await runUploadQueue(dropped, composerStorageType);
        } catch {
            message.error('解析拖拽内容失败，请重试');
        }
    };

    const handleFileInputChange = async e => {
        const selectedFiles = Array.from(e.target.files || []);
        e.target.value = '';
        if (selectedFiles.length === 0) return;

        const uploadItems = selectedFiles.map(file => ({
            file,
            relativePath: viewMode === 'folder' && currentPath ? `${currentPath}/${file.name}` : file.name,
            folderName: viewMode === 'folder' && currentPath ? currentPath.split('/')[0] : ''
        }));
        await runUploadQueue(uploadItems, composerStorageType);
    };

    const handleFolderInputChange = async e => {
        const selectedFiles = Array.from(e.target.files || []);
        e.target.value = '';
        if (selectedFiles.length === 0) return;

        const uploadItems = selectedFiles.map(file => {
            const rawRel = file.webkitRelativePath || file.name;
            const fullRel = viewMode === 'folder' && currentPath ? `${currentPath}/${rawRel}` : rawRel;
            const topFolder = fullRel.includes('/') ? fullRel.split('/')[0] : '';
            return {
                file,
                relativePath: fullRel,
                folderName: topFolder
            };
        });
        await runUploadQueue(uploadItems, composerStorageType);
    };

    // 单项生命周期与操作回调
    const handleItemExpired = useCallback(expiredId => {
        setItems(prev => prev.filter(it => getMemoId(it) !== expiredId));
        setPreviewItem(curr => (curr && getMemoId(curr) === expiredId ? null : curr));
    }, []);

    const handleTogglePreview = useCallback(item => {
        const id = getMemoId(item);
        setPreviewItem(curr => (curr && getMemoId(curr) === id ? null : item));
    }, []);

    const handleDownloadItem = useCallback(item => {
        const att = item?.attachment;
        const targetUrl = resolveAssetUrl(att?.url);
        if (!targetUrl) return;
        const link = document.createElement('a');
        link.href = targetUrl;
        link.download = att?.originalName || att?.filename || 'download';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }, []);

    const handleOpenSafeLink = useCallback(rawUrl => {
        const parsed = parseSafeHttpUrl(rawUrl);
        if (!parsed) {
            message.warning('仅支持打开 http/https 安全外链');
            return;
        }
        window.open(parsed.url, '_blank', 'noopener,noreferrer');
    }, []);

    const handlePromoteItem = useCallback(async item => {
        const id = getMemoId(item);
        try {
            const updated = await promoteQuickMemo(id);
            message.success('已转为永久保留');
            if (updated) {
                setItems(prev => mergeQuickMemoDelta(prev, { items: [updated] }));
                setPreviewItem(curr => (curr && getMemoId(curr) === id ? updated : curr));
            }
            fetchFullList({ silent: true });
        } catch {
            message.error('转为永久失败');
        }
    }, [fetchFullList]);

    const handleExtendItem = useCallback(async item => {
        const id = getMemoId(item);
        try {
            const updated = await extendQuickMemo(id);
            message.success('已延长临时有效期 20 分钟');
            if (updated) {
                setItems(prev => mergeQuickMemoDelta(prev, { items: [updated] }));
                setPreviewItem(curr => (curr && getMemoId(curr) === id ? updated : curr));
            }
        } catch {
            message.error('延长有效期失败');
        }
    }, []);

    const handleDeleteItem = useCallback(async item => {
        const id = getMemoId(item);
        try {
            await deleteQuickMemo(id);
            message.success('已删除');
            setItems(prev => prev.filter(it => getMemoId(it) !== id));
            setPreviewItem(curr => (curr && getMemoId(curr) === id ? null : curr));
        } catch {
            message.error('删除失败');
        }
    }, []);

    const handleDownloadFolder = useCallback(async folder => {
        const hide = message.loading(`正在打包下载文件夹「${folder.name}」...`, 0);
        try {
            const res = await downloadQuickMemoFolder(folder.topLevelFolder, folder.storageType);
            hide();
            const blob = res?.data instanceof Blob
                ? res.data
                : (res instanceof Blob ? res : new Blob([res]));
            const blobUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = `${folder.name}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(blobUrl);
            message.success(`文件夹「${folder.name}」打包下载已启动`);
        } catch {
            hide();
            message.error('打包下载文件夹失败，请稍后重试');
        }
    }, []);

    const handlePromoteFolder = useCallback(async folder => {
        try {
            await promoteQuickMemoFolder(folder.topLevelFolder);
            message.success(`文件夹「${folder.name}」已全部转为永久保留`);
            fetchFullList({ silent: true });
        } catch {
            message.error('整目录转永久失败');
        }
    }, [fetchFullList]);

    const handleDeleteFolder = useCallback(async folder => {
        try {
            await deleteQuickMemoFolder(folder.topLevelFolder, folder.storageType);
            message.success(`文件夹「${folder.name}」已彻底删除`);
            fetchFullList({ silent: true });
        } catch {
            message.error('删除文件夹失败');
        }
    }, [fetchFullList]);

    const handleItemContextMenu = useCallback((e, item) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ open: true, x: e.clientX, y: e.clientY, item });
    }, []);

    const contextMenuItems = useMemo(() => {
        const item = contextMenu.item;
        if (!item) return [];
        const isTemp = item.storageType === 'temp';
        const att = item.attachment;
        const safeLinks = Array.isArray(item.links) && item.links.length > 0
            ? item.links
            : extractSafeUrls(item.content || '');
        const primaryLink = safeLinks[0]?.url ? parseSafeHttpUrl(safeLinks[0].url)?.url : null;
        const resolvedUrl = att?.url ? resolveAssetUrl(att.url) : '';

        return [
            ...(att ? [
                {
                    key: 'preview',
                    icon: <EyeOutlined />,
                    label: '快速预览',
                    onClick: () => handleTogglePreview(item)
                },
                {
                    key: 'download',
                    icon: <DownloadOutlined />,
                    label: '下载文件',
                    onClick: () => handleDownloadItem(item)
                },
                {
                    key: 'copy-url',
                    icon: <CopyOutlined />,
                    label: '复制附件直链',
                    onClick: () => copyToClipboard(resolvedUrl, '附件直链已复制')
                }
            ] : [
                {
                    key: 'copy-text',
                    icon: <CopyOutlined />,
                    label: '复制文本内容',
                    onClick: () => copyToClipboard(item.content || '', '正文已复制')
                },
                ...(primaryLink ? [
                    {
                        key: 'open-link',
                        icon: <ExportOutlined />,
                        label: '在浏览器打开链接',
                        onClick: () => handleOpenSafeLink(primaryLink)
                    }
                ] : [])
            ]),
            { type: 'divider' },
            ...(isTemp ? [
                {
                    key: 'extend',
                    icon: <PlusCircleOutlined />,
                    label: '续期 +20 分钟',
                    onClick: () => handleExtendItem(item)
                },
                {
                    key: 'promote',
                    icon: <SaveOutlined />,
                    label: '转为永久保留',
                    onClick: () => handlePromoteItem(item)
                }
            ] : []),
            {
                key: 'to-note',
                icon: <FileAddOutlined />,
                label: '一键转存为笔记',
                onClick: () => setConvertTarget(item)
            },
            { type: 'divider' },
            {
                key: 'delete',
                icon: <DeleteOutlined />,
                danger: true,
                label: '彻底删除',
                onClick: () => handleDeleteItem(item)
            }
        ];
    }, [
        contextMenu.item,
        handleDeleteItem,
        handleDownloadItem,
        handleExtendItem,
        handleOpenSafeLink,
        handlePromoteItem,
        handleTogglePreview
    ]);

    const filteredItems = useMemo(() => {
        return items.filter(item => {
            if (storageFilter !== 'all' && item.storageType !== storageFilter) {
                return false;
            }
            if (kindFilter === 'text_link') {
                return !item.attachment && (item.kind === 'text' || item.kind === 'link');
            }
            if (kindFilter === 'image') {
                return isMemoVisualImage(item);
            }
            if (kindFilter === 'file') {
                return Boolean(item.attachment) && !isMemoVisualImage(item);
            }
            return true;
        });
    }, [items, storageFilter, kindFilter]);

    const folderItems = useMemo(() => {
        return items.filter(item => {
            if (!item.attachment) return false;
            if (storageFilter !== 'all' && item.storageType !== storageFilter) return false;
            return true;
        });
    }, [items, storageFilter]);

    return (
        <div
            ref={boardRootRef}
            className="file-stash-board"
            onDragEnter={handleContainerDragEnter}
            onDragOver={handleContainerDragOver}
            onDragLeave={handleContainerDragLeave}
            onDrop={handleContainerDrop}
        >
            <div className={`stash-main-pane ${previewItem ? 'with-preview' : ''}`}>
                <input
                    type="file"
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    multiple
                    onChange={handleFileInputChange}
                />
                <input
                    type="file"
                    ref={folderInputRef}
                    style={{ display: 'none' }}
                    webkitdirectory=""
                    directory=""
                    multiple
                    onChange={handleFolderInputChange}
                />

                {isDragOver && (
                    <div className="memo-drop-overlay">
                        <div className="drop-overlay-card">
                            <div className="drop-overlay-icon">
                                <CloudUploadOutlined />
                            </div>
                            <div className="drop-overlay-title">释放以发送至随心记</div>
                            <div className="drop-overlay-sub">
                                支持多文件、图片与完整文件夹 · 当前模式：
                                <span className={composerStorageType === 'temp' ? 'is-temp' : 'is-perm'}>
                                    {composerStorageType === 'temp' ? '临时 (20分钟)' : '永久保留'}
                                </span>
                            </div>
                        </div>
                    </div>
                )}

                {/* 顶栏标题与配额概览 */}
                <div className="stash-header">
                    <div className="header-left">
                        <h2 className="stash-title">
                            <SendOutlined className="title-icon" />
                            <span>随心记</span>
                        </h2>
                        <div className="stash-subtitle">
                            跨端图文链接文件随手传输 · 临时默认 20 分钟清理 · 永久配额 {formatBytes(quota?.permanentUsedBytes || 0)} / {formatBytes(quota?.permanentLimitBytes || 2 * 1024 * 1024 * 1024)}
                        </div>
                    </div>
                    <div className="header-right">
                        <Tooltip title={viewMode === 'folder' ? '切回时间流视图' : '切换为文件夹目录视图'}>
                            <Button
                                type={viewMode === 'folder' ? 'primary' : 'default'}
                                size="small"
                                icon={viewMode === 'folder' ? <UnorderedListOutlined /> : <FolderOutlined />}
                                onClick={() => setViewMode(m => (m === 'timeline' ? 'folder' : 'timeline'))}
                            >
                                {viewMode === 'folder' ? '时间流' : '文件夹'}
                            </Button>
                        </Tooltip>
                        <Button
                            size="small"
                            icon={<ReloadOutlined spin={loading} />}
                            onClick={() => fetchFullList({ scrollBottom: viewMode === 'timeline' })}
                            className="refresh-btn"
                        >
                            刷新
                        </Button>
                    </div>
                </div>

                {/* 存储分区与内容类型筛选行 */}
                <div className="stash-tabs-row">
                    <Segmented
                        value={storageFilter}
                        onChange={handleStorageFilterChange}
                        options={[
                            {
                                value: 'all',
                                label: (
                                    <span className="tab-label">
                                        全部
                                        <span className="badge-count">{counts.all}</span>
                                    </span>
                                )
                            },
                            {
                                value: 'temp',
                                label: (
                                    <span className="tab-label">
                                        临时 (20分钟)
                                        <span className="badge-count is-temp">{counts.temp}</span>
                                    </span>
                                )
                            },
                            {
                                value: 'permanent',
                                label: (
                                    <span className="tab-label">
                                        永久
                                        <span className="badge-count is-perm">{counts.permanent}</span>
                                    </span>
                                )
                            }
                        ]}
                    />

                    {viewMode === 'timeline' && (
                        <div className="kind-filter-pills">
                            {[
                                { key: 'all', label: '全部类型' },
                                { key: 'text_link', label: '文字·链接' },
                                { key: 'image', label: '图片' },
                                { key: 'file', label: '文件·目录' }
                            ].map(f => (
                                <button
                                    key={f.key}
                                    type="button"
                                    className={`kind-pill-btn ${kindFilter === f.key ? 'is-active' : ''}`}
                                    onClick={() => setKindFilter(f.key)}
                                >
                                    {f.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* 批量上传进度条 */}
                {uploading && (
                    <div className="upload-progress-card">
                        <div className="progress-info-col">
                            <div className="progress-status-row">
                                <span className="status-label">
                                    正在传输：{uploadCompletedCount} / {uploadTotalCount} 个文件
                                </span>
                                <span className="status-percent">{uploadPercent}%</span>
                            </div>
                            <span className="progress-filename" title={uploadingFileName}>
                                {uploadingFileName}
                            </span>
                        </div>
                        <Progress percent={uploadPercent} size="small" status="active" />
                    </div>
                )}

                {/* 主体内容区：时间流 or 虚拟文件夹视图 */}
                <div
                    ref={feedScrollRef}
                    className="memo-feed-scroll"
                    onScroll={() => {
                        if (hasNewBelow && isNearBottom()) {
                            setHasNewBelow(false);
                        }
                    }}
                >
                    {loading && items.length === 0 ? (
                        <div className="memo-skeleton-list" aria-busy="true">
                            {[1, 2, 3].map(n => (
                                <div key={n} className="memo-skeleton-card">
                                    <div className="skeleton-line short" />
                                    <div className="skeleton-line long" />
                                    <div className="skeleton-line medium" />
                                </div>
                            ))}
                        </div>
                    ) : viewMode === 'folder' ? (
                        <FolderExplorerView
                            items={folderItems}
                            currentPath={currentPath}
                            onPathChange={setCurrentPath}
                            previewFileId={previewItemId}
                            clockOffsetMs={clockOffsetMs}
                            onExpired={handleItemExpired}
                            onPreview={handleTogglePreview}
                            onDownload={handleDownloadItem}
                            onCopyLink={(url, msg) => copyToClipboard(url, msg)}
                            onPromoteItem={handlePromoteItem}
                            onConvertToNote={setConvertTarget}
                            onDeleteItem={handleDeleteItem}
                            onDownloadFolder={handleDownloadFolder}
                            onPromoteFolder={handlePromoteFolder}
                            onDeleteFolder={handleDeleteFolder}
                        />
                    ) : filteredItems.length === 0 ? (
                        <div className="stash-empty-wrapper">
                            <Empty
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description={
                                    <span className="empty-desc-text">
                                        暂无匹配的随心记内容，可在下方输入文字/链接、Ctrl+V 粘贴截图或拖拽文件发送
                                    </span>
                                }
                            />
                        </div>
                    ) : (
                        <div className="memo-timeline-list">
                            {filteredItems.map(item => (
                                <QuickMemoCard
                                    key={getMemoId(item)}
                                    item={item}
                                    isPreviewing={previewItemId === getMemoId(item)}
                                    clockOffsetMs={clockOffsetMs}
                                    onExpired={handleItemExpired}
                                    onPreview={handleTogglePreview}
                                    onDownload={handleDownloadItem}
                                    onCopyText={val => copyToClipboard(val, '内容已复制')}
                                    onCopyLink={(val, msg) => copyToClipboard(val, msg)}
                                    onOpenLink={handleOpenSafeLink}
                                    onExtend={handleExtendItem}
                                    onPromote={handlePromoteItem}
                                    onConvertToNote={setConvertTarget}
                                    onOpenNote={noteId => onOpenNote?.(noteId)}
                                    onDelete={handleDeleteItem}
                                    onOpenFolder={folderName => {
                                        setViewMode('folder');
                                        setCurrentPath(folderName);
                                    }}
                                    onContextMenu={handleItemContextMenu}
                                />
                            ))}
                        </div>
                    )}
                </div>

                {hasNewBelow && viewMode === 'timeline' && (
                    <button
                        type="button"
                        className="scroll-bottom-pill"
                        onClick={() => scrollToBottom('smooth')}
                    >
                        <VerticalAlignBottomOutlined />
                        <span>有新随心记到达</span>
                    </button>
                )}

                {/* 吸底快捷发送输入区 */}
                <QuickMemoComposer
                    storageType={composerStorageType}
                    onStorageTypeChange={setComposerStorageType}
                    text={composerText}
                    onTextChange={setComposerText}
                    pendingAttachments={pendingAttachments}
                    onRemoveAttachment={handleRemoveAttachment}
                    onClearAttachments={handleClearAttachments}
                    onSend={handleSend}
                    onPickFiles={() => fileInputRef.current?.click()}
                    onPickFolder={() => folderInputRef.current?.click()}
                    onPasteFiles={files => stageAttachments(files, { fromClipboard: true })}
                    uploading={uploading}
                    sending={sending}
                    inputRef={composerInputRef}
                />
            </div>

            {/* 右侧平滑弹性展开的附件预览抽屉 */}
            <div className={`stash-preview-drawer ${previewItem ? 'is-open' : ''} ${isFullScreen ? 'is-fullscreen' : ''}`}>
                {activePreviewItem && (
                    <FilePreviewPanel
                        file={activePreviewItem}
                        onClose={() => {
                            setIsFullScreen(false);
                            setPreviewItem(null);
                        }}
                        isFullScreen={isFullScreen}
                        onToggleFullScreen={() => setIsFullScreen(prev => !prev)}
                        onPromote={handlePromoteItem}
                    />
                )}
            </div>

            <ContextMenu
                open={contextMenu.open}
                x={contextMenu.x}
                y={contextMenu.y}
                onClose={() => setContextMenu(prev => ({ ...prev, open: false }))}
                items={contextMenuItems}
            />

            <ConvertToNoteModal
                open={Boolean(convertTarget)}
                memo={convertTarget}
                defaultNotebookId={activeNotebookId}
                onClose={() => setConvertTarget(null)}
                onConverted={(res, opts) => {
                    const updatedMemo = res?.memo;
                    const createdNote = res?.note;
                    const noteId = createdNote?._id || createdNote?.id || updatedMemo?.convertedNoteId;
                    const targetNbId = createdNote?.notebookId?._id || createdNote?.notebookId;

                    if (updatedMemo) {
                        setItems(prev => mergeQuickMemoDelta(prev, { items: [updatedMemo] }));
                    }
                    onNoteCreated?.(noteId, targetNbId);
                    if (opts?.openAfterSave && noteId) {
                        onOpenNote?.(noteId, targetNbId);
                    }
                }}
            />
        </div>
    );
}
