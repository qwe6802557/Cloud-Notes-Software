import React, { useEffect, useRef, useState, useCallback } from 'react';
import { getKnowledgeGraph, suggestNoteLinks } from '@/api/notes';
import {
    ApartmentOutlined,
    ZoomInOutlined,
    ZoomOutOutlined,
    AimOutlined,
    FullscreenOutlined,
    FullscreenExitOutlined,
    SearchOutlined,
    SettingOutlined,
    ReloadOutlined,
    FileTextOutlined
} from '@ant-design/icons';
import { Input, Select, Button, Slider, Popover, Tooltip, Empty, Spin, Tag, Switch } from 'antd';
import './index.less';

const DEFAULT_SETTINGS = {
    repulsion: 180,
    linkDistance: 120,
    showLabels: true,
    hideOrphans: false
};

const KnowledgeGraph = ({
    focusNoteId = null,
    onSelectNote = null,
    isLocalMode = false
}) => {
    const containerRef = useRef(null);
    const canvasRef = useRef(null);
    const animFrameRef = useRef(null);

    const [loading, setLoading] = useState(false);
    const [graphData, setGraphData] = useState({ nodes: [], links: [], notebooks: [] });
    const [selectedNotebook, setSelectedNotebook] = useState('all');
    const [searchKeyword, setSearchKeyword] = useState('');
    const [physicsParams, setPhysicsParams] = useState(DEFAULT_SETTINGS);
    const [isFullscreen, setIsFullscreen] = useState(false);

    // 交互状态 Refs（避免每帧重触发 React 渲染）
    const transformRef = useRef({ x: 0, y: 0, scale: 1 });
    const hoverNodeRef = useRef(null);
    const dragNodeRef = useRef(null);
    const isDraggingCanvasRef = useRef(false);
    const lastMousePosRef = useRef({ x: 0, y: 0 });
    const simulationNodesRef = useRef([]);
    const simulationLinksRef = useRef([]);
    const alphaRef = useRef(1.0);

    // 悬停气泡状态（用于展示 rich tooltip）与正文摘要缓存
    const [tooltipInfo, setTooltipInfo] = useState(null);
    const [nodeSnippets, setNodeSnippets] = useState({});
    const snippetCacheRef = useRef(new Map());

    // 拉取图谱数据
    const fetchGraph = useCallback(async () => {
        setLoading(true);
        try {
            const params = {};
            if (selectedNotebook && selectedNotebook !== 'all') {
                params.notebookId = selectedNotebook;
            }
            if (focusNoteId) {
                params.focusNoteId = focusNoteId;
                params.depth = isLocalMode ? 1 : 2;
            }

            const res = await getKnowledgeGraph(params);
            const data = res?.data || res || { nodes: [], links: [], notebooks: [] };

            // 初始化节点物理坐标与质量
            const width = containerRef.current?.clientWidth || 800;
            const height = containerRef.current?.clientHeight || 600;

            const existingMap = new Map();
            simulationNodesRef.current.forEach(n => existingMap.set(n.id, { x: n.x, y: n.y, vx: n.vx, vy: n.vy }));

            const nodes = (data.nodes || []).map((node, i) => {
                const existing = existingMap.get(node.id);
                // 角度散列初值
                const angle = (i / Math.max(1, data.nodes.length)) * Math.PI * 2;
                const radius = 60 + Math.random() * (Math.min(width, height) * 0.35);

                const inDeg = node.inDegree || 0;
                const nodeRadius = Math.min(22, Math.max(8, 7 + Math.sqrt(inDeg) * 3.5));

                return {
                    ...node,
                    radius: nodeRadius,
                    x: existing ? existing.x : Math.cos(angle) * radius,
                    y: existing ? existing.y : Math.sin(angle) * radius,
                    vx: existing ? existing.vx * 0.5 : (Math.random() - 0.5) * 2,
                    vy: existing ? existing.vy * 0.5 : (Math.random() - 0.5) * 2
                };
            });

            // 索引边关系
            const nodeById = new Map();
            nodes.forEach(n => nodeById.set(n.id, n));

            const links = (data.links || [])
                .map(link => {
                    const sourceNode = nodeById.get(link.source);
                    const targetNode = nodeById.get(link.target);
                    if (!sourceNode || !targetNode) return null;
                    return {
                        source: sourceNode,
                        target: targetNode
                    };
                })
                .filter(Boolean);

            simulationNodesRef.current = nodes;
            simulationLinksRef.current = links;
            setGraphData(data);
            alphaRef.current = 1.0;

            // 居中画布视口
            transformRef.current = {
                x: width / 2,
                y: height / 2,
                scale: isLocalMode ? 1.2 : 0.95
            };
        } catch {
            setGraphData({ nodes: [], links: [], notebooks: [] });
        } finally {
            setLoading(false);
        }
    }, [selectedNotebook, focusNoteId, isLocalMode]);

    useEffect(() => {
        fetchGraph();
    }, [fetchGraph]);

    // 屏幕物理坐标 -> 画布世界坐标转换
    const screenToWorld = useCallback((screenX, screenY) => {
        const t = transformRef.current;
        return {
            x: (screenX - t.x) / t.scale,
            y: (screenY - t.y) / t.scale
        };
    }, []);

    // 物理力学步进与 Canvas 渲染循环
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return undefined;
        const ctx = canvas.getContext('2d');

        let isRunning = true;
        alphaRef.current = 1.0;

        const renderFrame = () => {
            if (!isRunning) return;

            const dpr = window.devicePixelRatio || 1;
            const width = canvas.clientWidth;
            const height = canvas.clientHeight;

            if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
                canvas.width = width * dpr;
                canvas.height = height * dpr;
            }

            ctx.save();
            ctx.scale(dpr, dpr);
            ctx.clearRect(0, 0, width, height);

            const nodes = simulationNodesRef.current;
            const links = simulationLinksRef.current;
            const { repulsion, linkDistance, showLabels } = physicsParams;

            // 1. 物理力学模拟步进
            if (alphaRef.current > 0.005) {
                const kRepulsion = repulsion * 20;
                const kSpring = 0.04;
                const damping = 0.88;
                const alpha = alphaRef.current;

                // 节点间库仑斥力
                for (let i = 0; i < nodes.length; i++) {
                    const n1 = nodes[i];
                    for (let j = i + 1; j < nodes.length; j++) {
                        const n2 = nodes[j];
                        const dx = n2.x - n1.x;
                        const dy = n2.y - n1.y;
                        const distSq = dx * dx + dy * dy + 100;
                        const dist = Math.sqrt(distSq);

                        const force = (kRepulsion / distSq) * alpha;
                        const fx = (dx / dist) * force;
                        const fy = (dy / dist) * force;

                        if (n1 !== dragNodeRef.current) {
                            n1.vx -= fx;
                            n1.vy -= fy;
                        }
                        if (n2 !== dragNodeRef.current) {
                            n2.vx += fx;
                            n2.vy += fy;
                        }
                    }
                }

                // 边弹簧引力
                for (let i = 0; i < links.length; i++) {
                    const link = links[i];
                    const { source, target } = link;
                    const dx = target.x - source.x;
                    const dy = target.y - source.y;
                    const dist = Math.sqrt(dx * dx + dy * dy) || 1;

                    const force = (dist - linkDistance) * kSpring * alpha;
                    const fx = (dx / dist) * force;
                    const fy = (dy / dist) * force;

                    if (source !== dragNodeRef.current) {
                        source.vx += fx;
                        source.vy += fy;
                    }
                    if (target !== dragNodeRef.current) {
                        target.vx -= fx;
                        target.vy -= fy;
                    }
                }

                // 中心微弱向心力 (保持在视野原点周围)
                for (let i = 0; i < nodes.length; i++) {
                    const n = nodes[i];
                    if (n === dragNodeRef.current) continue;

                    n.vx += (0 - n.x) * 0.002 * alpha;
                    n.vy += (0 - n.y) * 0.002 * alpha;

                    n.vx *= damping;
                    n.vy *= damping;

                    n.x += n.vx;
                    n.y += n.vy;
                }

                alphaRef.current *= 0.992;
            }

            // 2. 变换矩阵应用
            const t = transformRef.current;
            ctx.save();
            ctx.translate(t.x, t.y);
            ctx.scale(t.scale, t.scale);

            // 检查当前悬停节点及其关联边
            const hoverNode = hoverNodeRef.current;
            const connectedNodeIds = new Set();
            if (hoverNode) {
                connectedNodeIds.add(hoverNode.id);
                links.forEach(l => {
                    if (l.source.id === hoverNode.id) connectedNodeIds.add(l.target.id);
                    if (l.target.id === hoverNode.id) connectedNodeIds.add(l.source.id);
                });
            }

            // 3. 绘制连线
            for (let i = 0; i < links.length; i++) {
                const { source, target } = links[i];
                const isHighlighted =
                    hoverNode && (source.id === hoverNode.id || target.id === hoverNode.id);

                ctx.beginPath();
                ctx.moveTo(source.x, source.y);
                ctx.lineTo(target.x, target.y);

                if (isHighlighted) {
                    ctx.strokeStyle = '#3b82f6';
                    ctx.lineWidth = 2.2 / t.scale;
                    ctx.globalAlpha = 0.95;
                } else if (hoverNode) {
                    ctx.strokeStyle = '#cbd5e1';
                    ctx.lineWidth = 1 / t.scale;
                    ctx.globalAlpha = 0.15;
                } else {
                    ctx.strokeStyle = '#94a3b8';
                    ctx.lineWidth = 1.2 / t.scale;
                    ctx.globalAlpha = 0.4;
                }
                ctx.stroke();
            }
            ctx.globalAlpha = 1.0;

            // 4. 绘制节点
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                if (physicsParams.hideOrphans && node.inDegree === 0 && !connectedNodeIds.has(node.id) && node.id !== focusNoteId) {
                    continue;
                }

                const isHovered = hoverNode && hoverNode.id === node.id;
                const isConnected = hoverNode && connectedNodeIds.has(node.id);
                const isFocus = node.id === focusNoteId;
                const baseColor = node.notebookColor || '#3b82f6';

                ctx.save();
                ctx.translate(node.x, node.y);

                let radius = node.radius;
                if (isHovered) radius += 4;
                if (isFocus) radius += 2;

                // 聚焦或悬停外光晕
                if (isHovered || isFocus) {
                    ctx.beginPath();
                    ctx.arc(0, 0, radius + 6, 0, Math.PI * 2);
                    ctx.fillStyle = isFocus ? 'rgba(234, 88, 12, 0.25)' : 'rgba(59, 130, 246, 0.25)';
                    ctx.fill();
                }

                // 节点主体圆
                ctx.beginPath();
                ctx.arc(0, 0, radius, 0, Math.PI * 2);
                ctx.fillStyle = baseColor;
                if (hoverNode && !isConnected) {
                    ctx.globalAlpha = 0.2;
                }
                ctx.fill();

                // 描边
                ctx.lineWidth = 2 / t.scale;
                ctx.strokeStyle = isFocus ? '#ea580c' : '#ffffff';
                ctx.stroke();

                // 5. 绘制文本标签 (LOD 分级、防重叠与悬停聚焦优化)
                let shouldDrawLabel = false;
                let isFullText = false;

                if (showLabels) {
                    if (hoverNode) {
                        // 悬停模式：仅展示当前悬停节点及其直连邻居或当前聚焦节点，其余背景节点文字全部隐去
                        if (isHovered || isConnected || isFocus) {
                            shouldDrawLabel = true;
                            isFullText = isHovered;
                        }
                    } else {
                        // 无悬停时按视口缩放比例 (LOD) 分级展示
                        if (isFocus) {
                            shouldDrawLabel = true;
                            isFullText = true;
                        } else if (node.inDegree >= 3) {
                            // 核心高入度枢纽节点始终展示
                            shouldDrawLabel = true;
                        } else if (t.scale >= 2.0) {
                            // 深度放大特写视图 (间距充裕)：全部展示
                            shouldDrawLabel = true;
                        } else if (t.scale >= 1.25 && (node.inDegree >= 1 || nodes.length < 40)) {
                            // 中景视图：展示有链接的节点，或小规模图谱全部展示
                            shouldDrawLabel = true;
                        }
                    }
                }

                if (shouldDrawLabel) {
                    const rawTitle = node.title || '未命名';
                    // 未悬停且非聚焦状态下进行长文本截断，防止横向过长碰撞遮挡
                    const label = isFullText || rawTitle.length <= 12
                        ? rawTitle
                        : `${rawTitle.slice(0, 10)}...`;

                    const fontSize = Math.max(10, 12 / Math.min(1.5, t.scale));
                    ctx.font = isHovered ? `600 ${fontSize}px sans-serif` : `500 ${fontSize}px sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'top';

                    const textY = radius + 4;
                    const metrics = ctx.measureText(label);
                    const padX = 6;
                    const padY = 3;
                    const textW = metrics.width;
                    const textH = fontSize + 2;

                    if (isHovered) {
                        // 悬停目标：深色高对比度毛玻璃胶囊
                        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
                        ctx.beginPath();
                        ctx.roundRect(-textW / 2 - padX, textY - padY, textW + padX * 2, textH + padY * 2, 4);
                        ctx.fill();

                        ctx.fillStyle = '#ffffff';
                        ctx.fillText(label, 0, textY);
                    } else if (isConnected || isFocus) {
                        // 关联节点 / 聚焦节点：品牌淡蓝胶囊
                        ctx.fillStyle = 'rgba(239, 246, 255, 0.95)';
                        ctx.strokeStyle = '#93c5fd';
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.roundRect(-textW / 2 - padX, textY - padY, textW + padX * 2, textH + padY * 2, 4);
                        ctx.fill();
                        ctx.stroke();

                        ctx.fillStyle = '#1d4ed8';
                        ctx.fillText(label, 0, textY);
                    } else {
                        // 普通状态 (LOD)：轻量级文字发光描边（无大白块胶囊，彻底杜绝膏药遮挡）
                        ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
                        ctx.lineWidth = 3 / t.scale;
                        ctx.strokeText(label, 0, textY);

                        ctx.fillStyle = '#334155';
                        ctx.fillText(label, 0, textY);
                    }
                }

                ctx.restore();
            }

            ctx.restore();
            ctx.restore();

            animFrameRef.current = requestAnimationFrame(renderFrame);
        };

        animFrameRef.current = requestAnimationFrame(renderFrame);

        return () => {
            isRunning = false;
            if (animFrameRef.current) {
                cancelAnimationFrame(animFrameRef.current);
            }
        };
    }, [physicsParams, focusNoteId]);

    // 命中测试：寻找鼠标指针下的节点
    const findNodeUnderMouse = useCallback(
        (screenX, screenY) => {
            const worldPos = screenToWorld(screenX, screenY);
            const nodes = simulationNodesRef.current;
            for (let i = nodes.length - 1; i >= 0; i--) {
                const node = nodes[i];
                const dx = node.x - worldPos.x;
                const dy = node.y - worldPos.y;
                if (dx * dx + dy * dy <= (node.radius + 6) * (node.radius + 6)) {
                    return node;
                }
            }
            return null;
        },
        [screenToWorld]
    );

    // 鼠标移动监听 (悬停与拖拽)
    const handleMouseMove = useCallback(
        e => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            if (isDraggingCanvasRef.current) {
                // 画布平移
                const dx = mouseX - lastMousePosRef.current.x;
                const dy = mouseY - lastMousePosRef.current.y;
                transformRef.current.x += dx;
                transformRef.current.y += dy;
                lastMousePosRef.current = { x: mouseX, y: mouseY };
                return;
            }

            if (dragNodeRef.current) {
                // 拖拽特定节点
                const worldPos = screenToWorld(mouseX, mouseY);
                dragNodeRef.current.x = worldPos.x;
                dragNodeRef.current.y = worldPos.y;
                dragNodeRef.current.vx = 0;
                dragNodeRef.current.vy = 0;
                alphaRef.current = Math.max(alphaRef.current, 0.2);
                return;
            }

            // 悬停检测
            const targetNode = findNodeUnderMouse(mouseX, mouseY);
            hoverNodeRef.current = targetNode;

            if (targetNode) {
                canvas.style.cursor = 'pointer';

                // 智能视口避让
                const CARD_W = 280;
                const CARD_H = 160;
                let posX = e.clientX + 14;
                if (posX + CARD_W > window.innerWidth - 16) {
                    posX = Math.max(16, e.clientX - CARD_W - 14);
                }
                let posY = e.clientY + 14;
                if (posY + CARD_H > window.innerHeight - 16) {
                    posY = Math.max(16, e.clientY - CARD_H - 14);
                }

                setTooltipInfo({
                    node: targetNode,
                    x: posX,
                    y: posY
                });

                // 异步拉取摘要
                if (!snippetCacheRef.current.has(targetNode.id)) {
                    snippetCacheRef.current.set(targetNode.id, 'fetching');
                    suggestNoteLinks(targetNode.title).then(res => {
                        const suggestions = res?.data?.suggestions || res?.suggestions || [];
                        const match = suggestions.find(s => s._id === targetNode.id) || suggestions[0];
                        const snippet = match?.snippet || '暂无详细正文摘要';
                        snippetCacheRef.current.set(targetNode.id, snippet);
                        setNodeSnippets(prev => ({ ...prev, [targetNode.id]: snippet }));
                    }).catch(() => {
                        snippetCacheRef.current.set(targetNode.id, '暂无摘要');
                        setNodeSnippets(prev => ({ ...prev, [targetNode.id]: '暂无摘要' }));
                    });
                }
            } else {
                canvas.style.cursor = 'default';
                setTooltipInfo(null);
            }
        },
        [findNodeUnderMouse, screenToWorld]
    );

    // 鼠标按下
    const handleMouseDown = useCallback(
        e => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const targetNode = findNodeUnderMouse(mouseX, mouseY);
            if (targetNode) {
                dragNodeRef.current = targetNode;
                alphaRef.current = Math.max(alphaRef.current, 0.25);
            } else {
                isDraggingCanvasRef.current = true;
                lastMousePosRef.current = { x: mouseX, y: mouseY };
            }
        },
        [findNodeUnderMouse]
    );

    // 鼠标松开与点击
    const handleMouseUp = useCallback(
        () => {
            if (dragNodeRef.current) {
                dragNodeRef.current = null;
                alphaRef.current = Math.max(alphaRef.current, 0.35);
            }
            if (isDraggingCanvasRef.current) {
                isDraggingCanvasRef.current = false;
            }
        },
        []
    );

    // 单击打开笔记
    const handleClick = useCallback(
        e => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const targetNode = findNodeUnderMouse(mouseX, mouseY);
            if (targetNode && typeof onSelectNote === 'function') {
                onSelectNote(targetNode.id);
            }
        },
        [findNodeUnderMouse, onSelectNote]
    );

    // 滚轮缩放
    const handleWheel = useCallback(
        e => {
            e.preventDefault();
            const canvas = canvasRef.current;
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
            const t = transformRef.current;
            const newScale = Math.min(3.5, Math.max(0.2, t.scale * zoomFactor));

            // 以鼠标位置为缩放锚点
            t.x = mouseX - (mouseX - t.x) * (newScale / t.scale);
            t.y = mouseY - (mouseY - t.y) * (newScale / t.scale);
            t.scale = newScale;
        },
        []
    );

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return undefined;

        canvas.addEventListener('wheel', handleWheel, { passive: false });
        return () => {
            canvas.removeEventListener('wheel', handleWheel);
        };
    }, [handleWheel]);

    // 放大 / 缩小 / 重置视图
    const handleZoomIn = () => {
        const t = transformRef.current;
        const width = containerRef.current?.clientWidth || 800;
        const height = containerRef.current?.clientHeight || 600;
        const newScale = Math.min(3.5, t.scale * 1.25);
        t.x = width / 2 - (width / 2 - t.x) * (newScale / t.scale);
        t.y = height / 2 - (height / 2 - t.y) * (newScale / t.scale);
        t.scale = newScale;
    };

    const handleZoomOut = () => {
        const t = transformRef.current;
        const width = containerRef.current?.clientWidth || 800;
        const height = containerRef.current?.clientHeight || 600;
        const newScale = Math.max(0.2, t.scale * 0.8);
        t.x = width / 2 - (width / 2 - t.x) * (newScale / t.scale);
        t.y = height / 2 - (height / 2 - t.y) * (newScale / t.scale);
        t.scale = newScale;
    };

    const handleResetView = () => {
        const width = containerRef.current?.clientWidth || 800;
        const height = containerRef.current?.clientHeight || 600;
        transformRef.current = {
            x: width / 2,
            y: height / 2,
            scale: 0.95
        };
        alphaRef.current = 0.8;
    };

    // 搜索定位节点
    const handleSearch = value => {
        setSearchKeyword(value);
        if (!value) return;

        const matched = simulationNodesRef.current.find(n =>
            n.title?.toLowerCase().includes(value.toLowerCase())
        );

        if (matched) {
            const width = containerRef.current?.clientWidth || 800;
            const height = containerRef.current?.clientHeight || 600;
            transformRef.current = {
                x: width / 2 - matched.x * 1.4,
                y: height / 2 - matched.y * 1.4,
                scale: 1.4
            };
            hoverNodeRef.current = matched;
        }
    };

    // 全屏切换
    const toggleFullscreen = () => {
        if (!containerRef.current) return;
        if (!isFullscreen) {
            if (containerRef.current.requestFullscreen) {
                containerRef.current.requestFullscreen();
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
        setIsFullscreen(!isFullscreen);
    };

    const totalNodesCount = graphData.nodes?.length || 0;
    const totalLinksCount = graphData.links?.length || 0;

    return (
        <div
            className={`knowledge-graph-container ${isFullscreen ? 'is-fullscreen' : ''} ${
                isLocalMode ? 'is-local-mode' : ''
            }`}
            ref={containerRef}
        >
            {/* 顶部现代化操作控制台 */}
            <div className="graph-toolbar">
                <div className="toolbar-left">
                    <div className="toolbar-title">
                        <ApartmentOutlined className="icon" />
                        <span>{isLocalMode ? '局部关系雷达' : '知识网络图谱'}</span>
                        <Tag className="stats-tag" color="blue">
                            {totalNodesCount} 节点 · {totalLinksCount} 关联
                        </Tag>
                    </div>

                    {!isLocalMode && (
                        <Select
                            className="notebook-select"
                            value={selectedNotebook}
                            onChange={setSelectedNotebook}
                            size="small"
                            style={{ width: 140 }}
                            options={[
                                { label: '全部笔记本', value: 'all' },
                                ...(graphData.notebooks || []).map(nb => ({
                                    label: nb.name,
                                    value: nb.id
                                }))
                            ]}
                        />
                    )}
                </div>

                <div className="toolbar-right">
                    <Input
                        className="search-input"
                        placeholder="检索节点定位..."
                        prefix={<SearchOutlined />}
                        size="small"
                        allowClear
                        value={searchKeyword}
                        onChange={e => handleSearch(e.target.value)}
                        style={{ width: 160 }}
                    />

                    <Tooltip title="放大">
                        <Button
                            className="tool-btn"
                            size="small"
                            icon={<ZoomInOutlined />}
                            onClick={handleZoomIn}
                        />
                    </Tooltip>
                    <Tooltip title="缩小">
                        <Button
                            className="tool-btn"
                            size="small"
                            icon={<ZoomOutOutlined />}
                            onClick={handleZoomOut}
                        />
                    </Tooltip>
                    <Tooltip title="重置居中">
                        <Button
                            className="tool-btn"
                            size="small"
                            icon={<AimOutlined />}
                            onClick={handleResetView}
                        />
                    </Tooltip>
                    <Tooltip title="重新排布计算">
                        <Button
                            className="tool-btn"
                            size="small"
                            icon={<ReloadOutlined spin={loading} />}
                            onClick={fetchGraph}
                        />
                    </Tooltip>

                    <Popover
                        placement="bottomRight"
                        title={<span style={{ fontWeight: 600 }}>力导向物理学参数</span>}
                        trigger="click"
                        content={
                            <div className="physics-popover">
                                <div className="param-item">
                                    <div className="label">节点排斥力 ({physicsParams.repulsion})</div>
                                    <Slider
                                        min={80}
                                        max={400}
                                        value={physicsParams.repulsion}
                                        onChange={v =>
                                            setPhysicsParams(prev => ({ ...prev, repulsion: v }))
                                        }
                                    />
                                </div>
                                <div className="param-item">
                                    <div className="label">边弹性长度 ({physicsParams.linkDistance})</div>
                                    <Slider
                                        min={60}
                                        max={300}
                                        value={physicsParams.linkDistance}
                                        onChange={v =>
                                            setPhysicsParams(prev => ({ ...prev, linkDistance: v }))
                                        }
                                    />
                                </div>
                                <div className="param-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                                    <span style={{ fontSize: 13, color: '#475569' }}>显示节点文本</span>
                                    <Switch
                                        size="small"
                                        checked={physicsParams.showLabels}
                                        onChange={v => setPhysicsParams(prev => ({ ...prev, showLabels: v }))}
                                    />
                                </div>
                                <div className="param-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                                    <span style={{ fontSize: 13, color: '#475569' }}>隐藏孤立无关联节点</span>
                                    <Switch
                                        size="small"
                                        checked={physicsParams.hideOrphans}
                                        onChange={v => setPhysicsParams(prev => ({ ...prev, hideOrphans: v }))}
                                    />
                                </div>
                            </div>
                        }
                    >
                        <Tooltip title="图谱力学参数">
                            <Button className="tool-btn" size="small" icon={<SettingOutlined />} />
                        </Tooltip>
                    </Popover>

                    {!isLocalMode && (
                        <Tooltip title={isFullscreen ? '退出全屏' : '全屏展示'}>
                            <Button
                                className="tool-btn"
                                size="small"
                                icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                                onClick={toggleFullscreen}
                            />
                        </Tooltip>
                    )}
                </div>
            </div>

            {/* Canvas 画布区域 */}
            <div className="canvas-wrapper">
                <Spin spinning={loading} tip="正在计算知识网络力学拓扑...">
                    <canvas
                        ref={canvasRef}
                        className="graph-canvas"
                        onMouseMove={handleMouseMove}
                        onMouseDown={handleMouseDown}
                        onMouseUp={handleMouseUp}
                        onClick={handleClick}
                    />
                </Spin>

                {!loading && totalNodesCount === 0 && (
                    <div className="empty-graph-overlay">
                        <Empty description="暂无笔记知识网络数据，在笔记中输入 [[ 建立双向链接以生成图谱" />
                    </div>
                )}
            </div>

            {/* 悬停信息浮层 (Hover Peek Card) */}
            {tooltipInfo && (
                <div
                    className="graph-tooltip"
                    style={{
                        top: tooltipInfo.y,
                        left: tooltipInfo.x
                    }}
                >
                    <div className="tooltip-header">
                        <div className="tooltip-title">
                            <FileTextOutlined style={{ marginRight: 6, color: '#3b82f6', flexShrink: 0 }} />
                            <span title={tooltipInfo.node.title}>{tooltipInfo.node.title}</span>
                        </div>
                        {tooltipInfo.node.notebookName && (
                            <span
                                className="notebook-badge"
                                style={{
                                    backgroundColor: `${tooltipInfo.node.notebookColor || '#3b82f6'}18`,
                                    color: tooltipInfo.node.notebookColor || '#3b82f6',
                                    borderColor: `${tooltipInfo.node.notebookColor || '#3b82f6'}40`
                                }}
                            >
                                <span
                                    className="dot"
                                    style={{ backgroundColor: tooltipInfo.node.notebookColor || '#3b82f6' }}
                                />
                                {tooltipInfo.node.notebookName}
                            </span>
                        )}
                    </div>

                    <div className="tooltip-meta">
                        <span className="degree-tag in-degree">
                            被引: {tooltipInfo.node.inDegree || 0}
                        </span>
                        <span className="degree-tag out-degree">
                            引出: {tooltipInfo.node.outDegree || 0}
                        </span>
                    </div>

                    <div className="tooltip-snippet">
                        {nodeSnippets[tooltipInfo.node.id] && nodeSnippets[tooltipInfo.node.id] !== 'fetching' ? (
                            <div className="snippet-text">“{nodeSnippets[tooltipInfo.node.id]}”</div>
                        ) : (
                            <div className="snippet-loading">正在提取笔记摘要...</div>
                        )}
                    </div>

                    <div className="tooltip-action-tip">
                        <ApartmentOutlined style={{ marginRight: 4 }} />
                        点击节点直接打开此笔记
                    </div>
                </div>
            )}

            {/* 笔记本分类色彩图例 */}
            {!isLocalMode && graphData.notebooks?.length > 0 && (
                <div className="notebook-legend">
                    <span className="legend-label">图例:</span>
                    {graphData.notebooks.slice(0, 8).map(nb => (
                        <div key={nb.id} className="legend-item">
                            <span
                                className="color-dot"
                                style={{ backgroundColor: nb.color || '#3b82f6' }}
                            />
                            <span className="name">{nb.name}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default KnowledgeGraph;
