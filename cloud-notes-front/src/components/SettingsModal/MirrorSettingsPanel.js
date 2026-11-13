import React, { useCallback, useEffect, useState } from 'react';
import { Button, Switch, Alert, Tag, Spin, message } from 'antd';
import {
    FolderOpenOutlined,
    FolderAddOutlined,
    SyncOutlined,
    ReloadOutlined,
    SafetyCertificateOutlined,
    DesktopOutlined,
    DisconnectOutlined,
    CheckCircleOutlined
} from '@ant-design/icons';
import { isDesktopMirrorSupported, runLocalMirrorSync } from '@/utils/mirrorSyncClient';

const formatSyncTime = value => {
    if (!value) return '尚未执行过镜像同步';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '尚未执行过镜像同步';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/**
 * 本地目录镜像设置与同步状态面板（Electron 桌面端独占，强制跳过端到端加密笔记）
 */
export default function MirrorSettingsPanel({ active = false }) {
    const desktopSupported = isDesktopMirrorSupported();
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [config, setConfig] = useState({
        enabled: false,
        autoSync: false,
        rootDir: '',
        rootExists: false,
        lastSyncAt: null,
        lastStats: null
    });

    const refreshConfig = useCallback(async () => {
        if (!desktopSupported) return;
        setLoading(true);
        try {
            const cfg = await window.electronAPI.mirror.getConfig();
            if (cfg) setConfig(cfg);
        } catch (err) {
            console.error('[MirrorSettingsPanel] Load config failed:', err);
        } finally {
            setLoading(false);
        }
    }, [desktopSupported]);

    useEffect(() => {
        if (active && desktopSupported) {
            refreshConfig();
        }
    }, [active, desktopSupported, refreshConfig]);

    const handleSelectDir = async () => {
        if (!desktopSupported) return;
        try {
            const res = await window.electronAPI.mirror.selectDir();
            if (res?.config) {
                setConfig(res.config);
            }
            if (!res?.canceled) {
                message.success('已绑定本地授权镜像目录');
            }
        } catch (err) {
            message.error(err?.message || '选择目录失败');
        }
    };

    const handleToggleConfig = async (field, value) => {
        if (!desktopSupported) return;
        try {
            const updated = await window.electronAPI.mirror.setConfig({ [field]: value });
            if (updated) setConfig(updated);
        } catch {
            message.error('保存镜像开关配置失败');
        }
    };

    const handleUnbindDir = async () => {
        if (!desktopSupported) return;
        try {
            const updated = await window.electronAPI.mirror.setConfig({
                enabled: false,
                autoSync: false,
                rootDir: ''
            });
            if (updated) setConfig(updated);
            message.info('已解除本地目录绑定（原目录内已生成文件保留）');
        } catch {
            message.error('解除绑定失败');
        }
    };

    const handleOpenDir = async () => {
        if (!desktopSupported) return;
        const res = await window.electronAPI.mirror.openDir();
        if (!res?.ok) {
            message.warning(res?.error || '无法打开本地目录');
        }
    };

    const handleRunSync = async (fullSync = false) => {
        if (!desktopSupported || syncing) return;
        setSyncing(true);
        try {
            const res = await runLocalMirrorSync({ fullSync });
            if (!res?.ok) {
                message.error(res?.error || '镜像同步失败');
                return;
            }
            if (res.config) {
                setConfig(res.config);
            } else {
                await refreshConfig();
            }
            const s = res.stats || {};
            message.success(
                `镜像同步完成：写入 ${s.written || 0} 篇、迁移 ${s.moved || 0} 篇、清理 ${s.removed || 0} 篇，已安全跳过加密笔记 ${s.skippedEncrypted || 0} 篇`
            );
        } catch (err) {
            console.error('[MirrorSettingsPanel] Sync failed:', err);
            message.error(err?.message || '镜像同步异常');
        } finally {
            setSyncing(false);
        }
    };

    if (!desktopSupported) {
        return (
            <div className="mirror-settings-panel">
                <div className="panel-section-title">本地目录单向镜像 (桌面端能力)</div>
                <Alert
                    type="info"
                    showIcon
                    icon={<DesktopOutlined />}
                    message="当前为 Web 浏览器环境"
                    description="受限于浏览器文件沙盒安全策略，本地目录树形 Markdown 镜像导出仅在 Cloud Notes 桌面客户端中提供。云端多端增量同步与离线 IndexedDB 缓存仍正常可用。"
                />
            </div>
        );
    }

    const lastStats = config.lastStats;

    return (
        <Spin spinning={loading}>
            <div className="mirror-settings-panel">
                <div className="panel-section-title">本地授权根目录</div>
                <div className="mirror-dir-card">
                    <div className="mirror-dir-info">
                        <div className="mirror-dir-label">
                            <FolderOpenOutlined />
                            <span>当前镜像文件夹</span>
                            {config.rootDir && (
                                <Tag color={config.rootExists ? 'success' : 'error'}>
                                    {config.rootExists ? '已就绪' : '目录不存在'}
                                </Tag>
                            )}
                        </div>
                        <div className="mirror-dir-path" title={config.rootDir || ''}>
                            {config.rootDir || '尚未选择本地目录（默认禁止写入任何未授权路径）'}
                        </div>
                    </div>

                    <div className="mirror-dir-actions">
                        <Button
                            type="primary"
                            size="small"
                            icon={<FolderAddOutlined />}
                            onClick={handleSelectDir}
                        >
                            {config.rootDir ? '更换目录' : '选择镜像目录'}
                        </Button>
                        {config.rootDir && (
                            <>
                                <Button
                                    size="small"
                                    icon={<FolderOpenOutlined />}
                                    disabled={!config.rootExists}
                                    onClick={handleOpenDir}
                                >
                                    打开目录
                                </Button>
                                <Button
                                    size="small"
                                    danger
                                    ghost
                                    icon={<DisconnectOutlined />}
                                    onClick={handleUnbindDir}
                                >
                                    解除绑定
                                </Button>
                            </>
                        )}
                    </div>
                </div>

                <div className="mirror-security-note">
                    <SafetyCertificateOutlined className="security-icon" />
                    <div className="security-text">
                        严格路径沙盒约束：仅在用户系统弹窗选定目录内按笔记本与文件夹结构写入 Markdown 文件；<strong>端到端加密笔记 (isEncrypted) 将强制跳过，绝不写入本地明文。</strong>
                    </div>
                </div>

                <div className="panel-divider" />

                <div className="panel-section-title">镜像策略与同步</div>
                <div className="switch-setting-row">
                    <div className="switch-setting-info">
                        <div className="setting-title">启用本地目录镜像备份</div>
                        <div className="setting-desc">开启后允许按增量游标将云端非加密笔记导出到本地 Markdown 文件树</div>
                    </div>
                    <Switch
                        checked={Boolean(config.enabled)}
                        disabled={!config.rootDir}
                        onChange={val => handleToggleConfig('enabled', val)}
                    />
                </div>

                <div className="switch-setting-row" style={{ marginTop: 12 }}>
                    <div className="switch-setting-info">
                        <div className="setting-title">笔记云同步后自动触发增量镜像</div>
                        <div className="setting-desc">编辑保存上云并防抖稳定后，静默增量刷新本地镜像文件夹</div>
                    </div>
                    <Switch
                        checked={Boolean(config.autoSync)}
                        disabled={!config.rootDir || !config.enabled}
                        onChange={val => handleToggleConfig('autoSync', val)}
                    />
                </div>

                <div className="mirror-sync-bar">
                    <div className="sync-meta">
                        <div className="sync-time">最近同步：{formatSyncTime(config.lastSyncAt)}</div>
                    </div>
                    <div className="sync-actions">
                        <Button
                            size="small"
                            icon={<ReloadOutlined />}
                            disabled={!config.rootDir || !config.rootExists || syncing}
                            onClick={() => handleRunSync(true)}
                        >
                            全量重建
                        </Button>
                        <Button
                            type="primary"
                            size="small"
                            icon={<SyncOutlined spin={syncing} />}
                            loading={syncing}
                            disabled={!config.rootDir || !config.rootExists}
                            onClick={() => handleRunSync(false)}
                        >
                            立即增量同步
                        </Button>
                    </div>
                </div>

                {lastStats && (
                    <div className="mirror-stats-grid">
                        <div className="mirror-stat-cell">
                            <span className="stat-label">写入/更新</span>
                            <span className="stat-value">{lastStats.written ?? 0}</span>
                        </div>
                        <div className="mirror-stat-cell">
                            <span className="stat-label">路径迁移</span>
                            <span className="stat-value">{lastStats.moved ?? 0}</span>
                        </div>
                        <div className="mirror-stat-cell">
                            <span className="stat-label">删除清理</span>
                            <span className="stat-value">{lastStats.removed ?? 0}</span>
                        </div>
                        <div className="mirror-stat-cell is-shield">
                            <span className="stat-label">跳过加密笔记</span>
                            <span className="stat-value">
                                <CheckCircleOutlined style={{ marginRight: 4, fontSize: 12 }} />
                                {lastStats.skippedEncrypted ?? 0}
                            </span>
                        </div>
                    </div>
                )}
            </div>
        </Spin>
    );
}
