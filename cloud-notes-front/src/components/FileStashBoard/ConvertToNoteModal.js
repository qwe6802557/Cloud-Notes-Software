import React, { useEffect, useState } from 'react';
import { Checkbox, Input, Modal, Select, message } from 'antd';
import { BookOutlined, FileAddOutlined, InfoCircleOutlined, LockOutlined } from '@ant-design/icons';
import { getNotebooks } from '@/api/notes';
import { convertQuickMemoToNote } from '@/api/quickNotes';
import { deriveNoteTitleFromMemo, getMemoId } from '@/utils/quickMemoHelper';

/**
 * 随心记一键转存为正式笔记轻确认弹窗
 */
export default function ConvertToNoteModal({
    open = false,
    memo = null,
    defaultNotebookId = null,
    onClose,
    onConverted
}) {
    const [notebooks, setNotebooks] = useState([]);
    const [loadingNotebooks, setLoadingNotebooks] = useState(false);
    const [notebookId, setNotebookId] = useState(undefined);
    const [title, setTitle] = useState('');
    const [openAfterSave, setOpenAfterSave] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!open || !memo) return undefined;
        let mounted = true;
        setTitle(deriveNoteTitleFromMemo(memo));
        setLoadingNotebooks(true);

        getNotebooks()
            .then(res => {
                if (!mounted) return;
                const list = res?.notebooks || [];
                setNotebooks(list);
                const availableNotebooks = list.filter(nb => !nb.isEncrypted);
                const preferred =
                    availableNotebooks.find(nb => (nb.id || nb._id) === defaultNotebookId) ||
                    availableNotebooks[0];
                setNotebookId(preferred ? (preferred.id || preferred._id) : undefined);
            })
            .catch(() => {
                if (mounted) message.error('加载笔记本列表失败');
            })
            .finally(() => {
                if (mounted) setLoadingNotebooks(false);
            });

        return () => {
            mounted = false;
        };
    }, [open, memo, defaultNotebookId]);

    const availableNotebooks = notebooks.filter(nb => !nb.isEncrypted);
    const selectedNotebook = notebooks.find(nb => (nb.id || nb._id) === notebookId);
    const canSubmit = Boolean(!loadingNotebooks && selectedNotebook && !selectedNotebook.isEncrypted);

    const handleSubmit = async () => {
        if (!memo || submitting || !canSubmit) return;
        const cleanTitle = title.trim() || deriveNoteTitleFromMemo(memo);
        setSubmitting(true);
        try {
            const res = await convertQuickMemoToNote(getMemoId(memo), {
                notebookId,
                title: cleanTitle
            });
            message.success('已成功转存为正式笔记（原随心记已保留）');
            onConverted?.(res, { openAfterSave });
            onClose?.();
        } catch (err) {
            message.error(err?.message || '转存为笔记失败');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal
            open={open}
            onCancel={submitting ? undefined : onClose}
            onOk={handleSubmit}
            okButtonProps={{ disabled: !canSubmit }}
            confirmLoading={submitting}
            okText="确认转存"
            cancelText="取消"
            centered
            destroyOnClose
            width={460}
            title={(
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <FileAddOutlined style={{ color: '#1890ff' }} />
                    <span>转存为正式笔记</span>
                </span>
            )}
        >
            <div className="convert-note-modal-body">
                <div className="convert-field-group">
                    <label className="convert-field-label">笔记标题</label>
                    <Input
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                        onPressEnter={handleSubmit}
                        placeholder="请输入笔记标题"
                        maxLength={100}
                        autoFocus
                        disabled={submitting}
                    />
                </div>

                <div className="convert-field-group">
                    <label className="convert-field-label">目标笔记本</label>
                    <Select
                        value={notebookId}
                        onChange={setNotebookId}
                        loading={loadingNotebooks}
                        disabled={submitting}
                        style={{ width: '100%' }}
                        placeholder={
                            !loadingNotebooks && availableNotebooks.length === 0
                                ? '暂无可用的普通笔记本'
                                : '默认落入首个可用笔记本'
                        }
                        options={notebooks.map(nb => ({
                            value: nb.id || nb._id,
                            disabled: Boolean(nb.isEncrypted),
                            label: (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                    {nb.isEncrypted ? (
                                        <LockOutlined style={{ color: '#94a3b8' }} />
                                    ) : (
                                        <BookOutlined style={{ color: '#1890ff' }} />
                                    )}
                                    <span>{nb.name}</span>
                                    {nb.isEncrypted && (
                                        <span style={{ fontSize: 12, color: '#94a3b8' }}>
                                            （加密笔记本不支持直接转存）
                                        </span>
                                    )}
                                </span>
                            )
                        }))}
                    />
                    {!loadingNotebooks && notebooks.length > 0 && availableNotebooks.length === 0 && (
                        <div style={{ marginTop: 6, fontSize: 12, color: '#dc2626' }}>
                            当前仅存在加密笔记本，请先创建普通笔记本后再转存。
                        </div>
                    )}
                </div>

                <div className="convert-hint-box">
                    <InfoCircleOutlined className="hint-icon" />
                    <span>
                        {memo?.attachment
                            ? '附件将安全拷贝至笔记资源目录（不随临时倒计时销毁），原随心记将保留并标记「已转存」。'
                            : '内容与链接将生成标准 Markdown 笔记，原随心记保留并标记「已转存」。'}
                    </span>
                </div>

                <Checkbox
                    checked={openAfterSave}
                    onChange={e => setOpenAfterSave(e.target.checked)}
                    disabled={submitting}
                >
                    转存后立即在编辑器中打开该笔记
                </Checkbox>
            </div>
        </Modal>
    );
}
