import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Modal, Spin, Tag, Button, Empty, Popconfirm, Select, Radio, message } from 'antd';
import { HistoryOutlined, RollbackOutlined, CopyOutlined, DiffOutlined, EyeOutlined, CodeOutlined } from '@ant-design/icons';
import { Viewer } from '@bytemd/react';
import gfm from '@bytemd/plugin-gfm';
import highlight from '@bytemd/plugin-highlight';
import math from '@bytemd/plugin-math';
import mermaid from '@bytemd/plugin-mermaid';
import breaks from '@bytemd/plugin-breaks';
import { getNoteHistories, getNoteHistoryDetail, rollbackNoteHistory } from '@/api/notes';
import DiffViewer from './DiffViewer';
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

const VersionHistoryModal = ({
    visible,
    onClose,
    noteId,
    currentNoteTitle,
    currentContent = '',
    onRollbackSuccess
}) => {
    const [loadingList, setLoadingList] = useState(false);
    const [histories, setHistories] = useState([]);
    const [selectedHistoryId, setSelectedHistoryId] = useState(null);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [selectedDetail, setSelectedDetail] = useState(null);
    const [prevDetail, setPrevDetail] = useState(null);
    const [detailCache, setDetailCache] = useState({});
    const [rollingBack, setRollingBack] = useState(false);

    // 视图模式: 'diff' | 'preview' | 'raw'
    const [viewMode, setViewMode] = useState('diff');
    // 对比基准: 'current' (与当前工作区对比) | 'previous' (与上一快照对比)
    const [diffBase, setDiffBase] = useState('current');
    // Diff 布局: 'split' (并排) | 'unified' (单列)
    const [diffLayout, setDiffLayout] = useState('split');

    const fetchHistories = useCallback(async targetNoteId => {
        if (!targetNoteId) return;
        setLoadingList(true);
        try {
            const res = await getNoteHistories(targetNoteId);
            const list = res?.histories || res?.data?.histories || [];
            setHistories(list);
            if (list.length > 0) {
                setSelectedHistoryId(list[0]._id);
            } else {
                setSelectedHistoryId(null);
                setSelectedDetail(null);
                setPrevDetail(null);
            }
        } catch {
            message.error('获取历史版本列表失败');
        } finally {
            setLoadingList(false);
        }
    }, []);

    const fetchDetail = useCallback(async (targetNoteId, historyId) => {
        if (!targetNoteId || !historyId) return null;
        if (detailCache[historyId]) {
            return detailCache[historyId];
        }

        setLoadingDetail(true);
        try {
            const res = await getNoteHistoryDetail(targetNoteId, historyId);
            const detail = res?.history || res?.data?.history || null;
            if (detail) {
                setDetailCache(prev => ({ ...prev, [historyId]: detail }));
            }
            return detail;
        } catch {
            message.error('获取版本详情失败');
            return null;
        } finally {
            setLoadingDetail(false);
        }
    }, [detailCache]);

    useEffect(() => {
        if (visible && noteId) {
            fetchHistories(noteId);
        } else {
            setHistories([]);
            setSelectedHistoryId(null);
            setSelectedDetail(null);
            setPrevDetail(null);
            setDetailCache({});
        }
    }, [visible, noteId, fetchHistories]);

    useEffect(() => {
        if (visible && noteId && selectedHistoryId) {
            fetchDetail(noteId, selectedHistoryId).then(detail => {
                setSelectedDetail(detail);
            });
        }
    }, [visible, noteId, selectedHistoryId, fetchDetail]);

    // 计算上一快照内容
    useEffect(() => {
        if (diffBase !== 'previous' || !selectedHistoryId || histories.length === 0) {
            setPrevDetail(null);
            return;
        }

        const currentIndex = histories.findIndex(item => item._id === selectedHistoryId);
        if (currentIndex >= 0 && currentIndex + 1 < histories.length) {
            const prevItem = histories[currentIndex + 1];
            if (detailCache[prevItem._id]) {
                setPrevDetail(detailCache[prevItem._id]);
            } else {
                fetchDetail(noteId, prevItem._id).then(detail => {
                    setPrevDetail(detail);
                });
            }
        } else {
            setPrevDetail(null);
        }
    }, [diffBase, selectedHistoryId, histories, detailCache, noteId, fetchDetail]);

    const handleCopyContent = () => {
        if (!selectedDetail?.content) {
            message.warning('快照内容为空');
            return;
        }
        navigator.clipboard.writeText(selectedDetail.content);
        message.success('已复制快照内容至剪贴板');
    };

    const handleRollback = async () => {
        if (!noteId || !selectedHistoryId) return;
        setRollingBack(true);
        try {
            const res = await rollbackNoteHistory(noteId, selectedHistoryId);
            message.success('已成功还原至所选快照版本');
            const restoredNote = res?.note || res?.data?.note;
            if (onRollbackSuccess && restoredNote) {
                onRollbackSuccess(restoredNote);
            }
            onClose();
        } catch {
            message.error('版本恢复失败，请稍后重试');
        } finally {
            setRollingBack(false);
        }
    };

    const diffBaseInfo = useMemo(() => {
        if (diffBase === 'current') {
            return {
                text: currentContent || '',
                title: '当前工作区 (最新编辑态)'
            };
        }
        if (prevDetail) {
            return {
                text: prevDetail.content || '',
                title: `上一快照 (${formatDateTime(prevDetail.createdAt)})`
            };
        }
        return {
            text: '',
            title: '初始空白基准 (无更早快照)'
        };
    }, [diffBase, currentContent, prevDetail]);

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
            width={1120}
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
                    {loadingDetail && !selectedDetail ? (
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
                                            icon={<DiffOutlined />}
                                            type={viewMode === 'diff' ? 'primary' : 'default'}
                                            onClick={() => setViewMode('diff')}
                                        >
                                            差异对比
                                        </Button>
                                        <Button
                                            size="small"
                                            icon={<EyeOutlined />}
                                            type={viewMode === 'preview' ? 'primary' : 'default'}
                                            onClick={() => setViewMode('preview')}
                                        >
                                            预览
                                        </Button>
                                        <Button
                                            size="small"
                                            icon={<CodeOutlined />}
                                            type={viewMode === 'raw' ? 'primary' : 'default'}
                                            onClick={() => setViewMode('raw')}
                                        >
                                            源码
                                        </Button>
                                    </div>

                                    {viewMode === 'diff' && (
                                        <div className="version-diff-controls">
                                            <Select
                                                size="small"
                                                value={diffBase}
                                                onChange={setDiffBase}
                                                style={{ width: 145 }}
                                                options={[
                                                    { value: 'current', label: '基准: 当前工作区' },
                                                    { value: 'previous', label: '基准: 上一快照' }
                                                ]}
                                            />
                                            <Radio.Group
                                                size="small"
                                                value={diffLayout}
                                                onChange={e => setDiffLayout(e.target.value)}
                                            >
                                                <Radio.Button value="split">并排</Radio.Button>
                                                <Radio.Button value="unified">单列</Radio.Button>
                                            </Radio.Group>
                                        </div>
                                    )}

                                    <Button
                                        size="small"
                                        icon={<CopyOutlined />}
                                        onClick={handleCopyContent}
                                    >
                                        复制
                                    </Button>

                                    <Popconfirm
                                        title="恢复至此版本？"
                                        description="恢复前系统会自动备份当前工作区内容，防止误操作丢失。"
                                        okText="确定恢复"
                                        cancelText="取消"
                                        onConfirm={handleRollback}
                                    >
                                        <Button
                                            type="primary"
                                            danger
                                            size="small"
                                            icon={<RollbackOutlined />}
                                            loading={rollingBack}
                                        >
                                            还原此版本
                                        </Button>
                                    </Popconfirm>
                                </div>
                            </div>

                            <div className="version-detail-body">
                                {viewMode === 'diff' ? (
                                    <DiffViewer
                                        oldValue={diffBaseInfo.text}
                                        newValue={selectedDetail.content || ''}
                                        oldTitle={diffBaseInfo.title}
                                        newTitle={`所选快照 (${formatDateTime(selectedDetail.createdAt)})`}
                                        layout={diffLayout}
                                    />
                                ) : viewMode === 'preview' ? (
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
