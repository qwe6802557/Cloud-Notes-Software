import { useState, useEffect, useCallback, useRef } from 'react';

const STORAGE_KEY = 'cloud_notes_tabs_workspace_v1';

/**
 * 从 localStorage 读取已保存的标签页工作区状态
 */
const loadSavedTabsState = () => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.primaryTabs)) {
            return parsed;
        }
    } catch {
        // 解析异常忽略，降级为默认空状态
    }
    return null;
};

/**
 * 多标签页工作区管理 Hook (支持主栏/副栏双独立标签栈、VS Code预览态、常驻态、脏数据提示与持久化)
 */
export const useNoteTabs = ({ onSaveNote, onActiveNoteChange }) => {
    const savedState = useRef(loadSavedTabsState()).current;

    // 主屏与副屏标签数组: NoteTabItem[]
    const [primaryTabs, setPrimaryTabs] = useState(savedState?.primaryTabs || []);
    const [primaryActiveId, setPrimaryActiveId] = useState(savedState?.primaryActiveId || null);

    const [secondaryTabs, setSecondaryTabs] = useState(savedState?.secondaryTabs || []);
    const [secondaryActiveId, setSecondaryActiveId] = useState(savedState?.secondaryActiveId || null);

    // 当前获得焦点/活跃的分栏: 'primary' | 'secondary'
    const [activePane, setActivePane] = useState(savedState?.activePane || 'primary');

    // 双栏分屏开关与比例持久化
    const [isSplitViewOpen, setIsSplitViewOpen] = useState(savedState?.isSplitViewOpen || false);
    const [splitPaneRatio, setSplitPaneRatio] = useState(savedState?.splitPaneRatio || 50);

    // 持久化到 localStorage
    useEffect(() => {
        try {
            const dataToSave = {
                primaryTabs: primaryTabs.map(t => ({
                    id: t.id,
                    title: t.title,
                    notebookId: t.notebookId,
                    isPreview: t.isPreview,
                    isPinned: t.isPinned
                })),
                primaryActiveId,
                secondaryTabs: secondaryTabs.map(t => ({
                    id: t.id,
                    title: t.title,
                    notebookId: t.notebookId,
                    isPreview: t.isPreview,
                    isPinned: t.isPinned
                })),
                secondaryActiveId,
                activePane,
                isSplitViewOpen,
                splitPaneRatio
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
        } catch {
            // 存储异常忽略
        }
    }, [primaryTabs, primaryActiveId, secondaryTabs, secondaryActiveId, activePane, isSplitViewOpen, splitPaneRatio]);

    // 初次挂载时若存在本地持久化的活跃主标签，自动通知外部恢复笔记正文
    useEffect(() => {
        if (primaryActiveId && onActiveNoteChange) {
            onActiveNoteChange(primaryActiveId);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /**
     * 打开或激活一个笔记标签页
     * @param {string} noteId 笔记ID
     * @param {object} options { title, notebookId, isPreview, pane, forcePermanent }
     */
    const openTab = useCallback((noteId, options = {}) => {
        if (!noteId) return;

        const targetPane = options.pane || activePane;
        const isPreview = options.forcePermanent ? false : (options.isPreview !== undefined ? options.isPreview : true);
        const title = options.title || '无标题笔记';
        const notebookId = options.notebookId || null;

        const setTabs = targetPane === 'primary' ? setPrimaryTabs : setSecondaryTabs;
        const setActiveId = targetPane === 'primary' ? setPrimaryActiveId : setSecondaryActiveId;

        setTabs(prevTabs => {
            const existingIndex = prevTabs.findIndex(t => t.id === noteId);

            if (existingIndex !== -1) {
                // 已存在该标签：若当前为强制常驻，则移除预览态标志
                return prevTabs.map((tab, idx) => {
                    if (idx === existingIndex) {
                        return {
                            ...tab,
                            title: options.title || tab.title,
                            isPreview: !options.forcePermanent && tab.isPreview ? tab.isPreview : false
                        };
                    }
                    return tab;
                });
            }

            // 新开标签：如果处于预览态，且当前存在未固定的预览标签，则就地替换预览标签
            const previewIndex = prevTabs.findIndex(t => t.isPreview && !t.isPinned);
            const newTab = {
                id: noteId,
                title,
                notebookId,
                isPreview,
                isPinned: false,
                isDirty: false
            };

            if (isPreview && previewIndex !== -1) {
                const updated = [...prevTabs];
                updated[previewIndex] = newTab;
                return updated;
            }

            return [...prevTabs, newTab];
        });

        setActiveId(noteId);
        setActivePane(targetPane);

        if (targetPane === 'primary' && onActiveNoteChange) {
            onActiveNoteChange(noteId);
        }
    }, [activePane, onActiveNoteChange]);

    /**
     * 将临时预览标签转为常驻标签（例如编辑、双击或右键固定）
     */
    const makeTabPermanent = useCallback((noteId, pane = 'primary') => {
        const setTabs = pane === 'primary' ? setPrimaryTabs : setSecondaryTabs;
        setTabs(prev => prev.map(tab => (tab.id === noteId ? { ...tab, isPreview: false } : tab)));
    }, []);

    /**
     * 切换标签固定常驻状态 (Pin)
     */
    const togglePinTab = useCallback((noteId, pane = 'primary') => {
        const setTabs = pane === 'primary' ? setPrimaryTabs : setSecondaryTabs;
        setTabs(prev => {
            const target = prev.find(t => t.id === noteId);
            if (!target) return prev;
            const updated = prev.map(tab => {
                if (tab.id === noteId) {
                    return { ...tab, isPinned: !tab.isPinned, isPreview: false };
                }
                return tab;
            });
            // 固定标签排序置前
            const pinned = updated.filter(t => t.isPinned);
            const unpinned = updated.filter(t => !t.isPinned);
            return [...pinned, ...unpinned];
        });
    }, []);

    /**
     * 标记标签脏数据状态（编辑未保存时显示圆点，并自动转为常驻标签）
     */
    const setTabDirty = useCallback((noteId, isDirty, pane = 'primary') => {
        const setTabs = pane === 'primary' ? setPrimaryTabs : setSecondaryTabs;
        setTabs(prev => prev.map(tab => {
            if (tab.id === noteId) {
                return {
                    ...tab,
                    isDirty: Boolean(isDirty),
                    isPreview: isDirty ? false : tab.isPreview
                };
            }
            return tab;
        }));
    }, []);

    /**
     * 关闭指定标签
     * @returns {boolean} 是否成功关闭
     */
    const closeTab = useCallback((noteId, pane = 'primary', force = false) => {
        const tabs = pane === 'primary' ? primaryTabs : secondaryTabs;
        const setTabs = pane === 'primary' ? setPrimaryTabs : setSecondaryTabs;
        const activeId = pane === 'primary' ? primaryActiveId : secondaryActiveId;
        const setActiveId = pane === 'primary' ? setPrimaryActiveId : setSecondaryActiveId;

        const targetTab = tabs.find(t => t.id === noteId);
        if (!targetTab) return true;

        if (targetTab.isDirty && !force) {
            return false; // 提示调用方需要确认弹窗
        }

        const targetIndex = tabs.findIndex(t => t.id === noteId);
        const nextTabs = tabs.filter(t => t.id !== noteId);
        setTabs(nextTabs);

        // 若关闭的是当前活跃标签，则智能激活相邻标签
        if (activeId === noteId) {
            let nextActiveId = null;
            if (nextTabs.length > 0) {
                const nextIndex = Math.min(targetIndex, nextTabs.length - 1);
                nextActiveId = nextTabs[nextIndex].id;
            }
            setActiveId(nextActiveId);
            if (pane === 'primary' && onActiveNoteChange) {
                onActiveNoteChange(nextActiveId);
            }
        }

        return true;
    }, [primaryTabs, secondaryTabs, primaryActiveId, secondaryActiveId, onActiveNoteChange]);

    /**
     * 关闭其他未固定的标签
     */
    const closeOtherTabs = useCallback((noteId, pane = 'primary') => {
        const setTabs = pane === 'primary' ? setPrimaryTabs : setSecondaryTabs;
        const setActiveId = pane === 'primary' ? setPrimaryActiveId : setSecondaryActiveId;

        setTabs(prev => prev.filter(t => t.id === noteId || t.isPinned));
        setActiveId(noteId);
        if (pane === 'primary' && onActiveNoteChange) {
            onActiveNoteChange(noteId);
        }
    }, [onActiveNoteChange]);

    /**
     * 关闭右侧所有未固定标签
     */
    const closeTabsToRight = useCallback((noteId, pane = 'primary') => {
        const tabs = pane === 'primary' ? primaryTabs : secondaryTabs;
        const setTabs = pane === 'primary' ? setPrimaryTabs : setSecondaryTabs;
        const activeId = pane === 'primary' ? primaryActiveId : secondaryActiveId;
        const setActiveId = pane === 'primary' ? setPrimaryActiveId : setSecondaryActiveId;

        const targetIndex = tabs.findIndex(t => t.id === noteId);
        if (targetIndex === -1) return;

        const remainingTabs = tabs.filter((t, idx) => idx <= targetIndex || t.isPinned);
        setTabs(remainingTabs);

        // 若当前激活项在右侧且被关闭，则激活保留的 noteId
        const activeStillExists = remainingTabs.some(t => t.id === activeId);
        if (!activeStillExists) {
            setActiveId(noteId);
            if (pane === 'primary' && onActiveNoteChange) {
                onActiveNoteChange(noteId);
            }
        }
    }, [primaryTabs, secondaryTabs, primaryActiveId, secondaryActiveId, onActiveNoteChange]);

    /**
     * 将标签在另一分栏中打开（支持副屏自动开启与跨栏投送）
     */
    const openInOppositePane = useCallback((noteId, currentPane = 'primary') => {
        const sourceTabs = currentPane === 'primary' ? primaryTabs : secondaryTabs;
        const targetPane = currentPane === 'primary' ? 'secondary' : 'primary';
        const sourceTab = sourceTabs.find(t => t.id === noteId);

        if (!sourceTab) return;

        if (!isSplitViewOpen) {
            setIsSplitViewOpen(true);
        }

        openTab(noteId, {
            title: sourceTab.title,
            notebookId: sourceTab.notebookId,
            isPreview: false,
            pane: targetPane,
            forcePermanent: true
        });
    }, [primaryTabs, secondaryTabs, isSplitViewOpen, openTab]);

    /**
     * 标签拖拽重排序
     */
    const reorderTabs = useCallback((sourceIndex, targetIndex, pane = 'primary') => {
        const setTabs = pane === 'primary' ? setPrimaryTabs : setSecondaryTabs;
        setTabs(prev => {
            if (sourceIndex === targetIndex) return prev;
            const updated = [...prev];
            const [moved] = updated.splice(sourceIndex, 1);
            updated.splice(targetIndex, 0, moved);
            return updated;
        });
    }, []);

    /**
     * 更新标签标题（树节点重命名或保存响应）
     */
    const updateTabTitle = useCallback((noteId, newTitle) => {
        if (!noteId || !newTitle) return;
        setPrimaryTabs(prev => prev.map(t => (t.id === noteId ? { ...t, title: newTitle } : t)));
        setSecondaryTabs(prev => prev.map(t => (t.id === noteId ? { ...t, title: newTitle } : t)));
    }, []);

    /**
     * 移除已被删除的笔记标签
     */
    const removeDeletedTab = useCallback(noteId => {
        closeTab(noteId, 'primary', true);
        closeTab(noteId, 'secondary', true);
    }, [closeTab]);

    // 全局事件监听：笔记重命名、删除及外部快速打开标签
    useEffect(() => {
        const handleNoteTitleUpdate = e => {
            if (e.detail?.id && e.detail?.title) {
                updateTabTitle(e.detail.id, e.detail.title);
            }
        };

        const handleNoteDeleted = e => {
            if (e.detail?.id) {
                removeDeletedTab(e.detail.id);
            }
        };

        window.addEventListener('note-title-updated', handleNoteTitleUpdate);
        window.addEventListener('note-deleted', handleNoteDeleted);

        return () => {
            window.removeEventListener('note-title-updated', handleNoteTitleUpdate);
            window.removeEventListener('note-deleted', handleNoteDeleted);
        };
    }, [updateTabTitle, removeDeletedTab]);

    return {
        primaryTabs,
        primaryActiveId,
        setPrimaryActiveId,
        secondaryTabs,
        secondaryActiveId,
        setSecondaryActiveId,
        activePane,
        setActivePane,
        isSplitViewOpen,
        setIsSplitViewOpen,
        splitPaneRatio,
        setSplitPaneRatio,
        openTab,
        closeTab,
        closeOtherTabs,
        closeTabsToRight,
        makeTabPermanent,
        togglePinTab,
        setTabDirty,
        openInOppositePane,
        reorderTabs,
        updateTabTitle,
        removeDeletedTab
    };
};
