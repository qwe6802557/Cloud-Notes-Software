import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Editor, Viewer } from '@bytemd/react';
import gfm from '@bytemd/plugin-gfm';
import highlight from '@bytemd/plugin-highlight';
import gemoji from '@bytemd/plugin-gemoji';
import mediumZoom from '@bytemd/plugin-medium-zoom';
import math from '@bytemd/plugin-math';
import mermaid from '@bytemd/plugin-mermaid';
import breaks from '@bytemd/plugin-breaks';
import { Empty, Spin, Button, Space, message, Tooltip } from 'antd';
import {
    EditOutlined,
    EyeOutlined,
    ColumnWidthOutlined,
    SaveOutlined,
    ShareAltOutlined,
    FileImageOutlined,
    DownloadOutlined
} from '@ant-design/icons';

// 引入所有中文语言文件
import zhHans from "bytemd/locales/zh_Hans.json";
import zhHansMermaid from "@bytemd/plugin-mermaid/locales/zh_Hans.json";
import zhHansGfm from "@bytemd/plugin-gfm/locales/zh_Hans.json";
import zhHansMath from "@bytemd/plugin-math/locales/zh_Hans.json";

import 'bytemd/dist/index.css';
import 'highlight.js/styles/github.css';
import 'katex/dist/katex.css';
import './index.less';
import { getNoteDetail } from '@/api/notes';

// 中文本地化
const locale = {
    ...zhHans
};

// 插件配置
const plugins = [
    gfm({
        locale: zhHansGfm,
    }), // GitHub
    highlight(), // 代码高亮
    gemoji(), // emoji支持
    mediumZoom(), // 图片缩放
    math({
        locale: zhHansMath,
    }), // 数学公式
    mermaid({
        locale: zhHansMermaid,
    }), // 流程图等
    breaks() // 换行符支持
];

const NoteEditor = ({ selectedNote, onSave, onDirtyChange, onSaveStateChange }) => {
    const [content, setContent] = useState('# 欢迎使用囧人云笔记\n\n请在左侧选择一个笔记本，然后选择或创建一个笔记开始编辑。');
    const [mode, setMode] = useState('split'); // 'edit', 'split', 'preview'
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [autoSaving, setAutoSaving] = useState(false);
    const [isDirty, setIsDirty] = useState(false);
    const [lastSavedAt, setLastSavedAt] = useState(null);
    const [saveError, setSaveError] = useState('');
    const [wordCount, setWordCount] = useState({ words: 0, lines: 0 });
    const autoSaveTimerRef = useRef(null);
    const lastSavedContentRef = useRef('');
    const loadingNoteRef = useRef(false);

    const updateWordCount = useCallback((text) => {
        const lines = text.split('\n').length;
        const words = text.trim().split(/\s+/).filter(Boolean).length;
        setWordCount({ words, lines });
    }, []);

    useEffect(() => {
        if (onDirtyChange) {
            onDirtyChange(isDirty);
        }
    }, [isDirty, onDirtyChange]);

    useEffect(() => {
        if (onSaveStateChange) {
            onSaveStateChange({ saving, autoSaving });
        }
    }, [autoSaving, onSaveStateChange, saving]);

    // 监听选中笔记变化，加载笔记内容
    useEffect(() => {
        let mounted = true;

        if (autoSaveTimerRef.current) {
            clearTimeout(autoSaveTimerRef.current);
        }

        if (selectedNote) {
            loadingNoteRef.current = true;
            setLoading(true);
            setSaveError('');

            getNoteDetail(selectedNote)
                .then(result => {
                    if (!mounted) {
                        return;
                    }

                    const noteContent = result?.note?.content || '';
                    setContent(noteContent);
                    updateWordCount(noteContent);
                    lastSavedContentRef.current = noteContent;
                    setLastSavedAt(result?.note?.updatedAt ? new Date(result.note.updatedAt) : null);
                    setIsDirty(false);
                })
                .catch(error => {
                    if (mounted) {
                        message.error('笔记加载失败');
                    }
                })
                .finally(() => {
                    if (mounted) {
                        loadingNoteRef.current = false;
                        setLoading(false);
                    }
                });
        } else {
            loadingNoteRef.current = false;
            setContent('# 欢迎使用囧人云笔记\n\n请在左侧选择一个笔记本，然后选择或创建一个笔记开始编辑。');
            updateWordCount('# 欢迎使用囧人云笔记\n\n请在左侧选择一个笔记本，然后选择或创建一个笔记开始编辑。');
            lastSavedContentRef.current = '';
            setIsDirty(false);
            setSaveError('');
            setLastSavedAt(null);
        }

        return () => {
            mounted = false;
        };
    }, [selectedNote, updateWordCount]);

    // 内容变更处理
    const handleChange = (value) => {
        setContent(value);
        updateWordCount(value);
        setSaveError('');
        if (!loadingNoteRef.current) {
            setIsDirty(value !== lastSavedContentRef.current);
        }
    };

    // 保存笔记
    const handleSave = useCallback(async (options = {}) => {
        if (!selectedNote) {
            if (!options.silent) {
                message.warning('请先选择一个笔记');
            }
            return;
        }

        if (!isDirty && content === lastSavedContentRef.current) {
            return;
        }

        if (saving || autoSaving) {
            return;
        }

        if (options.auto) {
            setAutoSaving(true);
        } else {
            setSaving(true);
        }

        try {
            if (onSave) {
                await onSave(selectedNote, content);
            }
            lastSavedContentRef.current = content;
            setLastSavedAt(new Date());
            setIsDirty(false);
            setSaveError('');

            if (!options.silent) {
                message.success('保存成功');
            }
        } catch (error) {
            setSaveError('保存失败');
            if (!options.silent) {
                message.error('保存失败，请稍后重试');
            }
            throw error;
        } finally {
            if (options.auto) {
                setAutoSaving(false);
            } else {
                setSaving(false);
            }
        }
    }, [autoSaving, content, isDirty, onSave, saving, selectedNote]);

    const handleRetrySave = () => {
        handleSave().catch(() => {});
    };

    // 编辑时隐藏工具
    const hideToolByEdit = () => {
        const tabElements = document.querySelectorAll('.bytemd-toolbar-tab');
        if (tabElements && tabElements.length > 0) {
            tabElements.forEach(element => {
                if (element.textContent === '编辑' || element.textContent === '预览') {
                    element.style.display = 'none';
                }
            });
        }

        // 隐藏整个左侧工具栏区域
        const toolbarLeft = document.querySelector('.bytemd-toolbar-left');
        if (toolbarLeft) {
            toolbarLeft.style.display = 'none';
        }
    }

    const saveStatusText = useMemo(() => {
        if (saveError) {
            return saveError;
        }
        if (saving) {
            return '正在保存...';
        }
        if (autoSaving) {
            return '正在自动保存...';
        }
        if (isDirty) {
            return '有未保存更改';
        }
        if (lastSavedAt) {
            return `已保存于 ${lastSavedAt.toLocaleTimeString()}`;
        }
        return '未选择笔记';
    }, [autoSaving, isDirty, lastSavedAt, saveError, saving]);

    // 渲染编辑器工具栏
    const renderToolbar = () => (
        <div className="editor-toolbar">
            <div className="editor-left-actions">
                <Space>
                    <Button
                        type={mode === 'edit' ? 'primary' : 'default'}
                        icon={<EditOutlined />}
                        onClick={() => setMode('edit')}
                    >
                        编辑
                    </Button>
                    <Button
                        type={mode === 'split' ? 'primary' : 'default'}
                        icon={<ColumnWidthOutlined />}
                        onClick={() => setMode('split')}
                    >
                        分屏
                    </Button>
                    <Button
                        type={mode === 'preview' ? 'primary' : 'default'}
                        icon={<EyeOutlined />}
                        onClick={() => setMode('preview')}
                    >
                        预览
                    </Button>
                </Space>

                <div className="word-count">
                    <Tooltip title="字数统计">
                        <span>
                          <span className="count-label">字数:</span> {wordCount.words} <span className="count-separator">|</span>
                          <span className="count-label">行数:</span> {wordCount.lines}
                        </span>
                    </Tooltip>
                </div>
            </div>

            <div className="editor-right-actions">
                <Space>
                    <Button
                        type="primary"
                        icon={<SaveOutlined />}
                        onClick={() => handleSave()}
                        loading={saving}
                        disabled={!selectedNote || !isDirty || loading || autoSaving}
                    >
                        保存
                    </Button>
                    <Button
                        icon={<ShareAltOutlined />}
                        disabled={!selectedNote}
                    >
                        分享
                    </Button>
                    <Button
                        icon={<FileImageOutlined />}
                        disabled={!selectedNote}
                    >
                        插入图片
                    </Button>
                    <Button
                        icon={<DownloadOutlined />}
                        disabled={!selectedNote}
                    >
                        导出
                    </Button>
                </Space>
            </div>
        </div>
    );

    // 监听mode变化
    useEffect(() => {
        if (mode === 'edit') {
            setTimeout(() => {
                hideToolByEdit();
            }, 50);
        }
    }, [mode]);
    // 自动保存
    useEffect(() => {
        if (!selectedNote || !isDirty || loading || saving || autoSaving) {
            return undefined;
        }

        autoSaveTimerRef.current = setTimeout(() => {
            handleSave({ auto: true, silent: true }).catch(() => {});
        }, 2000);

        return () => {
            if (autoSaveTimerRef.current) {
                clearTimeout(autoSaveTimerRef.current);
            }
        };
    }, [autoSaving, content, handleSave, isDirty, loading, saving, selectedNote]);

    // 刷新或关闭页面前提示未保存内容
    useEffect(() => {
        const handleBeforeUnload = event => {
            if (!isDirty) {
                return;
            }

            event.preventDefault();
            event.returnValue = '';
        };

        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, [isDirty]);

    // 如果没有选中笔记且非加载状态，显示空状态
    if (!selectedNote && !loading) {
        return (
            <div className="note-editor">
                {renderToolbar()}
                <div className="empty-state">
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description="请选择或创建一个笔记"
                    >
                        <Button type="primary">新建笔记</Button>
                    </Empty>
                </div>
            </div>
        );
    }

    return (
        <div className="note-editor">
            {renderToolbar()}

            <div className="editor-content">
                <Spin spinning={loading} tip="加载中...">
                    <div className={mode === 'edit' ? "editor-container editor-container-edit" : "editor-container"}>
                        {mode === 'edit' ? (
                            <Editor
                                value={content}
                                plugins={[...plugins]}
                                onChange={handleChange}
                                mode={'tab'}
                                locale={locale}
                            />
                        ) : mode === 'preview' ? (
                            <div className="preview-only">
                                <Viewer value={content} plugins={[...plugins]} />
                            </div>
                        ) : (
                            <Editor
                                value={content}
                                plugins={[...plugins]}
                                onChange={handleChange}
                                mode={'split'}
                                locale={locale}
                            />
                        )}
                    </div>
                </Spin>
            </div>

            <div className="editor-footer">
                <div className={`sync-info ${saveError ? 'sync-error' : ''}`}>
                    {saveStatusText}
                    {saveError && selectedNote && (
                        <Button type="link" size="small" onClick={handleRetrySave} disabled={saving || autoSaving}>
                            重试
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default NoteEditor;
