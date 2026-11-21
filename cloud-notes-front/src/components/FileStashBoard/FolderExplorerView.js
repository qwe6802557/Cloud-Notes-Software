import React, { useMemo } from 'react';
import { Button, Empty, Popconfirm, Tooltip } from 'antd';
import {
    ArrowLeftOutlined,
    CodeOutlined,
    CopyOutlined,
    DeleteOutlined,
    DownloadOutlined,
    EyeOutlined,
    FileAddOutlined,
    FileExcelOutlined,
    FileImageOutlined,
    FileOutlined,
    FilePdfOutlined,
    FileTextOutlined,
    FileWordOutlined,
    FileZipOutlined,
    FolderFilled,
    FolderOpenFilled,
    HomeOutlined,
    PlaySquareOutlined,
    RightOutlined,
    SaveOutlined
} from '@ant-design/icons';
import { resolveAssetUrl } from '@/utils/env';
import { formatBytes, getMemoId } from '@/utils/quickMemoHelper';
import CountdownBadge from './CountdownBadge';

const formatUploadDate = dateStr => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '';
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
 * 虚拟文件夹钻取视图：支持保留相对路径层级浏览、ZIP 打包下载、整目录转永久与删除
 */
export default function FolderExplorerView({
    items = [],
    currentPath = '',
    onPathChange,
    previewFileId = null,
    clockOffsetMs = 0,
    onExpired,
    onPreview,
    onDownload,
    onCopyLink,
    onPromoteItem,
    onConvertToNote,
    onDeleteItem,
    onDownloadFolder,
    onPromoteFolder,
    onDeleteFolder
}) {
    const viewData = useMemo(() => {
        const prefix = currentPath ? `${currentPath}/` : '';
        const folderMap = new Map();
        const directFiles = [];

        items.forEach(item => {
            const att = item?.attachment;
            if (!att) return;

            let relPath = (att.relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
            if (!relPath) {
                relPath = att.folderName
                    ? `${att.folderName}/${att.originalName || att.filename}`
                    : (att.originalName || att.filename || 'file');
            }

            if (prefix) {
                if (!relPath.startsWith(prefix)) return;
                relPath = relPath.slice(prefix.length);
            }

            if (relPath.includes('/')) {
                const subFolderName = relPath.split('/')[0];
                const fullSubFolderPath = currentPath ? `${currentPath}/${subFolderName}` : subFolderName;
                const folderGroupKey = `${item.storageType}:${fullSubFolderPath}`;

                if (!folderMap.has(folderGroupKey)) {
                    folderMap.set(folderGroupKey, {
                        key: folderGroupKey,
                        name: subFolderName,
                        fullPath: fullSubFolderPath,
                        topLevelFolder: fullSubFolderPath.split('/')[0],
                        storageType: item.storageType,
                        items: []
                    });
                }
                folderMap.get(folderGroupKey).items.push(item);
            } else {
                directFiles.push(item);
            }
        });

        const folders = Array.from(folderMap.values()).map(f => {
            const totalSize = f.items.reduce((acc, cur) => acc + (cur.attachment?.size || 0), 0);
            const earliestExpireAt = f.items.reduce((acc, cur) => {
                if (!cur.expireAt) return acc;
                if (!acc || new Date(cur.expireAt) < new Date(acc)) return cur.expireAt;
                return acc;
            }, null);
            const maxCreatedAt = f.items.reduce((acc, cur) => {
                if (!cur.createdAt) return acc;
                return !acc || new Date(cur.createdAt) > new Date(acc) ? cur.createdAt : acc;
            }, null);

            return {
                ...f,
                isFolder: true,
                fileCount: f.items.length,
                totalSize,
                expireAt: earliestExpireAt,
                createdAt: maxCreatedAt
            };
        });

        return { folders, files: directFiles };
    }, [items, currentPath]);

    const breadcrumbSegments = useMemo(() => {
        if (!currentPath) return [];
        const parts = currentPath.split('/');
        return parts.map((part, index) => ({
            name: part,
            path: parts.slice(0, index + 1).join('/')
        }));
    }, [currentPath]);

    const handleGoBack = () => {
        if (!currentPath) return;
        const parts = currentPath.split('/');
        parts.pop();
        onPathChange?.(parts.join('/'));
    };

    return (
        <div className="folder-explorer-view">
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
                            onClick={() => onPathChange?.('')}
                        >
                            <HomeOutlined className="bc-icon" />
                            根目录
                        </span>
                        {breadcrumbSegments.map((seg, idx) => (
                            <React.Fragment key={seg.path}>
                                <RightOutlined className="bc-separator" />
                                <span
                                    className={`breadcrumb-item ${idx === breadcrumbSegments.length - 1 ? 'is-active' : ''}`}
                                    onClick={() => onPathChange?.(seg.path)}
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
                        {viewData.folders.length > 0 && `${viewData.folders.length} 个目录 `}
                        {viewData.files.length} 个文件
                    </span>
                </div>
            </div>

            {viewData.folders.length === 0 && viewData.files.length === 0 ? (
                <div className="stash-empty-wrapper">
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={
                            currentPath
                                ? `目录「${currentPath}」下暂无文件`
                                : '暂无文件或文件夹，拖拽文件/文件夹至窗口即可上传'
                        }
                    />
                </div>
            ) : (
                <div className="stash-file-list">
                    {viewData.folders.map(folder => {
                        const isTemp = folder.storageType === 'temp';
                        return (
                            <div
                                key={folder.key}
                                className="file-card-item folder-card"
                                onDoubleClick={() => onPathChange?.(folder.fullPath)}
                            >
                                <div className="file-type-icon type-folder">
                                    <FolderFilled />
                                </div>

                                <div className="file-meta-content" onClick={() => onPathChange?.(folder.fullPath)}>
                                    <div className="file-name-row">
                                        <Tooltip title={`双击或点击进入「${folder.name}」`}>
                                            <span className="file-name-text folder-name-text">
                                                {folder.name}
                                            </span>
                                        </Tooltip>
                                        {isTemp ? (
                                            <CountdownBadge
                                                expireAt={folder.expireAt}
                                                clockOffsetMs={clockOffsetMs}
                                            />
                                        ) : (
                                            <span className="permanent-tag">永久目录</span>
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
                                        onClick={() => onPathChange?.(folder.fullPath)}
                                        className="action-icon-btn enter-btn"
                                    >
                                        <span className="btn-text">进入</span>
                                    </Button>

                                    <Tooltip title="打包为 ZIP 下载">
                                        <Button
                                            type="text"
                                            size="small"
                                            icon={<DownloadOutlined />}
                                            onClick={() => onDownloadFolder?.(folder)}
                                            className="action-icon-btn"
                                        >
                                            <span className="btn-text">打包</span>
                                        </Button>
                                    </Tooltip>

                                    {isTemp && (
                                        <Tooltip title="整目录转为永久">
                                            <Button
                                                type="text"
                                                size="small"
                                                icon={<SaveOutlined />}
                                                onClick={() => onPromoteFolder?.(folder)}
                                                className="action-icon-btn"
                                            >
                                                <span className="btn-text">转永久</span>
                                            </Button>
                                        </Tooltip>
                                    )}

                                    <Popconfirm
                                        title={`确定彻底删除目录「${folder.name}」及内部文件吗？`}
                                        okText="彻底删除"
                                        cancelText="取消"
                                        okType="danger"
                                        onConfirm={() => onDeleteFolder?.(folder)}
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

                    {viewData.files.map(item => {
                        const itemId = getMemoId(item);
                        const att = item.attachment;
                        const meta = getFileTypeMeta(att.originalName || att.filename, att.mimetype);
                        const isTemp = item.storageType === 'temp';
                        const isPreviewing = previewFileId === itemId;
                        const resolvedUrl = resolveAssetUrl(att.url);

                        return (
                            <div key={itemId} className={`file-card-item ${isPreviewing ? 'is-previewing' : ''}`}>
                                <div
                                    className={`file-type-icon ${meta.className}`}
                                    style={{ cursor: 'pointer' }}
                                    onClick={() => onPreview?.(item)}
                                >
                                    {meta.icon}
                                </div>

                                <div
                                    className="file-meta-content"
                                    style={{ cursor: 'pointer' }}
                                    onClick={() => onPreview?.(item)}
                                >
                                    <div className="file-name-row">
                                        <Tooltip title={att.originalName}>
                                            <span className="file-name-text">{att.originalName}</span>
                                        </Tooltip>
                                        {isTemp ? (
                                            <CountdownBadge
                                                expireAt={item.expireAt}
                                                clockOffsetMs={clockOffsetMs}
                                                onExpired={() => onExpired?.(itemId)}
                                            />
                                        ) : (
                                            <span className="permanent-tag">永久保存</span>
                                        )}
                                    </div>
                                    <div className="file-details-row">
                                        <span className="file-size">{formatBytes(att.size)}</span>
                                        <span className="file-time">{formatUploadDate(item.createdAt)}</span>
                                    </div>
                                </div>

                                <div className="file-actions-cluster">
                                    <Tooltip title={isPreviewing ? '关闭预览' : '快速预览'}>
                                        <Button
                                            type={isPreviewing ? 'primary' : 'text'}
                                            size="small"
                                            icon={<EyeOutlined />}
                                            onClick={() => onPreview?.(item)}
                                            className={`action-icon-btn ${isPreviewing ? 'is-active-eye' : ''}`}
                                        />
                                    </Tooltip>
                                    <Tooltip title="下载">
                                        <Button
                                            type="text"
                                            size="small"
                                            icon={<DownloadOutlined />}
                                            onClick={() => onDownload?.(item)}
                                            className="action-icon-btn"
                                        />
                                    </Tooltip>
                                    <Tooltip title="复制直链">
                                        <Button
                                            type="text"
                                            size="small"
                                            icon={<CopyOutlined />}
                                            onClick={() => onCopyLink?.(resolvedUrl, '附件直链已复制')}
                                            className="action-icon-btn"
                                        />
                                    </Tooltip>
                                    {isTemp && (
                                        <Tooltip title="转为永久">
                                            <Button
                                                type="text"
                                                size="small"
                                                icon={<SaveOutlined />}
                                                onClick={() => onPromoteItem?.(item)}
                                                className="action-icon-btn"
                                            />
                                        </Tooltip>
                                    )}
                                    <Tooltip title="转存为笔记">
                                        <Button
                                            type="text"
                                            size="small"
                                            icon={<FileAddOutlined />}
                                            onClick={() => onConvertToNote?.(item)}
                                            className="action-icon-btn"
                                        />
                                    </Tooltip>
                                    <Popconfirm
                                        title="确定彻底删除该文件吗？"
                                        okText="删除"
                                        cancelText="取消"
                                        okType="danger"
                                        onConfirm={() => onDeleteItem?.(item)}
                                    >
                                        <Tooltip title="删除">
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
            )}
        </div>
    );
}
