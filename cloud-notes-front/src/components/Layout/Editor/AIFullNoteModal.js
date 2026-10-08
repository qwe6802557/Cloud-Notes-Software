import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Modal, Button, message, Input, Spin } from 'antd';
import {
    ThunderboltOutlined,
    CopyOutlined,
    DownloadOutlined,
    ReloadOutlined,
    SendOutlined
} from '@ant-design/icons';
import { streamAICall } from '@/api/ai';
import { getAIModelDisplayTag } from '@/utils/preferences';


const AIFullNoteModal = ({
    open,
    onClose,
    action = 'full_summary',
    noteTitle = '',
    noteContent = '',
    onInsertContent
}) => {
    const [streaming, setStreaming] = useState(false);
    const [resultText, setResultText] = useState('');
    const [copied, setCopied] = useState(false);
    const [customPrompt, setCustomPrompt] = useState('');
    const [currentAction, setCurrentAction] = useState(action);
    const [modelTag, setModelTag] = useState(() => getAIModelDisplayTag());

    const abortControllerRef = useRef(null);
    const resultBoxRef = useRef(null);
    const noteContentRef = useRef(noteContent);
    noteContentRef.current = noteContent;
    const noteTitleRef = useRef(noteTitle);
    noteTitleRef.current = noteTitle;

    const startStream = useCallback(async (act = currentAction, prompt = customPrompt) => {
        const text = noteContentRef.current;
        const title = noteTitleRef.current;

        if (!text && !prompt) {
            message.warning('当前笔记内容为空，无法进行 AI 分析');
            return;
        }

        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        const controller = new AbortController();
        abortControllerRef.current = controller;

        setStreaming(true);
        setResultText('');
        setCopied(false);

        try {
            await streamAICall(
                {
                    action: act,
                    text,
                    noteTitle: title,
                    customPrompt: prompt
                },
                {
                    signal: controller.signal,
                    onDelta: (delta, full) => {
                        setResultText(full);
                        if (resultBoxRef.current) {
                            resultBoxRef.current.scrollTop = resultBoxRef.current.scrollHeight;
                        }
                    },
                    onFinish: () => {
                        setStreaming(false);
                    },
                    onError: err => {
                        if (err.name === 'AbortError') return;
                        setStreaming(false);
                        message.error(err.message || 'AI 生成异常');
                    }
                }
            );
        } catch (err) {
            if (err.name === 'AbortError') return;
            setStreaming(false);
        }
    }, [currentAction, customPrompt]);

    const startStreamRef = useRef(startStream);
    startStreamRef.current = startStream;

    useEffect(() => {
        const handleConfigChange = e => {
            setModelTag(getAIModelDisplayTag(e?.detail));
        };
        window.addEventListener('ai-config-changed', handleConfigChange);
        return () => {
            window.removeEventListener('ai-config-changed', handleConfigChange);
        };
    }, []);

    useEffect(() => {
        if (open) {
            setModelTag(getAIModelDisplayTag());
            setCurrentAction(action);
            setCustomPrompt('');
            if (action !== 'custom') {
                startStreamRef.current?.(action, '');
            } else {
                setResultText('');
                setStreaming(false);
            }
        } else {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            setStreaming(false);
            setResultText('');
        }
    }, [open, action]);

    const handleCopy = () => {
        if (!resultText) return;
        navigator.clipboard.writeText(resultText).then(() => {
            setCopied(true);
            message.success('AI 生成内容已复制到剪贴板');
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const handleInsert = () => {
        if (!resultText) return;
        let prefix = '\n\n';
        if (currentAction === 'full_summary') {
            prefix += '## 📑 AI 核心摘要\n';
        } else if (currentAction === 'extract_todos') {
            prefix += '## ✅ 待办事项清单\n';
        } else if (currentAction === 'mindmap_outline') {
            prefix += '## 🧠 思维导图大纲\n';
        }

        onInsertContent?.(prefix + resultText);
        message.success('已成功追加至文档末尾');
        onClose?.();
    };

    return (
        <Modal
            open={open}
            onCancel={() => {
                if (abortControllerRef.current) abortControllerRef.current.abort();
                onClose?.();
            }}
            title={(
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ThunderboltOutlined style={{ color: '#7c3aed', fontSize: 16 }} />
                    <span style={{ fontWeight: 600 }}>AI 创作</span>
                    {modelTag && (
                        <span
                            style={{
                                fontSize: 11,
                                padding: '1px 6px',
                                borderRadius: 4,
                                background: '#f3e8ff',
                                color: '#7c3aed',
                                fontFamily: 'SFMono-Regular, Consolas, monospace',
                                fontWeight: 500,
                                maxWidth: 160,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                            }}
                            title={modelTag}
                        >
                            {modelTag}
                        </span>
                    )}
                </div>
            )}
            width={720}
            destroyOnClose
            footer={(
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div />
                    <div style={{ display: 'flex', gap: 8 }}>
                        <Button
                            icon={<CopyOutlined />}
                            disabled={!resultText}
                            onClick={handleCopy}
                        >
                            {copied ? '已复制' : '复制结果'}
                        </Button>
                        <Button
                            icon={<ReloadOutlined />}
                            disabled={streaming}
                            onClick={() => startStream(currentAction, customPrompt)}
                        >
                            重新生成
                        </Button>
                        <Button
                            type="primary"
                            icon={<DownloadOutlined />}
                            disabled={!resultText || streaming}
                            onClick={handleInsert}
                            style={{ background: '#7c3aed', borderColor: '#7c3aed' }}
                        >
                            插入到文档末尾
                        </Button>
                    </div>
                </div>
            )}
        >
            <div style={{ minHeight: 280, maxHeight: 460, display: 'flex', flexDirection: 'column' }}>
                {currentAction === 'custom' && (
                    <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
                        <Input
                            placeholder="输入对当前笔记的提问或处理要求（例如：提炼3个核心论点、写成新闻通稿风格）..."
                            value={customPrompt}
                            onChange={e => setCustomPrompt(e.target.value)}
                            onPressEnter={() => startStream('custom', customPrompt)}
                            disabled={streaming}
                        />
                        <Button
                            type="primary"
                            icon={<SendOutlined />}
                            onClick={() => startStream('custom', customPrompt)}
                            loading={streaming}
                            style={{ background: '#7c3aed', borderColor: '#7c3aed' }}
                        >
                            发送
                        </Button>
                    </div>
                )}

                <div
                    ref={resultBoxRef}
                    className="ai-modal-result-box"
                    style={{
                        flex: 1,
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: 8,
                        padding: 16,
                        overflowY: 'auto',
                        overflowX: 'hidden',
                        whiteSpace: 'pre-wrap',
                        fontFamily: 'SFMono-Regular, Consolas, "PingFang SC", sans-serif',
                        fontSize: 13,
                        lineHeight: 1.6,
                        color: '#0f172a'
                    }}
                >
                    {resultText ? (
                        <>
                            {resultText}
                            {streaming && (
                                <span
                                    style={{
                                        display: 'inline-block',
                                        width: 8,
                                        height: 15,
                                        background: '#7c3aed',
                                        marginLeft: 4,
                                        verticalAlign: 'middle',
                                        animation: 'blink 1s infinite'
                                    }}
                                />
                            )}
                        </>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 220, color: '#94a3b8' }}>
                            {streaming ? (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                                    <Spin size="default" />
                                    <span style={{ fontSize: 13, color: '#7c3aed', fontWeight: 500 }}>正在实时推流生成中...</span>
                                </div>
                            ) : (
                                <span>{currentAction === 'custom' ? '请输入指令并点击发送' : '点击重新生成以触发 AI 分析'}</span>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    );
};

export default AIFullNoteModal;
