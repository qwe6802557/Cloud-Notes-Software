import React from 'react';
import { createPortal } from 'react-dom';
import {
    LinkOutlined,
    CloseOutlined,
    ApartmentOutlined
} from '@ant-design/icons';

/**
 * 幽灵双链悬浮交互微卡片
 * 遵循 Stitch 语义设计系统规范，提供单点一键织链、全量编织与忽略操作
 */
const GhostLinkHoverCard = ({
    visible,
    position,
    activeItem,
    onWeave,
    onWeaveAll,
    onIgnore,
    onMouseEnter,
    onMouseLeave
}) => {
    if (!visible || !activeItem) {
        return null;
    }

    const {
        targetTitle,
        notebookName = '知识库',
        notebookColor = '#7c3aed',
        occurrencesCount = 1
    } = activeItem;

    const cardContent = (
        <div
            className="ghost-link-hover-card"
            style={{
                top: `${position.top}px`,
                left: `${position.left}px`
            }}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            <div className="ghost-card-header">
                <span className="ghost-card-hint">
                    <LinkOutlined style={{ fontSize: 12 }} />
                    潜在概念
                </span>
                <span className="ghost-card-notebook" title={notebookName}>
                    <span
                        className="notebook-dot"
                        style={{ backgroundColor: notebookColor }}
                    />
                    {notebookName}
                </span>
            </div>

            <div className="ghost-card-body">
                <div className="ghost-target-title" title={targetTitle}>
                    《{targetTitle}》
                </div>
            </div>

            <div className="ghost-card-actions">
                <button
                    type="button"
                    className="btn-weave-single"
                    onClick={onWeave}
                    title="将当前词转换为 [[双链]] (Enter)"
                >
                    <LinkOutlined />
                    一键织链
                </button>

                {occurrencesCount > 1 && (
                    <button
                        type="button"
                        className="btn-weave-all"
                        onClick={onWeaveAll}
                        title={`将全文中所有 ${occurrencesCount} 处同名词统一转换为 [[双链]]`}
                    >
                        <ApartmentOutlined />
                        全部({occurrencesCount})
                    </button>
                )}

                <button
                    type="button"
                    className="btn-ignore"
                    onClick={onIgnore}
                    title="在当前编辑会话中忽略此词条提醒"
                >
                    <CloseOutlined style={{ fontSize: 10, marginRight: 2 }} />
                    忽略
                </button>
            </div>
        </div>
    );

    return createPortal(cardContent, document.body);
};

export default GhostLinkHoverCard;
