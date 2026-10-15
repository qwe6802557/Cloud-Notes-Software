import React, { useEffect, useState } from 'react';
import { Popover, Button } from 'antd';
import { SyncOutlined, CloudUploadOutlined, CheckCircleOutlined, DisconnectOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import syncManager from '@/utils/storage/syncManager';
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
        title: '内容已牢固保存在本地 IndexedDB，等待上传'
    },
    syncing: {
        text: '同步中',
        dotClass: 'dot-syncing',
        icon: <SyncOutlined spin style={{ color: '#2563eb' }} />,
        title: '正在增量推送到云端服务'
    },
    offline: {
        text: '离线保护',
        dotClass: 'dot-offline',
        icon: <DisconnectOutlined style={{ color: '#71717a' }} />,
        title: '网络未连接，已转入本地离线突变队列安全保护'
    },
    conflict: {
        text: '冲突已分叉',
        dotClass: 'dot-conflict',
        icon: <ExclamationCircleOutlined style={{ color: '#e11d48' }} />,
        title: '检测到云端存在并发修改，已自动安全分叉另存为副本'
    }
};

export default function SyncStatusPill() {
    const [syncState, setSyncState] = useState(() => syncManager.getSnapshot());
    const [popoverVisible, setPopoverVisible] = useState(false);

    useEffect(() => {
        const unsubscribe = syncManager.subscribe(snapshot => {
            setSyncState(snapshot);
        });
        return unsubscribe;
    }, []);

    const currentConfig = STATUS_CONFIG[syncState.status] || STATUS_CONFIG.synced;

    const formatTime = date => {
        if (!date) return '尚未同步';
        const d = new Date(date);
        const pad = n => String(n).padStart(2, '0');
        return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };

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
                        {syncState.isOnline ? '在线网络已就绪' : '离线状态 (断网自愈中)'}
                    </span>
                </div>
                <div className="status-row">
                    <span className="status-label">排队待传：</span>
                    <span className="status-val val-mono">
                        {syncState.queuedCount > 0 ? `${syncState.queuedCount} 条突变任务待发` : '无挂起任务'}
                    </span>
                </div>
                <div className="status-row">
                    <span className="status-label">最近同步：</span>
                    <span className="status-val val-mono">{formatTime(syncState.lastSyncedAt)}</span>
                </div>
                {syncState.lastConflictNote && (
                    <div className="conflict-alert">
                        <span className="conflict-tip">已生成安全副本：</span>
                        <span className="conflict-title" title={syncState.lastConflictNote.title}>
                            {syncState.lastConflictNote.title}
                        </span>
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
        <Popover
            content={popoverContent}
            trigger="click"
            open={popoverVisible}
            onOpenChange={setPopoverVisible}
            placement="bottomRight"
            overlayClassName="sync-status-popover-overlay"
        >
            <div className={`sync-status-pill pill-${syncState.status}`}>
                <span className={`status-dot ${currentConfig.dotClass}`} />
                <span className="status-text">{currentConfig.text}</span>
                {syncState.queuedCount > 0 && (
                    <span className="status-badge-count">{syncState.queuedCount}</span>
                )}
            </div>
        </Popover>
    );
}
