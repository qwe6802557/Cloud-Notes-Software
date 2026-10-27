import React, { useEffect, useState, useCallback } from 'react';
import './index.less';

/**
 * 桌面沉浸式顶栏 (DesktopTitleBar)
 * 仅在 Electron 环境下渲染，提供窗口拖拽、状态感知、版本更新胶囊与极简窗口生命周期控制。
 */
const DesktopTitleBar = ({
    activeNoteTitle = '',
    isDirty = false,
    updateInfo = null,
    downloadStatus = 'idle',
    downloadProgress = { percent: 0 },
    onOpenUpdateModal
}) => {
    const isElectron = Boolean(window.electronAPI?.isElectron);
    const [isMaximized, setIsMaximized] = useState(false);

    useEffect(() => {
        if (!isElectron || !window.electronAPI?.windowControl) return;

        window.electronAPI.windowControl.isMaximized().then(setIsMaximized).catch(() => {});
        const unsubscribe = window.electronAPI.windowControl.onMaximizedChange(setIsMaximized);

        return () => {
            unsubscribe?.();
        };
    }, [isElectron]);

    const handleMinimize = useCallback(() => {
        window.electronAPI?.windowControl?.minimize();
    }, []);

    const handleMaximize = useCallback(() => {
        window.electronAPI?.windowControl?.maximize();
    }, []);

    const handleClose = useCallback(() => {
        window.electronAPI?.windowControl?.close();
    }, []);

    if (!isElectron) {
        return null;
    }

    return (
        <header className="desktop-titlebar">
            <div className="titlebar-left">
                <svg className="titlebar-brand-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
                <span className="titlebar-brand-text">云笔记</span>
            </div>

            <div className="titlebar-center" onDoubleClick={handleMaximize}>
                {activeNoteTitle ? (
                    <div className="titlebar-note-info">
                        <span className="titlebar-note-title">{activeNoteTitle}</span>
                        {isDirty && <span className="titlebar-dirty-indicator" title="存在未同步变更" />}
                    </div>
                ) : (
                    <span className="titlebar-placeholder">Cloud Notes</span>
                )}

                {updateInfo?.hasUpdate && (
                    <button
                        type="button"
                        className={`titlebar-update-pill is-${downloadStatus}`}
                        onClick={e => {
                            e.stopPropagation();
                            onOpenUpdateModal?.();
                        }}
                        title="查看新版本更新详情"
                    >
                        <span className="update-pill-dot" />
                        <span className="update-pill-text">
                            {downloadStatus === 'downloading'
                                ? `${downloadProgress.percent}%`
                                : downloadStatus === 'downloaded'
                                ? '新版就绪'
                                : `新版 v${updateInfo.version}`}
                        </span>
                    </button>
                )}
            </div>

            <div className="titlebar-right">
                <button
                    type="button"
                    className="titlebar-btn titlebar-btn-min"
                    onClick={handleMinimize}
                    title="最小化"
                    aria-label="最小化"
                >
                    <svg viewBox="0 0 10 1" width="10" height="1">
                        <line x1="0" y1="0.5" x2="10" y2="0.5" stroke="currentColor" strokeWidth="1" />
                    </svg>
                </button>

                <button
                    type="button"
                    className="titlebar-btn titlebar-btn-max"
                    onClick={handleMaximize}
                    title={isMaximized ? '向下还原' : '最大化'}
                    aria-label={isMaximized ? '向下还原' : '最大化'}
                >
                    {isMaximized ? (
                        <svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1">
                            <rect x="2.5" y="0.5" width="7" height="7" rx="0.5" />
                            <polyline points="0.5,3.5 0.5,9.5 6.5,9.5" />
                        </svg>
                    ) : (
                        <svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1">
                            <rect x="0.5" y="0.5" width="9" height="9" rx="0.5" />
                        </svg>
                    )}
                </button>

                <button
                    type="button"
                    className="titlebar-btn titlebar-btn-close"
                    onClick={handleClose}
                    title="关闭"
                    aria-label="关闭"
                >
                    <svg viewBox="0 0 10 10" width="10" height="10" stroke="currentColor" strokeWidth="1.2">
                        <line x1="1" y1="1" x2="9" y2="9" />
                        <line x1="9" y1="1" x2="1" y2="9" />
                    </svg>
                </button>
            </div>
        </header>
    );
};

export default React.memo(DesktopTitleBar);
