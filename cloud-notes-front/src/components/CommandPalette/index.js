import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
    SearchOutlined,
    FileTextOutlined,
    ThunderboltOutlined,
    FullscreenOutlined,
    SettingOutlined,
    PlusOutlined
} from '@ant-design/icons';
import { searchNotes, getRecentNotes } from '@/api/notes';
import './CommandPalette.less';

const formatRelativeTime = dateStr => {
    if (!dateStr) return '';
    const now = new Date();
    const date = new Date(dateStr);
    const diffSec = Math.floor((now - date) / 1000);

    if (diffSec < 60) return '刚刚';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分钟前`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}小时前`;
    if (diffSec < 172800) return '昨天';
    return `${date.getMonth() + 1}-${date.getDate()}`;
};

const renderHighlighted = (text, keyword) => {
    if (!text) return '';
    if (!keyword) return text;

    const lowerText = text.toLowerCase();
    const lowerKey = keyword.toLowerCase();
    const index = lowerText.indexOf(lowerKey);

    if (index === -1) return text;

    const before = text.slice(0, index);
    const match = text.slice(index, index + keyword.length);
    const after = text.slice(index + keyword.length);

    return (
        <>
            {before}
            <mark>{match}</mark>
            {renderHighlighted(after, keyword)}
        </>
    );
};

const CommandPalette = ({
    open,
    onClose,
    onSelectNote,
    onCreateNote,
    onOpenAI,
    onToggleZenMode,
    onOpenSettings
}) => {
    const [searchText, setSearchText] = useState('');
    const [recentNotes, setRecentNotes] = useState([]);
    const [searchResults, setSearchResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);

    const inputRef = useRef(null);
    const searchTimerRef = useRef(null);
    const activeItemRef = useRef(null);

    const staticCommands = useMemo(() => [
        {
            id: 'cmd-create-note',
            type: 'command',
            title: '新建文档',
            icon: <PlusOutlined />,
            category: '快捷操作',
            action: () => {
                onCreateNote?.();
                onClose?.();
            }
        },
        {
            id: 'cmd-ai-assistant',
            type: 'command',
            title: 'AI 创作助手',
            icon: <ThunderboltOutlined style={{ color: '#7c3aed' }} />,
            category: '快捷操作',
            action: () => {
                onOpenAI?.();
                onClose?.();
            }
        },
        {
            id: 'cmd-zen-mode',
            type: 'command',
            title: '切换沉浸专注模式',
            icon: <FullscreenOutlined style={{ color: '#0284c7' }} />,
            category: '快捷操作',
            action: () => {
                onToggleZenMode?.();
                onClose?.();
            }
        },
        {
            id: 'cmd-settings',
            type: 'command',
            title: '个人偏好与系统设置',
            icon: <SettingOutlined style={{ color: '#475569' }} />,
            category: '快捷操作',
            action: () => {
                onOpenSettings?.();
                onClose?.();
            }
        }
    ], [onCreateNote, onClose, onOpenAI, onToggleZenMode, onOpenSettings]);

    const fetchRecent = useCallback(async () => {
        try {
            const res = await getRecentNotes({ limit: 5 });
            const list = res?.notes || res?.data?.notes || [];
            setRecentNotes(list);
        } catch {
            setRecentNotes([]);
        }
    }, []);

    useEffect(() => {
        if (open) {
            setSearchText('');
            setSearchResults([]);
            setActiveIndex(0);
            fetchRecent();
            setTimeout(() => {
                inputRef.current?.focus();
            }, 50);
        }
    }, [open, fetchRecent]);

    const executeSearch = useCallback(async query => {
        if (!query.trim()) {
            setSearchResults([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        try {
            const res = await searchNotes({ query: query.trim() });
            const list = res?.notes || res?.data?.notes || [];
            setSearchResults(list);
            setActiveIndex(0);
        } catch {
            setSearchResults([]);
        } finally {
            setLoading(false);
        }
    }, []);

    const handleInputChange = e => {
        const val = e.target.value;
        setSearchText(val);

        if (searchTimerRef.current) {
            clearTimeout(searchTimerRef.current);
        }

        if (val.startsWith('>')) {
            setSearchResults([]);
            setLoading(false);
            setActiveIndex(0);
            return;
        }

        searchTimerRef.current = setTimeout(() => {
            executeSearch(val);
        }, 220);
    };

    const isCommandMode = searchText.trim().startsWith('>');
    const commandFilter = isCommandMode ? searchText.trim().slice(1).trim().toLowerCase() : '';

    const filteredCommands = useMemo(() => {
        if (!isCommandMode) return staticCommands;
        if (!commandFilter) return staticCommands;
        return staticCommands.filter(c => c.title.toLowerCase().includes(commandFilter));
    }, [isCommandMode, commandFilter, staticCommands]);

    const flatItems = useMemo(() => {
        if (isCommandMode) {
            return filteredCommands;
        }

        if (searchText.trim()) {
            return searchResults.map(note => ({
                id: `note-${note._id}`,
                type: 'note',
                data: note
            }));
        }

        const items = [...filteredCommands];
        recentNotes.forEach(note => {
            items.push({
                id: `recent-${note._id}`,
                type: 'note',
                data: note
            });
        });

        return items;
    }, [isCommandMode, filteredCommands, searchText, searchResults, recentNotes]);

    useEffect(() => {
        if (activeItemRef.current) {
            activeItemRef.current.scrollIntoView({ block: 'nearest' });
        }
    }, [activeIndex]);

    const handleSelectCurrent = useCallback(index => {
        const target = flatItems[index];
        if (!target) return;

        if (target.type === 'command') {
            target.action?.();
        } else if (target.type === 'note' && target.data?._id) {
            onSelectNote?.(target.data._id);
            onClose?.();
        }
    }, [flatItems, onSelectNote, onClose]);

    const handleKeyDown = e => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (flatItems.length > 0) {
                setActiveIndex(prev => (prev + 1) % flatItems.length);
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (flatItems.length > 0) {
                setActiveIndex(prev => (prev - 1 + flatItems.length) % flatItems.length);
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            handleSelectCurrent(activeIndex);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose?.();
        }
    };

    if (!open) return null;

    return (
        <div className="command-palette-mask" onClick={onClose}>
            <div
                className="command-palette-card"
                onClick={e => e.stopPropagation()}
                onKeyDown={handleKeyDown}
            >
                <div className="command-palette-header">
                    <SearchOutlined className="command-search-icon" />
                    <input
                        ref={inputRef}
                        className="command-palette-input"
                        placeholder="搜索文档或输入 > 执行快捷操作..."
                        value={searchText}
                        onChange={handleInputChange}
                    />
                    <kbd className="command-esc-tag">ESC</kbd>
                </div>

                <div className="command-palette-body">
                    {loading ? (
                        <div className="command-palette-loading">正在全库极速检索中...</div>
                    ) : flatItems.length === 0 ? (
                        <div className="command-palette-empty">未匹配到相关文档或指令</div>
                    ) : (
                        <>
                            {!searchText.trim() && !isCommandMode ? (
                                <>
                                    <div className="command-group-title">快捷指令</div>
                                    {filteredCommands.map((item, index) => {
                                        const isSelected = activeIndex === index;
                                        return (
                                            <div
                                                key={item.id}
                                                ref={isSelected ? activeItemRef : null}
                                                className={`command-item ${isSelected ? 'is-active' : ''}`}
                                                onClick={() => handleSelectCurrent(index)}
                                                onMouseEnter={() => setActiveIndex(index)}
                                            >
                                                <div className="command-item-left">
                                                    <div className="command-item-icon">{item.icon}</div>
                                                    <span className="command-item-title">{item.title}</span>
                                                </div>
                                                <div className="command-item-right">
                                                    <span className="command-item-action-hint">↵ 执行</span>
                                                </div>
                                            </div>
                                        );
                                    })}

                                    {recentNotes.length > 0 && (
                                        <>
                                            <div className="command-group-title" style={{ marginTop: 10 }}>最近常用文档</div>
                                            {recentNotes.map((note, index) => {
                                                const globalIndex = filteredCommands.length + index;
                                                const isSelected = activeIndex === globalIndex;
                                                return (
                                                    <div
                                                        key={`recent-${note._id}`}
                                                        ref={isSelected ? activeItemRef : null}
                                                        className={`command-item ${isSelected ? 'is-active' : ''}`}
                                                        onClick={() => handleSelectCurrent(globalIndex)}
                                                        onMouseEnter={() => setActiveIndex(globalIndex)}
                                                    >
                                                        <div className="command-item-left">
                                                            <div className="command-item-icon">
                                                                <FileTextOutlined />
                                                            </div>
                                                            <div className="command-item-details">
                                                                <div className="command-item-title-row">
                                                                    <span className="command-item-title">
                                                                        {note.title || '无标题文档'}
                                                                    </span>
                                                                    {note.notebook?.name && (
                                                                        <span className="command-item-notebook">
                                                                            {note.notebook.name}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="command-item-right">
                                                            <span className="command-item-time">
                                                                {formatRelativeTime(note.updatedAt)}
                                                            </span>
                                                            <span className="command-item-action-hint">↵ 打开</span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </>
                                    )}
                                </>
                            ) : (
                                flatItems.map((item, index) => {
                                    const isSelected = activeIndex === index;
                                    if (item.type === 'command') {
                                        return (
                                            <div
                                                key={item.id}
                                                ref={isSelected ? activeItemRef : null}
                                                className={`command-item ${isSelected ? 'is-active' : ''}`}
                                                onClick={() => handleSelectCurrent(index)}
                                                onMouseEnter={() => setActiveIndex(index)}
                                            >
                                                <div className="command-item-left">
                                                    <div className="command-item-icon">{item.icon}</div>
                                                    <span className="command-item-title">{item.title}</span>
                                                </div>
                                                <div className="command-item-right">
                                                    <span className="command-item-action-hint">↵ 执行</span>
                                                </div>
                                            </div>
                                        );
                                    }

                                    const note = item.data;
                                    return (
                                        <div
                                            key={item.id}
                                            ref={isSelected ? activeItemRef : null}
                                            className={`command-item ${isSelected ? 'is-active' : ''}`}
                                            onClick={() => handleSelectCurrent(index)}
                                            onMouseEnter={() => setActiveIndex(index)}
                                        >
                                            <div className="command-item-left">
                                                <div className="command-item-icon">
                                                    <FileTextOutlined />
                                                </div>
                                                <div className="command-item-details">
                                                    <div className="command-item-title-row">
                                                        <span className="command-item-title">
                                                            {renderHighlighted(note.title || '无标题文档', searchText.trim())}
                                                        </span>
                                                        {note.notebook?.name && (
                                                            <span className="command-item-notebook">
                                                                {note.notebook.name}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {note.snippet && (
                                                        <div className="command-item-snippet">
                                                            {renderHighlighted(note.snippet, searchText.trim())}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="command-item-right">
                                                <span className="command-item-time">
                                                    {formatRelativeTime(note.updatedAt)}
                                                </span>
                                                <span className="command-item-action-hint">↵ 打开</span>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </>
                    )}
                </div>

                <div className="command-palette-footer">
                    <div className="command-footer-hints">
                        <span><kbd>↑</kbd> <kbd>↓</kbd> 移动</span>
                        <span><kbd>↵</kbd> 打开</span>
                        <span><kbd>ESC</kbd> 退出</span>
                    </div>
                    <div className="command-footer-brand">云笔记 · 闪电穿梭中枢</div>
                </div>
            </div>
        </div>
    );
};

export default CommandPalette;
