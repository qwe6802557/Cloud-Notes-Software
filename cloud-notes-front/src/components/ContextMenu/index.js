import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import './index.less';

/**
 * 通用原生无痕右键上下文菜单组件 (Stitch 规范封装)
 * 支持包裹 children 自动监听右键，或通过 open, x, y 受控呼出
 */
const ContextMenu = ({
    children,
    items = [],
    open: controlledOpen,
    x: controlledX = 0,
    y: controlledY = 0,
    onClose: controlledOnClose,
    className = ''
}) => {
    const [internalOpen, setInternalOpen] = useState(false);
    const [coords, setCoords] = useState({ x: 0, y: 0 });
    const menuRef = useRef(null);

    const isControlled = typeof controlledOpen === 'boolean';
    const isOpen = isControlled ? controlledOpen : internalOpen;
    const currentX = isControlled ? controlledX : coords.x;
    const currentY = isControlled ? controlledY : coords.y;

    const handleClose = useCallback(() => {
        if (isControlled) {
            controlledOnClose?.();
        } else {
            setInternalOpen(false);
        }
    }, [isControlled, controlledOnClose]);

    // 监听子元素原生 contextmenu 事件
    const handleContextMenu = useCallback(e => {
        if (items.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        setCoords({ x: e.clientX, y: e.clientY });
        setInternalOpen(true);
    }, [items]);

    // 点击外部与按下 ESC 自动关闭
    useEffect(() => {
        if (!isOpen) return;

        const handlePointerDown = e => {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                handleClose();
            }
        };

        const handleKeyDown = e => {
            if (e.key === 'Escape') {
                handleClose();
            }
        };

        const handleScroll = () => {
            handleClose();
        };

        window.addEventListener('pointerdown', handlePointerDown, true);
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('scroll', handleScroll, true);

        return () => {
            window.removeEventListener('pointerdown', handlePointerDown, true);
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('scroll', handleScroll, true);
        };
    }, [isOpen, handleClose]);

    // 视口边界碰撞检测自愈：防止溢出屏幕右侧或下侧
    const [adjustedPos, setAdjustedPos] = useState({ x: 0, y: 0 });

    useEffect(() => {
        if (!isOpen) return;

        const menuEl = menuRef.current;
        const width = menuEl ? menuEl.offsetWidth : 180;
        const height = menuEl ? menuEl.offsetHeight : 200;

        const clampedX = Math.max(8, Math.min(currentX, window.innerWidth - width - 8));
        const clampedY = Math.max(8, Math.min(currentY, window.innerHeight - height - 8));

        setAdjustedPos({ x: clampedX, y: clampedY });
    }, [isOpen, currentX, currentY]);

    const handleItemClick = (e, item) => {
        e.stopPropagation();
        if (item.disabled) return;
        handleClose();
        item.onClick?.();
    };

    const renderMenuContent = () => {
        if (!isOpen || items.length === 0) return null;

        return createPortal(
            <div
                ref={menuRef}
                className={`stitch-context-menu ${className}`}
                style={{
                    left: `${adjustedPos.x}px`,
                    top: `${adjustedPos.y}px`
                }}
                onContextMenu={e => e.preventDefault()}
            >
                {items.map((item, index) => {
                    if (item.type === 'divider') {
                        return <div key={`div-${index}`} className="stitch-menu-divider" />;
                    }

                    const itemClass = [
                        'stitch-menu-item',
                        item.danger ? 'is-danger' : '',
                        item.disabled ? 'is-disabled' : ''
                    ].filter(Boolean).join(' ');

                    return (
                        <div
                            key={item.key || `item-${index}`}
                            className={itemClass}
                            onClick={e => handleItemClick(e, item)}
                        >
                            <span className="item-left">
                                {item.icon && <span className="item-icon">{item.icon}</span>}
                                <span className="item-label">{item.label}</span>
                            </span>
                            {item.shortcut && <span className="item-shortcut">{item.shortcut}</span>}
                        </div>
                    );
                })}
            </div>,
            document.body
        );
    };

    if (children) {
        return (
            <div className="stitch-context-menu-wrapper" onContextMenu={handleContextMenu}>
                {children}
                {renderMenuContent()}
            </div>
        );
    }

    return renderMenuContent();
};

export default ContextMenu;
