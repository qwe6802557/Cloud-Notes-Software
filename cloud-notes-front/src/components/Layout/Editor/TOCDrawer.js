import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Drawer, Empty } from 'antd';
import { CloseOutlined, CompassOutlined } from '@ant-design/icons';
import './TOCDrawer.less';

const extractHeadingsFromMarkdown = content => {
    if (!content) {
        return [];
    }

    const lines = content.split('\n');
    const headings = [];
    let inCodeBlock = false;

    lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            return;
        }

        if (inCodeBlock) {
            return;
        }

        const match = line.match(/^(#{1,6})\s+(.+)$/);
        if (match) {
            const level = match[1].length;
            const rawText = match[2].trim();
            // 去除行内 markdown 语法如 **粗体**、*斜体*、`代码`
            const cleanText = rawText
                .replace(/\*\*(.*?)\*\*/g, '$1')
                .replace(/\*(.*?)\*/g, '$1')
                .replace(/`(.*?)`/g, '$1')
                .replace(/\[(.*?)\]\(.*?\)/g, '$1')
                .trim();

            headings.push({
                id: `toc-heading-${headings.length}`,
                level,
                text: cleanText || rawText,
                lineIndex: index,
                raw: line
            });
        }
    });

    return headings;
};

const TOCDrawer = ({ visible, onClose, content, editorContextRef }) => {
    const headings = useMemo(() => extractHeadingsFromMarkdown(content), [content]);
    const [activeHeadingIndex, setActiveHeadingIndex] = useState(0);

    // 滚动监听，动态高亮当前视口所在的大纲项
    useEffect(() => {
        if (!visible || headings.length === 0) {
            return undefined;
        }

        const handleScroll = () => {
            const previewContainer = document.querySelector('.preview-only .markdown-body, .bytemd-preview .markdown-body');
            const headingElements = previewContainer
                ? Array.from(previewContainer.querySelectorAll('h1, h2, h3, h4, h5, h6'))
                : [];

            if (headingElements.length > 0) {
                const scrollOffset = 120;
                let activeIdx = 0;

                headingElements.forEach((el, idx) => {
                    const rect = el.getBoundingClientRect();
                    if (rect.top <= scrollOffset) {
                        activeIdx = idx;
                    }
                });

                setActiveHeadingIndex(activeIdx);
                return;
            }

            // 若在纯编辑模式下，根据 CodeMirror 滚动位置定位行数
            const editorInstance = editorContextRef?.current?.editor;
            if (editorInstance?.getScrollInfo && editorInstance?.lineAtHeight) {
                const scrollInfo = editorInstance.getScrollInfo();
                const currentLine = editorInstance.lineAtHeight(scrollInfo.top, 'local');

                let activeIdx = 0;
                headings.forEach((h, idx) => {
                    if (h.lineIndex <= currentLine) {
                        activeIdx = idx;
                    }
                });
                setActiveHeadingIndex(activeIdx);
            }
        };

        const scrollContainer = document.querySelector('.bytemd-preview') ||
            document.querySelector('.preview-only') ||
            document.querySelector('.CodeMirror-scroll') ||
            window;

        scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
        handleScroll();

        return () => {
            scrollContainer.removeEventListener('scroll', handleScroll);
        };
    }, [visible, headings, editorContextRef]);

    const handleHeadingClick = useCallback((heading, index) => {
        setActiveHeadingIndex(index);

        // 1. 尝试在预览容器中滚动定位
        const previewContainer = document.querySelector('.preview-only .markdown-body, .bytemd-preview .markdown-body');
        if (previewContainer) {
            const headingElements = Array.from(previewContainer.querySelectorAll('h1, h2, h3, h4, h5, h6'));
            const targetEl = headingElements[index];
            if (targetEl) {
                targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }

        // 2. 尝试在 CodeMirror 编辑器中同步跳转至该行
        const editorInstance = editorContextRef?.current?.editor;
        if (editorInstance?.setCursor && editorInstance?.scrollIntoView) {
            const line = heading.lineIndex;
            editorInstance.setCursor({ line, ch: 0 });
            editorInstance.scrollIntoView({ line, ch: 0 }, 100);
            editorInstance.focus();
        }
    }, [editorContextRef]);

    return (
        <Drawer
            title={
                <div className="toc-drawer-header">
                    <CompassOutlined className="toc-header-icon" />
                    <span className="toc-header-title">文章大纲</span>
                    <span className="toc-header-count">{headings.length} 个节点</span>
                </div>
            }
            placement="right"
            width={280}
            open={visible}
            onClose={onClose}
            mask={false}
            zIndex={1010}
            className="cloud-notes-toc-drawer"
            closeIcon={<CloseOutlined className="toc-close-btn" />}
        >
            {headings.length === 0 ? (
                <div className="toc-empty-box">
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={
                            <div className="toc-empty-desc">
                                <div>当前文档暂无标题</div>
                                <div className="toc-empty-hint">在正文使用 # 一级标题、## 二级标题 即可自动生成目录</div>
                            </div>
                        }
                    />
                </div>
            ) : (
                <div className="toc-list-wrapper">
                    {headings.map((heading, index) => {
                        const isActive = activeHeadingIndex === index;
                        const indentClass = `toc-level-${heading.level}`;

                        return (
                            <div
                                key={heading.id}
                                className={`toc-item ${indentClass} ${isActive ? 'is-active' : ''}`}
                                onClick={() => handleHeadingClick(heading, index)}
                                title={heading.text}
                            >
                                <span className="toc-item-indicator" />
                                <span className="toc-item-text">{heading.text}</span>
                            </div>
                        );
                    })}
                </div>
            )}
        </Drawer>
    );
};

export default TOCDrawer;
