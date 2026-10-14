import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
    ThunderboltOutlined,
    FastForwardOutlined,
    CompressOutlined,
    CheckSquareOutlined,
    FontSizeOutlined,
    TableOutlined,
    CodeOutlined,
    InfoCircleOutlined,
    LinkOutlined,
    LoadingOutlined,
    CheckOutlined,
    CloseOutlined,
    ReloadOutlined
} from '@ant-design/icons';
import { message } from 'antd';
import { streamAICall } from '@/api/ai';
import './index.less';

/**
 * 斜杠指令清单定义
 * 包含 AI 智能生成与常用 Markdown 结构化块
 */
const SLASH_COMMANDS = [
    {
        id: 'ai',
        category: 'ai',
        title: '自由起草',
        desc: '输入自定义指令或主题，原地打字生成内容',
        icon: <ThunderboltOutlined style={{ color: '#7c3aed' }} />,
        shortcut: 'Enter',
        keywords: ['ai', 'qicao', '起草', 'prompt', 'ask', '生成'],
        actionType: 'prompt_input'
    },
    {
        id: 'continue',
        category: 'ai',
        title: '承接续写',
        desc: '分析上文语境与论点，向下自然延续正文',
        icon: <FastForwardOutlined style={{ color: '#2563eb' }} />,
        shortcut: 'Enter',
        keywords: ['continue', 'xuxie', '续写', '承接'],
        actionType: 'direct_stream',
        aiAction: 'continue'
    },
    {
        id: 'summary',
        category: 'ai',
        title: '要点提炼',
        desc: '精炼上文核心论点，生成要点结论清单',
        icon: <CompressOutlined style={{ color: '#059669' }} />,
        shortcut: 'Enter',
        keywords: ['summary', 'tilan', '总结', '提炼', '要点'],
        actionType: 'direct_stream',
        aiAction: 'summarize_text'
    },
    {
        id: 'todo',
        category: 'ai',
        title: '提取待办',
        desc: '识别并提炼上文中的任务项，生成任务清单',
        icon: <CheckSquareOutlined style={{ color: '#d97706' }} />,
        shortcut: 'Enter',
        keywords: ['todo', 'daiban', '待办', '清单', '任务'],
        actionType: 'direct_stream',
        aiAction: 'extract_todos'
    },
    {
        id: 'h2',
        category: 'markdown',
        title: '二级标题',
        desc: '插入 ## 模块主标题',
        icon: <FontSizeOutlined style={{ color: '#1890ff', fontSize: 13 }} />,
        keywords: ['h2', 'biaoti', '标题', 'erji'],
        actionType: 'insert_template',
        template: '## '
    },
    {
        id: 'h3',
        category: 'markdown',
        title: '三级标题',
        desc: '插入 ### 子章节小标题',
        icon: <FontSizeOutlined style={{ color: '#0284c7', fontSize: 12 }} />,
        keywords: ['h3', 'biaoti', '小标题', 'sanji'],
        actionType: 'insert_template',
        template: '### '
    },
    {
        id: 'table',
        category: 'markdown',
        title: '对比表格',
        desc: '插入标准 3×3 Markdown 结构化表格',
        icon: <TableOutlined style={{ color: '#0f766e' }} />,
        keywords: ['table', 'biaoge', '表格', 'duibi'],
        actionType: 'insert_template',
        template: '| 维度 | 方案 A | 方案 B |\n| :--- | :--- | :--- |\n| 特性 | 说明 1 | 说明 2 |\n| 优势 | 优势 1 | 优势 2 |\n'
    },
    {
        id: 'code',
        category: 'markdown',
        title: '代码块',
        desc: '插入多行代码容器并置入光标',
        icon: <CodeOutlined style={{ color: '#475569' }} />,
        keywords: ['code', 'daima', '代码', 'block'],
        actionType: 'insert_template',
        template: '```javascript\n\n```',
        cursorOffset: -4
    },
    {
        id: 'callout',
        category: 'markdown',
        title: '提示高亮块',
        desc: '插入引用提示块 (> [!NOTE])',
        icon: <InfoCircleOutlined style={{ color: '#6366f1' }} />,
        keywords: ['callout', 'note', 'tishi', '提示', '引用'],
        actionType: 'insert_template',
        template: '> [!NOTE]\n> '
    },
    {
        id: 'link',
        category: 'markdown',
        title: '双向链接',
        desc: '插入 [[ 唤醒笔记知识网联想',
        icon: <LinkOutlined style={{ color: '#2563eb' }} />,
        keywords: ['link', 'wiki', 'shuanglian', '双链', 'yinyong'],
        actionType: 'insert_template',
        template: '[['
    }
];

const SlashCommandPopup = ({
    containerRef,
    editorContextRef,
    noteTitle = ''
}) => {
    // 菜单状态
    const [visible, setVisible] = useState(false);
    const [position, setPosition] = useState({ top: 0, left: 0 });
    const [keyword, setKeyword] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);

    // 行内 Prompt 输入条状态
    const [promptMode, setPromptMode] = useState(false);
    const [customPrompt, setCustomPrompt] = useState('');

    // 行内打字机流式与暂存状态
    const [streaming, setStreaming] = useState(false);
    const [streamDone, setStreamDone] = useState(false);
    const [streamCapsulePos, setStreamCapsulePos] = useState({ top: 0, left: 0 });

    // 内部引用
    const matchRangeRef = useRef(null);
    const abortControllerRef = useRef(null);
    const listRef = useRef(null);
    const promptInputRef = useRef(null);
    const streamRangeRef = useRef(null);
    const streamMarkerRef = useRef(null);
    const lastActionConfigRef = useRef(null);

    // 过滤候选列表
    const filteredCommands = useMemo(() => {
        if (!keyword.trim()) return SLASH_COMMANDS;
        const q = keyword.trim().toLowerCase();
        return SLASH_COMMANDS.filter(cmd =>
            cmd.title.toLowerCase().includes(q) ||
            cmd.desc.toLowerCase().includes(q) ||
            cmd.keywords.some(k => k.toLowerCase().includes(q))
        );
    }, [keyword]);

    // 确保高亮索引在过滤后不越界
    useEffect(() => {
        setSelectedIndex(0);
    }, [filteredCommands]);

    // 计算光标屏幕物理坐标并安全限制在视口内
    const computeCoordinates = useCallback(cm => {
        const cursor = cm.getCursor();
        const coords = cm.cursorCoords(cursor, 'page');
        const containerRect = containerRef?.current?.getBoundingClientRect();

        let top = coords.bottom + 6;
        let left = coords.left;

        if (containerRect) {
            if (left + 330 > window.innerWidth - 20) {
                left = Math.max(20, window.innerWidth - 350);
            }
            if (top + 340 > window.innerHeight) {
                top = Math.max(20, coords.top - 340);
            }
        }
        return { top, left };
    }, [containerRef]);

    // 探测空白行首或缩进后的 "/"
    const detectSlashTrigger = useCallback(() => {
        if (promptMode || streaming) return;

        const cm = editorContextRef?.current?.editor;
        if (!cm) {
            setVisible(false);
            return;
        }

        const cursor = cm.getCursor();
        const lineText = cm.getLine(cursor.line);
        const textBeforeCursor = lineText.slice(0, cursor.ch);

        // 仅匹配行首空白后紧随 "/" 的输入
        const match = textBeforeCursor.match(/^\s*\/([a-zA-Z0-9_\u4e00-\u9fa5]*)$/);
        if (!match) {
            setVisible(false);
            return;
        }

        const slashIndex = textBeforeCursor.lastIndexOf('/');
        const query = match[1] || '';

        setKeyword(query);
        setPosition(computeCoordinates(cm));

        matchRangeRef.current = {
            from: { line: cursor.line, ch: slashIndex },
            to: { line: cursor.line, ch: cursor.ch }
        };
        setVisible(true);
    }, [editorContextRef, promptMode, streaming, computeCoordinates]);

    // 清除流式微光样式标记
    const clearStreamMarker = useCallback(() => {
        if (streamMarkerRef.current && typeof streamMarkerRef.current.clear === 'function') {
            streamMarkerRef.current.clear();
            streamMarkerRef.current = null;
        }
    }, []);

    // 采纳生成内容
    const handleAcceptStream = useCallback(() => {
        clearStreamMarker();
        setStreaming(false);
        setStreamDone(false);
        streamRangeRef.current = null;

        const cm = editorContextRef?.current?.editor;
        if (cm) {
            cm.focus();
        }
        message.success('已采纳 AI 生成内容');
    }, [editorContextRef, clearStreamMarker]);

    // 丢弃生成内容并回滚
    const handleDiscardStream = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        clearStreamMarker();

        const cm = editorContextRef?.current?.editor;
        const range = streamRangeRef.current;
        if (cm && range) {
            cm.replaceRange('', range.from, range.to);
            cm.setCursor(range.from);
            cm.focus();
        }

        setStreaming(false);
        setStreamDone(false);
        streamRangeRef.current = null;
        message.info('已撤销生成内容');
    }, [editorContextRef, clearStreamMarker]);

    // 执行流式生成
    const startStreamingFlow = useCallback(async (actionKey, customText = '') => {
        const cm = editorContextRef?.current?.editor;
        if (!cm) return;

        // 移除行首触发指令文本
        if (matchRangeRef.current) {
            cm.replaceRange('', matchRangeRef.current.from, matchRangeRef.current.to);
            matchRangeRef.current = null;
        }

        setVisible(false);
        setPromptMode(false);
        setStreaming(true);
        setStreamDone(false);

        // 记录起点坐标与上文上下文
        const startCursor = cm.getCursor();
        const prevContext = cm.getRange(
            { line: Math.max(0, startCursor.line - 30), ch: 0 },
            startCursor
        );

        lastActionConfigRef.current = { actionKey, customText };
        streamRangeRef.current = {
            from: { ...startCursor },
            to: { ...startCursor }
        };

        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        const controller = new AbortController();
        abortControllerRef.current = controller;

        try {
            await streamAICall(
                {
                    action: actionKey,
                    text: prevContext || '用户正文空白起草',
                    noteTitle,
                    customPrompt: customText
                },
                {
                    signal: controller.signal,
                    onDelta: delta => {
                        const currentTo = streamRangeRef.current?.to || startCursor;

                        cm.replaceRange(delta, currentTo);

                        const lines = delta.split('\n');
                        const newTo = {
                            line: currentTo.line + lines.length - 1,
                            ch: lines.length === 1 ? currentTo.ch + delta.length : lines[lines.length - 1].length
                        };

                        streamRangeRef.current.to = newTo;

                        // 标记微光选区
                        clearStreamMarker();
                        streamMarkerRef.current = cm.markText(
                            streamRangeRef.current.from,
                            streamRangeRef.current.to,
                            { className: 'inline-stream-ghost' }
                        );

                        // 滚动并保持悬浮条位置在生成底部
                        const coords = cm.cursorCoords(newTo, 'page');
                        setStreamCapsulePos({
                            top: coords.bottom + 8,
                            left: Math.max(20, Math.min(window.innerWidth - 300, coords.left))
                        });
                    },
                    onFinish: () => {
                        setStreaming(false);
                        setStreamDone(true);
                    },
                    onError: err => {
                        setStreaming(false);
                        setStreamDone(false);
                        message.error(err.message || 'AI 实时起草异常');
                    }
                }
            );
        } catch {
            setStreaming(false);
        }
    }, [editorContextRef, noteTitle, clearStreamMarker]);

    // 重新生成
    const handleRetryStream = useCallback(() => {
        if (!lastActionConfigRef.current) return;
        const cm = editorContextRef?.current?.editor;
        const range = streamRangeRef.current;
        if (cm && range) {
            cm.replaceRange('', range.from, range.to);
            cm.setCursor(range.from);
        }
        clearStreamMarker();
        const { actionKey, customText } = lastActionConfigRef.current;
        startStreamingFlow(actionKey, customText);
    }, [editorContextRef, startStreamingFlow, clearStreamMarker]);

    // 执行选中指令
    const executeCommand = useCallback(cmd => {
        const cm = editorContextRef?.current?.editor;
        if (!cm) return;

        if (cmd.actionType === 'prompt_input') {
            // 切换至行内 Prompt 胶囊输入模式
            setPromptMode(true);
            setVisible(false);
            setPosition(computeCoordinates(cm));
            return;
        }

        if (cmd.actionType === 'direct_stream') {
            startStreamingFlow(cmd.aiAction, '');
            return;
        }

        if (cmd.actionType === 'insert_template') {
            if (!matchRangeRef.current) return;
            cm.replaceRange(cmd.template, matchRangeRef.current.from, matchRangeRef.current.to);

            let offset = cmd.cursorOffset || 0;
            const lines = cmd.template.split('\n');
            const endLine = matchRangeRef.current.from.line + lines.length - 1;
            const endCh = lines.length === 1
                ? matchRangeRef.current.from.ch + cmd.template.length
                : lines[lines.length - 1].length;

            cm.setCursor({ line: endLine, ch: Math.max(0, endCh + offset) });
            cm.focus();
            setVisible(false);
        }
    }, [editorContextRef, startStreamingFlow, computeCoordinates]);

    // CodeMirror 键盘与光标事件接管
    useEffect(() => {
        const cm = editorContextRef?.current?.editor;
        if (!cm) return undefined;

        const handleKeyDown = (instance, event) => {
            // 处于采纳胶囊悬浮态
            if (streamDone && streamRangeRef.current) {
                if (event.key === 'Tab') {
                    event.preventDefault();
                    handleAcceptStream();
                    return;
                }
                if (event.key === 'Escape') {
                    event.preventDefault();
                    handleDiscardStream();
                    return;
                }
                if ((event.ctrlKey || event.metaKey) && (event.key === 'r' || event.key === 'R')) {
                    event.preventDefault();
                    handleRetryStream();
                    return;
                }
            }

            // 处于指令菜单激活态
            if (visible) {
                if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setSelectedIndex(prev => (prev + 1) % Math.max(1, filteredCommands.length));
                    return;
                }
                if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setSelectedIndex(prev => (prev - 1 + filteredCommands.length) % Math.max(1, filteredCommands.length));
                    return;
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                    event.preventDefault();
                    const targetCmd = filteredCommands[selectedIndex];
                    if (targetCmd) {
                        executeCommand(targetCmd);
                    }
                    return;
                }
                if (event.key === 'Escape') {
                    event.preventDefault();
                    setVisible(false);
                    return;
                }
            }
        };

        const handleCursorActivity = () => {
            detectSlashTrigger();
        };

        cm.on('keydown', handleKeyDown);
        cm.on('cursorActivity', handleCursorActivity);
        cm.on('change', handleCursorActivity);

        return () => {
            if (typeof cm.off === 'function') {
                cm.off('keydown', handleKeyDown);
                cm.off('cursorActivity', handleCursorActivity);
                cm.off('change', handleCursorActivity);
            }
        };
    }, [
        visible,
        filteredCommands,
        selectedIndex,
        streamDone,
        executeCommand,
        detectSlashTrigger,
        handleAcceptStream,
        handleDiscardStream,
        handleRetryStream,
        editorContextRef
    ]);

    // 聚焦 Prompt 输入框
    useEffect(() => {
        if (promptMode && promptInputRef.current) {
            promptInputRef.current.focus();
        }
    }, [promptMode]);

    // 组件卸载时释放流式控制器与标记
    useEffect(() => {
        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            clearStreamMarker();
        };
    }, [clearStreamMarker]);

    return (
        <>
            {/* 指令选择弹出菜单 */}
            {visible && (
                <div
                    className="slash-command-popup"
                    style={{ top: position.top, left: position.left }}
                    onMouseDown={e => e.preventDefault()}
                >
                    <div className="command-header">
                        <span className="header-title">
                            <ThunderboltOutlined style={{ color: '#7c3aed', marginRight: 6 }} />
                            行内指令中心
                        </span>
                        <span className="header-hint">按上下键选择，Enter 确认</span>
                    </div>

                    <div className="command-list" ref={listRef}>
                        {filteredCommands.length === 0 ? (
                            <div className="empty-command-hint">未找到匹配指令</div>
                        ) : (
                            filteredCommands.map((cmd, idx) => {
                                const isSelected = idx === selectedIndex;
                                return (
                                    <div
                                        key={cmd.id}
                                        className={`command-item ${isSelected ? 'is-selected' : ''}`}
                                        onClick={() => executeCommand(cmd)}
                                        onMouseEnter={() => setSelectedIndex(idx)}
                                    >
                                        <div className="item-icon-box">{cmd.icon}</div>
                                        <div className="item-info">
                                            <div className="item-title-row">
                                                <span className="item-title">{cmd.title}</span>
                                                <span className={`item-badge ${cmd.category}`}>{cmd.category === 'ai' ? 'AI' : 'MD'}</span>
                                            </div>
                                            <div className="item-desc">{cmd.desc}</div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            )}

            {/* 行内 Prompt 胶囊输入条 */}
            {promptMode && (
                <div
                    className="slash-inline-prompt-pill"
                    style={{ top: position.top, left: position.left }}
                    onMouseDown={e => e.stopPropagation()}
                >
                    <div className="pill-prefix">
                        <ThunderboltOutlined className="pulse-sparkle-icon" />
                        <span className="pill-tag">自由起草</span>
                    </div>
                    <input
                        ref={promptInputRef}
                        type="text"
                        className="pill-input"
                        placeholder="输入起草主题或要求，按 Enter 开始起草..."
                        value={customPrompt}
                        onChange={e => setCustomPrompt(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && customPrompt.trim()) {
                                e.preventDefault();
                                startStreamingFlow('custom', customPrompt.trim());
                            } else if (e.key === 'Escape') {
                                e.preventDefault();
                                setPromptMode(false);
                                setCustomPrompt('');
                                editorContextRef?.current?.editor?.focus();
                            }
                        }}
                    />
                    <div className="pill-actions">
                        <button
                            type="button"
                            className="pill-submit-btn"
                            disabled={!customPrompt.trim()}
                            onClick={() => {
                                if (customPrompt.trim()) {
                                    startStreamingFlow('custom', customPrompt.trim());
                                }
                            }}
                        >
                            起草
                        </button>
                        <button
                            type="button"
                            className="pill-close-btn"
                            onClick={() => {
                                setPromptMode(false);
                                setCustomPrompt('');
                                editorContextRef?.current?.editor?.focus();
                            }}
                        >
                            <CloseOutlined />
                        </button>
                    </div>
                </div>
            )}

            {/* 流式打字中或完成后的悬浮控制胶囊条 */}
            {(streaming || streamDone) && (
                <div
                    className="slash-stream-action-capsule"
                    style={{ top: streamCapsulePos.top, left: streamCapsulePos.left }}
                    onMouseDown={e => e.preventDefault()}
                >
                    <div className="capsule-status">
                        {streaming ? (
                            <>
                                <LoadingOutlined spin className="status-spin" />
                                <span className="status-text">AI 正在流式起草中...</span>
                            </>
                        ) : (
                            <>
                                <CheckOutlined className="status-done-icon" />
                                <span className="status-text">起草完成</span>
                            </>
                        )}
                    </div>

                    <div className="capsule-divider" />

                    <div className="capsule-btns">
                        <button
                            type="button"
                            className="action-pill-btn accept-btn"
                            disabled={streaming}
                            onClick={handleAcceptStream}
                            title="采纳并合入正文 (Tab)"
                        >
                            <CheckOutlined /> 采纳 <kbd>Tab</kbd>
                        </button>
                        <button
                            type="button"
                            className="action-pill-btn retry-btn"
                            disabled={streaming}
                            onClick={handleRetryStream}
                            title="重新起草 (Ctrl+R)"
                        >
                            <ReloadOutlined /> 重试 <kbd>Ctrl+R</kbd>
                        </button>
                        <button
                            type="button"
                            className="action-pill-btn discard-btn"
                            onClick={handleDiscardStream}
                            title="丢弃并撤销 (Esc)"
                        >
                            <CloseOutlined /> 丢弃 <kbd>Esc</kbd>
                        </button>
                    </div>
                </div>
            )}
        </>
    );
};

export default SlashCommandPopup;
