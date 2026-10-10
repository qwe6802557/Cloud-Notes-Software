import React, { useEffect, useState, useRef, useCallback } from 'react';
import { suggestNoteLinks } from '@/api/notes';
import {
    FileTextOutlined,
    PlusCircleOutlined,
    BookOutlined,
    LoadingOutlined
} from '@ant-design/icons';
import './LinkSuggestPopup.less';

const LinkSuggestPopup = ({ editorContextRef, containerRef }) => {
    const [visible, setVisible] = useState(false);
    const [position, setPosition] = useState({ top: 0, left: 0 });
    const [keyword, setKeyword] = useState('');
    const [suggestions, setSuggestions] = useState([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [loading, setLoading] = useState(false);

    // 记录触发点在 CodeMirror 中的坐标与字符范围
    const matchRangeRef = useRef(null); // { from: { line, ch }, to: { line, ch } }
    const debounceTimerRef = useRef(null);
    const listRef = useRef(null);

    // 实时检测光标处是否存在未闭合的 [[
    const detectWikiLinkTrigger = useCallback(() => {
        const cm = editorContextRef?.current?.editor;
        if (!cm) {
            setVisible(false);
            return;
        }

        const cursor = cm.getCursor();
        const lineText = cm.getLine(cursor.line);
        const textBeforeCursor = lineText.slice(0, cursor.ch);

        // 寻找光标前最后一个未闭合的 '[['
        const lastOpenIdx = textBeforeCursor.lastIndexOf('[[');
        if (lastOpenIdx === -1) {
            setVisible(false);
            return;
        }

        // 检查 '[[' 之后是否有闭合的 ']]'
        const textAfterOpen = textBeforeCursor.slice(lastOpenIdx + 2);
        if (textAfterOpen.includes(']]')) {
            setVisible(false);
            return;
        }

        // 提取输入的搜索词
        const query = textAfterOpen.trim();
        setKeyword(query);

        // 计算光标屏幕物理坐标
        const coords = cm.cursorCoords(cursor, 'page');
        const containerRect = containerRef?.current?.getBoundingClientRect();

        let top = coords.bottom + 6;
        let left = coords.left;

        if (containerRect) {
            // 防止超出右边缘
            if (left + 320 > window.innerWidth - 20) {
                left = Math.max(20, window.innerWidth - 340);
            }
            // 防止超出下边缘
            if (top + 280 > window.innerHeight) {
                top = Math.max(20, coords.top - 280);
            }
        }

        setPosition({ top, left });
        matchRangeRef.current = {
            from: { line: cursor.line, ch: lastOpenIdx },
            to: { line: cursor.line, ch: cursor.ch }
        };
        setVisible(true);
    }, [editorContextRef, containerRef]);

    // 根据输入词拉取候选项
    useEffect(() => {
        if (!visible) return;

        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }

        debounceTimerRef.current = setTimeout(async () => {
            setLoading(true);
            try {
                const res = await suggestNoteLinks(keyword);
                const list = res?.data?.suggestions || res?.suggestions || [];
                setSuggestions(list);
                setSelectedIndex(0);
            } catch {
                setSuggestions([]);
            } finally {
                setLoading(false);
            }
        }, 150);

        return () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }
        };
    }, [visible, keyword]);

    // 插入选中的双链并闭合
    const handleInsert = useCallback(
        title => {
            const cm = editorContextRef?.current?.editor;
            if (!cm || !matchRangeRef.current) return;

            const safeTitle = (title || '新双链').trim();
            const replacement = `[[${safeTitle}]] `;

            cm.replaceRange(
                replacement,
                matchRangeRef.current.from,
                matchRangeRef.current.to
            );

            // 将光标定位至双链右侧
            const newCursor = {
                line: matchRangeRef.current.from.line,
                ch: matchRangeRef.current.from.ch + replacement.length
            };
            cm.setCursor(newCursor);
            cm.focus();

            setVisible(false);
        },
        [editorContextRef]
    );

    // 键盘监听（上下键选择、回车确认、ESC关闭）
    useEffect(() => {
        const cm = editorContextRef?.current?.editor;
        if (!cm) return undefined;

        const handleKeyDown = (instance, event) => {
            if (!visible) return;

            // 总选项数：候选项列表 + 1 (若存在自建项)
            const exactMatched = suggestions.some(
                item => item.title.toLowerCase() === keyword.toLowerCase()
            );
            const showCustomItem = keyword.length > 0 && !exactMatched;
            const totalCount = suggestions.length + (showCustomItem ? 1 : 0);

            if (event.key === 'ArrowDown') {
                event.preventDefault();
                setSelectedIndex(prev => (prev + 1) % Math.max(1, totalCount));
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setSelectedIndex(prev => (prev - 1 + totalCount) % Math.max(1, totalCount));
            } else if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault();
                if (suggestions.length === 0 && showCustomItem) {
                    handleInsert(keyword);
                } else if (selectedIndex < suggestions.length) {
                    handleInsert(suggestions[selectedIndex].title);
                } else if (showCustomItem) {
                    handleInsert(keyword);
                }
            } else if (event.key === 'Escape') {
                event.preventDefault();
                setVisible(false);
            }
        };

        const handleCursorActivity = () => {
            detectWikiLinkTrigger();
        };

        cm.on('keydown', handleKeyDown);
        cm.on('cursorActivity', handleCursorActivity);

        return () => {
            if (typeof cm.off === 'function') {
                cm.off('keydown', handleKeyDown);
                cm.off('cursorActivity', handleCursorActivity);
            }
        };
    }, [visible, suggestions, selectedIndex, keyword, handleInsert, detectWikiLinkTrigger, editorContextRef]);

    if (!visible) return null;

    const exactMatched = suggestions.some(
        item => item.title.toLowerCase() === keyword.toLowerCase()
    );
    const showCustomItem = keyword.length > 0 && !exactMatched;

    return (
        <div
            className="link-suggest-popup"
            style={{
                top: position.top,
                left: position.left
            }}
            onMouseDown={e => e.preventDefault()} // 避免点击导致 CodeMirror 失去光标焦点
        >
            <div className="suggest-header">
                <span className="suggest-title">插入双向链接 [[...]]</span>
                {loading && <LoadingOutlined spin style={{ fontSize: 12, color: '#1890ff' }} />}
            </div>

            <div className="suggest-list" ref={listRef}>
                {suggestions.map((item, idx) => {
                    const isSelected = idx === selectedIndex;
                    return (
                        <div
                            key={item._id || item.title}
                            className={`suggest-item ${isSelected ? 'is-selected' : ''}`}
                            onClick={() => handleInsert(item.title)}
                            onMouseEnter={() => setSelectedIndex(idx)}
                        >
                            <div className="item-icon-wrap">
                                <FileTextOutlined className="note-icon" />
                            </div>
                            <div className="item-main">
                                <div className="item-title">{item.title}</div>
                                {item.notebookName && (
                                    <div className="item-meta">
                                        <BookOutlined style={{ marginRight: 4 }} />
                                        <span>{item.notebookName}</span>
                                    </div>
                                )}
                            </div>
                            {item.backlinkCount > 0 && (
                                <span className="item-badge" title="被引用频次">
                                    {item.backlinkCount} 引用
                                </span>
                            )}
                        </div>
                    );
                })}

                {showCustomItem && (
                    <div
                        className={`suggest-item create-placeholder-item ${
                            selectedIndex === suggestions.length ? 'is-selected' : ''
                        }`}
                        onClick={() => handleInsert(keyword)}
                        onMouseEnter={() => setSelectedIndex(suggestions.length)}
                    >
                        <div className="item-icon-wrap">
                            <PlusCircleOutlined style={{ color: '#10b981' }} />
                        </div>
                        <div className="item-main">
                            <div className="item-title">
                                建立新占位双链: <span className="highlight-tag">[[{keyword}]]</span>
                            </div>
                            <div className="item-meta">未来点击可一键自动创建此笔记</div>
                        </div>
                    </div>
                )}

                {suggestions.length === 0 && !showCustomItem && (
                    <div className="suggest-empty">
                        <span>输入标题关键词以快速关联笔记...</span>
                    </div>
                )}
            </div>

            <div className="suggest-footer">
                <span>↑↓ 选择</span>
                <span>Enter 插入</span>
                <span>Esc 取消</span>
            </div>
        </div>
    );
};

export default LinkSuggestPopup;
