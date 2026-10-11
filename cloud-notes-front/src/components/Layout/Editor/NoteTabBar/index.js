import React, { useRef, useCallback, useState } from 'react';
import { Dropdown, Tooltip } from 'antd';
import {
    CloseOutlined,
    PlusOutlined,
    DownOutlined,
    FileTextOutlined,
    SplitCellsOutlined
} from '@ant-design/icons';
import TabContextMenu from './TabContextMenu';
import './index.less';

/**
 * 桌面级 Markdown 多标签页组件 (NoteTabBar)
 */
const NoteTabBar = ({
    tabs = [],
    activeTabId,
    pane = 'primary', // 'primary' | 'secondary'
    isSplitViewOpen = false,
    onToggleSplitView,
    onSelectTab,
    onCloseTab,
    onCloseOtherTabs,
    onCloseTabsToRight,
    onTogglePinTab,
    onMakeTabPermanent,
    onOpenInOppositePane,
    onReorderTabs,
    onCrossPaneDrop,
    onCreateTab
}) => {
    const tabsListRef = useRef(null);
    const [draggedIndex, setDraggedIndex] = useState(null);
    const [dragOverIndex, setDragOverIndex] = useState(null);

    // 鼠标滚轮横向滚动
    const handleWheel = useCallback(e => {
        if (!tabsListRef.current) return;
        if (Math.abs(e.deltaY) > 0) {
            tabsListRef.current.scrollLeft += e.deltaY;
        }
    }, []);

    // 标签拖拽事件处理（支持同分栏重排序与跨分栏投送）
    const handleDragStart = (e, index) => {
        setDraggedIndex(index);
        e.dataTransfer.effectAllowed = 'move';
        const tab = tabs[index];
        const payload = {
            id: tab?.id,
            title: tab?.title,
            notebookId: tab?.notebookId,
            sourcePane: pane,
            sourceIndex: index
        };
        e.dataTransfer.setData('application/json', JSON.stringify(payload));
        e.dataTransfer.setData('text/plain', String(index));
    };

    const handleDragOver = (e, index) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dragOverIndex !== index) {
            setDragOverIndex(index);
        }
    };

    const handleDrop = (e, targetIndex) => {
        e.preventDefault();
        e.stopPropagation();

        // 尝试解析跨分栏投送数据
        try {
            const raw = e.dataTransfer.getData('application/json');
            if (raw) {
                const payload = JSON.parse(raw);
                if (payload.sourcePane && payload.sourcePane !== pane) {
                    if (onCrossPaneDrop) {
                        onCrossPaneDrop({
                            id: payload.id,
                            title: payload.title,
                            notebookId: payload.notebookId,
                            sourcePane: payload.sourcePane,
                            sourceIndex: payload.sourceIndex,
                            targetPane: pane,
                            targetIndex
                        });
                    }
                    setDraggedIndex(null);
                    setDragOverIndex(null);
                    return;
                }
            }
        } catch {}

        // 同分栏内重排序
        if (draggedIndex !== null && draggedIndex !== targetIndex && onReorderTabs) {
            onReorderTabs(draggedIndex, targetIndex, pane);
        }
        setDraggedIndex(null);
        setDragOverIndex(null);
    };

    const handleDragEnd = () => {
        setDraggedIndex(null);
        setDragOverIndex(null);
    };

    const handleScrollAreaDragOver = e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleScrollAreaDrop = e => {
        if (e.target.closest('.note-tab-item')) {
            return;
        }
        e.preventDefault();
        try {
            const raw = e.dataTransfer.getData('application/json');
            if (raw) {
                const payload = JSON.parse(raw);
                if (payload.sourcePane && payload.sourcePane !== pane && onCrossPaneDrop) {
                    onCrossPaneDrop({
                        id: payload.id,
                        title: payload.title,
                        notebookId: payload.notebookId,
                        sourcePane: payload.sourcePane,
                        sourceIndex: payload.sourceIndex,
                        targetPane: pane,
                        targetIndex: tabs.length
                    });
                }
            }
        } catch {}
        setDraggedIndex(null);
        setDragOverIndex(null);
    };

    // 标签页下拉快速拾取菜单
    const tabMenuItems = tabs.map(tab => ({
        key: tab.id,
        label: (
            <div className={`tab-dropdown-item ${tab.id === activeTabId ? 'is-active' : ''}`}>
                <FileTextOutlined style={{ marginRight: 6 }} />
                <span>{tab.title || '无标题笔记'}</span>
                {tab.isDirty && <span className="tab-dirty-dot" style={{ marginLeft: 6 }}>●</span>}
            </div>
        ),
        onClick: () => onSelectTab(tab.id, pane)
    }));

    return (
        <div className={`note-tab-bar note-tab-bar-${pane}`} role="tablist">
            <div
                className="note-tab-bar-scroll-area"
                ref={tabsListRef}
                onWheel={handleWheel}
                onDragOver={handleScrollAreaDragOver}
                onDrop={handleScrollAreaDrop}
            >
                {tabs.map((tab, index) => {
                    const isActive = tab.id === activeTabId;
                    const isDragging = draggedIndex === index;
                    const isDragOver = dragOverIndex === index;

                    return (
                        <TabContextMenu
                            key={tab.id}
                            tab={tab}
                            pane={pane}
                            onCloseTab={onCloseTab}
                            onCloseOtherTabs={onCloseOtherTabs}
                            onCloseTabsToRight={onCloseTabsToRight}
                            onTogglePinTab={onTogglePinTab}
                            onOpenInOppositePane={onOpenInOppositePane}
                        >
                            <div
                                className={`note-tab-item ${isActive ? 'is-active' : ''} ${tab.isDirty ? 'is-dirty' : ''} ${isDragging ? 'is-dragging' : ''} ${isDragOver ? 'is-drag-over' : ''}`}
                                role="tab"
                                aria-selected={isActive}
                                draggable
                                onDragStart={e => handleDragStart(e, index)}
                                onDragOver={e => handleDragOver(e, index)}
                                onDrop={e => handleDrop(e, index)}
                                onDragEnd={handleDragEnd}
                                onClick={() => onSelectTab(tab.id, pane)}
                                onDoubleClick={() => onMakeTabPermanent && onMakeTabPermanent(tab.id, pane)}
                                onAuxClick={e => {
                                    // 鼠标中键点击关闭标签
                                    if (e.button === 1) {
                                        e.preventDefault();
                                        onCloseTab(tab.id, pane);
                                    }
                                }}
                                title={tab.title || '无标题笔记'}
                            >
                                {/* 笔记标题（超长自动截断，保持文件名扩展名） */}
                                <span className="tab-title">
                                    {tab.title || '无标题笔记'}
                                </span>

                                {/* 每个标签均可点击叉关闭/删除 */}
                                <span
                                    className="tab-close-btn"
                                    onClick={e => {
                                        e.stopPropagation();
                                        onCloseTab(tab.id, pane);
                                    }}
                                    title={tab.isDirty ? '有未保存修改 (点击关闭)' : '关闭 (Alt+W)'}
                                >
                                    {tab.isDirty ? (
                                        <>
                                            <span className="dirty-indicator">●</span>
                                            <CloseOutlined className="hover-close-icon" />
                                        </>
                                    ) : (
                                        <CloseOutlined />
                                    )}
                                </span>
                            </div>
                        </TabContextMenu>
                    );
                })}

                {/* 新建标签按钮 */}
                {onCreateTab && (
                    <button
                        type="button"
                        className="tab-create-btn"
                        onClick={onCreateTab}
                        title="在当前分栏新建笔记"
                    >
                        <PlusOutlined />
                    </button>
                )}
            </div>

            {/* 标签过多时的下拉拾取菜单 */}
            {tabs.length > 3 && (
                <div className="tab-overflow-trigger">
                    <Dropdown menu={{ items: tabMenuItems }} trigger={['click']} placement="bottomRight">
                        <button type="button" className="tab-overflow-btn" title="查看所有打开的标签">
                            <DownOutlined />
                        </button>
                    </Dropdown>
                </div>
            )}

            {/* 标签栏快捷操作区 (双栏分屏控制) */}
            <div className="note-tab-bar-actions">
                {onToggleSplitView && (
                    <Tooltip title={isSplitViewOpen ? '收起双栏分屏 (Ctrl+\\)' : '开启双栏分屏 (Ctrl+\\)'}>
                        <button
                            type="button"
                            className={`tab-action-btn split-action-btn ${isSplitViewOpen ? 'is-active' : ''}`}
                            onClick={onToggleSplitView}
                            aria-label="双栏分屏"
                        >
                            <SplitCellsOutlined />
                        </button>
                    </Tooltip>
                )}
            </div>
        </div>
    );
};

export default NoteTabBar;
