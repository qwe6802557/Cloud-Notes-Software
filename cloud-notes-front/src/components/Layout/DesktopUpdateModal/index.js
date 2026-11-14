import React, { useMemo } from 'react';
import { Modal, Progress } from 'antd';
import './index.less';

/**
 * 桌面端版本更新模态卡片 (DesktopUpdateModal)
 * 遵循 Stitch Design Taste：中性灰 Slate 底色、Whisper 边框、等宽版本与校验和标识，无 AI 浮夸霓虹。
 */
const DesktopUpdateModal = ({
    open = false,
    onClose,
    appInfo = null,
    updateInfo = null,
    downloadProgress = { percent: 0, speed: 0, transferred: 0, total: 0 },
    downloadStatus = 'idle', // 'idle' | 'downloading' | 'downloaded' | 'error'
    errorMessage = '',
    onStartDownload,
    onInstall
}) => {
    const isForce = Boolean(updateInfo?.forceUpdate || updateInfo?.isForce);

    const isPortablePackage = useMemo(() => {
        if (updateInfo?.packageKind) {
            return updateInfo.packageKind === 'portable';
        }
        const urlPath = String(updateInfo?.downloadUrl || '').split('?')[0].toLowerCase();
        return urlPath.endsWith('.zip');
    }, [updateInfo?.packageKind, updateInfo?.downloadUrl]);

    const currentVersionText = updateInfo?.currentVersion || appInfo?.version || '1.0.0';

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

    const shortChecksum = useMemo(() => {
        const h = String(updateInfo?.hash || '').trim();
        if (!h) return '';
        return h.length > 20 ? `${h.slice(0, 12)}...${h.slice(-8)}` : h;
    }, [updateInfo?.hash]);

    if (!updateInfo) return null;

    const canDismiss = !isForce && downloadStatus !== 'downloading';

    return (
        <Modal
            open={open}
            onCancel={canDismiss ? onClose : undefined}
            footer={null}
            width={500}
            centered
            closable={canDismiss}
            maskClosable={canDismiss}
            className="desktop-update-modal"
        >
            <div className="update-modal-header">
                <div className={`update-modal-badge ${isForce ? 'is-force' : ''}`}>
                    {isForce ? 'REQUIRED UPDATE' : 'NEW RELEASE'}
                </div>
                <h3 className="update-modal-title">{updateInfo.title || '发现新版本'}</h3>
                <div className="update-modal-meta">
                    <span className="version-chip">
                        v{currentVersionText} → <strong>v{updateInfo.version}</strong>
                    </span>
                    {updateInfo.buildNumber ? (
                        <span className="channel-chip">Build #{updateInfo.buildNumber}</span>
                    ) : null}
                    <span className="channel-chip">
                        {isPortablePackage ? 'Portable 便携版' : 'NSIS 安装版'}
                    </span>
                    {formattedSize && <span className="size-chip">{formattedSize}</span>}
                </div>
            </div>

            <div className="update-modal-content">
                {isForce && (
                    <div className="force-update-notice">
                        当前版本需要执行关键兼容性升级，完成更新后方可继续使用。
                    </div>
                )}

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

                {shortChecksum && (
                    <div className="checksum-meta-row">
                        <span className="checksum-label">SHA-256</span>
                        <span className="checksum-value" title={updateInfo.hash}>
                            {shortChecksum}
                        </span>
                    </div>
                )}

                {downloadStatus === 'downloading' && (
                    <div className="download-progress-wrap">
                        <div className="progress-info">
                            <span className="progress-percent">{downloadProgress.percent}%</span>
                            <span className="progress-speed">{formattedSpeed}</span>
                        </div>
                        <Progress
                            percent={downloadProgress.percent}
                            showInfo={false}
                            size="small"
                        />
                    </div>
                )}

                {downloadStatus === 'downloaded' && (
                    <div className="download-ready-hint">
                        <span className="ready-dot" />
                        <span>
                            {isPortablePackage
                                ? '便携更新包已完成校验，点击下方按钮将打开下载目录，退出本应用后解压覆盖即可完成升级。'
                                : '新版本安装包已校验并就绪，点击下方按钮将保存工作并退出启动安装向导。'}
                        </span>
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
                        {isPortablePackage ? '打开下载目录' : '立即重启并安装'}
                    </button>
                ) : downloadStatus === 'downloading' ? (
                    <button type="button" className="action-btn disabled-btn" disabled>
                        正在后台下载...
                    </button>
                ) : (
                    <>
                        {!isForce && (
                            <button type="button" className="action-btn secondary-btn" onClick={onClose}>
                                稍后提醒
                            </button>
                        )}
                        <button type="button" className="action-btn primary-btn" onClick={onStartDownload}>
                            {downloadStatus === 'error' ? '重试下载更新' : '后台下载更新'}
                        </button>
                    </>
                )}
            </div>
        </Modal>
    );
};

export default React.memo(DesktopUpdateModal);
