import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Editor, Viewer } from '@bytemd/react';
import gfm from '@bytemd/plugin-gfm';
import highlight from '@bytemd/plugin-highlight';
import gemoji from '@bytemd/plugin-gemoji';
import math from '@bytemd/plugin-math';
import mermaid from '@bytemd/plugin-mermaid';
import breaks from '@bytemd/plugin-breaks';
import { Empty, Spin, Button, Space, message, Tooltip, Dropdown, Image, Popover, Radio, Divider, Drawer, Modal } from 'antd';
import {
    EditOutlined,
    EyeOutlined,
    ColumnWidthOutlined,
    SaveOutlined,
    ShareAltOutlined,
    FileImageOutlined,
    DownloadOutlined,
    ExportOutlined,
    CompassOutlined,
    HistoryOutlined,
    FullscreenOutlined,
    FullscreenExitOutlined,
    FileTextOutlined,
    FontSizeOutlined,
    CopyOutlined,
    OneToOneOutlined,
    ThunderboltOutlined,
    RobotOutlined,
    CheckOutlined,
    MoreOutlined,
    CheckCircleOutlined,
    CloseCircleOutlined,
    SyncOutlined,
    ApartmentOutlined
} from '@ant-design/icons';

import zhHans from 'bytemd/locales/zh_Hans.json';
import zhHansMermaid from '@bytemd/plugin-mermaid/locales/zh_Hans.json';
import zhHansGfm from '@bytemd/plugin-gfm/locales/zh_Hans.json';
import zhHansMath from '@bytemd/plugin-math/locales/zh_Hans.json';

import 'bytemd/dist/index.css';
import 'highlight.js/styles/github.css';
import 'katex/dist/katex.css';
import './index.less';
import { getNoteDetail, suggestNoteLinks, createNote } from '@/api/notes';
import { uploadNoteImage } from '@/api/upload';
import { getEditorPreferences, setEditorPreferences } from '@/utils/preferences';
import TOCDrawer from './TOCDrawer';
import VersionHistoryModal from './VersionHistoryModal';
import SelectionCopyBubble from './SelectionCopyBubble';
import AIFullNoteModal from './AIFullNoteModal';
import lazyImagePlugin from './plugins/lazyImagePlugin';
import wikiLinkPlugin from './plugins/wikiLinkPlugin';
import LinkSuggestPopup from './LinkSuggestPopup';
import BacklinksPanel from './BacklinksPanel';
import KnowledgeGraph from '@/components/KnowledgeGraph';
import WikiLinkHoverCard from './WikiLinkHoverCard';

const locale = {
    ...zhHans
};

const basePlugins = [
    gfm({
        locale: zhHansGfm
    }),
    highlight(),
    gemoji(),
    math({
        locale: zhHansMath
    }),
    mermaid({
        locale: zhHansMermaid
    }),
    breaks(),
    lazyImagePlugin(),
    wikiLinkPlugin()
];

const calculateContentAnalytics = text => {
    if (!text) {
        return {
            chineseChars: 0,
            englishWords: 0,
            punctuationChars: 0,
            totalChars: 0,
            lines: 0,
            readingTimeMinutes: 0,
            effectiveWords: 0
        };
    }

    const lines = text.split('\n').length;
    const totalChars = text.length;
    const chineseMatch = text.match(/[\u4e00-\u9fa5]/g);
    const chineseChars = chineseMatch ? chineseMatch.length : 0;

    const textWithoutChinese = text.replace(/[\u4e00-\u9fa5]/g, ' ');
    const wordsMatch = textWithoutChinese.trim().split(/\s+/).filter(Boolean);
    const englishWords = wordsMatch.length;

    const punctuationMatch = text.match(/[，。！？、；：“”‘’（）《》【】…—.,!?;:'"()[\]{}]/g);
    const punctuationChars = punctuationMatch ? punctuationMatch.length : 0;

    const effectiveWords = chineseChars + englishWords;
    const readingTimeMinutes = Math.max(1, Math.ceil(effectiveWords / 300));

    return {
        chineseChars,
        englishWords,
        punctuationChars,
        totalChars,
        lines,
        readingTimeMinutes,
        effectiveWords
    };
};

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

const MODE_OPTIONS = [
    { label: '编辑', value: 'edit', icon: <EditOutlined /> },
    { label: '分屏', value: 'split', icon: <ColumnWidthOutlined /> },
    { label: '预览', value: 'preview', icon: <EyeOutlined /> }
];

// 模式切换分段器：基于持久 DOM 滑块实现无重置平滑过渡
const ModeSegmented = ({ value, onChange }) => {
    const activeIndex = Math.max(0, MODE_OPTIONS.findIndex(item => item.value === value));

    return (
        <div className="mode-segmented" role="radiogroup" aria-label="视图模式切换">
            <div
                className="mode-segmented-thumb"
                style={{
                    transform: `translateX(${activeIndex * 100}%)`
                }}
            />
            {MODE_OPTIONS.map(item => (
                <button
                    key={item.value}
                    type="button"
                    role="radio"
                    aria-checked={item.value === value}
                    className={`mode-segmented-item ${item.value === value ? 'is-active' : ''}`}
                    onClick={() => onChange(item.value)}
                >
                    <span className="item-icon">{item.icon}</span>
                    <span className="item-label">{item.label}</span>
                </button>
            ))}
        </div>
    );
};

const NoteEditor = ({
    selectedNote,
    selectedNotebook,
    onSelectNote,
    onSave,
    onDirtyChange,
    onSaveStateChange,
    onCreateNote,
    zenMode = false,
    onToggleZenMode
}) => {
    const [noteTitle, setNoteTitle] = useState('');
    const [content, setContent] = useState('');
    const [mode, setMode] = useState(() => getEditorPreferences().defaultMode || 'split');
    const [fontFamily, setFontFamily] = useState(() => getEditorPreferences().fontFamily || 'lxgw');
    const [fontSize, setFontSize] = useState(() => getEditorPreferences().fontSize || 'medium');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [autoSaving, setAutoSaving] = useState(false);
    const [isDirty, setIsDirty] = useState(false);
    const [lastSavedAt, setLastSavedAt] = useState(null);
    const [saveError, setSaveError] = useState('');
    const [uploadingImage, setUploadingImage] = useState(false);
    const [tocVisible, setTocVisible] = useState(false);
    const [historyModalVisible, setHistoryModalVisible] = useState(false);
    const [localGraphVisible, setLocalGraphVisible] = useState(false);
    const [aiModalVisible, setAiModalVisible] = useState(false);
    const [aiModalAction, setAiModalAction] = useState('full_summary');
    const [imagePreview, setImagePreview] = useState({
        visible: false,
        current: 0,
        images: []
    });
    const autoSaveTimerRef = useRef(null);
    const lastSavedContentRef = useRef('');
    const loadingNoteRef = useRef(false);
    const editorContextRef = useRef(null);
    const imageInputRef = useRef(null);
    const contentRef = useRef('');
    const previousModeRef = useRef(mode);
    const editorContainerRef = useRef(null);
    const [statusAnchorEl, setStatusAnchorEl] = useState(null);
    const [backlinksAnchorEl, setBacklinksAnchorEl] = useState(null);

    const contentAnalytics = useMemo(() => calculateContentAnalytics(content), [content]);

    useEffect(() => {
        const handleOpenAI = e => {
            if (!selectedNote) {
                message.warning('请先选择或新建一篇笔记再使用 AI 创作助手');
                return;
            }
            if (!contentRef.current || !contentRef.current.trim()) {
                message.warning('笔记内容为空，无法进行 AI 分析');
                return;
            }
            const action = e.detail?.action || 'full_summary';
            setAiModalAction(action);
            setAiModalVisible(true);
        };
        window.addEventListener('open-ai-modal', handleOpenAI);
        return () => window.removeEventListener('open-ai-modal', handleOpenAI);
    }, [selectedNote]);

    // 监听正文双向链接跳转与快捷创建
    useEffect(() => {
        const handleOpenWikiLink = async e => {
            const targetTitle = e.detail?.title;
            if (!targetTitle) return;

            try {
                const res = await suggestNoteLinks(targetTitle);
                const list = res?.data?.suggestions || res?.suggestions || [];
                const exactMatch = list.find(
                    n => n.title.trim().toLowerCase() === targetTitle.trim().toLowerCase()
                );

                if (exactMatch) {
                    onSelectNote?.(exactMatch._id);
                } else {
                    Modal.confirm({
                        title: '创建关联双链笔记',
                        content: `笔记《${targetTitle}》尚未创建。是否立即以此标题创建新笔记？`,
                        okText: '立即创建',
                        cancelText: '取消',
                        centered: true,
                        onOk: async () => {
                            try {
                                const newNoteRes = await createNote({
                                    title: targetTitle,
                                    content: '',
                                    notebookId: selectedNotebook || undefined,
                                    type: 'note'
                                });
                                const newId =
                                    newNoteRes?.note?._id ||
                                    newNoteRes?.data?.note?._id ||
                                    newNoteRes?._id;
                                if (newId) {
                                    message.success(`已创建笔记《${targetTitle}》`);
                                    onSelectNote?.(newId);
                                }
                            } catch {
                                message.error('创建关联笔记失败');
                            }
                        }
                    });
                }
            } catch {
                message.error('检索关联笔记失败');
            }
        };

        window.addEventListener('open-wiki-link', handleOpenWikiLink);
        return () => window.removeEventListener('open-wiki-link', handleOpenWikiLink);
    }, [onSelectNote, selectedNotebook]);

    const handleCreateWikiLinkNote = useCallback(
        async targetTitle => {
            try {
                const newNoteRes = await createNote({
                    title: targetTitle,
                    content: '',
                    notebookId: selectedNotebook || undefined,
                    type: 'note'
                });
                const newId =
                    newNoteRes?.note?._id ||
                    newNoteRes?.data?.note?._id ||
                    newNoteRes?._id;
                if (newId) {
                    message.success(`已创建笔记《${targetTitle}》`);
                    onSelectNote?.(newId);
                }
            } catch {
                message.error('创建关联笔记失败');
            }
        },
        [selectedNotebook, onSelectNote]
    );

    // 锚定并挂载保存状态至 ByteMD 右侧原生状态栏与预览区反向链接
    useEffect(() => {
        if (mode === 'preview') {
            setStatusAnchorEl(null);
            setBacklinksAnchorEl(null);
            return;
        }

        const container = editorContainerRef.current;
        if (!container) return;

        const attachAnchors = () => {
            const statusRight = container.querySelector('.bytemd-status-right');
            if (statusRight) {
                let anchor = statusRight.querySelector('.bytemd-status-save-anchor');
                if (!anchor) {
                    anchor = document.createElement('div');
                    anchor.className = 'bytemd-status-save-anchor';
                    statusRight.insertBefore(anchor, statusRight.firstChild);
                }
                setStatusAnchorEl(anchor);
            }

            const previewEl = container.querySelector('.bytemd-preview');
            if (previewEl) {
                let backlinkAnchor = previewEl.querySelector('.bytemd-backlinks-anchor');
                if (!backlinkAnchor) {
                    backlinkAnchor = document.createElement('div');
                    backlinkAnchor.className = 'bytemd-backlinks-anchor';
                    previewEl.appendChild(backlinkAnchor);
                }
                setBacklinksAnchorEl(backlinkAnchor);
            }
        };

        attachAnchors();
        const timer = setTimeout(attachAnchors, 80);

        const observer = new MutationObserver(() => {
            attachAnchors();
        });

        observer.observe(container, { childList: true, subtree: true });

        return () => {
            clearTimeout(timer);
            observer.disconnect();
        };
    }, [mode, selectedNote]);

    useEffect(() => {
        if (zenMode) {
            setMode(currentMode => {
                previousModeRef.current = currentMode;
                return 'preview';
            });

            if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
                document.documentElement.requestFullscreen().catch(() => {});
            }
        } else {
            if (previousModeRef.current) {
                setMode(previousModeRef.current);
            }

            if (document.fullscreenElement && document.exitFullscreen) {
                document.exitFullscreen().catch(() => {});
            }
        }
    }, [zenMode]);

    useEffect(() => {
        const timer = setTimeout(() => {
            const editorInstance = editorContextRef.current?.editor;
            if (editorInstance?.refresh) {
                editorInstance.refresh();
            }
        }, 50);

        return () => clearTimeout(timer);
    }, [mode, zenMode]);

    useEffect(() => {
        const handleFullscreenChange = () => {
            if (!document.fullscreenElement && zenMode && onToggleZenMode) {
                onToggleZenMode(false);
            }
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
        };
    }, [zenMode, onToggleZenMode]);

    useEffect(() => {
        const handleKeyDown = event => {
            if (event.key === 'Escape' || event.code === 'Escape') {
                if (zenMode && onToggleZenMode) {
                    onToggleZenMode(false);
                }
            }

            if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === 'O' || event.key === 'o')) {
                event.preventDefault();
                setTocVisible(prev => !prev);
            }

            if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === 'F' || event.key === 'f')) {
                event.preventDefault();
                if (onToggleZenMode) {
                    onToggleZenMode(prev => !prev);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [zenMode, onToggleZenMode]);

    useEffect(() => {
        const handlePreferencesChange = event => {
            if (event?.detail?.defaultMode) {
                setMode(event.detail.defaultMode);
            }
            if (event?.detail?.fontFamily) {
                setFontFamily(event.detail.fontFamily);
            }
            if (event?.detail?.fontSize) {
                setFontSize(event.detail.fontSize);
            }
        };

        window.addEventListener('editor-preferences-changed', handlePreferencesChange);
        return () => {
            window.removeEventListener('editor-preferences-changed', handlePreferencesChange);
        };
    }, []);

    const handleTypographyChange = useCallback((key, value) => {
        if (key === 'fontFamily') {
            setFontFamily(value);
        } else if (key === 'fontSize') {
            setFontSize(value);
        }
        setEditorPreferences({ [key]: value });
        window.dispatchEvent(new CustomEvent('editor-preferences-changed', { detail: { [key]: value } }));
    }, []);

    const syncContentState = useCallback(nextContent => {
        contentRef.current = nextContent;
        setContent(nextContent);
        setSaveError('');

        if (!loadingNoteRef.current) {
            setIsDirty(nextContent !== lastSavedContentRef.current);
        }
    }, []);

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

    // 代理 Markdown 渲染区图片点击，组装画廊并呼出全功能预览器
    const handlePreviewContainerClick = useCallback(event => {
        const target = event.target;
        if (!target || target.tagName !== 'IMG' || !target.closest('.markdown-body')) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const container = target.closest('.markdown-body');
        const imgElements = Array.from(container.querySelectorAll('img'));
        const images = imgElements.map(img => {
            const naturalWidth = img.naturalWidth || 1;
            const naturalHeight = img.naturalHeight || 1;
            const realSrc = img.dataset.src || img.getAttribute('src') || img.src;
            return {
                src: realSrc,
                alt: img.getAttribute('alt') || '笔记图片',
                isTall: naturalHeight / naturalWidth > 1.6
            };
        });

        const clickedIndex = imgElements.indexOf(target);
        const targetSrc = target.dataset?.src || target.getAttribute('src') || target.src;
        setImagePreview({
            visible: true,
            current: clickedIndex >= 0 ? clickedIndex : 0,
            images: images.length > 0 ? images : [{
                src: targetSrc,
                alt: target.getAttribute('alt') || '笔记图片',
                isTall: (target.naturalHeight || 1) / (target.naturalWidth || 1) > 1.6
            }]
        });
    }, []);

    const { visible: isPreviewVisible, current: previewCurrentIndex } = imagePreview;

    // 长图预览：重置视口顶端 + 纵向拖拽上下平滑阅读（严格锁定 X 轴，防止横向偏移与图片消失）
    useEffect(() => {
        if (!isPreviewVisible) {
            return undefined;
        }

        const currentImage = imagePreview.images[previewCurrentIndex];
        const isTall = Boolean(currentImage?.isTall);
        if (!isTall) {
            return undefined;
        }

        let isDown = false;
        let startY = 0;
        let startScrollTop = 0;
        let activeWrap = null;

        const handleMouseDown = e => {
            if (e.button !== 0 || !activeWrap) return;
            if (e.target.closest('.ant-image-preview-operations, .cloud-note-preview-custom-toolbar, .ant-image-preview-switch-left, .ant-image-preview-switch-right, .ant-image-preview-close')) {
                return;
            }
            isDown = true;
            startY = e.clientY;
            startScrollTop = activeWrap.scrollTop;
            activeWrap.classList.add('is-dragging');
            activeWrap.style.scrollBehavior = 'auto';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        };

        const handleMouseMove = e => {
            if (!isDown || !activeWrap) return;
            const deltaY = e.clientY - startY;
            activeWrap.scrollTop = startScrollTop - deltaY;
        };

        const handleMouseUp = () => {
            if (!isDown) return;
            isDown = false;
            if (activeWrap) {
                activeWrap.classList.remove('is-dragging');
                activeWrap.style.scrollBehavior = 'smooth';
            }
            document.body.style.userSelect = '';
        };

        // 鼠标在图片区域时，滚轮只触发放大缩小，阻止外层容器滚动；图片外部滚轮正常滚动
        const handleWrapWheel = e => {
            if (e.target && e.target.closest('.ant-image-preview-img')) {
                e.preventDefault();
            }
        };

        const timer = setTimeout(() => {
            activeWrap = document.querySelector('.cloud-note-image-preview.is-tall-image .ant-image-preview-wrap');
            if (activeWrap) {
                activeWrap.scrollTo({ top: 0, behavior: 'instant' });
                activeWrap.addEventListener('mousedown', handleMouseDown);
                activeWrap.addEventListener('wheel', handleWrapWheel, { passive: false });
            }
        }, 30);

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            clearTimeout(timer);
            if (activeWrap) {
                activeWrap.removeEventListener('mousedown', handleMouseDown);
                activeWrap.removeEventListener('wheel', handleWrapWheel);
                activeWrap.classList.remove('is-dragging');
            }
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            document.body.style.userSelect = '';
        };
    }, [isPreviewVisible, previewCurrentIndex, imagePreview.images]);

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
            lastSavedContentRef.current = '';
            setIsDirty(false);
            setSaveError('');
            setLastSavedAt(null);
        }

        return () => {
            mounted = false;
        };
    }, [selectedNote]);

    const handleChange = value => {
        contentRef.current = value;
        setContent(value);
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
                await onSave(selectedNote, content, {
                    title: noteTitle,
                    saveType: options.auto ? 'auto' : 'manual'
                });
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
    }, [autoSaving, content, isDirty, noteTitle, onSave, saving, selectedNote]);

    const handleRollbackSuccess = useCallback(rolledBackNote => {
        if (!rolledBackNote) return;
        const newContent = rolledBackNote.content || '';
        const newTitle = rolledBackNote.title || '';
        setNoteTitle(newTitle);
        setContent(newContent);
        contentRef.current = newContent;
        lastSavedContentRef.current = newContent;
        setIsDirty(false);
        setSaveError('');
        setLastSavedAt(new Date());

        const editorInstance = editorContextRef.current?.editor;
        if (editorInstance?.setValue) {
            editorInstance.setValue(newContent);
        }
    }, []);

    const handleRetrySave = () => {
        handleSave().catch(() => {});
    };

    const handleShareClick = () => {
        message.info('分享功能暂未开放');
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

    const moreMenu = {
        items: [
            {
                key: 'share',
                icon: <ShareAltOutlined />,
                label: '分享当前笔记'
            },
            {
                type: 'divider'
            },
            {
                key: 'markdown',
                icon: <DownloadOutlined />,
                label: '导出 Markdown (.md)'
            },
            {
                key: 'html',
                icon: <ExportOutlined />,
                label: '导出 HTML (.html)'
            }
        ],
        onClick: ({ key }) => {
            if (key === 'share') {
                handleShareClick();
            } else if (key === 'markdown') {
                handleExportMarkdown();
            } else if (key === 'html') {
                handleExportHtml();
            }
        }
    };

    // 一键复制文档内容（支持 Markdown 源码与预览富文本）
    const handleCopyAll = useCallback(async (type = 'source') => {
        if (!content) {
            message.warning('笔记内容为空');
            return;
        }

        if (type === 'source') {
            try {
                if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(content);
                } else {
                    const textarea = document.createElement('textarea');
                    textarea.value = content;
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textarea);
                }
                message.success('已复制 Markdown 源码');
            } catch {
                message.error('复制失败，请重试');
            }
            return;
        }

        try {
            const previewEl = document.querySelector('.bytemd-preview .markdown-body, .preview-only .markdown-body');
            if (!previewEl) {
                await navigator.clipboard.writeText(content);
                message.success('已复制 Markdown 源码');
                return;
            }

            const html = previewEl.innerHTML;
            const plainText = previewEl.innerText;

            if (navigator.clipboard && window.ClipboardItem) {
                const blobHtml = new Blob([html], { type: 'text/html' });
                const blobText = new Blob([plainText], { type: 'text/plain' });
                await navigator.clipboard.write([
                    new ClipboardItem({
                        'text/html': blobHtml,
                        'text/plain': blobText
                    })
                ]);
            } else if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(plainText);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = plainText;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
            }
            message.success('已复制预览排版内容 (富文本)');
        } catch {
            try {
                await navigator.clipboard.writeText(content);
                message.success('已复制 Markdown 源码');
            } catch {
                message.error('复制失败');
            }
        }
    }, [content]);

    const handleInsertAIContent = useCallback(insertedText => {
        const editorInstance = editorContextRef.current?.editor;
        if (editorInstance?.getValue && editorInstance?.replaceRange && editorInstance?.lineCount) {
            const lineCount = editorInstance.lineCount();
            const lastLineLength = editorInstance.getLine(lineCount - 1)?.length || 0;
            const endPos = { line: lineCount - 1, ch: lastLineLength };
            editorInstance.replaceRange(insertedText, endPos);
            syncContentFromEditor(editorInstance);
            editorInstance.focus();
            return;
        }

        const separator = contentRef.current && !contentRef.current.endsWith('\n') ? '\n\n' : '';
        syncContentState(`${contentRef.current}${separator}${insertedText.trimStart()}`);
    }, [syncContentFromEditor, syncContentState]);

    const aiMenu = {
        items: [
            {
                key: 'full_summary',
                icon: <FileTextOutlined style={{ color: '#7c3aed' }} />,
                label: '全文核心摘要提炼'
            },
            {
                key: 'extract_todos',
                icon: <CheckOutlined style={{ color: '#059669' }} />,
                label: '提取行动清单与待办'
            },
            {
                key: 'mindmap_outline',
                icon: <CompassOutlined style={{ color: '#0284c7' }} />,
                label: '生成思维导图大纲 (Mermaid)'
            },
            {
                key: 'continue',
                icon: <EditOutlined style={{ color: '#d97706' }} />,
                label: '承接全文智能续写'
            },
            {
                type: 'divider'
            },
            {
                key: 'custom',
                icon: <RobotOutlined style={{ color: '#7c3aed' }} />,
                label: '针对全篇笔记对话提问...'
            }
        ],
        onClick: ({ key }) => {
            if (!content || !content.trim()) {
                message.warning('笔记内容为空，无法进行 AI 分析');
                return;
            }
            setAiModalAction(key);
            setAiModalVisible(true);
        }
    };

    const copyMenu = {
        items: [
            {
                key: 'source',
                icon: <CopyOutlined />,
                label: '复制 Markdown 源码'
            },
            {
                key: 'preview',
                icon: <FileTextOutlined />,
                label: '复制预览排版内容 (富文本)'
            }
        ],
        onClick: ({ key }) => {
            handleCopyAll(key);
        }
    };

    const renderToolbar = () => (
        <div className="editor-toolbar">
            <div className="editor-left-actions">
                <ModeSegmented value={mode} onChange={setMode} />
                <Divider type="vertical" style={{ height: 16, margin: '0 4px' }} />
                <Tooltip title={tocVisible ? '收起大纲' : '文章大纲 (Ctrl+Shift+O)'}>
                    <Button
                        className="toolbar-tool-btn"
                        type={tocVisible ? 'primary' : 'text'}
                        icon={<CompassOutlined />}
                        onClick={() => setTocVisible(!tocVisible)}
                    />
                </Tooltip>
                <Tooltip title="历史版本快照">
                    <Button
                        className="toolbar-tool-btn"
                        type="text"
                        icon={<HistoryOutlined />}
                        disabled={!selectedNote}
                        onClick={() => setHistoryModalVisible(true)}
                    />
                </Tooltip>
                <Tooltip title="局部知识图谱 (Radar)">
                    <Button
                        className="toolbar-tool-btn"
                        type={localGraphVisible ? 'primary' : 'text'}
                        icon={<ApartmentOutlined />}
                        disabled={!selectedNote}
                        onClick={() => setLocalGraphVisible(true)}
                    />
                </Tooltip>
                <Tooltip title={zenMode ? '退出沉浸模式 (Esc)' : '专注沉浸模式 (Ctrl+Shift+F)'}>
                    <Button
                        className="toolbar-tool-btn"
                        type={zenMode ? 'primary' : 'text'}
                        icon={zenMode ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                        onClick={() => onToggleZenMode?.(!zenMode)}
                    />
                </Tooltip>
                <Popover
                    placement="bottomLeft"
                    title={<span style={{ fontWeight: 600 }}>排版与字体风格</span>}
                    trigger="click"
                    content={(
                        <div className="typography-popover-content">
                            <div className="typography-popover-section">
                                <div className="popover-section-label">阅读字体</div>
                                <Radio.Group
                                    size="small"
                                    value={fontFamily}
                                    onChange={e => handleTypographyChange('fontFamily', e.target.value)}
                                    buttonStyle="solid"
                                >
                                    <Radio.Button value="lxgw">霞鹜文楷</Radio.Button>
                                    <Radio.Button value="sans">思源黑体</Radio.Button>
                                    <Radio.Button value="system">系统默认</Radio.Button>
                                </Radio.Group>
                            </div>
                            <div className="typography-popover-divider" />
                            <div className="typography-popover-section">
                                <div className="popover-section-label">正文字号</div>
                                <Radio.Group
                                    size="small"
                                    value={fontSize}
                                    onChange={e => handleTypographyChange('fontSize', e.target.value)}
                                    buttonStyle="solid"
                                >
                                    <Radio.Button value="small">小 (14px)</Radio.Button>
                                    <Radio.Button value="medium">标准 (16px)</Radio.Button>
                                    <Radio.Button value="large">大 (18px)</Radio.Button>
                                </Radio.Group>
                            </div>
                        </div>
                    )}
                >
                    <Tooltip title="排版与字体风格">
                        <Button className="toolbar-tool-btn" type="text" icon={<FontSizeOutlined />} />
                    </Tooltip>
                </Popover>
            </div>

            <div className="editor-right-actions">
                <Dropdown menu={aiMenu} trigger={['click']} placement="bottomRight">
                    <Button
                        className="ai-toolbar-btn"
                        type="primary"
                        icon={<ThunderboltOutlined />}
                        disabled={!selectedNote}
                    >
                        AI 创作助手
                    </Button>
                </Dropdown>
                <Button
                    className="save-btn"
                    type="primary"
                    icon={<SaveOutlined />}
                    onClick={() => handleSave()}
                    loading={saving}
                    disabled={!selectedNote || !isDirty || loading || autoSaving || uploadingImage}
                >
                    保存
                </Button>
                <Dropdown menu={copyMenu} placement="bottomLeft">
                    <Tooltip title="一键复制 (Markdown / 富文本)">
                        <Button
                            className="toolbar-tool-btn"
                            type="text"
                            icon={<CopyOutlined />}
                            disabled={!selectedNote || !content}
                        />
                    </Tooltip>
                </Dropdown>
                <Tooltip title="插入本地图片">
                    <Button
                        className="toolbar-tool-btn"
                        type="text"
                        icon={<FileImageOutlined />}
                        disabled={!selectedNote || uploadingImage}
                        loading={uploadingImage}
                        onClick={handleInsertImageClick}
                    />
                </Tooltip>
                <Dropdown menu={moreMenu} trigger={['click']} placement="bottomRight">
                    <Tooltip title="更多操作 (分享 / 导出)">
                        <Button
                            className="toolbar-tool-btn"
                            type="text"
                            icon={<MoreOutlined />}
                            disabled={!selectedNote}
                        />
                    </Tooltip>
                </Dropdown>
            </div>
        </div>
    );

    // 保存状态指示（嵌入 ByteMD 状态栏或预览底栏）
    const renderSaveStatus = () => (
        <div className="bytemd-save-status-wrap">
            {saveStatusText ? (
                <div className={saveError ? 'sync-info sync-error' : 'sync-info'}>
                    {saveError ? (
                        <CloseCircleOutlined style={{ color: '#ff4d4f', marginRight: 4 }} />
                    ) : (
                        <SyncOutlined spin style={{ color: '#1890ff', marginRight: 4 }} />
                    )}
                    <span>{saveStatusText}</span>
                    {saveError && selectedNote && (
                        <Button
                            type="link"
                            size="small"
                            onClick={handleRetrySave}
                            disabled={saving || autoSaving || uploadingImage}
                            style={{ padding: '0 4px', height: 'auto', fontSize: 12 }}
                        >
                            重试
                        </Button>
                    )}
                </div>
            ) : (
                <div className="sync-info sync-idle">
                    <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 4 }} />
                    <span>{savedTimeText || '已同步到云端'}</span>
                </div>
            )}
        </div>
    );

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
            <div className={`note-editor ${zenMode ? 'is-zen-mode' : ''}`}>
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
        <div className={`note-editor ${zenMode ? 'is-zen-mode' : ''} ${zenMode ? `is-zen-${mode}` : ''}`}>
            {zenMode ? (
                <div className="zen-top-reveal-group">
                    <div className="zen-hover-trigger" />
                    <div className="zen-toolbar-container">
                        {renderToolbar()}
                    </div>
                </div>
            ) : (
                renderToolbar()
            )}
            {zenMode && (
                <div className="zen-top-actions">
                    <div className="zen-mode-switch-pill" role="group" aria-label="视图模式切换">
                        <button
                            type="button"
                            className={`zen-switch-btn ${mode === 'preview' ? 'is-active' : ''}`}
                            onClick={() => setMode('preview')}
                            title="阅读模式 (只看排版与图文)"
                        >
                            <EyeOutlined className="btn-icon" />
                            <span>阅读</span>
                        </button>
                        <button
                            type="button"
                            className={`zen-switch-btn ${mode === 'edit' ? 'is-active' : ''}`}
                            onClick={() => setMode('edit')}
                            title="写作模式 (专注纯源码编辑)"
                        >
                            <EditOutlined className="btn-icon" />
                            <span>写作</span>
                        </button>
                        <button
                            type="button"
                            className={`zen-switch-btn ${mode === 'split' ? 'is-active' : ''}`}
                            onClick={() => setMode('split')}
                            title="分屏模式 (左编辑右预览)"
                        >
                            <ColumnWidthOutlined className="btn-icon" />
                            <span>分屏</span>
                        </button>
                    </div>

                    <div
                        className="zen-exit-pill"
                        onClick={() => onToggleZenMode?.(false)}
                        title="退出沉浸专注 (Esc)"
                    >
                        <FullscreenExitOutlined className="btn-icon" />
                        <span>退出专注</span>
                        <kbd className="zen-shortcut-key">Esc</kbd>
                    </div>
                </div>
            )}
            <input
                ref={imageInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                multiple
                hidden
                onChange={handleInsertImageChange}
            />

            <div className="editor-content" ref={editorContainerRef}>
                <Spin spinning={loading} tip="加载中...">
                    <div
                        className={`editor-container editor-container-${mode} font-family-${fontFamily} font-size-${fontSize}`}
                        onClick={handlePreviewContainerClick}
                    >
                        {mode === 'preview' ? (
                            <div className="preview-only-wrapper">
                                <div className="preview-only">
                                    <Viewer value={content} plugins={basePlugins} />
                                    <BacklinksPanel
                                        noteId={selectedNote}
                                        noteTitle={noteTitle}
                                        onNavigateNote={onSelectNote}
                                        onOpenLocalGraph={() => setLocalGraphVisible(true)}
                                    />
                                </div>
                                <div className="bytemd-status preview-status-bar">
                                    <div className="bytemd-status-left">
                                        <span>字数: <strong>{contentAnalytics.effectiveWords}</strong></span>
                                        <span>行数: <strong>{contentAnalytics.lines}</strong></span>
                                    </div>
                                    <div className="bytemd-status-right">
                                        {renderSaveStatus()}
                                    </div>
                                </div>
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
                <SelectionCopyBubble
                    containerRef={editorContainerRef}
                    editorContextRef={editorContextRef}
                />
                <LinkSuggestPopup
                    containerRef={editorContainerRef}
                    editorContextRef={editorContextRef}
                />
            </div>

            {statusAnchorEl && createPortal(renderSaveStatus(), statusAnchorEl)}
            {backlinksAnchorEl && createPortal(
                <BacklinksPanel
                    noteId={selectedNote}
                    noteTitle={noteTitle}
                    onNavigateNote={onSelectNote}
                    onOpenLocalGraph={() => setLocalGraphVisible(true)}
                />,
                backlinksAnchorEl
            )}

            <TOCDrawer
                visible={tocVisible}
                onClose={() => setTocVisible(false)}
                content={content}
                editorContextRef={editorContextRef}
            />

            <VersionHistoryModal
                visible={historyModalVisible}
                onClose={() => setHistoryModalVisible(false)}
                noteId={selectedNote}
                currentNoteTitle={noteTitle}
                currentContent={content}
                onRollbackSuccess={handleRollbackSuccess}
            />

            <AIFullNoteModal
                open={aiModalVisible}
                onClose={() => setAiModalVisible(false)}
                action={aiModalAction}
                noteTitle={noteTitle}
                noteContent={content}
                onInsertContent={handleInsertAIContent}
            />

            <Drawer
                title="当前笔记局部知识图谱 (Radar)"
                open={localGraphVisible}
                onClose={() => setLocalGraphVisible(false)}
                width={700}
                destroyOnClose
                bodyStyle={{ padding: 0 }}
            >
                <KnowledgeGraph
                    focusNoteId={selectedNote}
                    isLocalMode={true}
                    onSelectNote={id => {
                        setLocalGraphVisible(false);
                        onSelectNote?.(id);
                    }}
                />
            </Drawer>

            <div style={{ display: 'none' }}>
                <Image.PreviewGroup
                    preview={{
                        visible: imagePreview.visible,
                        onVisibleChange: visible => {
                            setImagePreview(prev => ({ ...prev, visible }));
                        },
                        current: imagePreview.current,
                        onChange: current => {
                            setImagePreview(prev => ({ ...prev, current }));
                        },
                        rootClassName: `cloud-note-image-preview ${imagePreview.images[imagePreview.current]?.isTall ? 'is-tall-image' : ''}`,
                        minScale: 1,
                        maxScale: 5,
                        scaleStep: 0.5,
                        movable: !Boolean(imagePreview.images[imagePreview.current]?.isTall),
                        imageRender: (originalNode, info) => {
                            const scale = info?.transform?.scale || 1;
                            const isTall = Boolean(imagePreview.images[imagePreview.current]?.isTall);
                            let nodeStyle = originalNode.props.style || {};

                            if (isTall) {
                                const currentTransform = nodeStyle.transform || '';
                                // 严格锁定长图 X 轴为 0px，保证水平居中，纵向位移全权交由滚动容器处理，彻底解决左右跑偏与图片消失
                                const cleanTransform = currentTransform.replace(/translate3d\([^)]+\)/, 'translate3d(0px, 0px, 0px)');
                                nodeStyle = {
                                    ...nodeStyle,
                                    transform: cleanTransform,
                                    transformOrigin: 'top center'
                                };
                            }

                            return React.cloneElement(originalNode, {
                                className: `${originalNode.props.className || ''} ${scale > 1 ? 'is-zoomed' : ''}`.trim(),
                                style: {
                                    ...nodeStyle,
                                    cursor: isTall ? 'grab' : scale > 1 ? 'grab' : originalNode.props.style?.cursor
                                },
                                draggable: false
                            });
                        },
                        toolbarRender: (originalNode, info) => {
                            const scale = info?.transform?.scale || 1;
                            const isTall = Boolean(imagePreview.images[imagePreview.current]?.isTall);
                            return (
                                <Space size={12} className="cloud-note-preview-custom-toolbar">
                                    {originalNode}
                                    <Tooltip title={scale > 1 ? '复位至初始比例 (1:1)' : '当前已是初始比例'}>
                                        <OneToOneOutlined
                                            className={`cloud-note-preview-toolbar-btn ${scale <= 1 ? 'is-disabled' : ''}`}
                                            onClick={() => {
                                                if (scale > 1) {
                                                    info?.actions?.onReset?.();
                                                    if (isTall) {
                                                        const wrap = document.querySelector('.cloud-note-image-preview.is-tall-image .ant-image-preview-wrap');
                                                        if (wrap) wrap.scrollTo({ top: 0, behavior: 'smooth' });
                                                    }
                                                }
                                            }}
                                            style={scale <= 1 ? { opacity: 0.45, cursor: 'not-allowed' } : {}}
                                        />
                                    </Tooltip>
                                    <Tooltip title="在新标签页查看原图">
                                        <ExportOutlined
                                            className="cloud-note-preview-toolbar-btn"
                                            onClick={() => {
                                                const activeImg = imagePreview.images[imagePreview.current]?.src;
                                                if (activeImg) {
                                                    window.open(activeImg, '_blank');
                                                }
                                            }}
                                        />
                                    </Tooltip>
                                </Space>
                            );
                        }
                    }}
                >
                    {imagePreview.images.map((item, index) => (
                        <Image key={`${item.src}-${index}`} src={item.src} alt={item.alt} />
                    ))}
                </Image.PreviewGroup>
            </div>

            <WikiLinkHoverCard
                onSelectNote={onSelectNote}
                onCreateNote={handleCreateWikiLinkNote}
            />
        </div>
    );
};

export default NoteEditor;
