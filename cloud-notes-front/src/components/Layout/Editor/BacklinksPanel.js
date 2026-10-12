import React, { useEffect, useState, useCallback } from 'react';
import { getNoteBacklinks } from '@/api/notes';
import { getRelatedNotes } from '@/api/rag';
import {
    DownOutlined,
    UpOutlined,
    ReloadOutlined,
    BookOutlined,
    ClockCircleOutlined,
    FileTextOutlined,
    CompassOutlined,
    SplitCellsOutlined,
    PushpinOutlined,
    PlusOutlined,
    FileAddOutlined,
    ThunderboltOutlined,
    ClusterOutlined,
    LinkOutlined,
    SearchOutlined
} from '@ant-design/icons';
import { Spin, Tooltip, Tag, message } from 'antd';
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

const BacklinksPanel = ({
    noteId,
    noteTitle,
    onNavigateNote,
    onOpenLocalGraph,
    onInsertText,
    onOpenSplitNote,
    isPinned = false,
    onTogglePin
}) => {
    const [loading, setLoading] = useState(false);
    const [semanticLoading, setSemanticLoading] = useState(false);
    const [expanded, setExpanded] = useState(isPinned);
    const [activeTab, setActiveTab] = useState('semantic'); // 'semantic' | 'links' | 'mentions'
    const [data, setData] = useState({
        backlinks: [],
        unresolvedMentions: [],
        totalCount: 0
    });
    const [semanticNotes, setSemanticNotes] = useState([]);

    // 切换笔记时若未置顶侧栏则默认收起
    useEffect(() => {
        if (!isPinned) {
            setExpanded(false);
        }
    }, [noteId, isPinned]);

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

    const fetchSemanticNotes = useCallback(async () => {
        if (!noteId) return;
        setSemanticLoading(true);
        try {
            const res = await getRelatedNotes(noteId, { topK: 6, minScore: 0.52 });
            const list = res?.data || res || [];
            setSemanticNotes(Array.isArray(list) ? list : []);
        } catch {
            setSemanticNotes([]);
        } finally {
            setSemanticLoading(false);
        }
    }, [noteId]);

    const refreshAll = useCallback(() => {
        fetchBacklinks();
        fetchSemanticNotes();
    }, [fetchBacklinks, fetchSemanticNotes]);

    useEffect(() => {
        refreshAll();
    }, [refreshAll]);

    if (!noteId) return null;

    const handleInsertWikiLink = (title, e) => {
        e?.stopPropagation();
        if (onInsertText) {
            onInsertText(`[[${title}]]`);
            message.success(`已插入双链 [[${title}]]`);
        }
    };

    const handleAppendReferenceBlock = (item, e) => {
        e?.stopPropagation();
        if (onInsertText) {
            const simText = item.similarity ? ` (匹配度 ${(item.similarity * 100).toFixed(0)}%)` : '';
            const block = `\n\n> 💡 **关联参考**：[[${item.title}]]${simText}\n> ${item.snippet ? item.snippet + '...' : ''}\n`;
            onInsertText(block);
            message.success(`已在文档追加《${item.title}》参考引用块`);
        }
    };

    const handleOpenSplit = (targetId, title, e) => {
        e?.stopPropagation();
        if (onOpenSplitNote) {
            onOpenSplitNote(targetId);
        } else {
            window.dispatchEvent(
                new CustomEvent('open-wiki-link-split', {
                    detail: { noteId: targetId, title }
                })
            );
        }
    };

    const renderSnippet = snippet => {
        if (!snippet) return null;
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

    const totalSemanticCount = semanticNotes.length;
    const totalExplicitCount = data.backlinks.length;
    const totalMentionsCount = data.unresolvedMentions.length;

    return (
        <div className={`backlinks-panel ${isPinned ? 'is-pinned-sidebar' : expanded ? 'is-expanded' : 'is-collapsed'}`}>
            <div className="panel-header" onClick={() => !isPinned && setExpanded(!expanded)}>
                <div className="header-left">
                    <span className="panel-icon">
                        <ThunderboltOutlined />
                    </span>
                    <span className="panel-title">{isPinned ? '智能知识伴侣' : '双链与智能知识网络'}</span>
                    <div className="companion-tabs" onClick={e => e.stopPropagation()}>
                        <button
                            type="button"
                            className={`tab-pill-btn ${activeTab === 'semantic' ? 'active' : ''}`}
                            onClick={() => {
                                setActiveTab('semantic');
                                if (!expanded) setExpanded(true);
                            }}
                        >
                            <ClusterOutlined className="tab-icon" style={{ color: '#7c3aed' }} />
                            <span>语义推荐</span>
                            {totalSemanticCount > 0 && <span className="tab-badge">{totalSemanticCount}</span>}
                        </button>
                        <button
                            type="button"
                            className={`tab-pill-btn ${activeTab === 'links' ? 'active' : ''}`}
                            onClick={() => {
                                setActiveTab('links');
                                if (!expanded) setExpanded(true);
                            }}
                        >
                            <LinkOutlined className="tab-icon" style={{ color: '#0284c7' }} />
                            <span>引用本文</span>
                            {totalExplicitCount > 0 && <span className="tab-badge">{totalExplicitCount}</span>}
                        </button>
                        <button
                            type="button"
                            className={`tab-pill-btn ${activeTab === 'mentions' ? 'active' : ''}`}
                            onClick={() => {
                                setActiveTab('mentions');
                                if (!expanded) setExpanded(true);
                            }}
                        >
                            <SearchOutlined className="tab-icon" style={{ color: '#d97706' }} />
                            <span>文本提及</span>
                            {totalMentionsCount > 0 && <span className="tab-badge">{totalMentionsCount}</span>}
                        </button>
                    </div>
                </div>

                <div className="header-actions" onClick={e => e.stopPropagation()}>
                    {onTogglePin && (
                        <Tooltip title={isPinned ? '取消侧栏固定，还原至底栏' : '固定为右侧常驻知识伴侣栏'}>
                            <button
                                type="button"
                                className={`action-btn pin-btn ${isPinned ? 'pinned-active' : ''}`}
                                onClick={onTogglePin}
                            >
                                <PushpinOutlined />
                                <span className="btn-text">{isPinned ? '还原底栏' : '固定侧栏'}</span>
                            </button>
                        </Tooltip>
                    )}
                    {onOpenLocalGraph && (
                        <Tooltip title="查看当前笔记局部知识星系">
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
                    <Tooltip title="刷新知识关联">
                        <button
                            type="button"
                            className="action-btn"
                            disabled={loading || semanticLoading}
                            onClick={refreshAll}
                        >
                            <ReloadOutlined spin={loading || semanticLoading} />
                        </button>
                    </Tooltip>
                    {!isPinned && (
                        <Tooltip title={expanded ? '收起伴侣面板' : '展开伴侣面板'}>
                            <button
                                type="button"
                                className="action-btn toggle-btn"
                                onClick={() => setExpanded(!expanded)}
                            >
                                {expanded ? <UpOutlined /> : <DownOutlined />}
                            </button>
                        </Tooltip>
                    )}
                </div>
            </div>

            {(expanded || isPinned) && (
                <div className="panel-body">
                    <Spin spinning={loading || semanticLoading} size="small">
                        {activeTab === 'semantic' && (
                            <div className="semantic-tab-content">
                                {semanticNotes.length === 0 ? (
                                    <div className="empty-backlinks">
                                        <p>暂未发现相关度超过 52% 的语义关联笔记</p>
                                        <span className="tip">系统将在您持续记录更多笔记后，利用切片向量矩阵自动发掘交叉灵感。</span>
                                    </div>
                                ) : (
                                    <div className="links-group">
                                        <div className="group-title">
                                            <span>全库语义强相关推荐 ({semanticNotes.length})</span>
                                            <span className="sub-desc">基于 17,700+ 切片向量智能发掘的潜在知识关联</span>
                                        </div>
                                        <div className="links-grid">
                                            {semanticNotes.map(item => (
                                                <div
                                                    key={item.noteId}
                                                    className="backlink-card semantic-card"
                                                    onClick={() => onNavigateNote?.(item.noteId)}
                                                >
                                                    <div className="card-top">
                                                        <div className="note-name">
                                                            <FileTextOutlined className="icon" />
                                                            <span className="name-text">{item.title}</span>
                                                        </div>
                                                        <div className="meta-right">
                                                            {item.similarity && (
                                                                <span className="semantic-similarity-tag" title="向量余弦相似度">
                                                                    <span className="pulse-dot" />
                                                                    匹配 {(item.similarity * 100).toFixed(0)}%
                                                                </span>
                                                            )}
                                                            {item.notebookName && (
                                                                <Tag className="notebook-tag">
                                                                    <BookOutlined style={{ marginRight: 3 }} />
                                                                    {item.notebookName}
                                                                </Tag>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {item.headerPath && (
                                                        <div className="matched-header-path">
                                                            <span>命中章节：{item.headerPath}</span>
                                                        </div>
                                                    )}

                                                    {item.snippet && (
                                                        <div className="card-snippet">
                                                            “{item.snippet}...”
                                                        </div>
                                                    )}

                                                    <div className="card-action-bar" onClick={e => e.stopPropagation()}>
                                                        <Tooltip title="在光标处织入 [[双链]]">
                                                            <button
                                                                type="button"
                                                                className="quick-action-btn"
                                                                onClick={e => handleInsertWikiLink(item.title, e)}
                                                            >
                                                                <PlusOutlined /> 插入双链
                                                            </button>
                                                        </Tooltip>
                                                        <Tooltip title="在正文末尾追加结构化参考卡片">
                                                            <button
                                                                type="button"
                                                                className="quick-action-btn"
                                                                onClick={e => handleAppendReferenceBlock(item, e)}
                                                            >
                                                                <FileAddOutlined /> 追加引用
                                                            </button>
                                                        </Tooltip>
                                                        <Tooltip title="在右侧副屏并排打开参考">
                                                            <button
                                                                type="button"
                                                                className="quick-action-btn"
                                                                onClick={e => handleOpenSplit(item.noteId, item.title, e)}
                                                            >
                                                                <SplitCellsOutlined /> 分屏研读
                                                            </button>
                                                        </Tooltip>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'links' && (
                            <div className="links-tab-content">
                                {data.backlinks.length === 0 ? (
                                    <div className="empty-backlinks">
                                        <p>当前笔记暂无显式反向链接。</p>
                                        <span className="tip">
                                            在其他任意笔记中键入 <code>[[{noteTitle || '当前笔记'}]]</code>，即可在此自动建立双向互联。
                                        </span>
                                    </div>
                                ) : (
                                    <div className="links-group">
                                        <div className="group-title">显式引用本文的笔记 ({data.backlinks.length})</div>
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
                                                                <Tag className="notebook-tag" color="blue">
                                                                    <BookOutlined style={{ marginRight: 3 }} />
                                                                    {item.notebookId.name}
                                                                </Tag>
                                                            )}
                                                            <Tooltip title="在副屏分屏参考">
                                                                <button
                                                                    type="button"
                                                                    className="card-split-btn"
                                                                    onClick={e => handleOpenSplit(item._id, item.title, e)}
                                                                >
                                                                    <SplitCellsOutlined />
                                                                </button>
                                                            </Tooltip>
                                                            <span className="update-time">
                                                                <ClockCircleOutlined style={{ marginRight: 3 }} />
                                                                {formatTime(item.updatedAt)}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    {item.contextSnippet && (
                                                        <div className="card-snippet">
                                                            “{renderSnippet(item.contextSnippet)}”
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'mentions' && (
                            <div className="mentions-tab-content">
                                {data.unresolvedMentions.length === 0 ? (
                                    <div className="empty-backlinks">
                                        <p>当前笔记暂无未建链接提及。</p>
                                        <span className="tip">当其他笔记出现《{noteTitle || '本文'}》标题但未加方括号时将在此聚合。</span>
                                    </div>
                                ) : (
                                    <div className="links-group mentions-group">
                                        <div className="group-title">
                                            未建链接提及 ({data.unresolvedMentions.length})
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
                                                        <Tooltip title="转换为正规 [[双链]] 织入">
                                                            <button
                                                                type="button"
                                                                className="quick-action-btn"
                                                                onClick={e => handleInsertWikiLink(item.title, e)}
                                                            >
                                                                <PlusOutlined /> 织入双链
                                                            </button>
                                                        </Tooltip>
                                                    </div>
                                                    {item.contextSnippet && (
                                                        <div className="card-snippet">
                                                            “{renderSnippet(item.contextSnippet)}”
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
