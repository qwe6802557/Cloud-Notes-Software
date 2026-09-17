import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Spin, Tag, Button, Empty, Popconfirm, message } from 'antd';
import { HistoryOutlined, RollbackOutlined } from '@ant-design/icons';
import { Viewer } from '@bytemd/react';
import gfm from '@bytemd/plugin-gfm';
import highlight from '@bytemd/plugin-highlight';
import math from '@bytemd/plugin-math';
import mermaid from '@bytemd/plugin-mermaid';
import breaks from '@bytemd/plugin-breaks';
import { getNoteHistories, getNoteHistoryDetail, rollbackNoteHistory } from '@/api/notes';
import './VersionHistoryModal.less';

const viewerPlugins = [
    gfm(),
    highlight(),
    math(),
    mermaid(),
    breaks()
];

const formatDateTime = dateStr => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

const renderSaveTypeTag = type => {
    switch (type) {
        case 'manual':
            return <Tag color="blue">手动保存</Tag>;
        case 'auto':
            return <Tag color="green">自动备份</Tag>;
        case 'rollback':
            return <Tag color="orange">版本回滚</Tag>;
        default:
            return <Tag>快照</Tag>;
    }
};

const VersionHistoryModal = ({ visible, onClose, noteId, currentNoteTitle, onRollbackSuccess }) => {
    const [loadingList, setLoadingList] = useState(false);
    const [histories, setHistories] = useState([]);
    const [selectedHistoryId, setSelectedHistoryId] = useState(null);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [selectedDetail, setSelectedDetail] = useState(null);
    const [rollingBack, setRollingBack] = useState(false);
    const [viewMode, setViewMode] = useState('preview'); // 'preview' | 'raw'

    const fetchHistories = useCallback(async targetNoteId => {
        if (!targetNoteId) return;
        setLoadingList(true);
        try {
            const res = await getNoteHistories(targetNoteId);
            const list = res?.data?.histories || [];
            setHistories(list);
            if (list.length > 0) {
                setSelectedHistoryId(list[0]._id);
            } else {
                setSelectedHistoryId(null);
                setSelectedDetail(null);
            }
        } catch {
            message.error('获取历史版本列表失败');
        } finally {
            setLoadingList(false);
        }
    }, []);

    const fetchDetail = useCallback(async (targetNoteId, historyId) => {
        if (!targetNoteId || !historyId) return;
        setLoadingDetail(true);
        try {
            const res = await getNoteHistoryDetail(targetNoteId, historyId);
            setSelectedDetail(res?.data?.history || null);
        } catch {
            message.error('获取版本详情失败');
        } finally {
            setLoadingDetail(false);
        }
    }, []);

    useEffect(() => {
        if (visible && noteId) {
            fetchHistories(noteId);
        } else {
            setHistories([]);
            setSelectedHistoryId(null);
            setSelectedDetail(null);
        }
    }, [visible, noteId, fetchHistories]);

    useEffect(() => {
        if (visible && noteId && selectedHistoryId) {
            fetchDetail(noteId, selectedHistoryId);
        }
    }, [visible, noteId, selectedHistoryId, fetchDetail]);

    const handleRollback = async () => {
        if (!noteId || !selectedHistoryId) return;
        setRollingBack(true);
        try {
            const res = await rollbackNoteHistory(noteId, selectedHistoryId);
            message.success('已成功还原至所选版本');
            if (onRollbackSuccess && res?.data?.note) {
                onRollbackSuccess(res.data.note);
            }
            onClose();
        } catch {
            message.error('版本恢复失败，请稍后重试');
        } finally {
            setRollingBack(false);
        }
    };

    return (
        <Modal
            title={
                <div className="version-history-modal-header">
                    <HistoryOutlined className="version-history-header-icon" />
                    <span>历史版本快照</span>
                    {currentNoteTitle && <span className="version-history-note-title">（{currentNoteTitle}）</span>}
                </div>
            }
            open={visible}
            onCancel={onClose}
            footer={null}
            width={980}
            centered
            className="cloud-notes-version-modal"
            destroyOnClose
        >
            <div className="version-history-container">
                <div className="version-history-sidebar">
                    <div className="version-history-list-title">版本时间线 ({histories.length})</div>
                    {loadingList ? (
                        <div className="version-history-loading">
                            <Spin size="small" tip="加载版本列表中..." />
                        </div>
                    ) : histories.length === 0 ? (
                        <div className="version-history-empty-list">
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无历史版本记录" />
                        </div>
                    ) : (
                        <div className="version-history-timeline-list">
                            {histories.map(item => {
                                const isSelected = item._id === selectedHistoryId;
                                return (
                                    <div
                                        key={item._id}
                                        className={`version-history-item ${isSelected ? 'is-selected' : ''}`}
                                        onClick={() => setSelectedHistoryId(item._id)}
                                    >
                                        <div className="version-item-top">
                                            <span className="version-item-time">{formatDateTime(item.createdAt)}</span>
                                            {renderSaveTypeTag(item.saveType)}
                                        </div>
                                        <div className="version-item-bottom">
                                            <span className="version-item-words">{item.wordCount || 0} 字</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="version-history-content-panel">
                    {loadingDetail ? (
                        <div className="version-history-loading">
                            <Spin tip="加载快照内容中..." />
                        </div>
                    ) : !selectedDetail ? (
                        <div className="version-history-empty-detail">
                            <Empty description="请从左侧选择要查看的历史版本" />
                        </div>
                    ) : (
                        <>
                            <div className="version-detail-toolbar">
                                <div className="version-detail-meta">
                                    <span className="version-detail-title">{selectedDetail.title || '无标题笔记'}</span>
                                    <span className="version-detail-time">{formatDateTime(selectedDetail.createdAt)}</span>
                                    {renderSaveTypeTag(selectedDetail.saveType)}
                                    <span className="version-detail-words">{selectedDetail.wordCount || 0} 字</span>
                                </div>
                                <div className="version-detail-actions">
                                    <div className="version-mode-toggle">
                                        <Button
                                            size="small"
                                            type={viewMode === 'preview' ? 'primary' : 'default'}
                                            onClick={() => setViewMode('preview')}
                                        >
                                            预览
                                        </Button>
                                        <Button
                                            size="small"
                                            type={viewMode === 'raw' ? 'primary' : 'default'}
                                            onClick={() => setViewMode('raw')}
                                        >
                                            Markdown
                                        </Button>
                                    </div>
                                    <Popconfirm
                                        title="恢复至此版本？"
                                        description="恢复后当前笔记内容将被此快照覆盖，并记录一条回滚版本。"
                                        okText="确定恢复"
                                        cancelText="取消"
                                        onConfirm={handleRollback}
                                    >
                                        <Button
                                            type="primary"
                                            danger
                                            icon={<RollbackOutlined />}
                                            loading={rollingBack}
                                        >
                                            还原此版本
                                        </Button>
                                    </Popconfirm>
                                </div>
                            </div>
                            <div className="version-detail-body">
                                {viewMode === 'preview' ? (
                                    <div className="version-preview-container markdown-body">
                                        <Viewer value={selectedDetail.content || ''} plugins={viewerPlugins} />
                                    </div>
                                ) : (
                                    <pre className="version-raw-content">
                                        {selectedDetail.content || '(空内容)'}
                                    </pre>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </Modal>
    );
};

export default VersionHistoryModal;
