import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Spin, Button, Tag, Space } from 'antd';
import {
    FileTextOutlined,
    ClockCircleOutlined,
    ApartmentOutlined,
    PlusOutlined,
    RightOutlined,
    CloseOutlined,
    SplitCellsOutlined
} from '@ant-design/icons';
import { suggestNoteLinks } from '@/api/notes';
import './WikiLinkHoverCard.less';

const CARD_WIDTH = 340;
const CARD_ESTIMATED_HEIGHT = 180;
const OPEN_DELAY = 220;
const CLOSE_DELAY = 260;

const WikiLinkHoverCard = ({ onSelectNote, onCreateNote, onOpenSplitNote }) => {
    const [visible, setVisible] = useState(false);
    const [loading, setLoading] = useState(false);
    const [targetTitle, setTargetTitle] = useState('');
    const [position, setPosition] = useState({ top: 0, left: 0 });
    const [noteInfo, setNoteInfo] = useState(null);
    const [isNotFound, setIsNotFound] = useState(false);

    const openTimerRef = useRef(null);
    const closeTimerRef = useRef(null);
    const cacheRef = useRef(new Map());

    // 智能计算视口避让位置
    const computePosition = useCallback((rect) => {
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let left = rect.left;
        if (left + CARD_WIDTH > viewportWidth - 16) {
            left = Math.max(16, viewportWidth - CARD_WIDTH - 16);
        }

        let top = rect.bottom + 8;
        if (top + CARD_ESTIMATED_HEIGHT > viewportHeight - 16) {
            top = Math.max(16, rect.top - CARD_ESTIMATED_HEIGHT - 8);
        }

        return { top, left };
    }, []);

    // 异步拉取目标笔记数据并写入瞬时缓存
    const fetchNoteData = useCallback(async (title) => {
        if (!title) return;
        const cached = cacheRef.current.get(title);
        if (cached) {
            setNoteInfo(cached);
            setIsNotFound(cached.notFound || false);
            setLoading(false);
            return;
        }

        setLoading(true);
        try {
            const res = await suggestNoteLinks(title);
            const suggestions = res?.data?.suggestions || res?.suggestions || [];
            const exactMatch = suggestions.find(
                s => s.title?.trim().toLowerCase() === title.trim().toLowerCase()
            );

            if (exactMatch) {
                const itemData = {
                    _id: exactMatch._id,
                    title: exactMatch.title,
                    notebookName: exactMatch.notebookName || '默认笔记本',
                    notebookColor: exactMatch.notebookColor || '#3b82f6',
                    updatedAt: exactMatch.updatedAt,
                    backlinkCount: exactMatch.backlinkCount || 0,
                    snippet: exactMatch.snippet || ''
                };
                cacheRef.current.set(title, itemData);
                setNoteInfo(itemData);
                setIsNotFound(false);
            } else {
                const notFoundData = { notFound: true, title };
                cacheRef.current.set(title, notFoundData);
                setNoteInfo(null);
                setIsNotFound(true);
            }
        } catch {
            setNoteInfo(null);
            setIsNotFound(true);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const handleHover = (e) => {
            const { title, rect } = e.detail || {};
            if (!title || !rect) return;

            if (closeTimerRef.current) {
                clearTimeout(closeTimerRef.current);
                closeTimerRef.current = null;
            }

            if (openTimerRef.current) {
                clearTimeout(openTimerRef.current);
            }

            openTimerRef.current = setTimeout(() => {
                setTargetTitle(title);
                setPosition(computePosition(rect));
                setVisible(true);
                fetchNoteData(title);
            }, OPEN_DELAY);
        };

        const handleLeave = () => {
            if (openTimerRef.current) {
                clearTimeout(openTimerRef.current);
                openTimerRef.current = null;
            }

            closeTimerRef.current = setTimeout(() => {
                setVisible(false);
                setNoteInfo(null);
            }, CLOSE_DELAY);
        };

        window.addEventListener('hover-wiki-link', handleHover);
        window.addEventListener('leave-wiki-link', handleLeave);

        return () => {
            window.removeEventListener('hover-wiki-link', handleHover);
            window.removeEventListener('leave-wiki-link', handleLeave);
            if (openTimerRef.current) clearTimeout(openTimerRef.current);
            if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
        };
    }, [computePosition, fetchNoteData]);

    const handleCardMouseEnter = () => {
        if (closeTimerRef.current) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
    };

    const handleCardMouseLeave = () => {
        closeTimerRef.current = setTimeout(() => {
            setVisible(false);
            setNoteInfo(null);
        }, 180);
    };

    const handleOpenNote = () => {
        if (noteInfo?._id) {
            setVisible(false);
            onSelectNote?.(noteInfo._id);
        }
    };

    const handleOpenSplitNote = () => {
        if (noteInfo?._id) {
            setVisible(false);
            if (typeof onOpenSplitNote === 'function') {
                onOpenSplitNote(noteInfo._id, targetTitle);
            } else {
                window.dispatchEvent(
                    new CustomEvent('open-wiki-link-split', {
                        detail: { noteId: noteInfo._id, title: targetTitle }
                    })
                );
            }
        }
    };

    const handleCreateNew = () => {
        setVisible(false);
        onCreateNote?.(targetTitle);
    };

    if (!visible) return null;

    const formatDate = (dateStr) => {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    return createPortal(
        <div
            className="wikilink-hover-card"
            style={{
                top: position.top,
                left: position.left,
                width: CARD_WIDTH
            }}
            onMouseEnter={handleCardMouseEnter}
            onMouseLeave={handleCardMouseLeave}
        >
            <div className="card-header">
                <div className="title-area">
                    <FileTextOutlined className="header-icon" />
                    <span className="note-title" title={targetTitle}>
                        {targetTitle}
                    </span>
                </div>
                <button
                    className="close-btn"
                    onClick={() => setVisible(false)}
                    aria-label="关闭预览"
                >
                    <CloseOutlined style={{ fontSize: 11 }} />
                </button>
            </div>

            <div className="card-body">
                {loading ? (
                    <div className="loading-box">
                        <Spin size="small" tip="正在载入笔记预览..." />
                    </div>
                ) : noteInfo ? (
                    <div className="note-content-preview">
                        <div className="badges-row">
                            <Tag
                                className="notebook-tag"
                                style={{
                                    borderColor: `${noteInfo.notebookColor}40`,
                                    backgroundColor: `${noteInfo.notebookColor}12`,
                                    color: noteInfo.notebookColor
                                }}
                            >
                                <span
                                    className="dot"
                                    style={{ backgroundColor: noteInfo.notebookColor }}
                                />
                                {noteInfo.notebookName}
                            </Tag>
                            {noteInfo.backlinkCount > 0 && (
                                <Tag className="backlink-tag" icon={<ApartmentOutlined />}>
                                    {noteInfo.backlinkCount} 双链
                                </Tag>
                            )}
                            {noteInfo.updatedAt && (
                                <span className="time-text">
                                    <ClockCircleOutlined style={{ marginRight: 3 }} />
                                    {formatDate(noteInfo.updatedAt)}
                                </span>
                            )}
                        </div>

                        <div className="snippet-box">
                            {noteInfo.snippet ? (
                                <p className="snippet-text">{noteInfo.snippet}</p>
                            ) : (
                                <p className="empty-snippet-text">暂无正文摘要预览</p>
                            )}
                        </div>
                    </div>
                ) : isNotFound ? (
                    <div className="not-found-box">
                        <div className="not-found-tag">未创建笔记</div>
                        <p className="not-found-desc">
                            知识库中尚未存在名为《{targetTitle}》的笔记，点击下方可一键生成并建立双向关联。
                        </p>
                    </div>
                ) : null}
            </div>

            <div className="card-footer">
                {noteInfo?._id ? (
                    <Space size={8}>
                        <Button
                            size="small"
                            icon={<SplitCellsOutlined />}
                            className="action-btn split-btn"
                            onClick={handleOpenSplitNote}
                        >
                            在副屏参考
                        </Button>
                        <Button
                            type="primary"
                            size="small"
                            icon={<RightOutlined />}
                            className="action-btn"
                            onClick={handleOpenNote}
                        >
                            主栏打开
                        </Button>
                    </Space>
                ) : isNotFound ? (
                    <Button
                        type="primary"
                        size="small"
                        icon={<PlusOutlined />}
                        className="action-btn create-btn"
                        onClick={handleCreateNew}
                    >
                        立即创建关联笔记
                    </Button>
                ) : null}
            </div>
        </div>,
        document.body
    );
};

export default WikiLinkHoverCard;
