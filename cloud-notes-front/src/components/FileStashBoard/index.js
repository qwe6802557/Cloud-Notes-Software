import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
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
    CloudUploadOutlined,
    FolderFilled,
    FolderOpenFilled,
    HomeOutlined,
    ArrowLeftOutlined,
    FolderAddOutlined,
    FileAddOutlined,
    RightOutlined
} from '@ant-design/icons';
import {
    getStashFiles,
    uploadStashFile,
    promoteStashFile,
    deleteStashFile,
    promoteStashFolder,
    deleteStashFolder,
    downloadStashFolder
} from '@/api/stash';
import './index.less';

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

/**
 * 递归读取 FileSystemDirectoryReader 下的所有条目（兼容 Chrome 分批返回）
 */
const readAllDirectoryEntries = async directoryReader => {
    const entries = [];
    const readBatch = () => {
        return new Promise((resolve, reject) => {
            directoryReader.readEntries(resolve, reject);
        });
    };

    let batch = await readBatch();
    while (batch && batch.length > 0) {
        entries.push(...batch);
        batch = await readBatch();
    }
    return entries;
};

/**
 * 递归遍历 FileSystemEntry
 */
const traverseEntry = async (entry, pathPrefix = '') => {
    const result = [];
    if (entry.isFile) {
        const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
        const relativePath = pathPrefix ? `${pathPrefix}/${file.name}` : file.name;
        result.push({
            file,
            relativePath,
            folderName: pathPrefix ? pathPrefix.split('/')[0] : ''
        });
    } else if (entry.isDirectory) {
        const dirReader = entry.createReader();
        const currentPath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;
        const entries = await readAllDirectoryEntries(dirReader);
        for (const child of entries) {
            const childFiles = await traverseEntry(child, currentPath);
            result.push(...childFiles);
        }
    }
    return result;
};

/**
 * 解析用户拖拽的所有条目（智能递归解构文件夹与文件）
 */
const parseDropItems = async dataTransfer => {
    const items = dataTransfer.items;
    const filesToUpload = [];

    if (items && items.length > 0 && items[0].webkitGetAsEntry) {
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file') {
                const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
                if (entry) {
                    const scanned = await traverseEntry(entry, '');
                    filesToUpload.push(...scanned);
                }
            }
        }
    } else if (dataTransfer.files && dataTransfer.files.length > 0) {
        for (let i = 0; i < dataTransfer.files.length; i++) {
            const f = dataTransfer.files[i];
            filesToUpload.push({
                file: f,
                relativePath: f.webkitRelativePath || f.name,
                folderName: f.webkitRelativePath && f.webkitRelativePath.includes('/') ? f.webkitRelativePath.split('/')[0] : ''
            });
        }
    }

    return filesToUpload;
};

const FileStashBoard = () => {
    const [currentTab, setCurrentTab] = useState('temp'); // 'temp' | 'permanent'
    const [files, setFiles] = useState([]);
    const [tempCount, setTempCount] = useState(0);
    const [permanentCount, setPermanentCount] = useState(0);
    const [loading, setLoading] = useState(false);

    // 虚拟目录导航层级状态
    const [currentPath, setCurrentPath] = useState(''); // '' 表示根目录，'Folder' 或 'Folder/Sub' 表示下钻路径

    // 上传状态
    const [uploading, setUploading] = useState(false);
    const [uploadPercent, setUploadPercent] = useState(0);
    const [uploadingFileName, setUploadingFileName] = useState('');
    const [uploadCompletedCount, setUploadCompletedCount] = useState(0);
    const [uploadTotalCount, setUploadTotalCount] = useState(0);

    // 拖拽高亮状态
    const [isDragOver, setIsDragOver] = useState(false);

    // 原生隐藏 input 引用
    const fileInputRef = useRef(null);
    const folderInputRef = useRef(null);

    // 切换 tab 时重置当前路径到根目录
    useEffect(() => {
        setCurrentPath('');
    }, [currentTab]);

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

    // 核心批量上传队列处理引擎 (3 并发控制 + 进度汇聚)
    const runUploadQueue = async (itemsList, storageType) => {
        if (!itemsList || itemsList.length === 0) return;

        // 容量与单文件校验
        const MAX_SINGLE_FILE_SIZE = 100 * 1024 * 1024; // 100MB
        const MAX_TOTAL_BATCH_SIZE = 500 * 1024 * 1024; // 500MB

        let totalSize = 0;
        for (const item of itemsList) {
            if (item.file.size > MAX_SINGLE_FILE_SIZE) {
                message.error(`文件【${item.file.name}】超出单文件 100MB 限制（当前: ${formatBytes(item.file.size)}）`);
                return;
            }
            totalSize += item.file.size;
        }

        if (totalSize > MAX_TOTAL_BATCH_SIZE) {
            message.error(`批量上传总容量超出 500MB 上限（当前: ${formatBytes(totalSize)}），请分批上传`);
            return;
        }

        setUploading(true);
        setUploadTotalCount(itemsList.length);
        setUploadCompletedCount(0);
        setUploadPercent(0);

        // 统一整批文件夹的 10 分钟到期时间
        const batchExpireAt = storageType === 'temp'
            ? new Date(Date.now() + 10 * 60 * 1000).toISOString()
            : null;

        const CONCURRENCY = 3;
        let currentIndex = 0;
        const finishedRef = { current: 0 };
        const fileLoadedMap = new Map();

        const handleProgress = (fileIdx, progressEvent) => {
            fileLoadedMap.set(fileIdx, progressEvent.loaded || 0);
            let totalLoaded = 0;
            fileLoadedMap.forEach(v => {
                totalLoaded += v;
            });
            const pct = totalSize > 0
                ? Math.round((totalLoaded * 100) / totalSize)
                : Math.round(((finishedRef.current) * 100) / itemsList.length);
            setUploadPercent(Math.min(99, pct));
        };

        const worker = async () => {
            while (currentIndex < itemsList.length) {
                const index = currentIndex++;
                const item = itemsList[index];
                const displayPath = item.relativePath || item.file.name;
                setUploadingFileName(displayPath);

                const formData = new FormData();
                formData.append('file', item.file);
                formData.append('originalName', item.file.name);
                formData.append('storageType', storageType);
                if (item.relativePath) {
                    formData.append('relativePath', item.relativePath);
                }
                if (item.folderName) {
                    formData.append('folderName', item.folderName);
                }
                if (batchExpireAt) {
                    formData.append('batchExpireAt', batchExpireAt);
                }

                try {
                    await uploadStashFile(formData, e => handleProgress(index, e));
                    finishedRef.current += 1;
                    setUploadCompletedCount(finishedRef.current);
                } catch (err) {
                    console.error(`上传失败: ${displayPath}`, err);
                }
            }
        };

        const workers = [];
        for (let i = 0; i < Math.min(CONCURRENCY, itemsList.length); i++) {
            workers.push(worker());
        }

        await Promise.all(workers);

        setUploadPercent(100);
        setTimeout(() => {
            setUploading(false);
            setUploadPercent(0);
            setUploadingFileName('');
        }, 500);

        if (itemsList.length === 1) {
            message.success(
                storageType === 'temp'
                    ? `【${itemsList[0].file.name}】已暂存（10分钟后自动删除）`
                    : `【${itemsList[0].file.name}】已永久保存`
            );
        } else {
            message.success(`批量上传完成：成功上传 ${finishedRef.current}/${itemsList.length} 个文件`);
        }

        fetchFiles();
    };

    // 拖拽放下处理
    const handleNativeDrop = async e => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);

        if (uploading) {
            message.warning('当前已有上传任务正在进行中，请稍候');
            return;
        }

        try {
            const items = await parseDropItems(e.dataTransfer);
            if (!items || items.length === 0) {
                message.warning('未检测到可上传的文件或文件夹内容');
                return;
            }

            // 如果当前在某个子目录下，且拖入的是散文件（无顶级文件夹），将其归入当前子目录
            if (currentPath) {
                items.forEach(it => {
                    if (!it.relativePath.startsWith(currentPath + '/')) {
                        it.relativePath = `${currentPath}/${it.relativePath}`;
                        it.folderName = currentPath.split('/')[0];
                    }
                });
            }

            await runUploadQueue(items, currentTab);
        } catch (err) {
            console.error('解析拖拽文件夹失败:', err);
            message.error('解析文件夹失败，请重试');
        }
    };

    // 文件选择框变更
    const handleFileInputChange = async e => {
        const selectedFiles = Array.from(e.target.files || []);
        e.target.value = '';
        if (selectedFiles.length === 0) return;

        const items = selectedFiles.map(file => ({
            file,
            relativePath: currentPath ? `${currentPath}/${file.name}` : file.name,
            folderName: currentPath ? currentPath.split('/')[0] : ''
        }));

        await runUploadQueue(items, currentTab);
    };

    // 文件夹选择框变更
    const handleFolderInputChange = async e => {
        const selectedFiles = Array.from(e.target.files || []);
        e.target.value = '';
        if (selectedFiles.length === 0) return;

        const items = selectedFiles.map(file => {
            const rawRel = file.webkitRelativePath || file.name;
            const fullRel = currentPath ? `${currentPath}/${rawRel}` : rawRel;
            const topFolder = fullRel.includes('/') ? fullRel.split('/')[0] : '';
            return {
                file,
                relativePath: fullRel,
                folderName: topFolder
            };
        });

        await runUploadQueue(items, currentTab);
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

    // 下载单文件
    const handleDownloadFile = file => {
        const link = document.createElement('a');
        link.href = file.url;
        link.download = file.originalName || file.filename;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // 单文件转永久
    const handlePromoteFile = async file => {
        try {
            await promoteStashFile(file._id || file.id);
            message.success(`【${file.originalName}】已转为永久保存文件`);
            fetchFiles();
        } catch {
            message.error('转为永久保存失败');
        }
    };

    // 删除单文件
    const handleDeleteFile = async file => {
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

    // 文件夹整包打包下载 (流式 ZIP)
    const handleDownloadFolder = async folder => {
        const hide = message.loading(`正在打包下载文件夹【${folder.name}】...`, 0);
        try {
            const res = await downloadStashFolder(folder.topLevelFolder, currentTab);
            hide();

            const blob = res?.data instanceof Blob
                ? res.data
                : (res instanceof Blob ? res : new Blob([res]));

            const blobUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = `${folder.name}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(blobUrl);
            message.success(`文件夹【${folder.name}】打包下载已启动`);
        } catch (err) {
            hide();
            message.error('打包下载文件夹失败，请稍后重试');
        }
    };

    // 文件夹整目录转永久
    const handlePromoteFolder = async folder => {
        try {
            await promoteStashFolder(folder.topLevelFolder);
            message.success(`文件夹【${folder.name}】及内部所有文件已全部转为永久保存`);
            fetchFiles();
        } catch {
            message.error('转为永久保存失败');
        }
    };

    // 文件夹整目录彻底删除
    const handleDeleteFolder = async folder => {
        try {
            await deleteStashFolder(folder.topLevelFolder, currentTab);
            message.success(`文件夹【${folder.name}】已彻底删除`);
            fetchFiles();
        } catch {
            message.error('删除文件夹失败');
        }
    };

    // 目录导航与回退
    const handleEnterFolder = folder => {
        setCurrentPath(folder.fullPath);
    };

    const handleGoBack = () => {
        if (!currentPath) return;
        const parts = currentPath.split('/');
        parts.pop();
        setCurrentPath(parts.join('/'));
    };

    const handleBreadcrumbClick = targetPath => {
        setCurrentPath(targetPath);
    };

    // 根据 currentPath 虚拟结构化当前视图中的目录与文件
    const viewData = useMemo(() => {
        const prefix = currentPath ? `${currentPath}/` : '';
        const folderMap = new Map();
        const directFiles = [];

        files.forEach(file => {
            let relPath = (file.relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
            if (!relPath) {
                if (file.folderName) {
                    relPath = `${file.folderName}/${file.originalName}`;
                } else {
                    relPath = file.originalName || file.filename;
                }
            }

            if (prefix) {
                if (!relPath.startsWith(prefix)) {
                    return;
                }
                relPath = relPath.slice(prefix.length);
            }

            if (relPath.includes('/')) {
                const subFolderName = relPath.split('/')[0];
                const fullSubFolderPath = currentPath ? `${currentPath}/${subFolderName}` : subFolderName;

                if (!folderMap.has(subFolderName)) {
                    folderMap.set(subFolderName, {
                        name: subFolderName,
                        fullPath: fullSubFolderPath,
                        topLevelFolder: fullSubFolderPath.split('/')[0],
                        files: []
                    });
                }
                folderMap.get(subFolderName).files.push(file);
            } else {
                directFiles.push(file);
            }
        });

        const folders = Array.from(folderMap.values()).map(f => {
            const totalSize = f.files.reduce((acc, cur) => acc + (cur.size || 0), 0);
            const minRemaining = f.files.reduce((acc, cur) => {
                if (cur.remainingSeconds == null) return acc;
                return acc == null ? cur.remainingSeconds : Math.min(acc, cur.remainingSeconds);
            }, null);
            const maxCreatedAt = f.files.reduce((acc, cur) => {
                if (!cur.createdAt) return acc;
                return !acc || new Date(cur.createdAt) > new Date(acc) ? cur.createdAt : acc;
            }, null);

            return {
                isFolder: true,
                name: f.name,
                fullPath: f.fullPath,
                topLevelFolder: f.topLevelFolder,
                fileCount: f.files.length,
                totalSize,
                remainingSeconds: minRemaining,
                createdAt: maxCreatedAt,
                files: f.files
            };
        });

        return {
            folders,
            files: directFiles
        };
    }, [files, currentPath]);

    // 面包屑分段
    const breadcrumbSegments = useMemo(() => {
        if (!currentPath) return [];
        const parts = currentPath.split('/');
        return parts.map((part, index) => ({
            name: part,
            path: parts.slice(0, index + 1).join('/')
        }));
    }, [currentPath]);

    return (
        <div className="file-stash-board">
            {/* 隐藏原生输入控件 */}
            <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                multiple
                onChange={handleFileInputChange}
            />
            <input
                type="file"
                ref={folderInputRef}
                style={{ display: 'none' }}
                webkitdirectory=""
                directory=""
                multiple
                onChange={handleFolderInputChange}
            />

            {/* 顶栏标题区 */}
            <div className="stash-header">
                <div className="header-left">
                    <h2 className="stash-title">
                        <CloudUploadOutlined className="title-icon" />
                        文件暂存
                    </h2>
                    <div className="stash-subtitle">
                        跨端即时互传中转站 · 支持完整多级文件夹 · 单文件 100MB · 文件夹上限 500MB
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
                        ? '⏱️ 临时文件与文件夹仅保留 10 分钟，到期自动物理销毁'
                        : '💾 永久文件与文件夹长期保存，支持跨端无限制下载与流式打包'}
                </div>
            </div>

            {/* 拖拽上传与双模式入口区域 */}
            <div className="upload-section">
                <div
                    className={`custom-dropzone ${isDragOver ? 'is-drag-over' : ''} ${uploading ? 'is-uploading' : ''}`}
                    onDragOver={e => {
                        e.preventDefault();
                        setIsDragOver(true);
                    }}
                    onDragEnter={e => {
                        e.preventDefault();
                        setIsDragOver(true);
                    }}
                    onDragLeave={e => {
                        e.preventDefault();
                        setIsDragOver(false);
                    }}
                    onDrop={handleNativeDrop}
                >
                    <div className="dropzone-content">
                        <div className="dropzone-icon-wrap">
                            <CloudUploadOutlined className="drop-icon" />
                        </div>
                        <p className="dropzone-title">
                            拖拽文件或文件夹至此处上传
                        </p>
                        <p className="dropzone-subtitle">
                            支持完整保留文件夹层级结构 · 存入【
                            <span className={currentTab === 'temp' ? 'highlight-temp' : 'highlight-type'}>
                                {currentTab === 'temp' ? '临时文件（10分钟后销毁）' : '永久文件'}
                            </span>
                            】
                        </p>

                        {/* 双操作入口按钮 */}
                        <div className="dropzone-actions" onClick={e => e.stopPropagation()}>
                            <Button
                                type="primary"
                                icon={<FileAddOutlined />}
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploading}
                                className="action-pick-btn"
                            >
                                上传文件
                            </Button>
                            <Button
                                icon={<FolderAddOutlined />}
                                onClick={() => folderInputRef.current?.click()}
                                disabled={uploading}
                                className="action-pick-btn"
                            >
                                上传文件夹
                            </Button>
                        </div>
                    </div>
                </div>

                {/* 综合上传进度条卡片 */}
                {uploading && (
                    <div className="upload-progress-card">
                        <div className="progress-info-col">
                            <div className="progress-status-row">
                                <span className="status-label">
                                    正在上传：{uploadCompletedCount} / {uploadTotalCount} 个文件
                                </span>
                                <span className="status-percent">{uploadPercent}%</span>
                            </div>
                            <span className="progress-filename" title={uploadingFileName}>
                                当前传输: {uploadingFileName}
                            </span>
                        </div>
                        <div className="progress-bar-wrap">
                            <Progress percent={uploadPercent} size="small" status="active" />
                        </div>
                    </div>
                )}
            </div>

            {/* 虚拟目录面包屑与导航栏 */}
            <div className="stash-nav-bar">
                <div className="nav-left">
                    {currentPath && (
                        <Button
                            size="small"
                            icon={<ArrowLeftOutlined />}
                            onClick={handleGoBack}
                            className="back-btn"
                        >
                            返回上一级
                        </Button>
                    )}
                    <div className="breadcrumbs-wrap">
                        <span
                            className={`breadcrumb-item ${!currentPath ? 'is-active' : ''}`}
                            onClick={() => handleBreadcrumbClick('')}
                        >
                            <HomeOutlined className="bc-icon" />
                            根目录
                        </span>
                        {breadcrumbSegments.map((seg, idx) => (
                            <React.Fragment key={seg.path}>
                                <RightOutlined className="bc-separator" />
                                <span
                                    className={`breadcrumb-item ${idx === breadcrumbSegments.length - 1 ? 'is-active' : ''}`}
                                    onClick={() => handleBreadcrumbClick(seg.path)}
                                >
                                    <FolderFilled className="bc-icon folder" />
                                    {seg.name}
                                </span>
                            </React.Fragment>
                        ))}
                    </div>
                </div>
                <div className="nav-right">
                    <span className="item-stats">
                        {viewData.folders.length > 0 && `${viewData.folders.length} 个文件夹 `}
                        {viewData.files.length} 个文件
                    </span>
                </div>
            </div>

            {/* 文件与文件夹卡片展示区 */}
            {loading && files.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 0' }}>
                    <Spin tip="正在读取暂存文件..." />
                </div>
            ) : viewData.folders.length > 0 || viewData.files.length > 0 ? (
                <div className="stash-file-list">
                    {/* 1. 文件夹列表 */}
                    {viewData.folders.map(folder => {
                        const isTemp = currentTab === 'temp';
                        const remaining = folder.remainingSeconds ?? 0;
                        const isUrgent = isTemp && remaining <= 60;

                        return (
                            <div
                                key={folder.fullPath}
                                className="file-card-item folder-card"
                                onDoubleClick={() => handleEnterFolder(folder)}
                            >
                                <div className="file-type-icon type-folder">
                                    <FolderFilled />
                                </div>

                                <div className="file-meta-content" onClick={() => handleEnterFolder(folder)}>
                                    <div className="file-name-row">
                                        <Tooltip title={`双击或点击「进入」查看目录内部（${folder.name}）`}>
                                            <span className="file-name-text folder-name-text">
                                                {folder.name}
                                            </span>
                                        </Tooltip>

                                        {isTemp ? (
                                            <span className={`countdown-badge ${isUrgent ? 'is-urgent' : ''}`}>
                                                <span className="pulse-dot" />
                                                剩余 {formatCountdown(remaining)}
                                            </span>
                                        ) : (
                                            <span className="permanent-tag">
                                                永久目录
                                            </span>
                                        )}
                                    </div>

                                    <div className="file-details-row">
                                        <span className="file-count-tag">{folder.fileCount} 个文件</span>
                                        <span className="file-size">{formatBytes(folder.totalSize)}</span>
                                        <span className="file-time">{formatUploadDate(folder.createdAt)}</span>
                                    </div>
                                </div>

                                <div className="file-actions-cluster">
                                    <Button
                                        type="primary"
                                        size="small"
                                        ghost
                                        icon={<FolderOpenFilled />}
                                        onClick={() => handleEnterFolder(folder)}
                                        className="action-icon-btn enter-btn"
                                    >
                                        进入
                                    </Button>

                                    <Tooltip title="一键将整文件夹打包为 ZIP 下载（保留目录层级）">
                                        <Button
                                            type="text"
                                            size="small"
                                            icon={<DownloadOutlined />}
                                            onClick={() => handleDownloadFolder(folder)}
                                            className="action-icon-btn"
                                        >
                                            打包下载
                                        </Button>
                                    </Tooltip>

                                    {isTemp && (
                                        <Tooltip title="将该文件夹内所有文件一键转为永久保存">
                                            <Button
                                                type="text"
                                                size="small"
                                                icon={<SaveOutlined />}
                                                onClick={() => handlePromoteFolder(folder)}
                                                className="action-icon-btn"
                                            >
                                                转永久
                                            </Button>
                                        </Tooltip>
                                    )}

                                    <Popconfirm
                                        title={`确定要彻底删除整目录【${folder.name}】及其内部所有文件吗？`}
                                        okText="彻底删除"
                                        cancelText="取消"
                                        okType="danger"
                                        onConfirm={() => handleDeleteFolder(folder)}
                                    >
                                        <Tooltip title="彻底删除整目录">
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

                    {/* 2. 单文件列表 */}
                    {viewData.files.map(file => {
                        const fileId = file._id || file.id;
                        const meta = getFileTypeMeta(file.originalName, file.mimetype);
                        const isTemp = file.storageType === 'temp';
                        const remaining = file.remainingSeconds ?? 0;
                        const isUrgent = isTemp && remaining <= 60;

                        return (
                            <div key={fileId} className="file-card-item">
                                <div className={`file-type-icon ${meta.className}`}>
                                    {meta.icon}
                                </div>

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

                                <div className="file-actions-cluster">
                                    <Tooltip title="直接下载">
                                        <Button
                                            type="text"
                                            size="small"
                                            icon={<DownloadOutlined />}
                                            onClick={() => handleDownloadFile(file)}
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
                                                onClick={() => handlePromoteFile(file)}
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
                                        onConfirm={() => handleDeleteFile(file)}
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
                                {currentPath
                                    ? `当前目录【${currentPath}】下暂无文件`
                                    : `暂无${currentTab === 'temp' ? '临时' : '永久'}暂存文件或文件夹，拖拽或点击上方按钮即可上传`}
                            </span>
                        }
                    />
                </div>
            )}
        </div>
    );
};

export default FileStashBoard;
