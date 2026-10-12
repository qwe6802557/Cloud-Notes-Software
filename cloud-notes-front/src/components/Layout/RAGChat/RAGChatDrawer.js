import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Drawer, Button, Input, Tooltip, message } from 'antd';
import {
    RobotOutlined,
    SyncOutlined,
    CloseOutlined,
    SendOutlined,
    BookOutlined,
    FileTextOutlined,
    ClearOutlined
} from '@ant-design/icons';
import { getRAGStats, triggerReindex } from '@/api/rag';
import './RAGChatDrawer.less';

const { TextArea } = Input;

/**
 * 格式化渲染 AI 文本并动态解析 [1][2] 为交互式证据角标
 */
const renderTextWithCitations = (text, onCitationClick) => {
    if (!text) return null;

    const parts = [];
    const regex = /\[(\d+)\]/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
        const indexBefore = match.index;
        if (indexBefore > lastIndex) {
            parts.push(text.slice(lastIndex, indexBefore));
        }

        const citationNumber = match[1];
        parts.push(
            <span
                key={`cite-${indexBefore}`}
                className="citation-pill"
                onClick={() => onCitationClick && onCitationClick(Number(citationNumber))}
                title={`查看引用来源 [${citationNumber}]`}
            >
                {citationNumber}
            </span>
        );
        lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
        parts.push(text.slice(lastIndex));
    }

    return parts;
};

const RAGChatDrawer = ({
    visible,
    onClose,
    currentNoteId,
    currentNoteTitle,
    currentNotebookId,
    currentNotebookName,
    onNavigateNote
}) => {
    const [messages, setMessages] = useState([]);
    const [inputQuery, setInputQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [indexing, setIndexing] = useState(false);
    const [stats, setStats] = useState({ totalNotes: 0, indexedNotes: 0, totalChunks: 0 });
    const [scopeType, setScopeType] = useState('all');

    const abortControllerRef = useRef(null);
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    const fetchStats = useCallback(async () => {
        try {
            const res = await getRAGStats();
            const data = res?.data || res;
            if (data && typeof data.totalNotes === 'number') {
                setStats(data);
            }
        } catch {}
    }, []);

    useEffect(() => {
        if (visible) {
            fetchStats();
        }
    }, [visible, fetchStats]);

    useEffect(() => {
        scrollToBottom();
    }, [messages, loading]);

    const handleReindex = async () => {
        if (indexing) return;
        setIndexing(true);
        const hideLoading = message.loading('正在构建个人知识库向量索引，请稍候...', 0);
        try {
            const res = await triggerReindex();
            const data = res?.data || res;
            message.success(`知识库索引构建成功！已索引 ${data?.indexedNotes || 0} 篇笔记（${data?.totalChunks || 0} 个切片）`);
            await fetchStats();
        } catch (err) {
            message.error(err.message || '构建索引失败');
        } finally {
            hideLoading();
            setIndexing(false);
        }
    };

    const handleClearChat = () => {
        if (loading && abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        setMessages([]);
    };

    const handleSend = async queryText => {
        const query = (queryText || inputQuery).trim();
        if (!query || loading) return;

        setInputQuery('');
        setLoading(true);

        const userMsg = {
            id: `user-${Date.now()}`,
            role: 'user',
            content: query
        };

        const assistantMsgId = `assistant-${Date.now()}`;
        const initialAssistantMsg = {
            id: assistantMsgId,
            role: 'assistant',
            content: '',
            citations: []
        };

        setMessages(prev => [...prev, userMsg, initialAssistantMsg]);

        let scope = {};
        if (scopeType === 'notebook' && currentNotebookId) {
            scope.notebookId = currentNotebookId;
        } else if (scopeType === 'note' && currentNoteId) {
            scope.noteId = currentNoteId;
        }

        const history = messages.slice(-4).map(m => ({
            role: m.role,
            content: m.content
        }));

        const controller = new AbortController();
        abortControllerRef.current = controller;

        const token = localStorage.getItem('token') || '';

        try {
            const response = await fetch('/api/ai/rag/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: token ? `Bearer ${token}` : ''
                },
                body: JSON.stringify({
                    question: query,
                    scope,
                    history
                }),
                signal: controller.signal
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`请求失败 (${response.status}): ${errText.slice(0, 100)}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith(':')) continue;

                    if (trimmed.startsWith('data: ')) {
                        const payloadStr = trimmed.slice(6).trim();
                        if (payloadStr === '[DONE]') continue;

                        try {
                            const payload = JSON.parse(payloadStr);

                            if (payload.type === 'meta') {
                                setMessages(prev =>
                                    prev.map(m =>
                                        m.id === assistantMsgId
                                            ? { ...m, citations: payload.citations || [] }
                                            : m
                                    )
                                );
                            } else if (payload.type === 'delta') {
                                setMessages(prev =>
                                    prev.map(m =>
                                        m.id === assistantMsgId
                                            ? { ...m, content: (m.content || '') + (payload.text || '') }
                                            : m
                                    )
                                );
                            } else if (payload.type === 'error') {
                                message.error(payload.error || '生成异常中断');
                            }
                        } catch {}
                    }
                }
            }
        } catch (err) {
            if (err.name !== 'AbortError') {
                setMessages(prev =>
                    prev.map(m =>
                        m.id === assistantMsgId
                            ? {
                                  ...m,
                                  content: (m.content || '') + `\n\n*(问答异常: ${err.message})*`
                              }
                            : m
                    )
                );
            }
        } finally {
            setLoading(false);
            abortControllerRef.current = null;
        }
    };

    const handleKeyDown = e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleCitationClick = (citationIndex, citations = []) => {
        const target = citations.find(c => c.citationIndex === citationIndex);
        if (target && onNavigateNote) {
            onNavigateNote(target.noteId, target.headerPath);
        }
    };

    return (
        <Drawer
            className="rag-chat-drawer"
            title={
                <div className="rag-drawer-header-content">
                    <div className="rag-header-left">
                        <span className="rag-header-title">
                            <RobotOutlined /> 个人知识库问答
                        </span>
                        <span className="rag-index-badge" title="已构建向量索引的笔记数与切片数">
                            已索引 {stats.indexedNotes}/{stats.totalNotes} 篇 ({stats.totalChunks} 块)
                        </span>
                    </div>
                    <div className="rag-header-actions">
                        <Tooltip title="同步全库索引">
                            <Button
                                size="small"
                                type="text"
                                icon={<SyncOutlined spin={indexing} />}
                                onClick={handleReindex}
                                disabled={indexing || loading}
                            />
                        </Tooltip>
                        <Tooltip title="清空对话">
                            <Button
                                size="small"
                                type="text"
                                icon={<ClearOutlined />}
                                onClick={handleClearChat}
                                disabled={messages.length === 0 || loading}
                            />
                        </Tooltip>
                    </div>
                </div>
            }
            footer={
                <div className="rag-input-section">
                    <div className="scope-selector-row">
                        <span className="scope-label">范围：</span>
                        <button
                            type="button"
                            className={`scope-pill-btn ${scopeType === 'all' ? 'active' : ''}`}
                            onClick={() => setScopeType('all')}
                        >
                            全部笔记
                        </button>
                        {currentNotebookName && (
                            <button
                                type="button"
                                className={`scope-pill-btn ${scopeType === 'notebook' ? 'active' : ''}`}
                                onClick={() => setScopeType('notebook')}
                            >
                                <BookOutlined /> {currentNotebookName}
                            </button>
                        )}
                        {currentNoteTitle && (
                            <button
                                type="button"
                                className={`scope-pill-btn ${scopeType === 'note' ? 'active' : ''}`}
                                onClick={() => setScopeType('note')}
                            >
                                <FileTextOutlined /> 当前篇
                            </button>
                        )}
                    </div>

                    <div className="rag-input-box">
                        <TextArea
                            value={inputQuery}
                            onChange={e => setInputQuery(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="基于知识库提问... (Enter 发送, Shift+Enter 换行)"
                            autoSize={{ minRows: 1, maxRows: 4 }}
                            disabled={loading}
                        />
                        <Button
                            className="send-btn"
                            type="primary"
                            icon={<SendOutlined />}
                            onClick={() => handleSend()}
                            loading={loading}
                            disabled={!inputQuery.trim() || loading}
                        >
                            提问
                        </Button>
                    </div>
                </div>
            }
            footerStyle={{ padding: 0, borderTop: 'none' }}
            bodyStyle={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            placement="right"
            width={460}
            open={visible}
            onClose={onClose}
            closeIcon={<CloseOutlined />}
            destroyOnClose={false}
        >
            <div className="rag-messages-scroll">
                {messages.length === 0 ? (
                    <div className="rag-empty-guide">
                        <div className="empty-symbol">
                            <RobotOutlined />
                        </div>
                        <div className="empty-title">探索您的专属知识网络</div>
                        <div className="empty-desc">
                            AI 将在您保存的全部笔记中进行语义与关键词混合检索，基于真实记录生成可溯源回答。
                        </div>
                        <div className="sample-questions">
                            <div
                                className="sample-item"
                                onClick={() => handleSend('我笔记中记录过哪些核心架构和关键规划？')}
                            >
                                我笔记中记录过哪些核心架构和关键规划？
                            </div>
                            <div
                                className="sample-item"
                                onClick={() => handleSend('总结一下关于图形渲染与可视化相关的笔记要点')}
                            >
                                总结一下关于图形渲染与可视化相关的笔记要点
                            </div>
                        </div>
                    </div>
                ) : (
                    messages.map(msg => {
                        const isThinking = !msg.content && loading && msg.id === messages[messages.length - 1]?.id;

                        return (
                            <div key={msg.id} className={`rag-message-row ${msg.role === 'user' ? 'user-row' : 'assistant-row'}`}>
                                <div className={`message-bubble ${isThinking ? 'is-thinking' : ''}`}>
                                    {msg.role === 'user' ? (
                                        msg.content
                                    ) : isThinking ? (
                                        <div className="rag-thinking-state">
                                            <div className="thinking-header">
                                                <span className="thinking-pulse-dot" />
                                                <span className="thinking-text">正在检索知识库切片并生成回答...</span>
                                            </div>
                                            <div className="thinking-skeletons">
                                                <div className="skeleton-bar bar-1" />
                                                <div className="skeleton-bar bar-2" />
                                                <div className="skeleton-bar bar-3" />
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="assistant-text">
                                                {renderTextWithCitations(msg.content, idx =>
                                                    handleCitationClick(idx, msg.citations)
                                                )}
                                                {loading && msg.id === messages[messages.length - 1]?.id && (
                                                    <span className="streaming-cursor">▍</span>
                                                )}
                                            </div>

                                            {msg.citations && msg.citations.length > 0 && (
                                                <div className="rag-citations-box">
                                                    <div className="citations-header">
                                                        <span>参考来源 ({msg.citations.length} 篇)</span>
                                                    </div>
                                                    <div className="citations-list">
                                                        {msg.citations.map(c => (
                                                            <div
                                                                key={c.citationIndex}
                                                                className="citation-card"
                                                                onClick={() =>
                                                                    onNavigateNote && onNavigateNote(c.noteId, c.headerPath)
                                                                }
                                                                title="点击在工作区打开该笔记"
                                                            >
                                                                <div className="citation-card-top">
                                                                    <div className="citation-title-wrap">
                                                                        <span className="citation-index">[{c.citationIndex}]</span>
                                                                        <span>{c.noteTitle}</span>
                                                                    </div>
                                                                    {c.similarity > 0 && (
                                                                        <span className="citation-sim-tag">
                                                                            匹配度 {(c.similarity * 100).toFixed(0)}%
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                {c.snippet && (
                                                                    <div className="citation-snippet">
                                                                        {c.snippet}...
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
                <div ref={messagesEndRef} />
            </div>
        </Drawer>
    );
};

export default RAGChatDrawer;
