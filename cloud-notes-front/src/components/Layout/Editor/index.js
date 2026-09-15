import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Editor, Viewer } from '@bytemd/react';
import gfm from '@bytemd/plugin-gfm';
import highlight from '@bytemd/plugin-highlight';
import gemoji from '@bytemd/plugin-gemoji';
import mediumZoom from '@bytemd/plugin-medium-zoom';
import math from '@bytemd/plugin-math';
import mermaid from '@bytemd/plugin-mermaid';
import breaks from '@bytemd/plugin-breaks';
import { Empty, Spin, Button, Space, message, Tooltip, Dropdown } from 'antd';
import {
    EditOutlined,
    EyeOutlined,
    ColumnWidthOutlined,
    SaveOutlined,
    ShareAltOutlined,
    FileImageOutlined,
    DownloadOutlined
} from '@ant-design/icons';

import zhHans from 'bytemd/locales/zh_Hans.json';
import zhHansMermaid from '@bytemd/plugin-mermaid/locales/zh_Hans.json';
import zhHansGfm from '@bytemd/plugin-gfm/locales/zh_Hans.json';
import zhHansMath from '@bytemd/plugin-math/locales/zh_Hans.json';

import 'bytemd/dist/index.css';
import 'highlight.js/styles/github.css';
import 'katex/dist/katex.css';
import './index.less';
import { getNoteDetail } from '@/api/notes';
import { uploadNoteImage } from '@/api/upload';
import { getEditorPreferences } from '@/utils/preferences';

const locale = {
    ...zhHans
};

const basePlugins = [
    gfm({
        locale: zhHansGfm
    }),
    highlight(),
    gemoji(),
    mediumZoom(),
    math({
        locale: zhHansMath
    }),
    mermaid({
        locale: zhHansMermaid
    }),
    breaks()
];

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const createImageMarkdown = ({ url, alt, title }) => {
    const safeAlt = alt || 'image';
    const safeTitle = title ? ` "${title}"` : '';

    return `![${safeAlt}](${url}${safeTitle})`;
};

const createUploadPlaceholder = (fileName, token) => {
    return `[[图片上传中:${fileName}:${token}]]`;
};

const createMarkdownFileName = title => {
    const safeTitle = (title || '未命名笔记')
        .split('')
        .map(char => {
            const code = char.charCodeAt(0);
            const invalidChars = '<>:"/\\|?*';

            if (invalidChars.includes(char) || code <= 31) {
                return '-';
            }

            return char;
        })
        .join('')
        .replace(/\s+/g, ' ')
        .trim();

    return `${safeTitle || '未命名笔记'}.md`;
};

const createHtmlFileName = title => {
    return createMarkdownFileName(title).replace(/\.md$/i, '.html');
};

const createExportHtmlDocument = ({ title, bodyHtml }) => {
    const documentTitle = title || '未命名笔记';

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${documentTitle}</title>
  <style>
    body {
      margin: 0;
      padding: 40px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #1f1f1f;
      background: #ffffff;
      line-height: 1.75;
    }
    .markdown-body {
      max-width: 900px;
      margin: 0 auto;
      font-size: 16px;
    }
    .markdown-body img {
      max-width: 100%;
      height: auto;
    }
    .markdown-body pre {
      overflow: auto;
      padding: 16px;
      background: #f6f8fa;
      border-radius: 8px;
    }
    .markdown-body code {
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    }
    .markdown-body table {
      border-collapse: collapse;
      width: 100%;
    }
    .markdown-body th,
    .markdown-body td {
      border: 1px solid #d0d7de;
      padding: 8px 12px;
    }
    .markdown-body blockquote {
      margin: 0;
      padding-left: 16px;
      color: #57606a;
      border-left: 4px solid #d0d7de;
    }
  </style>
</head>
<body>
  <article class="markdown-body">
    ${bodyHtml}
  </article>
</body>
</html>`;
};

const getFileExtension = fileName => {
    const extension = fileName ? fileName.slice(fileName.lastIndexOf('.')).toLowerCase() : '';

    return extension.startsWith('.') ? extension : '';
};

const sniffImageTypeFromMagicNumber = async file => {
    const headerBuffer = await file.slice(0, 16).arrayBuffer();
    const bytes = new Uint8Array(headerBuffer);

    if (
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47
    ) {
        return {
            mime: 'image/png',
            extension: '.png'
        };
    }

    if (
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[2] === 0xff
    ) {
        return {
            mime: 'image/jpeg',
            extension: '.jpg'
        };
    }

    if (
        bytes[0] === 0x47 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x38
    ) {
        return {
            mime: 'image/gif',
            extension: '.gif'
        };
    }

    if (
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
    ) {
        return {
            mime: 'image/webp',
            extension: '.webp'
        };
    }

    return null;
};

const normalizeImageFileByDetectedType = (file, detectedType) => {
    const currentExtension = getFileExtension(file.name || '');
    const normalizedName = currentExtension
        ? file.name
        : `${file.name || `image-${Date.now()}`}${detectedType.extension}`;

    return new File([file], normalizedName, {
        type: detectedType.mime,
        lastModified: file.lastModified
    });
};

const isAllowedImageFile = file => {
    if (!file) {
        return false;
    }

    if (file.type && ALLOWED_IMAGE_TYPES.has(file.type)) {
        return true;
    }

    return ALLOWED_IMAGE_EXTENSIONS.has(getFileExtension(file.name || ''));
};

const createEditorContextPlugin = (editorContextRef, onHandleImageFiles) => ({
    editorEffect(ctx) {
        editorContextRef.current = ctx;

        const handlePaste = async (_, event) => {
            const items = Array.from(event?.clipboardData?.items || []);
            const files = items
                .filter(item => item.kind === 'file')
                .map(item => item.getAsFile())
                .filter(Boolean);

            if (files.length === 0) {
                return;
            }

            event.preventDefault();
            await onHandleImageFiles(files, { showSuccess: false });
        };

        const handleDrop = async (_, event) => {
            const files = Array.from(event?.dataTransfer?.files || []).filter(Boolean);

            if (files.length === 0) {
                return;
            }

            event.preventDefault();
            await onHandleImageFiles(files, { showSuccess: false });
        };

        ctx.editor.on('paste', handlePaste);
        ctx.editor.on('drop', handleDrop);

        return () => {
            if (typeof ctx.editor.off === 'function') {
                ctx.editor.off('paste', handlePaste);
                ctx.editor.off('drop', handleDrop);
            }

            if (editorContextRef.current === ctx) {
                editorContextRef.current = null;
            }
        };
    }
});

const NoteEditor = ({ selectedNote, onSave, onDirtyChange, onSaveStateChange, onCreateNote }) => {
    const [noteTitle, setNoteTitle] = useState('');
    const [content, setContent] = useState('');
    const [mode, setMode] = useState(() => getEditorPreferences().defaultMode || 'split');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [autoSaving, setAutoSaving] = useState(false);
    const [isDirty, setIsDirty] = useState(false);
    const [lastSavedAt, setLastSavedAt] = useState(null);
    const [saveError, setSaveError] = useState('');
    const [uploadingImage, setUploadingImage] = useState(false);
    const [wordCount, setWordCount] = useState({ words: 0, lines: 0 });
    const autoSaveTimerRef = useRef(null);
    const lastSavedContentRef = useRef('');
    const loadingNoteRef = useRef(false);
    const editorContextRef = useRef(null);
    const imageInputRef = useRef(null);
    const contentRef = useRef('');

    useEffect(() => {
        const handlePreferencesChange = event => {
            if (event?.detail?.defaultMode) {
                setMode(event.detail.defaultMode);
            }
        };

        window.addEventListener('editor-preferences-changed', handlePreferencesChange);
        return () => {
            window.removeEventListener('editor-preferences-changed', handlePreferencesChange);
        };
    }, []);

    const updateWordCount = useCallback(text => {
        const lines = text.split('\n').length;
        const words = text.trim().split(/\s+/).filter(Boolean).length;
        setWordCount({ words, lines });
    }, []);

    const syncContentState = useCallback(nextContent => {
        contentRef.current = nextContent;
        setContent(nextContent);
        updateWordCount(nextContent);
        setSaveError('');

        if (!loadingNoteRef.current) {
            setIsDirty(nextContent !== lastSavedContentRef.current);
        }
    }, [updateWordCount]);

    const syncContentFromEditor = useCallback(editorInstance => {
        if (!editorInstance?.getValue) {
            return;
        }

        syncContentState(editorInstance.getValue());
    }, [syncContentState]);

    const replacePlaceholderToken = useCallback((placeholder, replacement = '') => {
        const editorInstance = editorContextRef.current?.editor;

        if (editorInstance?.getValue && editorInstance?.replaceRange && editorInstance?.posFromIndex) {
            const editorValue = editorInstance.getValue();
            const startIndex = editorValue.indexOf(placeholder);

            if (startIndex !== -1) {
                const from = editorInstance.posFromIndex(startIndex);
                const to = editorInstance.posFromIndex(startIndex + placeholder.length);

                editorInstance.replaceRange(replacement, from, to);
                syncContentFromEditor(editorInstance);
                editorInstance.focus();
                return;
            }
        }

        const nextContent = contentRef.current.replace(placeholder, replacement);
        syncContentState(nextContent);
    }, [syncContentFromEditor, syncContentState]);

    const insertTextAtCursor = useCallback(text => {
        const editorInstance = editorContextRef.current?.editor;

        if (editorInstance?.replaceSelection) {
            editorInstance.replaceSelection(text);
            syncContentFromEditor(editorInstance);
            editorInstance.focus();
            return;
        }

        if (editorInstance?.getCursor && editorInstance?.replaceRange) {
            const cursor = editorInstance.getCursor();
            editorInstance.replaceRange(text, cursor);
            syncContentFromEditor(editorInstance);
            editorInstance.focus();
            return;
        }

        const separator = contentRef.current && !contentRef.current.endsWith('\n') ? '\n\n' : '';
        syncContentState(`${contentRef.current}${separator}${text}`);
    }, [syncContentFromEditor, syncContentState]);

    const validateImageFiles = useCallback(async files => {
        const validFiles = [];
        const invalidTypeFiles = [];
        const invalidSizeFiles = [];

        for (const file of files || []) {
            if (!file) {
                continue;
            }

            let normalizedFile = file;

            if (!isAllowedImageFile(file)) {
                const detectedType = await sniffImageTypeFromMagicNumber(file);

                if (!detectedType) {
                    invalidTypeFiles.push(file.name || '未命名图片');
                    continue;
                }

                normalizedFile = normalizeImageFileByDetectedType(file, detectedType);
            }

            if (normalizedFile.size > MAX_IMAGE_SIZE) {
                invalidSizeFiles.push(normalizedFile.name || '未命名图片');
                continue;
            }

            validFiles.push(normalizedFile);
        }

        if (invalidTypeFiles.length > 0) {
            throw new Error(`仅支持 JPG、PNG、GIF、WEBP 图片：${invalidTypeFiles.join('、')}`);
        }

        if (invalidSizeFiles.length > 0) {
            throw new Error(`图片大小不能超过 5MB：${invalidSizeFiles.join('、')}`);
        }

        if (validFiles.length === 0) {
            throw new Error('请选择要上传的图片');
        }

        return validFiles;
    }, []);

    const uploadSingleImage = useCallback(async file => {
        const response = await uploadNoteImage(file);

        return {
            url: response.url,
            alt: response.alt || file.name,
            title: response.title || file.name
        };
    }, []);

    const handleImageFiles = useCallback(async (files, options = {}) => {
        const { showSuccess = true } = options;

        if (!selectedNote) {
            message.warning('请先选择一个笔记');
            return [];
        }

        const validFiles = await validateImageFiles(files);
        const placeholders = validFiles.map((file, index) => {
            const token = `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;

            return {
                file,
                placeholder: createUploadPlaceholder(file.name, token)
            };
        });

        insertTextAtCursor(placeholders.map(item => item.placeholder).join('\n\n'));
        setUploadingImage(true);

        const uploadedImages = [];
        const failedFiles = [];

        try {
            for (const item of placeholders) {
                try {
                    const uploadedImage = await uploadSingleImage(item.file);
                    uploadedImages.push(uploadedImage);
                    replacePlaceholderToken(item.placeholder, createImageMarkdown(uploadedImage));
                } catch (error) {
                    failedFiles.push(item.file.name);
                    replacePlaceholderToken(item.placeholder, '');
                }
            }

            if (failedFiles.length > 0) {
                const prefix = uploadedImages.length > 0 ? '部分图片上传失败' : '图片上传失败';
                throw new Error(`${prefix}：${failedFiles.join('、')}`);
            }

            if (showSuccess) {
                message.success(validFiles.length > 1 ? `已插入 ${validFiles.length} 张图片` : '图片上传成功');
            }

            return uploadedImages;
        } finally {
            setUploadingImage(false);
        }
    }, [insertTextAtCursor, replacePlaceholderToken, selectedNote, uploadSingleImage, validateImageFiles]);

    const handleInsertImageClick = () => {
        if (!selectedNote || uploadingImage) {
            return;
        }

        imageInputRef.current?.click();
    };

    const handleInsertImageChange = async event => {
        const fileList = Array.from(event.target.files || []);

        if (fileList.length === 0) {
            return;
        }

        try {
            await handleImageFiles(fileList, { showSuccess: true });
        } catch (error) {
            message.error(error.message || '图片上传失败，请稍后重试');
        } finally {
            event.target.value = '';
        }
    };

    const handleExportMarkdown = async () => {
        if (!selectedNote) {
            message.warning('请先选择一个笔记');
            return;
        }

        const suggestedName = createMarkdownFileName(noteTitle);

        try {
            if (window.electronAPI?.saveMarkdownFile) {
                const result = await window.electronAPI.saveMarkdownFile({
                    content,
                    suggestedName
                });

                if (!result?.canceled) {
                    message.success('Markdown 导出成功');
                }
                return;
            }

            const blob = new Blob([content], {
                type: 'text/markdown;charset=utf-8'
            });
            const downloadUrl = URL.createObjectURL(blob);
            const anchor = document.createElement('a');

            anchor.href = downloadUrl;
            anchor.download = suggestedName;
            anchor.click();

            URL.revokeObjectURL(downloadUrl);
            message.success('Markdown 导出成功');
        } catch (error) {
            message.error('Markdown 导出失败，请稍后重试');
        }
    };

    const handleExportHtml = async () => {
        if (!selectedNote) {
            message.warning('请先选择一个笔记');
            return;
        }

        const previewContainer = document.querySelector('.preview-only .markdown-body, .bytemd-preview .markdown-body');
        const htmlContent = previewContainer?.innerHTML || '';

        if (!htmlContent) {
            message.warning('当前预览内容尚未准备完成，请稍后重试');
            return;
        }

        const suggestedName = createHtmlFileName(noteTitle);
        const htmlDocument = createExportHtmlDocument({
            title: noteTitle,
            bodyHtml: htmlContent
        });

        try {
            if (window.electronAPI?.saveHtmlFile) {
                const result = await window.electronAPI.saveHtmlFile({
                    content: htmlDocument,
                    suggestedName
                });

                if (!result?.canceled) {
                    message.success('HTML 导出成功');
                }
                return;
            }

            const blob = new Blob([htmlDocument], {
                type: 'text/html;charset=utf-8'
            });
            const downloadUrl = URL.createObjectURL(blob);
            const anchor = document.createElement('a');

            anchor.href = downloadUrl;
            anchor.download = suggestedName;
            anchor.click();

            URL.revokeObjectURL(downloadUrl);
            message.success('HTML 导出成功');
        } catch (error) {
            message.error('HTML 导出失败，请稍后重试');
        }
    };

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

    useEffect(() => {
        let mounted = true;

        if (autoSaveTimerRef.current) {
            clearTimeout(autoSaveTimerRef.current);
        }

        if (selectedNote) {
            loadingNoteRef.current = true;
            setLoading(true);
            setSaveError('');
            contentRef.current = '';
            setContent('');
            updateWordCount('');
            lastSavedContentRef.current = '';

            getNoteDetail(selectedNote)
                .then(result => {
                    if (!mounted) {
                        return;
                    }

                    const noteContent = result?.note?.content || '';
                    setNoteTitle(result?.note?.title || '');
                    contentRef.current = noteContent;
                    setContent(noteContent);
                    updateWordCount(noteContent);
                    lastSavedContentRef.current = noteContent;
                    setLastSavedAt(result?.note?.updatedAt ? new Date(result.note.updatedAt) : null);
                    setIsDirty(false);
                })
                .catch(() => {
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
            setNoteTitle('');
            loadingNoteRef.current = false;
            contentRef.current = '';
            setContent('');
            updateWordCount('');
            lastSavedContentRef.current = '';
            setIsDirty(false);
            setSaveError('');
            setLastSavedAt(null);
        }

        return () => {
            mounted = false;
        };
    }, [selectedNote, updateWordCount]);

    const handleChange = value => {
        contentRef.current = value;
        setContent(value);
        updateWordCount(value);
        setSaveError('');

        if (!loadingNoteRef.current) {
            setIsDirty(value !== lastSavedContentRef.current);
        }
    };

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

    const handleShareClick = () => {
        message.info('分享功能暂未开放');
    };

    const hideToolByEdit = () => {
        const tabElements = document.querySelectorAll('.bytemd-toolbar-tab');
        if (tabElements.length > 0) {
            tabElements.forEach(element => {
                if (element.textContent === '编辑' || element.textContent === '预览') {
                    element.style.display = 'none';
                }
            });
        }

        const toolbarLeft = document.querySelector('.bytemd-toolbar-left');
        if (toolbarLeft) {
            toolbarLeft.style.display = 'none';
        }
    };

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
        if (uploadingImage) {
            return '图片上传中...';
        }
        return '';
    }, [autoSaving, isDirty, saveError, saving, uploadingImage]);

    const savedTimeText = useMemo(() => {
        if (!lastSavedAt) {
            return '';
        }

        return '已保存于 ' + lastSavedAt.toLocaleTimeString();
    }, [lastSavedAt]);

    const editorPlugins = useMemo(() => {
        return [
            ...basePlugins,
            createEditorContextPlugin(editorContextRef, handleImageFiles)
        ];
    }, [handleImageFiles]);

    const exportMenu = {
        items: [
            {
                key: 'markdown',
                label: '导出 Markdown (.md)'
            },
            {
                key: 'html',
                label: '导出 HTML (.html)'
            }
        ],
        onClick: ({ key }) => {
            if (key === 'markdown') {
                handleExportMarkdown();
                return;
            }

            handleExportHtml();
        }
    };

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
                            <span className="count-label">字数:</span> {wordCount.words}
                            <span className="count-separator">|</span>
                            <span className="count-label">行数:</span> {wordCount.lines}
                            {savedTimeText && (
                                <>
                                    <span className="count-separator">|</span>
                                    <span className="save-time">{savedTimeText}</span>
                                </>
                            )}
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
                        disabled={!selectedNote || !isDirty || loading || autoSaving || uploadingImage}
                    >
                        保存
                    </Button>
                    <Button
                        icon={<ShareAltOutlined />}
                        disabled={!selectedNote}
                        onClick={handleShareClick}
                    >
                        分享
                    </Button>
                    <Button
                        icon={<FileImageOutlined />}
                        disabled={!selectedNote || uploadingImage}
                        loading={uploadingImage}
                        onClick={handleInsertImageClick}
                    >
                        插入图片
                    </Button>
                    <Dropdown menu={exportMenu} trigger={['click']}>
                        <Button
                            icon={<DownloadOutlined />}
                            disabled={!selectedNote}
                        >
                            导出
                        </Button>
                    </Dropdown>
                </Space>
            </div>
        </div>
    );

    useEffect(() => {
        if (mode === 'edit') {
            setTimeout(() => {
                hideToolByEdit();
            }, 50);
        }
    }, [mode]);

    useEffect(() => {
        if (!selectedNote || !isDirty || loading || saving || autoSaving || uploadingImage) {
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
    }, [autoSaving, content, handleSave, isDirty, loading, saving, selectedNote, uploadingImage]);

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

    if (!selectedNote && !loading) {
        return (
            <div className="note-editor">
                {renderToolbar()}
                <div className="empty-state">
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description="请选择或创建一个笔记"
                    >
                        <Button type="primary" onClick={onCreateNote}>新建笔记</Button>
                    </Empty>
                </div>
            </div>
        );
    }

    return (
        <div className="note-editor">
            <input
                ref={imageInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                multiple
                hidden
                onChange={handleInsertImageChange}
            />
            {renderToolbar()}

            <div className="editor-content">
                <Spin spinning={loading} tip="加载中...">
                    <div className={mode === 'edit' ? 'editor-container editor-container-edit' : 'editor-container'}>
                        {mode === 'edit' ? (
                            <Editor
                                value={content}
                                plugins={editorPlugins}
                                onChange={handleChange}
                                mode="tab"
                                locale={locale}
                            />
                        ) : mode === 'preview' ? (
                            <div className="preview-only">
                                <Viewer value={content} plugins={basePlugins} />
                            </div>
                        ) : (
                            <Editor
                                value={content}
                                plugins={editorPlugins}
                                onChange={handleChange}
                                mode="split"
                                locale={locale}
                            />
                        )}
                    </div>
                </Spin>
            </div>

            {saveStatusText && (
                <div className="editor-footer">
                    <div className={saveError ? 'sync-info sync-error' : 'sync-info'}>
                        {saveStatusText}
                        {saveError && selectedNote && (
                            <Button
                                type="link"
                                size="small"
                                onClick={handleRetrySave}
                                disabled={saving || autoSaving || uploadingImage}
                            >
                                重试
                            </Button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default NoteEditor;
