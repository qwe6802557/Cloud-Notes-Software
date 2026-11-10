import React from 'react';
import {
    ScissorOutlined,
    CopyOutlined,
    SnippetsOutlined,
    UndoOutlined,
    RedoOutlined,
    BoldOutlined,
    CodeOutlined,
    LinkOutlined,
    ThunderboltOutlined,
    FileTextOutlined,
    ClockCircleOutlined,
    EyeOutlined,
    BorderOutlined
} from '@ant-design/icons';
import ContextMenu from '@/components/ContextMenu';

/**
 * 编辑器动态上下文感知右键菜单
 */
const EditorContextMenu = ({
    open = false,
    x = 0,
    y = 0,
    onClose,
    selectedText = '',
    targetImg = null,
    onCut,
    onCopy,
    onPaste,
    onUndo,
    onRedo,
    onSelectAll,
    onFormat,
    onInsertTimestamp,
    onInsertDivider,
    onAIAction,
    onCopyImageUrl,
    onPreviewImage
}) => {
    if (!open) return null;

    const hasSelection = Boolean(selectedText && selectedText.trim().length > 0);
    const items = [];

    if (targetImg) {
        items.push(
            {
                key: 'copy-image-url',
                label: '复制图片直链',
                icon: <CopyOutlined />,
                onClick: onCopyImageUrl
            },
            {
                key: 'preview-image',
                label: '全屏大图预览',
                icon: <EyeOutlined />,
                onClick: onPreviewImage
            }
        );
        if (hasSelection) {
            items.push({ type: 'divider' });
        }
    }

    if (hasSelection) {
        items.push(
            {
                key: 'cut',
                label: '剪切',
                icon: <ScissorOutlined />,
                shortcut: 'Ctrl+X',
                onClick: onCut
            },
            {
                key: 'copy',
                label: '复制',
                icon: <CopyOutlined />,
                shortcut: 'Ctrl+C',
                onClick: onCopy
            },
            {
                key: 'paste',
                label: '粘贴',
                icon: <SnippetsOutlined />,
                shortcut: 'Ctrl+V',
                onClick: onPaste
            },
            { type: 'divider' },
            {
                key: 'format-bold',
                label: '包裹粗体',
                icon: <BoldOutlined />,
                shortcut: 'Ctrl+B',
                onClick: () => onFormat?.('bold')
            },
            {
                key: 'format-code',
                label: '包裹行内代码',
                icon: <CodeOutlined />,
                shortcut: '`',
                onClick: () => onFormat?.('code')
            },
            {
                key: 'format-wikilink',
                label: '设为双链引用',
                icon: <LinkOutlined style={{ color: '#2563eb' }} />,
                shortcut: '[[ ]]',
                onClick: () => onFormat?.('wikilink')
            },
            { type: 'divider' },
            {
                key: 'ai-polish',
                label: 'AI 语法润色',
                icon: <ThunderboltOutlined style={{ color: '#2563eb' }} />,
                onClick: () => onAIAction?.('polish')
            },
            {
                key: 'ai-summary',
                label: 'AI 核心要点提炼',
                icon: <FileTextOutlined style={{ color: '#2563eb' }} />,
                onClick: () => onAIAction?.('summary')
            },
            { type: 'divider' },
            {
                key: 'select-all',
                label: '全选',
                icon: <BorderOutlined />,
                shortcut: 'Ctrl+A',
                onClick: onSelectAll
            }
        );
    } else if (!targetImg) {
        items.push(
            {
                key: 'undo',
                label: '撤销',
                icon: <UndoOutlined />,
                shortcut: 'Ctrl+Z',
                onClick: onUndo
            },
            {
                key: 'redo',
                label: '重做',
                icon: <RedoOutlined />,
                shortcut: 'Ctrl+Y',
                onClick: onRedo
            },
            { type: 'divider' },
            {
                key: 'paste',
                label: '粘贴',
                icon: <SnippetsOutlined />,
                shortcut: 'Ctrl+V',
                onClick: onPaste
            },
            {
                key: 'select-all',
                label: '全选',
                icon: <BorderOutlined />,
                shortcut: 'Ctrl+A',
                onClick: onSelectAll
            },
            { type: 'divider' },
            {
                key: 'insert-timestamp',
                label: '插入当前时间戳',
                icon: <ClockCircleOutlined />,
                onClick: onInsertTimestamp
            },
            {
                key: 'insert-divider',
                label: '插入分割线',
                icon: <BorderOutlined />,
                shortcut: '---',
                onClick: onInsertDivider
            }
        );
    }

    return (
        <ContextMenu
            open={open}
            x={x}
            y={y}
            onClose={onClose}
            items={items}
        />
    );
};

export default EditorContextMenu;
