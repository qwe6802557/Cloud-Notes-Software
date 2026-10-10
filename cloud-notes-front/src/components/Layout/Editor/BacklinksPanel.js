import React, { useEffect, useState, useCallback } from 'react';
import { getNoteBacklinks } from '@/api/notes';
import {
    LinkOutlined,
    DownOutlined,
    UpOutlined,
    ReloadOutlined,
    BookOutlined,
    ClockCircleOutlined,
    FileTextOutlined,
    CompassOutlined
} from '@ant-design/icons';
import { Spin, Tooltip, Tag } from 'antd';
import './BacklinksPanel.less';

const formatTime = isoStr => {
    if (!isoStr) return '';
    const date = new Date(isoStr);
    const now = new Date();
    const diff = (now - date) / 1000;

    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const BacklinksPanel = ({ noteId, noteTitle, onNavigateNote, onOpenLocalGraph }) => {
    const [loading, setLoading] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [data, setData] = useState({
        backlinks: [],
        unresolvedMentions: [],
        totalCount: 0
    });

    // 切换笔记时重置为默认收起状态
    useEffect(() => {
        setExpanded(false);
    }, [noteId]);

    const fetchBacklinks = useCallback(async () => {
        if (!noteId) return;
        setLoading(true);
        try {
            const res = await getNoteBacklinks(noteId);
            const payload = res?.data || res || {};
            setData({
                backlinks: payload.backlinks || [],
                unresolvedMentions: payload.unresolvedMentions || [],
                totalCount: payload.totalCount || 0
            });
        } catch {
            setData({ backlinks: [], unresolvedMentions: [], totalCount: 0 });
        } finally {
            setLoading(false);
        }
    }, [noteId]);

    useEffect(() => {
        fetchBacklinks();
    }, [fetchBacklinks]);

    if (!noteId) return null;

    const renderSnippet = (snippet, targetTitle) => {
        if (!snippet) return null;

        // 若语境包含 ==标记== 则转换高亮
        const markRegex = /==([^=]+)==/g;
        const parts = [];
        let lastIdx = 0;
        let match;

        while ((match = markRegex.exec(snippet)) !== null) {
            if (match.index > lastIdx) {
                parts.push(snippet.slice(lastIdx, match.index));
            }
            parts.push(
                <mark key={match.index} className="snippet-highlight">
                    {match[1]}
                </mark>
            );
            lastIdx = markRegex.lastIndex;
        }

        if (lastIdx < snippet.length) {
            parts.push(snippet.slice(lastIdx));
        }

        return parts.length > 0 ? parts : snippet;
    };

    return (
        <div className={`backlinks-panel ${expanded ? 'is-expanded' : 'is-collapsed'}`}>
            <div className="panel-header" onClick={() => setExpanded(!expanded)}>
                <div className="header-left">
                    <span className="panel-icon">
                        <LinkOutlined />
                    </span>
                    <span className="panel-title">反向链接 (Backlinks)</span>
                    <Tag className="count-badge" color={data.totalCount > 0 ? 'blue' : 'default'}>
                        {data.totalCount}
                    </Tag>
                </div>

                <div className="header-actions" onClick={e => e.stopPropagation()}>
                    {onOpenLocalGraph && (
                        <Tooltip title="查看当前笔记局部关系图谱">
                            <button
                                type="button"
                                className="action-btn"
                                onClick={() => onOpenLocalGraph(noteId)}
                            >
                                <CompassOutlined />
                                <span className="btn-text">关系图</span>
                            </button>
                        </Tooltip>
                    )}
                    <Tooltip title="刷新反链列表">
                        <button
                            type="button"
                            className="action-btn"
                            disabled={loading}
                            onClick={fetchBacklinks}
                        >
                            <ReloadOutlined spin={loading} />
                        </button>
                    </Tooltip>
                    <Tooltip title={expanded ? '收起反向链接面板' : '展开反向链接面板'}>
                        <button
                            type="button"
                            className="action-btn toggle-btn"
                            onClick={() => setExpanded(!expanded)}
                        >
                            {expanded ? <UpOutlined /> : <DownOutlined />}
                        </button>
                    </Tooltip>
                </div>
            </div>

            {expanded && (
                <div className="panel-body">
                    <Spin spinning={loading} size="small">
                        {data.totalCount === 0 ? (
                            <div className="empty-backlinks">
                                <p>当前笔记暂无反向链接。</p>
                                <span className="tip">
                                    在其他任意笔记中键入 <code>[[{noteTitle || '当前笔记'}]]</code>，即可在此自动建立关联网络与语境卡片。
                                </span>
                            </div>
                        ) : (
                            <div className="backlinks-content">
                                {data.backlinks.length > 0 && (
                                    <div className="links-group">
                                        <div className="group-title">引用本文的笔记 ({data.backlinks.length})</div>
                                        <div className="links-grid">
                                            {data.backlinks.map(item => (
                                                <div
                                                    key={item._id}
                                                    className="backlink-card"
                                                    onClick={() => onNavigateNote?.(item._id)}
                                                >
                                                    <div className="card-top">
                                                        <div className="note-name">
                                                            <FileTextOutlined className="icon" />
                                                            <span className="name-text">{item.title}</span>
                                                        </div>
                                                        <div className="meta-right">
                                                            {item.notebookId && (
                                                                <Tag
                                                                    className="notebook-tag"
                                                                    color={item.notebookId.color || 'blue'}
                                                                >
                                                                    <BookOutlined style={{ marginRight: 3 }} />
                                                                    {item.notebookId.name}
                                                                </Tag>
                                                            )}
                                                            <span className="update-time">
                                                                <ClockCircleOutlined style={{ marginRight: 3 }} />
                                                                {formatTime(item.updatedAt)}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    {item.contextSnippet && (
                                                        <div className="card-snippet">
                                                            “{renderSnippet(item.contextSnippet, noteTitle)}”
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {data.unresolvedMentions.length > 0 && (
                                    <div className="links-group mentions-group">
                                        <div className="group-title">
                                            未建提及 ({data.unresolvedMentions.length})
                                            <span className="sub">（曾作为占位符引用的笔记）</span>
                                        </div>
                                        <div className="links-grid">
                                            {data.unresolvedMentions.map(item => (
                                                <div
                                                    key={item._id}
                                                    className="backlink-card is-mention"
                                                    onClick={() => onNavigateNote?.(item._id)}
                                                >
                                                    <div className="card-top">
                                                        <div className="note-name">
                                                            <FileTextOutlined className="icon" />
                                                            <span className="name-text">{item.title}</span>
                                                        </div>
                                                    </div>
                                                    {item.contextSnippet && (
                                                        <div className="card-snippet">
                                                            “{renderSnippet(item.contextSnippet, noteTitle)}”
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </Spin>
                </div>
            )}
        </div>
    );
};

export default BacklinksPanel;
