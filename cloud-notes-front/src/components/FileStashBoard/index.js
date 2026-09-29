import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    Upload,
    Segmented,
    Button,
    message,
    Progress,
    Empty,
    Popconfirm,
    Tooltip,
    Spin
} from 'antd';
import {
    InboxOutlined,
    ReloadOutlined,
    DownloadOutlined,
    CopyOutlined,
    SaveOutlined,
    DeleteOutlined,
    FileImageOutlined,
    FileTextOutlined,
    FilePdfOutlined,
    FileExcelOutlined,
    FileWordOutlined,
    FileZipOutlined,
    PlaySquareOutlined,
    CodeOutlined,
    FileOutlined,
    CloudUploadOutlined
} from '@ant-design/icons';
import {
    getStashFiles,
    uploadStashFile,
    promoteStashFile,
    deleteStashFile
} from '@/api/stash';
import './index.less';

const { Dragger } = Upload;

const formatBytes = (bytes, decimals = 1) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

const formatCountdown = totalSeconds => {
    if (!totalSeconds || totalSeconds <= 0) return '00:00';
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const formatUploadDate = dateStr => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const getFileTypeMeta = (filename = '', mimetype = '') => {
    const ext = filename.split('.').pop().toLowerCase();

    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext) || mimetype.startsWith('image/')) {
        return { icon: <FileImageOutlined />, className: 'type-image' };
    }
    if (ext === 'pdf' || mimetype.includes('pdf')) {
        return { icon: <FilePdfOutlined />, className: 'type-doc' };
    }
    if (['doc', 'docx'].includes(ext) || mimetype.includes('word')) {
        return { icon: <FileWordOutlined />, className: 'type-doc' };
    }
    if (['xls', 'xlsx', 'csv'].includes(ext) || mimetype.includes('sheet') || mimetype.includes('excel')) {
        return { icon: <FileExcelOutlined />, className: 'type-doc' };
    }
    if (['txt', 'md', 'markdown'].includes(ext) || mimetype.startsWith('text/')) {
        return { icon: <FileTextOutlined />, className: 'type-doc' };
    }
    if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext) || mimetype.includes('zip') || mimetype.includes('compressed')) {
        return { icon: <FileZipOutlined />, className: 'type-archive' };
    }
    if (['mp4', 'mov', 'avi', 'mkv', 'webm', 'mp3', 'wav', 'flac'].includes(ext) || mimetype.startsWith('video/') || mimetype.startsWith('audio/')) {
        return { icon: <PlaySquareOutlined />, className: 'type-video' };
    }
    if (['js', 'jsx', 'ts', 'tsx', 'html', 'css', 'json', 'py', 'java', 'c', 'cpp', 'go', 'rs', 'sql', 'sh'].includes(ext)) {
        return { icon: <CodeOutlined />, className: 'type-code' };
    }
    return { icon: <FileOutlined />, className: 'type-other' };
};

const FileStashBoard = () => {
    const [currentTab, setCurrentTab] = useState('temp'); // 'temp' | 'permanent'
    const [files, setFiles] = useState([]);
    const [tempCount, setTempCount] = useState(0);
    const [permanentCount, setPermanentCount] = useState(0);
    const [loading, setLoading] = useState(false);

    // 上传状态
    const [uploading, setUploading] = useState(false);
    const [uploadPercent, setUploadPercent] = useState(0);
    const [uploadingFileName, setUploadingFileName] = useState('');

    const filesRef = useRef(files);
    filesRef.current = files;

    // 拉取暂存文件列表
    const fetchFiles = useCallback(async () => {
        try {
            setLoading(true);
            const res = await getStashFiles(currentTab);
            setFiles(res?.files || []);
            setTempCount(res?.tempCount ?? 0);
            setPermanentCount(res?.permanentCount ?? 0);
        } catch {
            message.error('加载暂存文件失败');
        } finally {
            setLoading(false);
        }
    }, [currentTab]);

    useEffect(() => {
        fetchFiles();
    }, [fetchFiles]);

    // 10 分钟倒计时秒级驱动引擎
    useEffect(() => {
        if (currentTab !== 'temp') return;

        const interval = setInterval(() => {
            setFiles(prevFiles => {
                let hasExpired = false;
                const nextFiles = prevFiles
                    .map(file => {
                        if (file.storageType !== 'temp') return file;
                        const nextSec = (file.remainingSeconds ?? 0) - 1;
                        if (nextSec <= 0) {
                            hasExpired = true;
                            return null;
                        }
                        return { ...file, remainingSeconds: nextSec };
                    })
                    .filter(Boolean);

                if (hasExpired) {
                    setTempCount(nextFiles.length);
                }
                return nextFiles;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [currentTab]);

    // 处理自定义上传
    const handleCustomUpload = async ({ file, onSuccess, onError }) => {
        // 单文件限制 100MB
        const MAX_SIZE = 100 * 1024 * 1024;
        if (file.size > MAX_SIZE) {
            message.error(`文件大小超出限制，单文件最大支持 100MB（当前: ${formatBytes(file.size)}）`);
            onError(new Error('File size exceeded'));
            return;
        }

        const formData = new FormData();
        formData.append('file', file);
        formData.append('storageType', currentTab);

        setUploading(true);
        setUploadingFileName(file.name);
        setUploadPercent(0);

        try {
            const res = await uploadStashFile(formData, progressEvent => {
                if (progressEvent.total) {
                    const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                    setUploadPercent(percent);
                }
            });

            message.success(
                currentTab === 'temp'
                    ? `【${file.name}】已暂存（10分钟后自动删除）`
                    : `【${file.name}】已永久保存`
            );
            onSuccess(res);
            fetchFiles();
        } catch {
            message.error('文件上传失败，请重试');
            onError(new Error('Upload failed'));
        } finally {
            setUploading(false);
            setUploadPercent(0);
            setUploadingFileName('');
        }
    };

    // 复制直链
    const handleCopyUrl = file => {
        if (!file.url) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(file.url).then(() => {
                message.success('文件直链已复制，可在手机浏览器或任意客户端直接打开');
            }).catch(() => {
                fallbackCopy(file.url);
            });
        } else {
            fallbackCopy(file.url);
        }
    };

    const fallbackCopy = text => {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        message.success('文件直链已复制');
    };

    // 下载文件
    const handleDownload = file => {
        const link = document.createElement('a');
        link.href = file.url;
        link.download = file.originalName || file.filename;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // 临时文件转永久
    const handlePromote = async file => {
        try {
            await promoteStashFile(file._id || file.id);
            message.success(`【${file.originalName}】已转为永久保存文件`);
            fetchFiles();
        } catch {
            message.error('转为永久保存失败');
        }
    };

    // 删除文件
    const handleDelete = async file => {
        try {
            await deleteStashFile(file._id || file.id);
            message.success('暂存文件已删除');
            setFiles(prev => prev.filter(f => (f._id || f.id) !== (file._id || file.id)));
            if (currentTab === 'temp') {
                setTempCount(prev => Math.max(0, prev - 1));
            } else {
                setPermanentCount(prev => Math.max(0, prev - 1));
            }
        } catch {
            message.error('删除文件失败');
        }
    };

    return (
        <div className="file-stash-board">
            {/* 顶栏标题区 */}
            <div className="stash-header">
                <div className="header-left">
                    <h2 className="stash-title">
                        <CloudUploadOutlined className="title-icon" />
                        文件暂存
                    </h2>
                    <div className="stash-subtitle">
                        跨端即时互传中转站 · 单文件上限 100MB · 临时文件 10 分钟自动销毁
                    </div>
                </div>
                <div className="header-right">
                    <Button
                        icon={<ReloadOutlined spin={loading} />}
                        onClick={fetchFiles}
                        className="refresh-btn"
                    >
                        刷新
                    </Button>
                </div>
            </div>

            {/* 分区切换行 */}
            <div className="stash-tabs-row">
                <Segmented
                    value={currentTab}
                    onChange={setCurrentTab}
                    options={[
                        {
                            value: 'temp',
                            label: (
                                <span className="tab-label">
                                    临时文件 (10分钟)
                                    <span className="badge-count is-temp">{tempCount}</span>
                                </span>
                            )
                        },
                        {
                            value: 'permanent',
                            label: (
                                <span className="tab-label">
                                    永久文件
                                    <span className="badge-count">{permanentCount}</span>
                                </span>
                            )
                        }
                    ]}
                />
                <div className="storage-hint">
                    {currentTab === 'temp'
                        ? '⏱️ 临时文件仅保留 10 分钟，到期自动物理销毁'
                        : '💾 永久文件长期保存，支持跨端无限制下载'}
                </div>
            </div>

            {/* 拖拽上传区域 */}
            <div className="upload-section">
                <Dragger
                    name="file"
                    multiple={false}
                    showUploadList={false}
                    customRequest={handleCustomUpload}
                    disabled={uploading}
                >
                    <p className="upload-icon">
                        <InboxOutlined />
                    </p>
                    <p className="upload-primary-text">
                        点击或拖拽文件至此处上传
                    </p>
                    <p className="upload-hint-text">
                        支持任意格式，单文件上限 100MB。当前上传将存入【
                        <span className={currentTab === 'temp' ? 'highlight-temp' : 'highlight-type'}>
                            {currentTab === 'temp' ? '临时文件（10分钟后自动删除）' : '永久文件'}
                        </span>
                        】
                    </p>
                </Dragger>

                {uploading && (
                    <div className="upload-progress-card">
                        <span className="progress-filename">{uploadingFileName}</span>
                        <div className="progress-bar-wrap">
                            <Progress percent={uploadPercent} size="small" status="active" />
                        </div>
                    </div>
                )}
            </div>

            {/* 文件卡片列表区 */}
            {loading && files.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 0' }}>
                    <Spin tip="正在读取暂存文件..." />
                </div>
            ) : files.length > 0 ? (
                <div className="stash-file-list">
                    {files.map(file => {
                        const fileId = file._id || file.id;
                        const meta = getFileTypeMeta(file.originalName, file.mimetype);
                        const isTemp = file.storageType === 'temp';
                        const remaining = file.remainingSeconds ?? 0;
                        const isUrgent = isTemp && remaining <= 60;

                        return (
                            <div key={fileId} className="file-card-item">
                                {/* 文件图标 */}
                                <div className={`file-type-icon ${meta.className}`}>
                                    {meta.icon}
                                </div>

                                {/* 文件元信息 */}
                                <div className="file-meta-content">
                                    <div className="file-name-row">
                                        <Tooltip title={file.originalName}>
                                            <span className="file-name-text">
                                                {file.originalName}
                                            </span>
                                        </Tooltip>

                                        {isTemp ? (
                                            <span className={`countdown-badge ${isUrgent ? 'is-urgent' : ''}`}>
                                                <span className="pulse-dot" />
                                                剩余 {formatCountdown(remaining)}
                                            </span>
                                        ) : (
                                            <span className="permanent-tag">
                                                永久保存
                                            </span>
                                        )}
                                    </div>

                                    <div className="file-details-row">
                                        <span className="file-size">{formatBytes(file.size)}</span>
                                        <span className="file-time">{formatUploadDate(file.createdAt)}</span>
                                    </div>
                                </div>

                                {/* 操作按钮集群 */}
                                <div className="file-actions-cluster">
                                    <Tooltip title="直接下载">
                                        <Button
                                            type="text"
                                            size="small"
                                            icon={<DownloadOutlined />}
                                            onClick={() => handleDownload(file)}
                                            className="action-icon-btn"
                                        >
                                            下载
                                        </Button>
                                    </Tooltip>

                                    <Tooltip title="复制直链（可发到手机或浏览器打开）">
                                        <Button
                                            type="text"
                                            size="small"
                                            icon={<CopyOutlined />}
                                            onClick={() => handleCopyUrl(file)}
                                            className="action-icon-btn"
                                        >
                                            复制链接
                                        </Button>
                                    </Tooltip>

                                    {isTemp && (
                                        <Tooltip title="转为永久保存（不再自动删除）">
                                            <Button
                                                type="text"
                                                size="small"
                                                icon={<SaveOutlined />}
                                                onClick={() => handlePromote(file)}
                                                className="action-icon-btn"
                                            >
                                                转永久
                                            </Button>
                                        </Tooltip>
                                    )}

                                    <Popconfirm
                                        title="确定要彻底删除该暂存文件吗？"
                                        okText="删除"
                                        cancelText="取消"
                                        okType="danger"
                                        onConfirm={() => handleDelete(file)}
                                    >
                                        <Tooltip title="删除文件">
                                            <Button
                                                type="text"
                                                size="small"
                                                icon={<DeleteOutlined />}
                                                className="action-icon-btn btn-danger"
                                            />
                                        </Tooltip>
                                    </Popconfirm>
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className="stash-empty-wrapper">
                    <Empty
                        description={
                            <span style={{ color: '#64748b' }}>
                                暂无{currentTab === 'temp' ? '临时' : '永久'}暂存文件，拖拽或点击上方区域即可上传
                            </span>
                        }
                    />
                </div>
            )}
        </div>
    );
};

export default FileStashBoard;
