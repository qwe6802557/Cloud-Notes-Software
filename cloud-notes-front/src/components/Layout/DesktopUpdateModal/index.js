import React, { useMemo } from 'react';
import { Modal, Progress } from 'antd';
import './index.less';

/**
 * 桌面端版本更新模态卡片 (DesktopUpdateModal)
 * 遵循 Stitch Design Taste：中性灰 Slate 底色、Whisper 边框、等宽版本标识，无 AI 浮夸霓虹。
 */
const DesktopUpdateModal = ({
    open = false,
    onClose,
    updateInfo = null,
    downloadProgress = { percent: 0, speed: 0, transferred: 0, total: 0 },
    downloadStatus = 'idle', // 'idle' | 'downloading' | 'downloaded' | 'error'
    errorMessage = '',
    onStartDownload,
    onInstall
}) => {
    const formattedSize = useMemo(() => {
        const bytes = updateInfo?.size || downloadProgress?.total || 0;
        if (!bytes) return '';
        const mb = bytes / (1024 * 1024);
        return `${mb.toFixed(1)} MB`;
    }, [updateInfo?.size, downloadProgress?.total]);

    const formattedSpeed = useMemo(() => {
        const bps = downloadProgress?.speed || 0;
        if (bps < 1024 * 1024) {
            return `${(bps / 1024).toFixed(0)} KB/s`;
        }
        return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
    }, [downloadProgress?.speed]);

    if (!updateInfo) return null;

    return (
        <Modal
            open={open}
            onCancel={downloadStatus === 'downloading' ? undefined : onClose}
            footer={null}
            width={480}
            centered
            closable={downloadStatus !== 'downloading'}
            className="desktop-update-modal"
        >
            <div className="update-modal-header">
                <div className="update-modal-badge">NEW RELEASE</div>
                <h3 className="update-modal-title">{updateInfo.title || '发现新版本'}</h3>
                <div className="update-modal-meta">
                    <span className="version-chip">
                        v{updateInfo.currentVersion || '0.1.0'} → <strong>v{updateInfo.version}</strong>
                    </span>
                    {formattedSize && <span className="size-chip">{formattedSize}</span>}
                </div>
            </div>

            <div className="update-modal-content">
                <div className="changelog-label">更新日志</div>
                <div className="changelog-body">
                    {updateInfo.changelog ? (
                        updateInfo.changelog.split('\n').map((line, idx) => (
                            <p key={idx} className="changelog-line">
                                {line}
                            </p>
                        ))
                    ) : (
                        <p className="changelog-line">日常系统优化与稳定性提升。</p>
                    )}
                </div>

                {downloadStatus === 'downloading' && (
                    <div className="download-progress-wrap">
                        <div className="progress-info">
                            <span className="progress-percent">{downloadProgress.percent}%</span>
                            <span className="progress-speed">{formattedSpeed}</span>
                        </div>
                        <Progress
                            percent={downloadProgress.percent}
                            showInfo={false}
                            strokeColor="#0f172a"
                            trailColor="#e2e8f0"
                            size="small"
                        />
                    </div>
                )}

                {downloadStatus === 'downloaded' && (
                    <div className="download-ready-hint">
                        <span className="ready-dot" />
                        新版本安装包已校验并就绪，点击下方按钮将保存当前工作并完成更新。
                    </div>
                )}

                {downloadStatus === 'error' && (
                    <div className="download-error-hint">
                        {errorMessage || '下载过程发生异常，请重试'}
                    </div>
                )}
            </div>

            <div className="update-modal-footer">
                {downloadStatus === 'downloaded' ? (
                    <button type="button" className="action-btn primary-btn" onClick={onInstall}>
                        立即重启并安装
                    </button>
                ) : downloadStatus === 'downloading' ? (
                    <button type="button" className="action-btn disabled-btn" disabled>
                        正在后台下载...
                    </button>
                ) : (
                    <>
                        <button type="button" className="action-btn secondary-btn" onClick={onClose}>
                            稍后提醒
                        </button>
                        <button type="button" className="action-btn primary-btn" onClick={onStartDownload}>
                            后台下载更新
                        </button>
                    </>
                )}
            </div>
        </Modal>
    );
};

export default React.memo(DesktopUpdateModal);
