import React, { useEffect, useState } from 'react';
import { Modal, Button, Segmented, Alert, Spin, message } from 'antd';
import {
    ExclamationCircleOutlined,
    LockOutlined,
    CopyOutlined,
    CloudDownloadOutlined,
    CheckOutlined,
    ColumnWidthOutlined,
    MenuOutlined
} from '@ant-design/icons';
import DiffViewer from '../DiffViewer';
import syncManager from '@/utils/storage/syncManager';
import { decryptNoteInMemory } from '@/utils/noteCryptoHelper';
import { subscribeVaultLock } from '@/utils/cryptoVault';
import './index.less';

const formatTime = value => {
    if (!value) return '未知时间';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '未知时间';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/**
 * 显式版本冲突三向对比裁决弹窗（接入 DiffViewer，支持加密笔记内存解密预览）
 */
export default function ConflictResolveModal({
    open,
    noteId,
    conflict: conflictProp = null,
    onClose,
    onResolved
}) {
    const conflict = conflictProp || syncManager.getConflict(noteId);
    const targetNoteId = conflict?.noteId || noteId;

    const [layout, setLayout] = useState('split');
    const [decrypting, setDecrypting] = useState(false);
    const [submittingStrategy, setSubmittingStrategy] = useState('');
    const [localPreview, setLocalPreview] = useState({ title: '', content: '', locked: false });
    const [serverPreview, setServerPreview] = useState({ title: '', content: '', locked: false });
    const [vaultTick, setVaultTick] = useState(0);

    useEffect(() => {
        return subscribeVaultLock(() => {
            setVaultTick(v => v + 1);
        });
    }, []);

    useEffect(() => {
        if (!open || !conflict) return undefined;
        let cancelled = false;

        const hydrateDecryptedPreviews = async () => {
            setDecrypting(true);
            try {
                const [localRes, serverRes] = await Promise.all([
                    decryptNoteInMemory(conflict.localDraft),
                    decryptNoteInMemory(conflict.serverNote)
                ]);
                if (!cancelled) {
                    setLocalPreview(localRes);
                    setServerPreview(serverRes);
                }
            } finally {
                if (!cancelled) {
                    setDecrypting(false);
                }
            }
        };

        hydrateDecryptedPreviews();
        return () => {
            cancelled = true;
        };
    }, [open, conflict, vaultTick]);

    const handleResolve = async strategy => {
        if (!targetNoteId || !conflict || submittingStrategy) return;
        setSubmittingStrategy(strategy);
        try {
            const res = await syncManager.resolveConflict(targetNoteId, strategy, conflict.localDraft);
            if (!res?.success) {
                message.error('冲突裁决失败，请稍后重试');
                return;
            }

            if (strategy === 'fork_copy') {
                message.success(`已保留云端版本，本地内容另存为：${res.forkedNote?.title || '冲突副本'}`);
            } else if (strategy === 'use_server') {
                message.success('已采用云端最新版本覆盖本地草稿');
            } else {
                message.success('已使用本地版本强制覆盖云端');
            }

            onResolved?.(res);
            onClose?.();
        } catch (err) {
            console.error('[ConflictResolveModal] Resolve failed:', err);
            message.error('冲突裁决发生异常，内容仍保留在本地');
        } finally {
            setSubmittingStrategy('');
        }
    };

    const isLocked = Boolean(localPreview.locked || serverPreview.locked);
    const titleChanged = (localPreview.title || '') !== (serverPreview.title || '');

    return (
        <Modal
            open={open && Boolean(conflict)}
            onCancel={onClose}
            width={920}
            centered
            destroyOnClose
            footer={null}
            className="cloud-notes-conflict-modal"
            title={
                <div className="conflict-modal-header-title">
                    <ExclamationCircleOutlined className="conflict-title-icon" />
                    <span>同步版本冲突裁决</span>
                    {conflict?.isEncrypted && (
                        <span className="conflict-encrypted-badge">
                            <LockOutlined /> 端到端加密
                        </span>
                    )}
                </div>
            }
        >
            {conflict && (
                <div className="conflict-modal-body">
                    <div className="conflict-meta-bar">
                        <div className="conflict-version-cards">
                            <div className="version-meta-card server-card">
                                <span className="meta-tag">云端最新</span>
                                <span className="meta-version">v{conflict.serverNote?.contentVersion ?? '-'}</span>
                                <span className="meta-time">{formatTime(conflict.serverNote?.updatedAt)}</span>
                            </div>
                            <div className="version-meta-card local-card">
                                <span className="meta-tag">本地草稿</span>
                                <span className="meta-version">基于 v{conflict.expectedVersion ?? '-'}</span>
                                <span className="meta-time">{formatTime(conflict.localDraft?.updatedAt)}</span>
                            </div>
                        </div>

                        <Segmented
                            size="small"
                            value={layout}
                            onChange={setLayout}
                            options={[
                                { label: '分栏对比', value: 'split', icon: <ColumnWidthOutlined /> },
                                { label: '行内对比', value: 'unified', icon: <MenuOutlined /> }
                            ]}
                        />
                    </div>

                    {titleChanged && (
                        <div className="conflict-title-diff-bar">
                            <span className="title-diff-label">标题存在差异：</span>
                            <span className="title-diff-server" title={serverPreview.title}>
                                云端「{serverPreview.title || '无标题'}」
                            </span>
                            <span className="title-diff-sep">对比</span>
                            <span className="title-diff-local" title={localPreview.title}>
                                本地「{localPreview.title || '无标题'}」
                            </span>
                        </div>
                    )}

                    {isLocked && (
                        <Alert
                            type="warning"
                            showIcon
                            icon={<LockOutlined />}
                            className="conflict-lock-alert"
                            message="私密保险箱当前处于锁定状态"
                            description="已安全保护端到端加密密文。请在编辑器中输入 PIN 解锁保险箱后查看明文差异，或直接选择保留云端/本地密文版本。"
                        />
                    )}

                    <div className="conflict-diff-wrapper">
                        {decrypting ? (
                            <div className="conflict-decrypt-loading">
                                <Spin size="small" />
                                <span>正在内存解密对比快照...</span>
                            </div>
                        ) : (
                            <DiffViewer
                                oldValue={isLocked ? '' : serverPreview.content}
                                newValue={isLocked ? '' : localPreview.content}
                                oldTitle={`云端版本 (v${conflict.serverNote?.contentVersion ?? '-'})`}
                                newTitle={`本地草稿 (基于 v${conflict.expectedVersion ?? '-'})`}
                                layout={layout}
                            />
                        )}
                    </div>

                    <div className="conflict-modal-footer">
                        <span className="footer-hint">请选择保留策略，裁决完成后队列将继续自动同步</span>
                        <div className="footer-actions">
                            <Button
                                icon={<CopyOutlined />}
                                loading={submittingStrategy === 'fork_copy'}
                                disabled={Boolean(submittingStrategy)}
                                onClick={() => handleResolve('fork_copy')}
                            >
                                另存冲突副本
                            </Button>
                            <Button
                                icon={<CloudDownloadOutlined />}
                                loading={submittingStrategy === 'use_server'}
                                disabled={Boolean(submittingStrategy)}
                                onClick={() => handleResolve('use_server')}
                            >
                                采用云端版本
                            </Button>
                            <Button
                                type="primary"
                                icon={<CheckOutlined />}
                                loading={submittingStrategy === 'keep_local'}
                                disabled={Boolean(submittingStrategy)}
                                onClick={() => handleResolve('keep_local')}
                            >
                                保留本地覆盖
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </Modal>
    );
}
