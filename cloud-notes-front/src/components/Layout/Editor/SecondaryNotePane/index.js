import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Viewer, Editor } from '@bytemd/react';
import gfm from '@bytemd/plugin-gfm';
import highlight from '@bytemd/plugin-highlight';
import gemoji from '@bytemd/plugin-gemoji';
import math from '@bytemd/plugin-math';
import mermaid from '@bytemd/plugin-mermaid';
import breaks from '@bytemd/plugin-breaks';
import { Spin, Button, Tag, Tooltip, Input, Empty, message } from 'antd';
import {
    FileTextOutlined,
    ClockCircleOutlined,
    PushpinOutlined,
    PushpinFilled,
    SwapOutlined,
    EditOutlined,
    EyeOutlined,
    SaveOutlined,
    CloseOutlined,
    SearchOutlined,
    BookOutlined,
    CheckCircleOutlined
} from '@ant-design/icons';
import zhHans from 'bytemd/locales/zh_Hans.json';
import zhHansMermaid from '@bytemd/plugin-mermaid/locales/zh_Hans.json';
import zhHansGfm from '@bytemd/plugin-gfm/locales/zh_Hans.json';
import zhHansMath from '@bytemd/plugin-math/locales/zh_Hans.json';
import { getNoteDetail, updateNote, getRecentNotes, suggestNoteLinks } from '@/api/notes';
import lazyImagePlugin from '../plugins/lazyImagePlugin';
import wikiLinkPlugin from '../plugins/wikiLinkPlugin';
import './index.less';

const locale = { ...zhHans };

const secondaryPlugins = [
    gfm({ locale: zhHansGfm }),
    highlight(),
    gemoji(),
    math({ locale: zhHansMath }),
    mermaid({ locale: zhHansMermaid }),
    breaks(),
    lazyImagePlugin(),
    wikiLinkPlugin()
];

const SecondaryNotePane = ({
    noteId,
    isPinned,
    onTogglePin,
    onSwap,
    onClose,
    onSelectNote,
    onNavigateMainNote,
    selectedNotebook
}) => {
    const [loading, setLoading] = useState(false);
    const [noteData, setNoteData] = useState(null);
    const [viewMode, setViewMode] = useState('preview'); // 'preview' | 'edit'
    const [editContent, setEditContent] = useState('');
    const [saving, setSaving] = useState(false);
    const [isDirty, setIsDirty] = useState(false);

    // 空状态时的快速检索与最近笔记
    const [recentNotes, setRecentNotes] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searching, setSearching] = useState(false);
    const searchTimerRef = useRef(null);

    // 格式化时间
    const formatDate = (dateStr) => {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };

    // 统计字数
    const wordCount = (text) => {
        if (!text) return 0;
        const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
        const words = text.replace(/[\u4e00-\u9fa5]/g, ' ').trim().split(/\s+/).filter(Boolean).length;
        return chinese + words;
    };

    // 加载目标笔记详情
    const fetchNote = useCallback(async (id) => {
        if (!id) {
            setNoteData(null);
            setEditContent('');
            setIsDirty(false);
            return;
        }

        setLoading(true);
        try {
            const res = await getNoteDetail(id);
            const data = res?.note || res?.data?.note || res?.data || res;
            if (data && (data._id || data.title)) {
                setNoteData(data);
                setEditContent(data.content || '');
                setIsDirty(false);
            } else {
                message.warning('未能加载到该参考笔记');
            }
        } catch (err) {
            console.error('加载参考笔记异常:', err);
            message.error('加载参考笔记失败');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchNote(noteId);
    }, [noteId, fetchNote]);

    // 当没有指定 noteId 时拉取最近笔记
    const fetchRecent = useCallback(async () => {
        try {
            const res = await getRecentNotes({ limit: 6 });
            const list = res?.notes || res?.data?.notes || [];
            setRecentNotes(list);
        } catch {
            setRecentNotes([]);
        }
    }, []);

    useEffect(() => {
        if (!noteId) {
            fetchRecent();
        }
    }, [noteId, fetchRecent]);

    // 搜索笔记
    const handleSearchChange = (e) => {
        const val = e.target.value;
        setSearchQuery(val);

        if (searchTimerRef.current) {
            clearTimeout(searchTimerRef.current);
        }

        if (!val.trim()) {
            setSearchResults([]);
            setSearching(false);
            return;
        }

        setSearching(true);
        searchTimerRef.current = setTimeout(async () => {
            try {
                const res = await suggestNoteLinks(val.trim());
                const list = res?.data?.suggestions || res?.suggestions || [];
                setSearchResults(list);
            } catch {
                setSearchResults([]);
            } finally {
                setSearching(false);
            }
        }, 260);
    };

    // 保存副栏编辑
    const handleSave = useCallback(async () => {
        if (!noteData?._id) return;
        setSaving(true);
        try {
            await updateNote(noteData._id, {
                title: noteData.title,
                content: editContent,
                notebookId: noteData.notebookId?._id || noteData.notebookId || selectedNotebook
            });
            setIsDirty(false);
            setNoteData(prev => ({ ...prev, content: editContent, updatedAt: new Date().toISOString() }));
            message.success(`已保存参考笔记《${noteData.title}》`);
        } catch {
            message.error('副屏笔记保存失败');
        } finally {
            setSaving(false);
        }
    }, [noteData, editContent, selectedNotebook]);

    // 快捷键保存
    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's' && viewMode === 'edit' && isDirty) {
                e.preventDefault();
                handleSave();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [viewMode, isDirty, handleSave]);

    // 切换模式前如未保存提示
    const handleToggleMode = () => {
        if (viewMode === 'edit') {
            if (isDirty) {
                // 如果有未保存改动，提示或直接同步预览
                setNoteData(prev => ({ ...prev, content: editContent }));
            }
            setViewMode('preview');
        } else {
            setViewMode('edit');
        }
    };

    return (
        <div className="secondary-note-pane">
            {/* 顶部控制栏 */}
            <div className="pane-header">
                <div className="pane-header-left">
                    <FileTextOutlined className="note-icon" />
                    {noteData ? (
                        <>
                            <Tooltip title={noteData.title}>
                                <span className="note-title-text">{noteData.title}</span>
                            </Tooltip>
                            {isDirty && <span className="dirty-badge" title="有未保存修改">•</span>}
                            {noteData.notebookId && (
                                <Tag
                                    className="notebook-pill"
                                    style={{
                                        borderColor: `${noteData.notebookId.color || '#3b82f6'}30`,
                                        backgroundColor: `${noteData.notebookId.color || '#3b82f6'}15`,
                                        color: noteData.notebookId.color || '#3b82f6'
                                    }}
                                >
                                    <BookOutlined style={{ marginRight: 3, fontSize: 11 }} />
                                    {noteData.notebookId.name || '默认笔记本'}
                                </Tag>
                            )}
                        </>
                    ) : (
                        <span className="empty-title-text">副屏参考笔记</span>
                    )}
                </div>

                <div className="pane-header-actions">
                    {noteData && (
                        <>
                            {/* 锁定 / 解锁 */}
                            <Tooltip title={isPinned ? '已锁定此参考笔记（后续正文双链不会覆盖，点击可解锁）' : '锁定此参考笔记（防止后续双链跳转冲掉）'}>
                                <button
                                    type="button"
                                    className={`action-icon-btn pin-btn ${isPinned ? 'is-pinned' : ''}`}
                                    onClick={onTogglePin}
                                    aria-label="锁定副屏"
                                >
                                    {isPinned ? <PushpinFilled /> : <PushpinOutlined />}
                                    <span className="btn-label">{isPinned ? '已锁定' : '锁定'}</span>
                                </button>
                            </Tooltip>

                            {/* 左右对调 */}
                            <Tooltip title="与主编辑栏对调 (Swap Panes)">
                                <button
                                    type="button"
                                    className="action-icon-btn swap-btn"
                                    onClick={onSwap}
                                    aria-label="与主栏互换"
                                >
                                    <SwapOutlined />
                                    <span className="btn-label">对调</span>
                                </button>
                            </Tooltip>

                            {/* 编辑 / 阅读 切换 */}
                            <Tooltip title={viewMode === 'preview' ? '切换为就地编辑模式' : '切换为只读参考模式'}>
                                <button
                                    type="button"
                                    className={`action-icon-btn mode-btn ${viewMode === 'edit' ? 'is-editing' : ''}`}
                                    onClick={handleToggleMode}
                                    aria-label="切换编辑预览"
                                >
                                    {viewMode === 'preview' ? <EditOutlined /> : <EyeOutlined />}
                                    <span className="btn-label">{viewMode === 'preview' ? '就地编辑' : '只读参考'}</span>
                                </button>
                            </Tooltip>

                            {/* 编辑模式下的保存按钮 */}
                            {viewMode === 'edit' && (
                                <Button
                                    size="small"
                                    type="primary"
                                    icon={<SaveOutlined />}
                                    loading={saving}
                                    disabled={!isDirty}
                                    onClick={handleSave}
                                    className="save-btn"
                                >
                                    保存
                                </Button>
                            )}
                        </>
                    )}

                    {/* 关闭副栏 */}
                    <Tooltip title="关闭副屏参考">
                        <button
                            type="button"
                            className="action-icon-btn close-btn"
                            onClick={onClose}
                            aria-label="关闭副屏"
                        >
                            <CloseOutlined />
                        </button>
                    </Tooltip>
                </div>
            </div>

            {/* 主内容区域 */}
            <div className="pane-body">
                {loading ? (
                    <div className="pane-loading">
                        <Spin size="default" tip="正在载入参考笔记..." />
                    </div>
                ) : !noteData ? (
                    /* 未选择参考笔记时的选择与搜索面板 */
                    <div className="pane-empty-picker">
                        <div className="picker-hero">
                            <div className="hero-icon">
                                <BookOutlined />
                            </div>
                            <h3>选择一篇笔记作为参考资料</h3>
                            <p className="hero-desc">
                                开启双栏分屏联动写作。您可在下方直接选择笔记，或在左侧正文中按住 <code>Shift/Alt</code> 点击任意 <code>[[双向链接]]</code> 快速载入。
                            </p>
                        </div>

                        <div className="search-bar-wrap">
                            <Input
                                prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
                                placeholder="输入标题快速查找参考笔记..."
                                value={searchQuery}
                                onChange={handleSearchChange}
                                allowClear
                                className="reference-search-input"
                            />
                        </div>

                        {searchQuery.trim() ? (
                            <div className="search-results-list">
                                <div className="section-title">搜索结果 ({searchResults.length})</div>
                                <Spin spinning={searching} size="small">
                                    {searchResults.length === 0 ? (
                                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未找到匹配笔记" />
                                    ) : (
                                        searchResults.map(item => (
                                            <div
                                                key={item._id}
                                                className="note-pick-item"
                                                onClick={() => onSelectNote?.(item._id)}
                                            >
                                                <div className="item-title">
                                                    <FileTextOutlined className="icon" />
                                                    <span>{item.title}</span>
                                                </div>
                                                {item.snippet && (
                                                    <div className="item-snippet">{item.snippet}</div>
                                                )}
                                            </div>
                                        ))
                                    )}
                                </Spin>
                            </div>
                        ) : (
                            <div className="recent-notes-list">
                                <div className="section-title">最近编辑的笔记</div>
                                {recentNotes.length === 0 ? (
                                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无历史笔记" />
                                ) : (
                                    <div className="recent-grid">
                                        {recentNotes.map(item => (
                                            <div
                                                key={item._id}
                                                className="note-pick-item"
                                                onClick={() => onSelectNote?.(item._id)}
                                            >
                                                <div className="item-title">
                                                    <FileTextOutlined className="icon" />
                                                    <span>{item.title}</span>
                                                </div>
                                                <div className="item-meta">
                                                    {item.notebookId && (
                                                        <span className="notebook-text">
                                                            {item.notebookId.name || '默认笔记本'}
                                                        </span>
                                                    )}
                                                    <span className="time-text">
                                                        <ClockCircleOutlined style={{ marginRight: 3 }} />
                                                        {formatDate(item.updatedAt)}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    /* 已载入笔记内容 */
                    <div className="pane-content-wrap">
                        {viewMode === 'preview' ? (
                            <div className="secondary-preview-scroller">
                                <Viewer value={noteData.content || ''} plugins={secondaryPlugins} />
                            </div>
                        ) : (
                            <div className="secondary-editor-wrapper">
                                <Editor
                                    value={editContent}
                                    plugins={secondaryPlugins}
                                    onChange={val => {
                                        setEditContent(val);
                                        setIsDirty(val !== (noteData.content || ''));
                                    }}
                                    mode="split"
                                    locale={locale}
                                />
                            </div>
                        )}

                        {/* 副屏底部状态栏 */}
                        <div className="pane-status-bar">
                            <div className="status-left">
                                <span className="word-count">
                                    字数: <strong>{wordCount(viewMode === 'preview' ? (noteData.content || '') : editContent)}</strong>
                                </span>
                                {noteData.updatedAt && (
                                    <span className="update-time">
                                        更新于: {formatDate(noteData.updatedAt)}
                                    </span>
                                )}
                            </div>
                            <div className="status-right">
                                {viewMode === 'preview' ? (
                                    <span className="mode-indicator preview-mode">
                                        <EyeOutlined style={{ marginRight: 4 }} />
                                        只读参考模式
                                    </span>
                                ) : isDirty ? (
                                    <span className="mode-indicator dirty-mode">
                                        <EditOutlined style={{ marginRight: 4 }} />
                                        有未保存修改 (Ctrl+S 保存)
                                    </span>
                                ) : (
                                    <span className="mode-indicator clean-mode">
                                        <CheckCircleOutlined style={{ marginRight: 4, color: '#10b981' }} />
                                        就地编辑已同步
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SecondaryNotePane;
