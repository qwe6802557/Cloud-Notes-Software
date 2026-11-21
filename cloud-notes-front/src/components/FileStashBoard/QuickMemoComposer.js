import React from 'react';
import { Button, Tooltip } from 'antd';
import {
    ClockCircleOutlined,
    CloseOutlined,
    FileAddOutlined,
    FileOutlined,
    FolderAddOutlined,
    SaveOutlined,
    SendOutlined
} from '@ant-design/icons';
import { formatBytes, MAX_TEXT_MEMO_BYTES } from '@/utils/quickMemoHelper';

/**
 * 随心记吸底输入区：支持 Enter 发送 / Shift+Enter 换行、IME 防误触、Ctrl+V 待发附件胶囊、临时/永久切换
 */
export default function QuickMemoComposer({
    storageType = 'temp',
    onStorageTypeChange,
    text = '',
    onTextChange,
    pendingAttachments = [],
    onRemoveAttachment,
    onClearAttachments,
    onSend,
    onPickFiles,
    onPickFolder,
    onPasteFiles,
    uploading = false,
    sending = false,
    inputRef
}) {
    const textBytes = typeof Blob !== 'undefined'
        ? new Blob([text]).size
        : text.length;
    const isOverTextLimit = textBytes > MAX_TEXT_MEMO_BYTES;
    const canSend = (Boolean(text.trim()) || pendingAttachments.length > 0) && !isOverTextLimit && !uploading && !sending;

    const handleKeyDown = e => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent?.isComposing) {
            e.preventDefault();
            if (canSend) {
                onSend?.();
            }
        }
    };

    const handlePaste = e => {
        const items = Array.from(e.clipboardData?.items || []);
        const files = items
            .filter(it => it.kind === 'file')
            .map(it => it.getAsFile())
            .filter(Boolean);

        if (files.length > 0) {
            e.preventDefault();
            onPasteFiles?.(files);
        }
    };

    return (
        <div className="memo-composer-shell">
            {pendingAttachments.length > 0 && (
                <div className="pending-attachments-bar">
                    <div className="pending-capsules-list">
                        {pendingAttachments.map(att => (
                            <div key={att.uid} className="pending-attachment-capsule">
                                {att.isImage && att.previewUrl ? (
                                    <img src={att.previewUrl} alt={att.name} className="capsule-thumb" />
                                ) : (
                                    <span className="capsule-icon">
                                        <FileOutlined />
                                    </span>
                                )}
                                <span className="capsule-name" title={att.name}>
                                    {att.name}
                                </span>
                                <span className="capsule-size">{formatBytes(att.size)}</span>
                                <button
                                    type="button"
                                    className="capsule-remove-btn"
                                    onClick={() => onRemoveAttachment?.(att.uid)}
                                    title="移除附件"
                                    aria-label="移除附件"
                                >
                                    <CloseOutlined />
                                </button>
                            </div>
                        ))}
                    </div>
                    <button
                        type="button"
                        className="pending-clear-btn"
                        onClick={onClearAttachments}
                    >
                        清空 ({pendingAttachments.length})
                    </button>
                </div>
            )}

            <div className="composer-input-wrap">
                <textarea
                    ref={inputRef}
                    className="composer-textarea"
                    rows={2}
                    value={text}
                    onChange={e => onTextChange?.(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    placeholder="随手记文字、粘贴链接或 Ctrl+V 粘贴截图/文件（Enter 发送，Shift+Enter 换行）"
                    disabled={uploading}
                />
            </div>

            <div className="composer-toolbar">
                <div className="composer-left-controls">
                    <div className="ttl-mode-switch" role="radiogroup" aria-label="保存时长">
                        <button
                            type="button"
                            role="radio"
                            aria-checked={storageType === 'temp'}
                            className={`ttl-pill is-temp ${storageType === 'temp' ? 'is-active' : ''}`}
                            onClick={() => onStorageTypeChange?.('temp')}
                        >
                            <ClockCircleOutlined />
                            <span>临时 20分钟</span>
                        </button>
                        <button
                            type="button"
                            role="radio"
                            aria-checked={storageType === 'permanent'}
                            className={`ttl-pill is-perm ${storageType === 'permanent' ? 'is-active' : ''}`}
                            onClick={() => onStorageTypeChange?.('permanent')}
                        >
                            <SaveOutlined />
                            <span>永久保留</span>
                        </button>
                    </div>

                    <Tooltip title="选择文件上传">
                        <Button
                            type="text"
                            size="small"
                            icon={<FileAddOutlined />}
                            onClick={onPickFiles}
                            disabled={uploading}
                            className="composer-tool-btn"
                        >
                            文件
                        </Button>
                    </Tooltip>

                    <Tooltip title="上传完整文件夹">
                        <Button
                            type="text"
                            size="small"
                            icon={<FolderAddOutlined />}
                            onClick={onPickFolder}
                            disabled={uploading}
                            className="composer-tool-btn"
                        >
                            文件夹
                        </Button>
                    </Tooltip>
                </div>

                <div className="composer-right-controls">
                    {textBytes > 0 && (
                        <span className={`composer-byte-counter ${isOverTextLimit ? 'is-over' : ''}`}>
                            {formatBytes(textBytes)} / 50 KB
                        </span>
                    )}
                    <Button
                        type="primary"
                        size="small"
                        icon={<SendOutlined />}
                        disabled={!canSend}
                        loading={sending || uploading}
                        onClick={onSend}
                        className="composer-send-btn"
                    >
                        发送
                    </Button>
                </div>
            </div>
        </div>
    );
}
