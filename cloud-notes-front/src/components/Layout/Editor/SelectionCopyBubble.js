import React, { useEffect, useRef, useState, useCallback } from 'react';
import { CopyOutlined, CheckOutlined } from '@ant-design/icons';

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

const SelectionCopyBubble = ({ containerRef }) => {
    const [visible, setVisible] = useState(false);
    const [copied, setCopied] = useState(false);
    const [position, setPosition] = useState({ top: 0, left: 0 });
    const bubbleRef = useRef(null);
    const hideTimerRef = useRef(null);
    const activeSelectionRef = useRef(null);
    const visibleRef = useRef(false);

    useEffect(() => {
        visibleRef.current = visible;
    }, [visible]);

    // 触发复制成功状态与平滑淡出
    const showCopiedFeedback = useCallback(() => {
        setCopied(true);
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        hideTimerRef.current = setTimeout(() => {
            setVisible(false);
            setCopied(false);
        }, 800);
    }, []);

    // 复制选区内容至剪贴板（预览区支持富文本与纯文本双通道，编辑区复制 Markdown 原文）
    const handleCopy = useCallback(async e => {
        e?.preventDefault();
        e?.stopPropagation();

        const selData = activeSelectionRef.current;
        const selectedText = selData?.text || window.getSelection()?.toString() || '';
        if (!selectedText) return;

        try {
            if (selData?.isPreview && selData?.range && navigator.clipboard && window.ClipboardItem) {
                const cloned = selData.range.cloneContents();
                const tempDiv = document.createElement('div');
                tempDiv.appendChild(cloned);
                const htmlContent = tempDiv.innerHTML;

                if (htmlContent) {
                    const blobHtml = new Blob([htmlContent], { type: 'text/html' });
                    const blobText = new Blob([selectedText], { type: 'text/plain' });
                    await navigator.clipboard.write([
                        new ClipboardItem({
                            'text/html': blobHtml,
                            'text/plain': blobText
                        })
                    ]);
                } else {
                    await navigator.clipboard.writeText(selectedText);
                }
            } else if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(selectedText);
            } else {
                document.execCommand('copy');
            }

            showCopiedFeedback();
        } catch {
            setCopied(false);
        }
    }, [showCopiedFeedback]);

    // 计算并展示浮动气泡位置，返回是否匹配到有效选区
    const updateBubblePosition = useCallback(() => {
        const container = containerRef?.current;
        if (!container) {
            setVisible(false);
            setCopied(false);
            return false;
        }

        const selection = window.getSelection();

        // 1. 优先检查预览区（DOM 原生选区）
        if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
            const text = selection.toString().trim();
            if (text) {
                const range = selection.getRangeAt(0);
                const ancestor = range.commonAncestorContainer;
                const ancestorEl = ancestor.nodeType === Node.ELEMENT_NODE ? ancestor : ancestor.parentElement;

                if (container.contains(ancestorEl)) {
                    const isPreview = Boolean(ancestorEl.closest('.bytemd-preview, .preview-only, .markdown-body'));
                    const rect = range.getBoundingClientRect();

                    if (rect.width > 0 && rect.height > 0) {
                        const bubbleWidth = 100;
                        const bubbleHeight = 32;

                        let top = rect.top - bubbleHeight - 8;
                        let left = rect.left + rect.width / 2;

                        if (top < 64) {
                            top = rect.bottom + 8;
                        }

                        const minLeft = bubbleWidth / 2 + 12;
                        const maxLeft = window.innerWidth - bubbleWidth / 2 - 12;
                        left = Math.max(minLeft, Math.min(maxLeft, left));

                        activeSelectionRef.current = {
                            text: selection.toString(),
                            isPreview,
                            range: isPreview ? range.cloneRange() : null
                        };
                        setPosition({ top, left });
                        setVisible(true);
                        setCopied(false);
                        return true;
                    }
                }
            }
        }

        // 2. 检查编辑区（CodeMirror 选区）
        const cmEl = container.querySelector('.CodeMirror');
        const cm = cmEl?.CodeMirror;
        if (cm && typeof cm.somethingSelected === 'function' && cm.somethingSelected()) {
            const cmText = cm.getSelection();
            if (cmText && cmText.trim()) {
                const selectedEls = cmEl.querySelectorAll('.CodeMirror-selected');
                let rect = null;

                if (selectedEls.length > 0) {
                    let top = Infinity;
                    let bottom = -Infinity;
                    let left = Infinity;
                    let right = -Infinity;

                    selectedEls.forEach(el => {
                        const r = el.getBoundingClientRect();
                        if (r.width > 0 && r.height > 0) {
                            top = Math.min(top, r.top);
                            bottom = Math.max(bottom, r.bottom);
                            left = Math.min(left, r.left);
                            right = Math.max(right, r.right);
                        }
                    });

                    if (top !== Infinity) {
                        rect = {
                            top,
                            bottom,
                            left,
                            right,
                            width: right - left,
                            height: bottom - top
                        };
                    }
                }

                if (!rect && typeof cm.cursorCoords === 'function') {
                    const from = cm.cursorCoords(true, 'window');
                    const to = cm.cursorCoords(false, 'window');
                    rect = {
                        top: Math.min(from.top, to.top),
                        bottom: Math.max(from.bottom, to.bottom),
                        left: Math.min(from.left, to.left),
                        right: Math.max(from.right, to.right),
                        width: Math.abs(to.left - from.left) || 10,
                        height: Math.abs(to.bottom - from.top) || 20
                    };
                }

                if (rect && rect.top > 0) {
                    const bubbleWidth = 100;
                    const bubbleHeight = 32;

                    let top = rect.top - bubbleHeight - 8;
                    let left = rect.left + rect.width / 2;

                    if (top < 64) {
                        top = rect.bottom + 8;
                    }

                    const minLeft = bubbleWidth / 2 + 12;
                    const maxLeft = window.innerWidth - bubbleWidth / 2 - 12;
                    left = Math.max(minLeft, Math.min(maxLeft, left));

                    activeSelectionRef.current = {
                        text: cmText,
                        isPreview: false,
                        range: null
                    };
                    setPosition({ top, left });
                    setVisible(true);
                    setCopied(false);
                    return true;
                }
            }
        }

        setVisible(false);
        setCopied(false);
        return false;
    }, [containerRef]);

    useEffect(() => {
        const handleMouseUp = e => {
            if (bubbleRef.current && bubbleRef.current.contains(e.target)) {
                return;
            }
            setTimeout(updateBubblePosition, 20);
        };

        const handleMouseDown = e => {
            if (bubbleRef.current && bubbleRef.current.contains(e.target)) {
                return;
            }
            setVisible(false);
            setCopied(false);
        };

        const handleKeyUp = e => {
            if (e.shiftKey || e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                setTimeout(updateBubblePosition, 20);
            }
        };

        const handleScrollOrResize = () => {
            setVisible(false);
            setCopied(false);
        };

        // 键盘快捷键 Ctrl+C / Cmd+C 监听与提示
        const handleKeyDown = e => {
            if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
                if (visibleRef.current && activeSelectionRef.current?.text) {
                    showCopiedFeedback();
                } else {
                    const hasSelection = updateBubblePosition();
                    if (hasSelection) {
                        showCopiedFeedback();
                    }
                }
            }
        };

        // 原生 copy 事件监听与富文本增强
        const handleCopyEvent = e => {
            const selData = activeSelectionRef.current;
            if (visibleRef.current && selData?.text) {
                showCopiedFeedback();

                if (selData.isPreview && selData.range && e.clipboardData) {
                    try {
                        const cloned = selData.range.cloneContents();
                        const tempDiv = document.createElement('div');
                        tempDiv.appendChild(cloned);
                        const htmlContent = tempDiv.innerHTML;
                        if (htmlContent) {
                            e.clipboardData.setData('text/html', htmlContent);
                            e.clipboardData.setData('text/plain', selData.text);
                            e.preventDefault();
                        }
                    } catch {
                        // ignore fallback
                    }
                }
            }
        };

        document.addEventListener('mouseup', handleMouseUp);
        document.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('keyup', handleKeyUp);
        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('copy', handleCopyEvent);
        window.addEventListener('scroll', handleScrollOrResize, true);
        window.addEventListener('resize', handleScrollOrResize);

        return () => {
            document.removeEventListener('mouseup', handleMouseUp);
            document.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('keyup', handleKeyUp);
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('copy', handleCopyEvent);
            window.removeEventListener('scroll', handleScrollOrResize, true);
            window.removeEventListener('resize', handleScrollOrResize);
            if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        };
    }, [updateBubblePosition, showCopiedFeedback]);

    if (!visible) return null;

    return (
        <div
            ref={bubbleRef}
            className={`selection-copy-bubble ${copied ? 'is-copied' : ''}`}
            style={{ top: position.top, left: position.left }}
            onMouseDown={e => e.preventDefault()}
            onClick={handleCopy}
            title={copied ? '已复制' : '复制选中文字'}
        >
            {copied ? (
                <span className="bubble-content">
                    <CheckOutlined className="bubble-icon copied-icon" />
                    <span className="bubble-text">已复制</span>
                </span>
            ) : (
                <span className="bubble-content">
                    <CopyOutlined className="bubble-icon" />
                    <span className="bubble-text">复制</span>
                    <kbd className="bubble-kbd">{isMac ? '⌘C' : 'Ctrl+C'}</kbd>
                </span>
            )}
        </div>
    );
};

export default SelectionCopyBubble;
