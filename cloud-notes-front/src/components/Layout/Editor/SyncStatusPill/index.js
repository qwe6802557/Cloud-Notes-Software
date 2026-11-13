import React, { useEffect, useState } from 'react';
import { Popover, Button } from 'antd';
import {
    SyncOutlined,
    CloudUploadOutlined,
    CheckCircleOutlined,
    DisconnectOutlined,
    ExclamationCircleOutlined,
    RightOutlined
} from '@ant-design/icons';
import syncManager from '@/utils/storage/syncManager';
import ConflictResolveModal from '../ConflictResolveModal';
import './index.less';

const STATUS_CONFIG = {
    synced: {
        text: '已同步',
        dotClass: 'dot-synced',
        icon: <CheckCircleOutlined style={{ color: '#059669' }} />,
        title: '所有更改已实时同步至云端'
    },
    pending: {
        text: '待同步',
        dotClass: 'dot-pending',
        icon: <CloudUploadOutlined style={{ color: '#d97706' }} />,
        title: '内容已保存在本地缓存，等待推送上云'
    },
    syncing: {
        text: '同步中',
        dotClass: 'dot-syncing',
        icon: <SyncOutlined spin style={{ color: '#1890ff' }} />,
        title: '正在增量推送至云端服务'
    },
    offline: {
        text: '离线保护',
        dotClass: 'dot-offline',
        icon: <DisconnectOutlined style={{ color: '#64748b' }} />,
        title: '网络未连接，变更已安全记录至本地离线队列'
    },
    conflict: {
        text: '待裁决冲突',
        dotClass: 'dot-conflict',
        icon: <ExclamationCircleOutlined style={{ color: '#dc2626' }} />,
        title: '检测到云端版本存在冲突，请打开对比面板选择保留策略'
    }
};

export default function SyncStatusPill({ onOpenConflict }) {
    const [syncState, setSyncState] = useState(() => syncManager.getSnapshot());
    const [popoverVisible, setPopoverVisible] = useState(false);
    const [resolvingNoteId, setResolvingNoteId] = useState(null);

    useEffect(() => {
        const unsubscribe = syncManager.subscribe(snapshot => {
            setSyncState(snapshot);
        });
        return unsubscribe;
    }, []);

    const effectiveStatus = syncState.conflictCount > 0 ? 'conflict' : syncState.status;
    const currentConfig = STATUS_CONFIG[effectiveStatus] || STATUS_CONFIG.synced;
    const badgeCount = effectiveStatus === 'conflict'
        ? syncState.conflictCount
        : syncState.queuedCount;

    const formatTime = date => {
        if (!date) return '尚未同步';
        const d = new Date(date);
        const pad = n => String(n).padStart(2, '0');
        return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };

    const handleSelectConflict = noteId => {
        setPopoverVisible(false);
        if (typeof onOpenConflict === 'function') {
            onOpenConflict(noteId);
        } else {
            setResolvingNoteId(noteId);
        }
    };

    const conflictList = Array.isArray(syncState.conflicts) ? syncState.conflicts : [];

    const popoverContent = (
        <div className="sync-status-popover">
            <div className="popover-header">
                <span className="popover-title">本地优先存储引擎</span>
                <span className="popover-engine-tag">IndexedDB</span>
            </div>
            <div className="popover-body">
                <div className="status-row">
                    <span className="status-label">当前网络：</span>
                    <span className={`status-val ${syncState.isOnline ? 'val-online' : 'val-offline'}`}>
                        {syncState.isOnline ? '在线网络已就绪' : '离线模式 (断网自愈中)'}
                    </span>
                </div>
                <div className="status-row">
                    <span className="status-label">排队待传：</span>
                    <span className="status-val val-mono">
                        {syncState.queuedCount > 0 ? `${syncState.queuedCount} 条变更待同步` : '无挂起任务'}
                    </span>
                </div>
                <div className="status-row">
                    <span className="status-label">最近同步：</span>
                    <span className="status-val val-mono">{formatTime(syncState.lastSyncedAt)}</span>
                </div>

                {conflictList.length > 0 && (
                    <div className="conflict-list-box">
                        <div className="conflict-list-header">
                            <ExclamationCircleOutlined />
                            <span>存在 {conflictList.length} 篇版本冲突待裁决</span>
                        </div>
                        <div className="conflict-list-items">
                            {conflictList.map(item => (
                                <button
                                    key={item.noteId}
                                    type="button"
                                    className="conflict-list-item"
                                    onClick={() => handleSelectConflict(item.noteId)}
                                >
                                    <span className="conflict-item-title" title={item.title}>
                                        {item.title || '无标题笔记'}
                                    </span>
                                    <span className="conflict-item-action">
                                        裁决 <RightOutlined />
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>
            <div className="popover-footer">
                <Button
                    size="small"
                    type="primary"
                    ghost
                    icon={<SyncOutlined />}
                    onClick={() => {
                        syncManager.retryManual();
                    }}
                    loading={syncState.status === 'syncing'}
                >
                    立即同步
                </Button>
            </div>
        </div>
    );

    return (
        <>
            <Popover
                content={popoverContent}
                trigger="click"
                open={popoverVisible}
                onOpenChange={setPopoverVisible}
                placement="bottomRight"
                overlayClassName="sync-status-popover-overlay"
            >
                <div
                    className={`sync-status-pill pill-${effectiveStatus}`}
                    title={currentConfig.title}
                >
                    <span className={`status-dot ${currentConfig.dotClass}`} />
                    <span className="status-text">{currentConfig.text}</span>
                    {badgeCount > 0 && (
                        <span className={`status-badge-count ${effectiveStatus === 'conflict' ? 'badge-conflict' : ''}`}>
                            {badgeCount}
                        </span>
                    )}
                </div>
            </Popover>

            <ConflictResolveModal
                open={Boolean(resolvingNoteId)}
                noteId={resolvingNoteId}
                onClose={() => setResolvingNoteId(null)}
            />
        </>
    );
}
