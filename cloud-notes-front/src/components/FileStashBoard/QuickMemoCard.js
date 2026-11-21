import React, { useMemo } from 'react';
import { Button, Popconfirm, Tooltip } from 'antd';
import {
    CheckCircleOutlined,
    CodeOutlined,
    CopyOutlined,
    DeleteOutlined,
    DownloadOutlined,
    ExportOutlined,
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
    LinkOutlined,
    PlaySquareOutlined,
    PlusCircleOutlined,
    SaveOutlined
} from '@ant-design/icons';
import { resolveAssetUrl } from '@/utils/env';
import {
    extractSafeUrls,
    formatBytes,
    isMemoVisualImage,
    parseSafeHttpUrl,
    splitTextWithSafeLinks
} from '@/utils/quickMemoHelper';
import CountdownBadge from './CountdownBadge';

const formatClockTime = dateStr => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    const now = new Date();
    const isSameDay =
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate();
    if (isSameDay) {
        return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const getAttachmentTypeMeta = (filename = '', mimetype = '') => {
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
 * 随心记单条信息流卡片（支持纯文本、安全外链、图片缩略图、文件附件与存量旧暂存兼容）
 */
export default function QuickMemoCard({
    item,
    isPreviewing = false,
    clockOffsetMs = 0,
    onExpired,
    onPreview,
    onDownload,
    onCopyText,
    onCopyLink,
    onOpenLink,
    onExtend,
    onPromote,
    onConvertToNote,
    onOpenNote,
    onDelete,
    onOpenFolder,
    onContextMenu
}) {
    const itemId = item?._id || item?.id;
    const isTemp = item?.storageType === 'temp';
    const att = item?.attachment || null;
    const isImage = isMemoVisualImage(item);
    const attMeta = att ? getAttachmentTypeMeta(att.originalName || att.filename, att.mimetype) : null;
    const resolvedUrl = att?.url ? resolveAssetUrl(att.url) : '';

    const safeLinks = useMemo(() => {
        const rawList = Array.isArray(item?.links) && item.links.length > 0
            ? item.links
            : extractSafeUrls(item?.content || '');
        const seen = new Set();
        const valid = [];
        for (const entry of rawList) {
            const parsed = parseSafeHttpUrl(typeof entry === 'string' ? entry : entry?.url);
            if (parsed && !seen.has(parsed.url)) {
                seen.add(parsed.url);
                valid.push(parsed);
            }
        }
        return valid;
    }, [item?.links, item?.content]);

    const textSegments = useMemo(
        () => splitTextWithSafeLinks(item?.content || ''),
        [item?.content]
    );

    const primaryLink = safeLinks[0] || null;
    const hasTextContent = Boolean((item?.content || '').trim());

    return (
        <article
            className={`quick-memo-card ${isPreviewing ? 'is-previewing' : ''} ${isTemp ? 'is-temp-item' : 'is-perm-item'}`}
            onContextMenu={e => onContextMenu?.(e, item)}
        >
            <div className="memo-card-header">
                <div className="memo-meta-left">
                    <span className="memo-time-badge">{formatClockTime(item?.createdAt)}</span>
                    {isTemp ? (
                        <CountdownBadge
                            expireAt={item?.expireAt}
                            clockOffsetMs={clockOffsetMs}
                            onExpired={() => onExpired?.(itemId)}
                        />
                    ) : (
                        <span className="permanent-tag">永久</span>
                    )}
                    {item?.legacySource === 'stash' && (
                        <span className="legacy-tag">旧暂存</span>
                    )}
                    {att?.folderName && (
                        <button
                            type="button"
                            className="folder-origin-chip"
                            onClick={() => onOpenFolder?.(att.folderName)}
                            title={`在文件夹视图中查看「${att.folderName}」`}
                        >
                            <FolderFilled />
                            <span>{att.relativePath || att.folderName}</span>
                        </button>
                    )}
                    {item?.convertedNoteId && (
                        <button
                            type="button"
                            className="converted-note-chip"
                            onClick={() => onOpenNote?.(item.convertedNoteId)}
                            title="点击打开已转存的笔记"
                        >
                            <CheckCircleOutlined />
                            <span>已转存笔记</span>
                        </button>
                    )}
                </div>

                <div className="memo-actions-cluster">
                    {att ? (
                        <>
                            <Tooltip title={isPreviewing ? '关闭预览' : '预览'}>
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
                        </>
                    ) : (
                        <>
                            <Tooltip title="复制内容">
                                <Button
                                    type="text"
                                    size="small"
                                    icon={<CopyOutlined />}
                                    onClick={() => onCopyText?.(item?.content || '')}
                                    className="action-icon-btn"
                                />
                            </Tooltip>
                            {primaryLink && (
                                <Tooltip title="在浏览器打开链接">
                                    <Button
                                        type="text"
                                        size="small"
                                        icon={<ExportOutlined />}
                                        onClick={() => onOpenLink?.(primaryLink.url)}
                                        className="action-icon-btn"
                                    />
                                </Tooltip>
                            )}
                        </>
                    )}

                    {isTemp && (
                        <>
                            <Tooltip title="续期 +20 分钟">
                                <Button
                                    type="text"
                                    size="small"
                                    icon={<PlusCircleOutlined />}
                                    onClick={() => onExtend?.(item)}
                                    className="action-icon-btn"
                                />
                            </Tooltip>
                            <Tooltip title="转为永久保留">
                                <Button
                                    type="text"
                                    size="small"
                                    icon={<SaveOutlined />}
                                    onClick={() => onPromote?.(item)}
                                    className="action-icon-btn"
                                />
                            </Tooltip>
                        </>
                    )}

                    <Tooltip title={item?.convertedNoteId ? '再次转存为笔记' : '一键转存为笔记'}>
                        <Button
                            type="text"
                            size="small"
                            icon={<FileAddOutlined />}
                            onClick={() => onConvertToNote?.(item)}
                            className="action-icon-btn"
                        />
                    </Tooltip>

                    <Popconfirm
                        title="确定彻底删除该随心记吗？"
                        okText="删除"
                        cancelText="取消"
                        okType="danger"
                        onConfirm={() => onDelete?.(item)}
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

            <div className="memo-card-body">
                {hasTextContent && (
                    <div className="memo-text-content">
                        {textSegments.map((seg, idx) =>
                            seg.type === 'link' ? (
                                <a
                                    key={`${seg.href}-${idx}`}
                                    href={seg.href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="memo-inline-link"
                                    onClick={e => {
                                        e.stopPropagation();
                                    }}
                                >
                                    {seg.value}
                                </a>
                            ) : (
                                <React.Fragment key={idx}>{seg.value}</React.Fragment>
                            )
                        )}
                    </div>
                )}

                {!att && safeLinks.length > 0 && (
                    <div className="memo-links-stack">
                        {safeLinks.map(link => (
                            <div key={link.url} className="memo-link-card">
                                <div className="link-card-icon">
                                    <LinkOutlined />
                                </div>
                                <div className="link-card-info" onClick={() => onOpenLink?.(link.url)}>
                                    <div className="link-host">{link.host}</div>
                                    <div className="link-url" title={link.url}>{link.url}</div>
                                </div>
                                <div className="link-card-actions">
                                    <Tooltip title="复制链接">
                                        <Button
                                            type="text"
                                            size="small"
                                            icon={<CopyOutlined />}
                                            onClick={() => onCopyLink?.(link.url, '链接已复制')}
                                        />
                                    </Tooltip>
                                    <Tooltip title="打开链接">
                                        <Button
                                            type="text"
                                            size="small"
                                            icon={<ExportOutlined />}
                                            onClick={() => onOpenLink?.(link.url)}
                                        />
                                    </Tooltip>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {att && isImage && (
                    <div
                        className="memo-image-stage"
                        onClick={() => onPreview?.(item)}
                        title="点击查看大图预览"
                    >
                        <img
                            src={resolvedUrl}
                            alt={att.originalName || '图片'}
                            loading="lazy"
                            className="memo-image-thumb"
                        />
                        <div className="memo-image-meta">
                            <span className="image-name">{att.originalName}</span>
                            <span className="image-size">{formatBytes(att.size)}</span>
                        </div>
                    </div>
                )}

                {att && !isImage && (
                    <div className="memo-attachment-row" onClick={() => onPreview?.(item)}>
                        <div className={`file-type-icon ${attMeta?.className || 'type-other'}`}>
                            {attMeta?.icon || <FileOutlined />}
                        </div>
                        <div className="attachment-meta">
                            <div className="attachment-name" title={att.originalName}>
                                {att.originalName || att.filename}
                            </div>
                            <div className="attachment-sub">
                                <span className="attachment-size">{formatBytes(att.size)}</span>
                                {att.mimetype && <span className="attachment-mime">{att.mimetype}</span>}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </article>
    );
}
