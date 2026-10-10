import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button, Tooltip, message, Spin } from 'antd';
import {
    CloseOutlined,
    FullscreenOutlined,
    FullscreenExitOutlined,
    DownloadOutlined,
    CopyOutlined,
    SaveOutlined,
    ZoomInOutlined,
    ZoomOutOutlined,
    RotateRightOutlined,
    ReloadOutlined,
    FileImageOutlined,
    PlaySquareOutlined,
    CustomerServiceOutlined,
    FilePdfOutlined,
    CodeOutlined,
    FileOutlined,
    CheckOutlined
} from '@ant-design/icons';
import './index.less';

/**
 * 格式化文件体积字节
 */
const formatBytes = (bytes = 0) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

/**
 * 依据后缀与 MIME 类型研判文件所属预览门类
 */
const getFileCategory = (filename = '', mimetype = '') => {
    const ext = filename.split('.').pop().toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext) || mimetype.startsWith('image/')) {
        return 'image';
    }
    if (['mp4', 'webm', 'mov', 'm4v', 'ogv'].includes(ext) || mimetype.startsWith('video/')) {
        return 'video';
    }
    if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(ext) || mimetype.startsWith('audio/')) {
        return 'audio';
    }
    if (ext === 'pdf' || mimetype.includes('pdf')) {
        return 'pdf';
    }
    if (
        ['txt', 'md', 'markdown', 'json', 'js', 'jsx', 'ts', 'tsx', 'html', 'css', 'less', 'scss', 'py', 'java', 'c', 'cpp', 'go', 'rs', 'sql', 'sh', 'yaml', 'yml', 'xml', 'log'].includes(ext) ||
        mimetype.startsWith('text/')
    ) {
        return 'text';
    }
    return 'unsupported';
};

const FilePreviewPanel = ({
    file,
    onClose,
    isFullScreen = false,
    onToggleFullScreen,
    onPromote
}) => {
    const [imageScale, setImageScale] = useState(1);
    const [imageRotate, setImageRotate] = useState(0);
    const [textContent, setTextContent] = useState('');
    const [textLoading, setTextLoading] = useState(false);
    const [textError, setTextError] = useState(false);
    const [codeCopied, setCodeCopied] = useState(false);

    const category = getFileCategory(file?.originalName, file?.mimetype);
    const imageContainerRef = useRef(null);

    // 监听键盘 Esc 退出全屏或关闭面板
    useEffect(() => {
        const handleKeyDown = e => {
            if (e.key === 'Escape') {
                if (isFullScreen && onToggleFullScreen) {
                    onToggleFullScreen();
                } else if (onClose) {
                    onClose();
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isFullScreen, onToggleFullScreen, onClose]);

    // 切换文件时重置图像缩放和旋转
    useEffect(() => {
        setImageScale(1);
        setImageRotate(0);
    }, [file?.url]);

    // 异步加载纯文本与代码内容
    useEffect(() => {
        if (category !== 'text' || !file?.url) {
            setTextContent('');
            setTextError(false);
            return;
        }

        let isMounted = true;
        setTextLoading(true);
        setTextError(false);

        fetch(file.url)
            .then(res => {
                if (!res.ok) throw new Error('网络响应异常');
                return res.text();
            })
            .then(text => {
                if (!isMounted) return;
                // 限制最大渲染长度（防止百万行卡死）
                const MAX_CHARS = 300000;
                if (text.length > MAX_CHARS) {
                    setTextContent(text.slice(0, MAX_CHARS) + '\n\n/* --- 文件过大，已截断前 30 万字符显示，请直接下载完整文件查看 --- */');
                } else {
                    setTextContent(text);
                }
            })
            .catch(() => {
                if (isMounted) setTextError(true);
            })
            .finally(() => {
                if (isMounted) setTextLoading(false);
            });

        return () => {
            isMounted = false;
        };
    }, [file?.url, category]);

    // 鼠标滚轮平滑缩放图片
    const handleImageWheel = useCallback(e => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.15 : -0.15;
        setImageScale(prev => Math.min(Math.max(0.2, prev + delta), 5));
    }, []);

    // 复制直链
    const handleCopyUrl = () => {
        if (!file?.url) return;
        if (navigator?.clipboard?.writeText) {
            navigator.clipboard.writeText(file.url).then(() => {
                message.success('直链已复制');
            });
        } else {
            const textArea = document.createElement('textarea');
            textArea.value = file.url;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            message.success('直链已复制');
        }
    };

    // 直接下载
    const handleDownload = () => {
        if (!file?.url) return;
        const link = document.createElement('a');
        link.href = file.url;
        link.download = file.originalName || file.filename;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // 复制代码内容
    const handleCopyCode = () => {
        if (!textContent) return;
        if (navigator?.clipboard?.writeText) {
            navigator.clipboard.writeText(textContent).then(() => {
                setCodeCopied(true);
                message.success('代码内容已复制');
                setTimeout(() => setCodeCopied(false), 2000);
            });
        }
    };

    if (!file) return null;

    const isTemp = file.storageType === 'temp';

    return (
        <aside className={`stash-preview-panel ${isFullScreen ? 'is-fullscreen' : ''}`}>
            {/* 顶栏控制条 */}
            <div className="panel-header">
                <div className="header-meta">
                    <span className="file-category-icon">
                        {category === 'image' && <FileImageOutlined />}
                        {category === 'video' && <PlaySquareOutlined />}
                        {category === 'audio' && <CustomerServiceOutlined />}
                        {category === 'pdf' && <FilePdfOutlined />}
                        {category === 'text' && <CodeOutlined />}
                        {category === 'unsupported' && <FileOutlined />}
                    </span>
                    <Tooltip title={file.originalName}>
                        <span className="header-filename">{file.originalName}</span>
                    </Tooltip>
                    <span className="header-size">{formatBytes(file.size)}</span>
                    <span className={`header-tag ${isTemp ? 'is-temp' : 'is-perm'}`}>
                        {isTemp ? '临时' : '永久'}
                    </span>
                </div>

                <div className="header-actions">
                    <Tooltip title="复制直链">
                        <Button
                            type="text"
                            size="small"
                            icon={<CopyOutlined />}
                            onClick={handleCopyUrl}
                            className="ctrl-btn"
                        />
                    </Tooltip>

                    <Tooltip title="直接下载">
                        <Button
                            type="text"
                            size="small"
                            icon={<DownloadOutlined />}
                            onClick={handleDownload}
                            className="ctrl-btn"
                        />
                    </Tooltip>

                    {isTemp && onPromote && (
                        <Tooltip title="转为永久保存">
                            <Button
                                type="text"
                                size="small"
                                icon={<SaveOutlined />}
                                onClick={() => onPromote(file)}
                                className="ctrl-btn"
                            />
                        </Tooltip>
                    )}

                    {onToggleFullScreen && (
                        <Tooltip title={isFullScreen ? '退出全屏 (Esc)' : '网页全屏'}>
                            <Button
                                type="text"
                                size="small"
                                icon={isFullScreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                                onClick={onToggleFullScreen}
                                className="ctrl-btn"
                            />
                        </Tooltip>
                    )}

                    <Tooltip title="关闭预览 (Esc)">
                        <Button
                            type="text"
                            size="small"
                            icon={<CloseOutlined />}
                            onClick={onClose}
                            className="ctrl-btn close-btn"
                        />
                    </Tooltip>
                </div>
            </div>

            {/* 内容视口区域 */}
            <div className="panel-viewport">
                {/* 1. 图片预览 */}
                {category === 'image' && (
                    <div
                        className="image-viewer-stage"
                        ref={imageContainerRef}
                        onWheel={handleImageWheel}
                    >
                        <div className="image-floating-toolbar">
                            <Tooltip title="放大 (+)">
                                <Button
                                    type="text"
                                    size="small"
                                    icon={<ZoomInOutlined />}
                                    onClick={() => setImageScale(s => Math.min(s + 0.25, 5))}
                                />
                            </Tooltip>
                            <span className="scale-indicator">{Math.round(imageScale * 100)}%</span>
                            <Tooltip title="缩小 (-)">
                                <Button
                                    type="text"
                                    size="small"
                                    icon={<ZoomOutOutlined />}
                                    onClick={() => setImageScale(s => Math.max(s - 0.25, 0.2))}
                                />
                            </Tooltip>
                            <Tooltip title="顺时针旋转 90°">
                                <Button
                                    type="text"
                                    size="small"
                                    icon={<RotateRightOutlined />}
                                    onClick={() => setImageRotate(r => (r + 90) % 360)}
                                />
                            </Tooltip>
                            <Tooltip title="还原初始比例">
                                <Button
                                    type="text"
                                    size="small"
                                    icon={<ReloadOutlined />}
                                    onClick={() => {
                                        setImageScale(1);
                                        setImageRotate(0);
                                    }}
                                />
                            </Tooltip>
                        </div>

                        <div className="image-canvas">
                            <img
                                src={file.url}
                                alt={file.originalName}
                                className="target-image"
                                style={{
                                    transform: `scale(${imageScale}) rotate(${imageRotate}deg)`
                                }}
                                draggable={false}
                            />
                        </div>
                    </div>
                )}

                {/* 2. 视频预览 */}
                {category === 'video' && (
                    <div className="video-viewer-stage">
                        <video
                            src={file.url}
                            controls
                            playsInline
                            className="target-video"
                        />
                    </div>
                )}

                {/* 3. 音频预览 */}
                {category === 'audio' && (
                    <div className="audio-viewer-stage">
                        <div className="audio-card">
                            <div className="audio-disc-icon">
                                <CustomerServiceOutlined />
                            </div>
                            <div className="audio-info">
                                <span className="audio-title">{file.originalName}</span>
                                <span className="audio-meta">
                                    {formatBytes(file.size)} · 音频流
                                </span>
                            </div>
                            <audio
                                src={file.url}
                                controls
                                className="target-audio"
                            />
                        </div>
                    </div>
                )}

                {/* 4. PDF 预览 */}
                {category === 'pdf' && (
                    <div className="pdf-viewer-stage">
                        <iframe
                            src={file.url}
                            title={file.originalName}
                            className="target-pdf-frame"
                        />
                    </div>
                )}

                {/* 5. 纯文本与代码预览 */}
                {category === 'text' && (
                    <div className="text-viewer-stage">
                        <div className="text-toolbar">
                            <span className="code-lang-tag">
                                {file.originalName.split('.').pop().toUpperCase() || 'TEXT'}
                            </span>
                            <Button
                                size="small"
                                type="text"
                                icon={codeCopied ? <CheckOutlined /> : <CopyOutlined />}
                                onClick={handleCopyCode}
                                className="copy-code-btn"
                            >
                                {codeCopied ? '已复制' : '复制代码'}
                            </Button>
                        </div>
                        <div className="text-content-wrapper">
                            {textLoading ? (
                                <div className="text-loading">
                                    <Spin tip="正在载入文本流..." />
                                </div>
                            ) : textError ? (
                                <div className="text-error">
                                    无法加载文本内容，请检查网络或直接下载查看
                                </div>
                            ) : (
                                <pre className="code-pre">
                                    <code>{textContent}</code>
                                </pre>
                            )}
                        </div>
                    </div>
                )}

                {/* 6. 不支持格式友好降级卡片 */}
                {category === 'unsupported' && (
                    <div className="unsupported-viewer-stage">
                        <div className="fallback-card">
                            <div className="fallback-icon">
                                <FileOutlined />
                            </div>
                            <h3 className="fallback-title">该格式暂不支持直接预览</h3>
                            <p className="fallback-desc">
                                当前文件为专用二进制或未受支持格式，可直接下载到本地后用对应客户端程序打开。
                            </p>
                            <div className="fallback-details">
                                <div className="detail-item">
                                    <span className="detail-label">文件名称：</span>
                                    <span className="detail-value">{file.originalName}</span>
                                </div>
                                <div className="detail-item">
                                    <span className="detail-label">文件体积：</span>
                                    <span className="detail-value">{formatBytes(file.size)}</span>
                                </div>
                                <div className="detail-item">
                                    <span className="detail-label">MIME 类型：</span>
                                    <span className="detail-value">{file.mimetype || 'application/octet-stream'}</span>
                                </div>
                            </div>
                            <div className="fallback-actions">
                                <Button
                                    type="primary"
                                    icon={<DownloadOutlined />}
                                    onClick={handleDownload}
                                    className="fallback-btn-primary"
                                >
                                    下载此文件
                                </Button>
                                <Button
                                    icon={<CopyOutlined />}
                                    onClick={handleCopyUrl}
                                    className="fallback-btn-secondary"
                                >
                                    复制直链
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </aside>
    );
};

export default FilePreviewPanel;
