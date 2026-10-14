import React, { useEffect, useState, useRef, useCallback } from 'react';
import { message } from 'antd';
import { getNoteDictionary } from '@/api/notes';
import GhostLinkHoverCard from './GhostLinkHoverCard';
import './index.less';

/**
 * 提取文档中受 Markdown 语法保护的区间
 * 避免在代码块、行内代码、图片、已有双链与超链接中误标虚线
 */
const getProtectedRanges = text => {
    const ranges = [];
    if (!text) return ranges;

    const patterns = [
        /```[\s\S]*?```/g,            // 多行代码块
        /`[^`\n]+`/g,                  // 行内代码
        /\[\[[^\]\r\n]+\]\]/g,         // 已存在的双链
        /!?\[[^\]\r\n]*\]\([^)\r\n]*\)/g, // Markdown 链接与图片
        /<[^>\r\n]+>/g                 // HTML 标签
    ];

    patterns.forEach(regex => {
        let match;
        while ((match = regex.exec(text)) !== null) {
            ranges.push({
                start: match.index,
                end: match.index + match[0].length
            });
        }
    });

    return ranges;
};

/**
 * 检测指定区间是否与受保护区间重叠
 */
const isRangeProtected = (start, end, protectedRanges) => {
    return protectedRanges.some(r => Math.max(start, r.start) < Math.min(end, r.end));
};

/**
 * GhostLink 管理组件
 * 负责知识库词典获取、CodeMirror 文本扫描打标、悬浮卡片展示与一键织链动作
 */
const GhostLink = ({
    editorContextRef,
    containerRef,
    noteTitle,
    noteId,
    enabled = true
}) => {
    const [dictionary, setDictionary] = useState([]);
    const [hoverState, setHoverState] = useState({
        visible: false,
        position: { top: 0, left: 0 },
        activeItem: null
    });

    const dictionaryRef = useRef([]);
    const markersRef = useRef([]);
    const ignoredWordsRef = useRef(new Set());
    const scanTimerRef = useRef(null);
    const hoverTimerRef = useRef(null);
    const isMouseInCardRef = useRef(false);

    // 获取 CodeMirror 实例（优先从 contextRef 获取，降级从 DOM 获取）
    const getEditor = useCallback(() => {
        return editorContextRef?.current?.editor || containerRef?.current?.querySelector('.CodeMirror')?.CodeMirror;
    }, [editorContextRef, containerRef]);

    // 清理所有已生成的 CodeMirror TextMarker
    const clearMarkers = useCallback(() => {
        markersRef.current.forEach(item => {
            if (item && item.marker && typeof item.marker.clear === 'function') {
                item.marker.clear();
            }
        });
        markersRef.current = [];
    }, []);

    // 核心扫描与 TextMarker 标记逻辑
    const scanAndMarkGhostLinks = useCallback(() => {
        const cm = getEditor();
        if (!cm) return;

        // 若功能已关闭或词库为空，清除全部标记并退出
        if (!enabled || !dictionaryRef.current.length) {
            clearMarkers();
            return;
        }

        const fullText = cm.getValue();
        if (!fullText) {
            clearMarkers();
            return;
        }

        clearMarkers();

        const protectedRanges = getProtectedRanges(fullText);
        const occupiedRanges = [];
        const newMarkers = [];
        const currentTrimmedTitle = (noteTitle || '').trim().toLowerCase();

        dictionaryRef.current.forEach(item => {
            const title = (item.title || '').trim();
            if (title.length < 2) return;

            // 规避自环：排除当前打开的笔记自身标题
            const lowerTitle = title.toLowerCase();
            if (currentTrimmedTitle && lowerTitle === currentTrimmedTitle) return;

            // 排除当前会话已忽略的词
            if (ignoredWordsRef.current.has(lowerTitle)) return;

            // 构造安全正则，英文单词边界保护
            const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const prefix = /^[a-zA-Z0-9]/.test(title) ? '\\b' : '';
            const suffix = /[a-zA-Z0-9]$/.test(title) ? '\\b' : '';
            const regex = new RegExp(`${prefix}${escaped}${suffix}`, 'g');

            let match;
            while ((match = regex.exec(fullText)) !== null) {
                const start = match.index;
                const end = start + match[0].length;

                // 判断是否在语法保护区或已被更长的词条命中
                if (isRangeProtected(start, end, protectedRanges)) continue;
                if (isRangeProtected(start, end, occupiedRanges)) continue;

                occupiedRanges.push({ start, end });

                const fromPos = cm.posFromIndex(start);
                const toPos = cm.posFromIndex(end);

                const marker = cm.markText(fromPos, toPos, {
                    className: 'cm-ghost-link',
                    attributes: {
                        'data-ghost-title': title,
                        'data-ghost-id': item._id
                    }
                });

                newMarkers.push({
                    marker,
                    title,
                    item,
                    fromIndex: start,
                    toIndex: end
                });
            }
        });

        markersRef.current = newMarkers;
    }, [clearMarkers, getEditor, enabled, noteTitle]);

    // 防抖调度扫描
    const scheduleScan = useCallback(() => {
        if (scanTimerRef.current) {
            clearTimeout(scanTimerRef.current);
        }
        scanTimerRef.current = setTimeout(() => {
            scanAndMarkGhostLinks();
        }, 300);
    }, [scanAndMarkGhostLinks]);

    // 拉取全量笔记轻量词典
    useEffect(() => {
        let isMounted = true;
        getNoteDictionary()
            .then(res => {
                if (!isMounted) return;
                const list = res?.dictionary || res?.data?.dictionary || [];
                // 按标题长度降序排列，优先匹配较长复合概念词
                const sorted = [...list].sort((a, b) => (b.title || '').length - (a.title || '').length);
                dictionaryRef.current = sorted;
                setDictionary(sorted);
                scheduleScan();
            })
            .catch(() => {
                dictionaryRef.current = [];
            });

        return () => {
            isMounted = false;
        };
    }, [scheduleScan]);

    // 监听 CodeMirror 编辑变化与实例载入
    useEffect(() => {
        let attachedCm = null;
        let pollTimer = null;

        const handleChange = () => {
            scheduleScan();
        };

        const tryAttach = () => {
            const cm = getEditor();
            if (!cm) {
                pollTimer = setTimeout(tryAttach, 150);
                return;
            }

            attachedCm = cm;
            scanAndMarkGhostLinks();
            cm.on('change', handleChange);
        };

        tryAttach();

        return () => {
            if (pollTimer) clearTimeout(pollTimer);
            if (attachedCm && typeof attachedCm.off === 'function') {
                attachedCm.off('change', handleChange);
            }
            if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
        };
    }, [getEditor, scheduleScan, scanAndMarkGhostLinks, dictionary, enabled, noteTitle, noteId]);

    // 当 enabled 或当前笔记变化时立即刷新
    useEffect(() => {
        scheduleScan();
    }, [enabled, noteTitle, noteId, scheduleScan]);

    // 组件卸载时清理所有 TextMarker 与浮层
    useEffect(() => {
        return () => {
            clearMarkers();
            if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
            if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
        };
    }, [clearMarkers]);

    // 鼠标在编辑器内移动与悬浮检测
    useEffect(() => {
        const container = containerRef?.current;
        if (!container) return;

        const handleMouseOver = e => {
            const target = e.target.closest('.cm-ghost-link');
            if (!target) return;

            const targetTitle = target.getAttribute('data-ghost-title');
            if (!targetTitle) return;

            if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);

            hoverTimerRef.current = setTimeout(() => {
                const cm = editorContextRef?.current?.editor;
                if (!cm) return;

                // 统计该词条在全文中命中的总频次
                const occurrences = markersRef.current.filter(m => m.title === targetTitle);
                const matchedMarker = markersRef.current.find(m => m.title === targetTitle);
                const item = matchedMarker?.item || {
                    title: targetTitle,
                    notebookName: '知识库',
                    notebookColor: '#7c3aed'
                };

                const rect = target.getBoundingClientRect();
                let top = rect.bottom + 6;
                let left = rect.left;

                // 防止超出屏幕边界
                if (left + 300 > window.innerWidth - 20) {
                    left = Math.max(20, window.innerWidth - 310);
                }
                if (top + 160 > window.innerHeight) {
                    top = Math.max(20, rect.top - 160);
                }

                setHoverState({
                    visible: true,
                    position: { top, left },
                    activeItem: {
                        targetTitle,
                        noteId: item._id,
                        notebookName: item.notebookName,
                        notebookColor: item.notebookColor,
                        occurrencesCount: occurrences.length,
                        domElement: target
                    }
                });
            }, 180);
        };

        const handleMouseOut = e => {
            const target = e.target.closest('.cm-ghost-link');
            if (!target) return;

            if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);

            hoverTimerRef.current = setTimeout(() => {
                if (!isMouseInCardRef.current) {
                    setHoverState(prev => ({ ...prev, visible: false }));
                }
            }, 250);
        };

        container.addEventListener('mouseover', handleMouseOver);
        container.addEventListener('mouseout', handleMouseOut);

        return () => {
            container.removeEventListener('mouseover', handleMouseOver);
            container.removeEventListener('mouseout', handleMouseOut);
        };
    }, [containerRef, editorContextRef]);

    // 执行单处织链操作
    const handleWeaveSingle = useCallback(() => {
        const cm = getEditor();
        const activeItem = hoverState.activeItem;
        if (!cm || !activeItem) return;

        const { targetTitle, domElement } = activeItem;

        // 定位当前被点击的 TextMarker
        const matched = markersRef.current.find(m => {
            if (m.title !== targetTitle) return false;
            if (domElement) {
                const markerPos = m.marker.find();
                if (!markerPos) return false;
                const coords = cm.charCoords(markerPos.from, 'window');
                const domRect = domElement.getBoundingClientRect();
                return Math.abs(coords.top - domRect.top) < 15;
            }
            return true;
        }) || markersRef.current.find(m => m.title === targetTitle);

        if (matched) {
            const pos = matched.marker.find();
            if (pos) {
                cm.replaceRange(`[[${targetTitle}]]`, pos.from, pos.to);
                message.success(`已织入双链: 《${targetTitle}》`);
            }
        }

        setHoverState(prev => ({ ...prev, visible: false }));
        scheduleScan();
    }, [getEditor, hoverState.activeItem, scheduleScan]);

    // 执行全文批量织链操作
    const handleWeaveAll = useCallback(() => {
        const cm = getEditor();
        const activeItem = hoverState.activeItem;
        if (!cm || !activeItem) return;

        const { targetTitle } = activeItem;
        const matches = markersRef.current
            .filter(m => m.title === targetTitle)
            .map(m => ({ pos: m.marker.find(), marker: m.marker }))
            .filter(m => m.pos !== null && m.pos !== undefined);

        if (!matches.length) return;

        // 从文本末尾向文本前端倒序替换，防止字符位移影响前序位置
        matches.sort((a, b) => {
            if (b.pos.from.line !== a.pos.from.line) {
                return b.pos.from.line - a.pos.from.line;
            }
            return b.pos.from.ch - a.pos.from.ch;
        });

        cm.operation(() => {
            matches.forEach(item => {
                cm.replaceRange(`[[${targetTitle}]]`, item.pos.from, item.pos.to);
            });
        });

        message.success(`已批量织入 ${matches.length} 处双链: 《${targetTitle}》`);
        setHoverState(prev => ({ ...prev, visible: false }));
        scheduleScan();
    }, [getEditor, hoverState.activeItem, scheduleScan]);

    // 忽略当前词条感知
    const handleIgnore = useCallback(() => {
        const activeItem = hoverState.activeItem;
        if (!activeItem) return;

        const { targetTitle } = activeItem;
        ignoredWordsRef.current.add(targetTitle.toLowerCase());

        message.info(`已在当前会话忽略《${targetTitle}》`);
        setHoverState(prev => ({ ...prev, visible: false }));
        scanAndMarkGhostLinks();
    }, [hoverState.activeItem, scanAndMarkGhostLinks]);

    // 键盘支持：悬浮卡片开启状态下回车一键织链，Esc 关闭
    useEffect(() => {
        if (!hoverState.visible) return;

        const handleKeyDown = e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleWeaveSingle();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                setHoverState(prev => ({ ...prev, visible: false }));
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [hoverState.visible, handleWeaveSingle]);

    return (
        <GhostLinkHoverCard
            visible={hoverState.visible}
            position={hoverState.position}
            activeItem={hoverState.activeItem}
            onWeave={handleWeaveSingle}
            onWeaveAll={handleWeaveAll}
            onIgnore={handleIgnore}
            onMouseEnter={() => {
                isMouseInCardRef.current = true;
                if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
            }}
            onMouseLeave={() => {
                isMouseInCardRef.current = false;
                hoverTimerRef.current = setTimeout(() => {
                    setHoverState(prev => ({ ...prev, visible: false }));
                }, 200);
            }}
        />
    );
};

export default GhostLink;
