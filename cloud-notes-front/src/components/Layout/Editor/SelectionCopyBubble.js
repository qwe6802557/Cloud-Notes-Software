import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
    CopyOutlined,
    CheckOutlined,
    ThunderboltOutlined,
    CloseOutlined,
    ReloadOutlined,
    SwapOutlined,
    VerticalAlignBottomOutlined,
    SendOutlined,
    EditOutlined,
    FastForwardOutlined,
    FileAddOutlined,
    CompressOutlined,
    CheckCircleOutlined,
    TranslationOutlined,
    GlobalOutlined
} from '@ant-design/icons';
import { Popover, message, Button, Input, Spin } from 'antd';
import { streamAICall, getAIConfig } from '@/api/ai';
import { setCachedAIConfig, getAIModelDisplayTag } from '@/utils/preferences';

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

const AI_ACTIONS = [
    { key: 'polish', icon: <EditOutlined style={{ color: '#d97706' }} />, label: '智能润色', desc: '改进文笔与修辞，使表达更专业地道' },
    { key: 'continue', icon: <FastForwardOutlined style={{ color: '#2563eb' }} />, label: '承接续写', desc: '根据选中内容向下延伸创作' },
    { key: 'expand', icon: <FileAddOutlined style={{ color: '#7c3aed' }} />, label: '丰富扩写', desc: '补充论据与细节，充实内容篇幅' },
    { key: 'summarize_text', icon: <CompressOutlined style={{ color: '#059669' }} />, label: '精简提炼', desc: '保留核心观点，剔除冗余修饰' },
    { key: 'grammar', icon: <CheckCircleOutlined style={{ color: '#10b981' }} />, label: '纠错校对', desc: '修正错别字、标点与语法病句' },
    { key: 'translate_en', icon: <TranslationOutlined style={{ color: '#0284c7' }} />, label: '翻译为英文', desc: '转换为自然流畅的现代英文' },
    { key: 'translate_zh', icon: <GlobalOutlined style={{ color: '#ea580c' }} />, label: '翻译为中文', desc: '转换为规范通顺的标准中文' }
];

const SelectionCopyBubble = ({
    containerRef,
    editorContextRef
}) => {
    const [visible, setVisible] = useState(false);
    const [copied, setCopied] = useState(false);
    const [position, setPosition] = useState({ top: 0, left: 0 });

    // AI 相关状态
    const [aiMenuOpen, setAiMenuOpen] = useState(false);
    const [aiCardOpen, setAiCardOpen] = useState(false);
    const [aiStreaming, setAiStreaming] = useState(false);
    const [aiResult, setAiResult] = useState('');
    const [aiAction, setAiAction] = useState('polish');
    const [customPrompt, setCustomPrompt] = useState('');
    const [resultCopied, setResultCopied] = useState(false);
    const [modelTag, setModelTag] = useState(() => getAIModelDisplayTag());

    const bubbleRef = useRef(null);
    const aiCardRef = useRef(null);
    const aiResultBoxRef = useRef(null);
    const hideTimerRef = useRef(null);
    const activeSelectionRef = useRef(null);
    const visibleRef = useRef(false);
    const isAIActiveRef = useRef(false);
    const aiCardOpenRef = useRef(false);
    const aiMenuOpenRef = useRef(false);
    const aiStreamingRef = useRef(false);
    const abortControllerRef = useRef(null);

    useEffect(() => {
        visibleRef.current = visible;
    }, [visible]);

    useEffect(() => {
        aiCardOpenRef.current = aiCardOpen;
        aiMenuOpenRef.current = aiMenuOpen;
        aiStreamingRef.current = aiStreaming;
        isAIActiveRef.current = aiMenuOpen || aiCardOpen || aiStreaming;
    }, [aiMenuOpen, aiCardOpen, aiStreaming]);

    // 同步 AI 模型生效状态
    useEffect(() => {
        const handleConfigChange = e => {
            setModelTag(getAIModelDisplayTag(e?.detail));
        };
        window.addEventListener('ai-config-changed', handleConfigChange);

        getAIConfig().then(res => {
            if (res) {
                setCachedAIConfig(res);
                setModelTag(getAIModelDisplayTag(res));
            }
        }).catch(() => {});

        return () => {
            window.removeEventListener('ai-config-changed', handleConfigChange);
        };
    }, []);

    useEffect(() => {
        if (aiMenuOpen) {
            setModelTag(getAIModelDisplayTag());
        }
    }, [aiMenuOpen]);

    // 组件真正卸载时终止未完成的流式请求
    useEffect(() => {
        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        };
    }, []);

    // 触发普通复制成功反馈
    const showCopiedFeedback = useCallback(() => {
        setCopied(true);
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        hideTimerRef.current = setTimeout(() => {
            if (!isAIActiveRef.current) {
                setVisible(false);
            }
            setCopied(false);
        }, 800);
    }, []);

    // 复制选区内容至剪贴板
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

    // 计算选区位置
    const updateBubblePosition = useCallback(() => {
        if (isAIActiveRef.current) {
            return true;
        }

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
                        const bubbleWidth = 180;
                        const bubbleHeight = 34;

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
                            range: isPreview ? range.cloneRange() : null,
                            from: null,
                            to: null
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
                    const fromCoords = cm.cursorCoords(true, 'window');
                    const toCoords = cm.cursorCoords(false, 'window');
                    rect = {
                        top: Math.min(fromCoords.top, toCoords.top),
                        bottom: Math.max(fromCoords.bottom, toCoords.bottom),
                        left: Math.min(fromCoords.left, toCoords.left),
                        right: Math.max(fromCoords.right, toCoords.right),
                        width: Math.abs(toCoords.left - fromCoords.left) || 10,
                        height: Math.abs(toCoords.bottom - fromCoords.top) || 20
                    };
                }

                if (rect && rect.top > 0) {
                    const bubbleWidth = 180;
                    const bubbleHeight = 34;

                    let top = rect.top - bubbleHeight - 8;
                    let left = rect.left + rect.width / 2;

                    if (top < 64) {
                        top = rect.bottom + 8;
                    }

                    const minLeft = bubbleWidth / 2 + 12;
                    const maxLeft = window.innerWidth - bubbleWidth / 2 - 12;
                    left = Math.max(minLeft, Math.min(maxLeft, left));

                    const fromPos = cm.getCursor('from');
                    const toPos = cm.getCursor('to');

                    activeSelectionRef.current = {
                        text: cmText,
                        isPreview: false,
                        range: null,
                        from: fromPos,
                        to: toPos
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

    // 触发 AI 处理
    const handleTriggerAI = useCallback(async (actionKey, customText = '') => {
        const selData = activeSelectionRef.current;
        const selectedText = selData?.text || '';
        if (!selectedText.trim()) {
            message.warning('请先选择要处理的文字');
            return;
        }

        setAiMenuOpen(false);
        setAiCardOpen(true);
        setAiStreaming(true);
        setAiResult('');
        setAiAction(actionKey);

        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        const controller = new AbortController();
        abortControllerRef.current = controller;

        try {
            await streamAICall(
                {
                    action: actionKey,
                    text: selectedText,
                    customPrompt: customText
                },
                {
                    signal: controller.signal,
                    onDelta: (delta, full) => {
                        setAiResult(full);
                        if (aiResultBoxRef.current) {
                            aiResultBoxRef.current.scrollTop = aiResultBoxRef.current.scrollHeight;
                        }
                    },
                    onFinish: () => {
                        setAiStreaming(false);
                    },
                    onError: err => {
                        setAiStreaming(false);
                        message.error(err.message || 'AI 生成异常');
                    }
                }
            );
        } catch {
            setAiStreaming(false);
        }
    }, []);

    // 替换选中的原文
    const handleReplaceSelection = useCallback(() => {
        if (!aiResult) return;
        const selData = activeSelectionRef.current;
        const cm = editorContextRef?.current?.editor;

        if (cm && selData?.from && selData?.to) {
            cm.replaceRange(aiResult, selData.from, selData.to);
            cm.focus();
            message.success('已替换原文');
            setAiCardOpen(false);
            setVisible(false);
            return;
        }

        if (selData?.isPreview) {
            navigator.clipboard.writeText(aiResult).then(() => {
                message.info('当前在只读预览区，已将生成内容复制至剪贴板');
            });
            setAiCardOpen(false);
            setVisible(false);
            return;
        }

        message.error('未找到对应编辑器光标选区');
    }, [aiResult, editorContextRef]);

    // 在选区下方插入
    const handleInsertBelow = useCallback(() => {
        if (!aiResult) return;
        const selData = activeSelectionRef.current;
        const cm = editorContextRef?.current?.editor;

        if (cm && selData?.to) {
            cm.replaceRange('\n\n' + aiResult, selData.to, selData.to);
            cm.focus();
            message.success('已在下方插入生成内容');
            setAiCardOpen(false);
            setVisible(false);
            return;
        }

        navigator.clipboard.writeText(aiResult).then(() => {
            message.info('已复制生成内容至剪贴板');
        });
        setAiCardOpen(false);
        setVisible(false);
    }, [aiResult, editorContextRef]);

    // 复制 AI 结果
    const handleCopyResult = useCallback(() => {
        if (!aiResult) return;
        navigator.clipboard.writeText(aiResult).then(() => {
            setResultCopied(true);
            message.success('已复制 AI 内容');
            setTimeout(() => setResultCopied(false), 2000);
        });
    }, [aiResult]);

    // 关闭 AI 卡片
    const handleCloseAICard = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        setAiStreaming(false);
        setAiCardOpen(false);
        setAiMenuOpen(false);
        setVisible(false);
    }, []);

    useEffect(() => {
        const handleMouseUp = e => {
            if (bubbleRef.current && bubbleRef.current.contains(e.target)) {
                return;
            }
            if (aiCardRef.current && aiCardRef.current.contains(e.target)) {
                return;
            }
            if (isAIActiveRef.current) {
                return;
            }
            setTimeout(updateBubblePosition, 20);
        };

        const handleMouseDown = e => {
            if (bubbleRef.current && bubbleRef.current.contains(e.target)) {
                return;
            }
            if (aiCardRef.current && aiCardRef.current.contains(e.target)) {
                return;
            }
            // 忽略对 Antd 快捷弹窗浮层的点击，防止提前销毁或阻断流式请求
            if (e.target && typeof e.target.closest === 'function' && e.target.closest('.selection-ai-popover-overlay, .ant-popover')) {
                return;
            }
            // 如果 AI 面板打开，点击外部非卡片区域则关闭
            if (aiCardOpenRef.current || aiMenuOpenRef.current) {
                if (!aiStreamingRef.current) {
                    setAiCardOpen(false);
                    setAiMenuOpen(false);
                    setVisible(false);
                }
                return;
            }
            setVisible(false);
            setCopied(false);
        };

        const handleKeyUp = e => {
            if (isAIActiveRef.current) return;
            if (e.shiftKey || e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                setTimeout(updateBubblePosition, 20);
            }
        };

        const handleScrollOrResize = () => {
            if (!isAIActiveRef.current) {
                setVisible(false);
                setCopied(false);
            }
        };

        const handleKeyDown = e => {
            if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
                if (visibleRef.current && activeSelectionRef.current?.text) {
                    showCopiedFeedback();
                }
            }
        };

        document.addEventListener('mouseup', handleMouseUp);
        document.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('keyup', handleKeyUp);
        document.addEventListener('keydown', handleKeyDown);
        window.addEventListener('scroll', handleScrollOrResize, true);
        window.addEventListener('resize', handleScrollOrResize);

        return () => {
            document.removeEventListener('mouseup', handleMouseUp);
            document.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('keyup', handleKeyUp);
            document.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('scroll', handleScrollOrResize, true);
            window.removeEventListener('resize', handleScrollOrResize);
            if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        };
    }, [updateBubblePosition, showCopiedFeedback]);

    if (!visible) return null;

    // 计算 AI 浮窗安全视口坐标
    const cardWidth = 460;
    let cardLeft = position.left;
    if (cardLeft - cardWidth / 2 < 16) {
        cardLeft = cardWidth / 2 + 16;
    } else if (cardLeft + cardWidth / 2 > window.innerWidth - 16) {
        cardLeft = window.innerWidth - cardWidth / 2 - 16;
    }

    let cardTop = position.top + 38;
    if (cardTop + 360 > window.innerHeight) {
        cardTop = Math.max(16, position.top - 380);
    }

    const aiMenuContent = (
        <div className="selection-ai-menu-popover" onMouseDown={e => e.stopPropagation()}>
            <div className="menu-header">
                <span className="menu-title">
                    <ThunderboltOutlined style={{ color: '#7c3aed', marginRight: 6 }} />
                    AI 选区快捷创作
                </span>
                <span className="menu-model-tag" title={modelTag}>{modelTag}</span>
            </div>
            <div className="menu-grid">
                {AI_ACTIONS.map(action => (
                    <div
                        key={action.key}
                        className="menu-item"
                        onClick={() => handleTriggerAI(action.key, '')}
                    >
                        <span className="item-icon">{action.icon}</span>
                        <div className="item-info">
                            <div className="item-label">{action.label}</div>
                            <div className="item-desc">{action.desc}</div>
                        </div>
                    </div>
                ))}
            </div>
            <div className="menu-custom-input">
                <Input
                    size="small"
                    placeholder="自定义指令（如：转换为更加幽默的口吻）..."
                    value={customPrompt}
                    onChange={e => setCustomPrompt(e.target.value)}
                    onPressEnter={() => {
                        if (customPrompt.trim()) {
                            handleTriggerAI('custom', customPrompt);
                        }
                    }}
                    suffix={(
                        <SendOutlined
                            style={{
                                cursor: customPrompt.trim() ? 'pointer' : 'not-allowed',
                                color: customPrompt.trim() ? '#7c3aed' : '#cbd5e1'
                            }}
                            onClick={() => {
                                if (customPrompt.trim()) {
                                    handleTriggerAI('custom', customPrompt);
                                }
                            }}
                        />
                    )}
                />
            </div>
        </div>
    );

    return (
        <>
            {/* 选区气泡主胶囊 */}
            <div
                ref={bubbleRef}
                className={`selection-copy-bubble ${copied ? 'is-copied' : ''}`}
                style={{ top: position.top, left: position.left }}
                onMouseDown={e => e.stopPropagation()}
            >
                {/* AI 创作按钮 */}
                <Popover
                    content={aiMenuContent}
                    trigger="click"
                    open={aiMenuOpen}
                    onOpenChange={open => setAiMenuOpen(open)}
                    placement="bottom"
                    overlayClassName="selection-ai-popover-overlay"
                >
                    <div className="bubble-btn ai-action-btn" title="AI 智能创作助手">
                        <ThunderboltOutlined className="bubble-icon ai-sparkle-icon" />
                        <span className="bubble-text">AI 创作</span>
                    </div>
                </Popover>

                <div className="bubble-split-divider" />

                {/* 复制按钮 */}
                <div
                    className="bubble-btn copy-action-btn"
                    onClick={handleCopy}
                    title={copied ? '已复制' : '复制选中文字'}
                >
                    {copied ? (
                        <>
                            <CheckOutlined className="bubble-icon copied-icon" />
                            <span className="bubble-text">已复制</span>
                        </>
                    ) : (
                        <>
                            <CopyOutlined className="bubble-icon" />
                            <span className="bubble-text">复制</span>
                            <kbd className="bubble-kbd">{isMac ? '⌘C' : 'Ctrl+C'}</kbd>
                        </>
                    )}
                </div>
            </div>

            {/* AI 生成结果流式悬浮卡片 */}
            {aiCardOpen && (
                <div
                    ref={aiCardRef}
                    className="selection-ai-result-card"
                    style={{ top: cardTop, left: cardLeft }}
                    onMouseDown={e => e.stopPropagation()}
                >
                    <div className="card-header">
                        <div className="card-header-left">
                            <ThunderboltOutlined style={{ color: '#7c3aed', fontSize: 15 }} />
                            <span className="card-title">AI 创作</span>
                        </div>
                        <div className="card-header-right">
                            <CloseOutlined
                                className="close-btn"
                                onClick={handleCloseAICard}
                                title="关闭"
                            />
                        </div>
                    </div>

                    <div ref={aiResultBoxRef} className="card-body">
                        {aiResult ? (
                            <>
                                <span className="result-text">{aiResult}</span>
                                {aiStreaming && <span className="typing-cursor" />}
                            </>
                        ) : (
                            <div className="loading-placeholder">
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '24px 0' }}>
                                    <Spin size="default" />
                                    <span style={{ fontSize: 13, color: '#7c3aed', fontWeight: 500 }}>正在实时推流生成中...</span>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="card-footer">
                        <div className="footer-left">
                            <Button
                                size="small"
                                icon={<ReloadOutlined />}
                                disabled={aiStreaming}
                                onClick={() => handleTriggerAI(aiAction, customPrompt)}
                            >
                                重新生成
                            </Button>
                        </div>
                        <div className="footer-right">
                            <Button
                                size="small"
                                icon={<CopyOutlined />}
                                onClick={handleCopyResult}
                                disabled={!aiResult}
                            >
                                {resultCopied ? '已复制' : '复制'}
                            </Button>
                            <Button
                                size="small"
                                icon={<VerticalAlignBottomOutlined />}
                                onClick={handleInsertBelow}
                                disabled={!aiResult || aiStreaming}
                            >
                                下方插入
                            </Button>
                            <Button
                                size="small"
                                type="primary"
                                icon={<SwapOutlined />}
                                onClick={handleReplaceSelection}
                                disabled={!aiResult || aiStreaming}
                                style={{ background: '#7c3aed', borderColor: '#7c3aed' }}
                            >
                                替换原文
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default SelectionCopyBubble;
