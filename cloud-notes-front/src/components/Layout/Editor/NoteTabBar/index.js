import React, { useRef, useCallback, useState } from 'react';
import { Dropdown } from 'antd';
import {
    CloseOutlined,
    PushpinFilled,
    PlusOutlined,
    DownOutlined,
    FileTextOutlined
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
    onSelectTab,
    onCloseTab,
    onCloseOtherTabs,
    onCloseTabsToRight,
    onTogglePinTab,
    onMakeTabPermanent,
    onOpenInOppositePane,
    onReorderTabs,
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

    // 标签拖拽事件处理
    const handleDragStart = (e, index) => {
        setDraggedIndex(index);
        e.dataTransfer.effectAllowed = 'move';
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

    // 标签页下拉快速拾取菜单
    const tabMenuItems = tabs.map(tab => ({
        key: tab.id,
        label: (
            <div className={`tab-dropdown-item ${tab.id === activeTabId ? 'is-active' : ''}`}>
                <FileTextOutlined style={{ marginRight: 6 }} />
                <span className={tab.isPreview ? 'is-preview' : ''}>{tab.title || '无标题笔记'}</span>
                {tab.isPinned && <PushpinFilled style={{ color: '#d97706', marginLeft: 6, fontSize: 11 }} />}
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
                                className={`note-tab-item ${isActive ? 'is-active' : ''} ${tab.isPreview ? 'is-preview' : ''} ${tab.isPinned ? 'is-pinned' : ''} ${tab.isDirty ? 'is-dirty' : ''} ${isDragging ? 'is-dragging' : ''} ${isDragOver ? 'is-drag-over' : ''}`}
                                role="tab"
                                aria-selected={isActive}
                                draggable
                                onDragStart={e => handleDragStart(e, index)}
                                onDragOver={e => handleDragOver(e, index)}
                                onDrop={e => handleDrop(e, index)}
                                onDragEnd={handleDragEnd}
                                onClick={() => onSelectTab(tab.id, pane)}
                                onDoubleClick={() => onMakeTabPermanent(tab.id, pane)}
                                onAuxClick={e => {
                                    // 鼠标中键点击关闭标签
                                    if (e.button === 1) {
                                        e.preventDefault();
                                        onCloseTab(tab.id, pane);
                                    }
                                }}
                                title={`${tab.title}${tab.isPreview ? ' (预览模式 - 双击或修改转为常驻)' : ''}${tab.isPinned ? ' (已固定)' : ''}`}
                            >
                                {/* 固定图钉标记 */}
                                {tab.isPinned && (
                                    <span
                                        className="tab-pin-icon"
                                        onClick={e => {
                                            e.stopPropagation();
                                            onTogglePinTab(tab.id, pane);
                                        }}
                                        title="取消固定"
                                    >
                                        <PushpinFilled />
                                    </span>
                                )}

                                {/* 笔记标题（超长自动截断，保持文件名扩展名） */}
                                <span className="tab-title">
                                    {tab.title || '无标题笔记'}
                                </span>

                                {/* 关闭按钮与未保存圆点 */}
                                {!tab.isPinned && (
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
                                )}
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
        </div>
    );
};

export default NoteTabBar;
