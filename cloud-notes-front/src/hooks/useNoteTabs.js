import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * 多标签页工作区管理 Hook (支持主栏/副栏双独立标签栈、VS Code预览态、常驻态、脏数据提示)
 * 默认进入为空白态，用户点击或新建笔记时按需添加标签
 */
export const useNoteTabs = ({ onSaveNote, onActiveNoteChange }) => {
    // 正在关闭的标签白名单，防止在 React 异步渲染间隙被再次意外创建
    const closingNoteIdsRef = useRef(new Set());

    // 主屏与副屏标签数组: NoteTabItem[]，默认初始空白
    const [primaryTabs, setPrimaryTabs] = useState([]);
    const [primaryActiveId, setPrimaryActiveId] = useState(null);

    const [secondaryTabs, setSecondaryTabs] = useState([]);
    const [secondaryActiveId, setSecondaryActiveId] = useState(null);

    // 当前获得焦点/活跃的分栏: 'primary' | 'secondary'
    const [activePane, setActivePane] = useState('primary');

    // 双栏分屏开关与比例
    const [isSplitViewOpen, setIsSplitViewOpen] = useState(false);
    const [splitPaneRatio, setSplitPaneRatio] = useState(50);

    // 清理历史残留的自动强行开启缓存
    useEffect(() => {
        try {
            localStorage.removeItem('cloud_notes_tabs_workspace_v1');
        } catch {}
    }, []);

    /**
     * 打开或激活一个笔记标签页
     * 行为规范：切换为别的笔记时，原有tab不关闭和替换，始终新增一个tab并选中显示；
     * 若该笔记tab已存在，则平滑切换激活该tab
     * @param {string} noteId 笔记ID
     * @param {object} options { title, notebookId, pane, forcePermanent, isPinned }
     */
    const openTab = useCallback((noteId, options = {}) => {
        if (!noteId || closingNoteIdsRef.current.has(noteId)) return;

        const targetPane = options.pane || activePane;
        const title = options.title || '无标题笔记';
        const notebookId = options.notebookId || null;

        const setTabs = targetPane === 'primary' ? setPrimaryTabs : setSecondaryTabs;
        const setActiveId = targetPane === 'primary' ? setPrimaryActiveId : setSecondaryActiveId;

        setTabs(prevTabs => {
            const existingIndex = prevTabs.findIndex(t => t.id === noteId);

            if (existingIndex !== -1) {
                // 已存在该标签：若有更新的真实标题则更新，保留标签栈
                if (options.title && options.title !== '无标题笔记' && prevTabs[existingIndex].title !== options.title) {
                    return prevTabs.map((tab, idx) => {
                        if (idx === existingIndex) {
                            return { ...tab, title: options.title };
                        }
                        return tab;
                    });
                }
                return prevTabs;
            }

            // 新开标签：始终新增一个tab并追加到末尾，绝不替换或关闭旧tab
            const newTab = {
                id: noteId,
                title,
                notebookId,
                isPreview: false,
                isPinned: Boolean(options.isPinned),
                isDirty: false
            };

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

        // 记录正在关闭的标签ID，防止生命周期异步更新期间被外部错误重新开启
        closingNoteIdsRef.current.add(noteId);
        setTimeout(() => {
            closingNoteIdsRef.current.delete(noteId);
        }, 800);

        // 若所有标签均已关闭，重置活跃指针并通知外部回到空白态；若关闭的是当前活跃标签，则激活相邻标签
        if (nextTabs.length === 0) {
            setActiveId(null);
            if (pane === 'primary' && onActiveNoteChange) {
                onActiveNoteChange(null, { skipConfirm: true });
            }
        } else if (activeId === noteId) {
            const nextIndex = Math.min(targetIndex, nextTabs.length - 1);
            const nextActiveId = nextTabs[nextIndex].id;
            setActiveId(nextActiveId);
            if (pane === 'primary' && onActiveNoteChange) {
                onActiveNoteChange(nextActiveId, { skipConfirm: true });
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
        window.addEventListener('cloud-note-title-updated', handleNoteTitleUpdate);
        window.addEventListener('note-deleted', handleNoteDeleted);

        return () => {
            window.removeEventListener('note-title-updated', handleNoteTitleUpdate);
            window.removeEventListener('cloud-note-title-updated', handleNoteTitleUpdate);
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
