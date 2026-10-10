/**
 * wikiLinkPlugin.js - ByteMD 专用的双向链接 (WikiLinks [[笔记名称]]) 渲染与交互插件
 *
 * 功能：
 * 1. 扫描正文文本节点中的 [[笔记标题]] 语法（自动跳过 pre / code / a 等保护标签）；
 * 2. 转换为现代沉浸式双链徽标 (badge)，支持自定义别名 [[笔记标题|别名]] 语法；
 * 3. 绑定点击交互，通过自定义事件 'open-wiki-link' 驱动平滑笔记切换或占位创建；
 * 4. 键盘无障碍访问（Tab 聚焦 + 回车跳转）。
 */

const WIKI_LINK_REGEX = /\[\[([^[\]\r\n]+)\]\]/g;
const EXCLUDED_TAGS = new Set(['PRE', 'CODE', 'A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SCRIPT', 'STYLE']);

function processTextNode(node) {
    const text = node.nodeValue;
    if (!text || !text.includes('[[')) return null;

    WIKI_LINK_REGEX.lastIndex = 0;
    if (!WIKI_LINK_REGEX.test(text)) return null;

    WIKI_LINK_REGEX.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match;

    while ((match = WIKI_LINK_REGEX.exec(text)) !== null) {
        const matchStart = match.index;
        const matchEnd = WIKI_LINK_REGEX.lastIndex;

        // 匹配前普通文本
        if (matchStart > lastIndex) {
            fragment.appendChild(document.createTextNode(text.slice(lastIndex, matchStart)));
        }

        const rawTarget = match[1].trim();
        // 处理别名语法：[[真实标题|展示别名]]
        let targetTitle = rawTarget;
        let displayLabel = rawTarget;
        if (rawTarget.includes('|')) {
            const parts = rawTarget.split('|');
            targetTitle = parts[0].trim();
            displayLabel = parts.slice(1).join('|').trim() || targetTitle;
        }

        // 创建双链徽标元素
        const linkEl = document.createElement('span');
        linkEl.className = 'wiki-link';
        linkEl.setAttribute('role', 'button');
        linkEl.setAttribute('tabindex', '0');
        linkEl.setAttribute('data-target-title', targetTitle);
        linkEl.setAttribute('title', `跳转至笔记: 《${targetTitle}》`);

        linkEl.innerHTML = `
            <span class="wiki-link-icon" aria-hidden="true">
                <svg viewBox="0 0 1024 1024" width="12" height="12" fill="currentColor">
                    <path d="M574 665.4c-17.9 0-32.4 14.5-32.4 32.4 0 53.6-43.6 97.2-97.2 97.2H240.2c-53.6 0-97.2-43.6-97.2-97.2V493.6c0-53.6 43.6-97.2 97.2-97.2h204.2c17.9 0 32.4-14.5 32.4-32.4s-14.5-32.4-32.4-32.4H240.2C137 331.6 53 415.6 53 518.8v184.2c0 103.2 84 187.2 187.2 187.2h204.2c103.2 0 187.2-84 187.2-187.2-0.1-17.9-14.6-32.4-32.6-32.4z"/>
                    <path d="M783.8 133.8H579.6c-17.9 0-32.4 14.5-32.4 32.4s14.5 32.4 32.4 32.4h204.2c53.6 0 97.2 43.6 97.2 97.2v204.2c0 53.6-43.6 97.2-97.2 97.2H579.6c-17.9 0-32.4 14.5-32.4 32.4s14.5 32.4 32.4 32.4h204.2c103.2 0 187.2-84 187.2-187.2V295.8c0-103.2-84-162-187.2-162z"/>
                    <path d="M366.4 625.2c6.2 6.2 14.4 9.4 22.6 9.4s16.4-3.1 22.6-9.4l246-246c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-246 246c-12.5 12.5-12.5 32.7 0 45.3z"/>
                </svg>
            </span>
            <span class="wiki-link-title">${displayLabel}</span>
        `;

        fragment.appendChild(linkEl);
        lastIndex = matchEnd;
    }

    if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    return fragment;
}

function traverseAndReplace(node) {
    if (!node) return;

    if (node.nodeType === Node.TEXT_NODE) {
        const replacement = processTextNode(node);
        if (replacement && node.parentNode) {
            node.parentNode.replaceChild(replacement, node);
        }
        return;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
        if (EXCLUDED_TAGS.has(node.tagName)) {
            return;
        }

        const childNodes = Array.from(node.childNodes);
        for (const child of childNodes) {
            traverseAndReplace(child);
        }
    }
}

export default function wikiLinkPlugin(options = {}) {
    const { onWikiLinkClick } = options;

    return {
        viewerEffect({ markdownBody }) {
            if (!markdownBody) return undefined;

            traverseAndReplace(markdownBody);

            const handleClick = event => {
                const linkEl = event.target.closest('.wiki-link');
                if (!linkEl) return;

                event.preventDefault();
                event.stopPropagation();

                const targetTitle = linkEl.getAttribute('data-target-title');
                if (!targetTitle) return;

                if (typeof onWikiLinkClick === 'function') {
                    onWikiLinkClick(targetTitle);
                }

                window.dispatchEvent(
                    new CustomEvent('open-wiki-link', {
                        detail: { title: targetTitle }
                    })
                );
            };

            const handleKeyDown = event => {
                if (event.key === 'Enter') {
                    const linkEl = event.target.closest('.wiki-link');
                    if (linkEl) {
                        handleClick(event);
                    }
                }
            };

            markdownBody.addEventListener('click', handleClick);
            markdownBody.addEventListener('keydown', handleKeyDown);

            return () => {
                markdownBody.removeEventListener('click', handleClick);
                markdownBody.removeEventListener('keydown', handleKeyDown);
            };
        }
    };
}
