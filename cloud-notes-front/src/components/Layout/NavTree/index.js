import React, { useCallback, useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import {
    Tree,
    Input,
    Button,
    Dropdown,
    Modal,
    Tooltip,
    Avatar,
    Space,
    message,
    Select,
    TreeSelect,
    Empty
} from 'antd';
import {
    FolderOutlined,
    FolderOpenOutlined,
    FileMarkdownOutlined,
    PlusOutlined,
    MoreOutlined,
    StarOutlined,
    StarFilled,
    DeleteOutlined,
    ClockCircleOutlined,
    BookOutlined,
    SettingOutlined,
    UserOutlined,
    SyncOutlined,
    LogoutOutlined,
    SearchOutlined,
    EditOutlined,
    FolderAddOutlined,
    RollbackOutlined,
    LeftOutlined,
    RightOutlined
} from '@ant-design/icons';
import {
    getNotebooks,
    createNotebook,
    getNotebookNotes,
    getRecentNotes,
    getStarredNotes,
    getDeletedNotes,
    createNote,
    updateNote,
    deleteNote,
    restoreNote,
    updateNoteStarred,
    moveNoteNode
} from '@/api/notes';
import { getUser } from '@/utils/auth';
import SettingsModal from '@/components/SettingsModal';
import './index.less';

const SYSTEM_VIEWS = [
    { key: 'all', label: '全部笔记', icon: <BookOutlined /> },
    { key: 'recent', label: '最近文档', icon: <ClockCircleOutlined /> },
    { key: 'starred', label: '收藏文档', icon: <StarOutlined /> },
    { key: 'trash', label: '回收站', icon: <DeleteOutlined /> }
];

// 不可变更新树中指定节点的子节点
const updateTreeChildren = (list, key, children) => {
    return list.map(node => {
        if (node.key === key) {
            return {
                ...node,
                children
            };
        }
        if (node.children && Array.isArray(node.children)) {
            return {
                ...node,
                children: updateTreeChildren(node.children, key, children)
            };
        }
        return node;
    });
};

// 不可变更新树中指定节点的标题
const updateNodeTitleInTree = (list, key, newTitle) => {
    return list.map(node => {
        if (node.key === key) {
            return { ...node, title: newTitle };
        }
        if (node.children && Array.isArray(node.children)) {
            return { ...node, children: updateNodeTitleInTree(node.children, key, newTitle) };
        }
        return node;
    });
};

// 不可变更新树中指定节点的收藏状态
const updateNodeStarredInTree = (list, key, isStarred) => {
    return list.map(node => {
        if (node.key === key) {
            return { ...node, isStarred };
        }
        if (node.children && Array.isArray(node.children)) {
            return { ...node, children: updateNodeStarredInTree(node.children, key, isStarred) };
        }
        return node;
    });
};

// 不可变从树中移除指定节点
const removeNodeFromTree = (list, key) => {
    return list
        .filter(node => node.key !== key)
        .map(node => {
            if (node.children && Array.isArray(node.children)) {
                return { ...node, children: removeNodeFromTree(node.children, key) };
            }
            return node;
        });
};

// 不可变向树中指定父节点插入新节点
const insertNodeToTree = (list, parentId, newNode) => {
    if (!parentId || parentId === 'root') {
        return [newNode, ...list];
    }
    return list.map(node => {
        if (node.key === parentId) {
            const currentChildren = Array.isArray(node.children) ? node.children : [];
            return {
                ...node,
                children: [newNode, ...currentChildren]
            };
        }
        if (node.children && Array.isArray(node.children)) {
            return {
                ...node,
                children: insertNodeToTree(node.children, parentId, newNode)
            };
        }
        return node;
    });
};

// 递归判断 targetKey 是否为 dragKey 自身或其子孙节点
const isDescendantNode = (list, dragKey, targetKey) => {
    if (!list || !Array.isArray(list)) return false;
    if (dragKey === targetKey) return true;

    const findNode = (nodes, key) => {
        for (const n of nodes) {
            if (n.key === key) return n;
            if (n.children && Array.isArray(n.children)) {
                const found = findNode(n.children, key);
                if (found) return found;
            }
        }
        return null;
    };

    const dragNode = findNode(list, dragKey);
    if (!dragNode || !dragNode.children) return false;

    const containsKey = (children, key) => {
        if (!Array.isArray(children)) return false;
        for (const child of children) {
            if (child.key === key) return true;
            if (child.children && containsKey(child.children, key)) return true;
        }
        return false;
    };

    return containsKey(dragNode.children, targetKey);
};

// 深拷贝树节点结构
const cloneTreeData = data => {
    if (!Array.isArray(data)) return [];
    return data.map(item => ({
        ...item,
        children: item.children && Array.isArray(item.children)
            ? cloneTreeData(item.children)
            : (item.isFolder ? (item.children === undefined ? undefined : []) : undefined)
    }));
};

const NavTree = forwardRef(({
    collapsed,
    setCollapsed,
    selectedNotebook,
    setSelectedNotebook,
    selectedNote,
    setSelectedNote,
    canChangeSelection,
    savedNote,
    syncVersion,
    onSync,
    onLogout
}, ref) => {
    const [notebooks, setNotebooks] = useState([]);
    const [viewType, setViewType] = useState('all');
    const [treeData, setTreeData] = useState([]);
    const [flatListNotes, setFlatListNotes] = useState([]);
    const [expandedKeys, setExpandedKeys] = useState([]);
    const [autoExpandParent, setAutoExpandParent] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);

    // 模态弹窗状态
    const [dialogState, setDialogState] = useState({
        open: false,
        type: 'createNote', // 'createNote' | 'createFolder' | 'createNotebook' | 'rename' | 'move'
        node: null,
        targetParentId: null,
        title: ''
    });
    const [dialogSubmitting, setDialogSubmitting] = useState(false);
    const [moveFolderTree, setMoveFolderTree] = useState([]);
    const [settingsOpen, setSettingsOpen] = useState(false);

    // 拖拽交互状态
    const [draggingKey, setDraggingKey] = useState(null);
    const [isOverRootDropZone, setIsOverRootDropZone] = useState(false);
    const draggingNodeRef = useRef(null);
    const dragHoverTimerRef = useRef(null);

    // 右键上下文菜单定位状态
    const [contextMenu, setContextMenu] = useState({
        visible: false,
        x: 0,
        y: 0,
        node: null
    });

    const [modal, contextHolder] = Modal.useModal();
    const user = getUser();
    const userAvatar = user?.avatar && user.avatar !== 'default-avatar.png' ? user.avatar : null;
    const treeContainerRef = useRef(null);

    // 组件卸载时清理悬停定时器
    useEffect(() => {
        return () => {
            if (dragHoverTimerRef.current) {
                clearTimeout(dragHoverTimerRef.current);
                dragHoverTimerRef.current = null;
            }
        };
    }, []);

    // 保持最新选中的笔记本引用，避免作为 useCallback 依赖引发二次重复调用
    const selectedNotebookRef = useRef(selectedNotebook);
    selectedNotebookRef.current = selectedNotebook;

    // 加载笔记本列表（仅在初次挂载与 syncVersion 变更时拉取）
    const loadNotebooks = useCallback(async () => {
        try {
            const result = await getNotebooks();
            const list = result?.notebooks || [];
            setNotebooks(list);
            if (!selectedNotebookRef.current && list.length > 0) {
                const firstId = list[0].id || list[0]._id;
                setSelectedNotebook(firstId);
            }
        } catch {
            message.error('笔记本加载失败');
        }
    }, [setSelectedNotebook]);

    // 格式化后端数据为 Ant Design Tree 懒加载结构
    const formatTreeData = useCallback(nodes => {
        return (nodes || []).map(item => {
            const isFolder = item.type === 'folder';
            const nodeKey = item._id ? item._id.toString() : item.id;
            const hasChildren = Array.isArray(item.children) && item.children.length > 0;

            return {
                title: item.title,
                key: nodeKey,
                isFolder,
                isLeaf: !isFolder, // 文件夹不是叶子节点，支持异步懒加载展开
                isStarred: Boolean(item.isStarred),
                parentId: item.parentId ? item.parentId.toString() : null,
                notebookId: item.notebookId,
                order: item.order ?? 0,
                rawItem: item,
                children: hasChildren 
                    ? formatTreeData(item.children) 
                    : (isFolder ? (item.children === undefined ? undefined : []) : undefined)
            };
        });
    }, []);

    // 异步懒加载子节点 (loadData 回调)
    const onLoadData = useCallback(async node => {
        const { key, children } = node;
        // 如果 children 已加载（即已为数组），无需重复拉取
        if (children !== undefined) {
            return;
        }
        try {
            const result = await getNotebookNotes(selectedNotebook, { parentId: key });
            const childList = result?.notes || [];
            const formattedChildren = formatTreeData(childList);
            setTreeData(origin => updateTreeChildren(origin, key, formattedChildren));
        } catch {
            message.error('加载子目录失败');
        }
    }, [selectedNotebook, formatTreeData]);

    // 加载顶级树形笔记（仅拉取 parentId 为 null 的一级数据）
    const loadNotebookTree = useCallback(async notebookId => {
        if (!notebookId) {
            return;
        }
        setLoading(true);
        try {
            const result = await getNotebookNotes(notebookId, { parentId: 'null' });
            const rawNotes = result?.notes || [];
            const formatted = formatTreeData(rawNotes);
            setTreeData(formatted);
            setExpandedKeys([]); // 默认全部收起，提高初次加载与渲染性能
        } catch {
            message.error('加载目录树失败');
        } finally {
            setLoading(false);
        }
    }, [formatTreeData]);

    // 重新拉取整树数据并保持指定父级处于展开状态
    const refreshNotebookTree = useCallback(async (notebookId, targetParentToExpand = null) => {
        if (!notebookId) return;
        try {
            const result = await getNotebookNotes(notebookId, { all: 'true' });
            const rawTree = result?.tree || result?.notes || [];
            const formatted = formatTreeData(rawTree);
            setTreeData(formatted);
            if (targetParentToExpand) {
                setExpandedKeys(prev => Array.from(new Set([...prev, targetParentToExpand])));
            }
        } catch {
            message.error('刷新目录树失败');
        }
    }, [formatTreeData]);

    // 执行节点移动与同级排序持久化
    const executeMoveNode = useCallback(async (nodeKey, targetParentId, orderedSiblingIds = []) => {
        try {
            await moveNoteNode(nodeKey, {
                targetParentId,
                notebookId: selectedNotebook,
                orderedSiblingIds
            });
            if (targetParentId) {
                setExpandedKeys(prev => Array.from(new Set([...prev, targetParentId])));
            }
            await refreshNotebookTree(selectedNotebook, targetParentId);
        } catch (err) {
            message.error(err?.message || '移动失败');
            await refreshNotebookTree(selectedNotebook);
        }
    }, [selectedNotebook, refreshNotebookTree]);

    // 拖拽开始：记录拖拽节点
    const handleDragStart = useCallback(({ node }) => {
        setDraggingKey(node.key);
        draggingNodeRef.current = node;
    }, []);

    // 拖拽结束：清理状态与延时器
    const handleDragEnd = useCallback(() => {
        setDraggingKey(null);
        draggingNodeRef.current = null;
        setIsOverRootDropZone(false);
        if (dragHoverTimerRef.current) {
            clearTimeout(dragHoverTimerRef.current);
            dragHoverTimerRef.current = null;
        }
    }, []);

    // 拖拽悬停进入：折叠文件夹悬停 600ms 自动展开
    const handleDragEnter = useCallback(info => {
        const { node } = info;
        if (dragHoverTimerRef.current) {
            clearTimeout(dragHoverTimerRef.current);
            dragHoverTimerRef.current = null;
        }

        if (node.isFolder && !expandedKeys.includes(node.key)) {
            dragHoverTimerRef.current = setTimeout(() => {
                setExpandedKeys(prev => {
                    if (!prev.includes(node.key)) {
                        return [...prev, node.key];
                    }
                    return prev;
                });
            }, 600);
        }
    }, [expandedKeys]);

    // 拖拽移出节点
    const handleDragLeave = useCallback(() => {
        if (dragHoverTimerRef.current) {
            clearTimeout(dragHoverTimerRef.current);
            dragHoverTimerRef.current = null;
        }
    }, []);

    // 实时放置校验：拦截非法放置位置与防环
    const handleAllowDrop = useCallback(({ dragNode: dNode, dropNode, dropPosition }) => {
        const drag = dNode || draggingNodeRef.current;
        if (!drag || !dropNode) return true;

        if (drag.key === dropNode.key) {
            return false;
        }

        // 普通笔记不可作为容器放入子项（dropPosition === 0 代表放入内部）
        if (!dropNode.isFolder && dropPosition === 0) {
            return false;
        }

        // 防环：禁止将目录移入自身或子孙目录
        if (drag.isFolder && isDescendantNode(treeData, drag.key, dropNode.key)) {
            return false;
        }

        return true;
    }, [treeData]);

    // 节点释放处理：计算插入位置、乐观更新及持久化同级顺序
    const handleDrop = useCallback(async info => {
        if (dragHoverTimerRef.current) {
            clearTimeout(dragHoverTimerRef.current);
            dragHoverTimerRef.current = null;
        }

        const { dragNode, node: dropNode, dropPosition: infoDropPosition, dropToGap } = info;
        if (!dragNode || !dropNode) return;

        const dropKey = dropNode.key;
        const dragKey = dragNode.key;
        if (dragKey === dropKey) return;

        // 防环拦截：禁止将目录移入自身或子孙目录
        if (dragNode.isFolder && isDescendantNode(treeData, dragKey, dropKey)) {
            message.warning('不能将目录移动到自身的子目录中');
            return;
        }

        const dropPos = dropNode.pos.split('-');
        const dropPosition = infoDropPosition - Number(dropPos[dropPos.length - 1]);

        // 内存拷贝并重排树节点
        const data = cloneTreeData(treeData);

        // 1. 查找并抽离被拖拽节点
        let dragObj = null;
        const loopRemove = nodes => {
            for (let i = 0; i < nodes.length; i++) {
                if (nodes[i].key === dragKey) {
                    dragObj = { ...nodes[i] };
                    nodes.splice(i, 1);
                    return true;
                }
                if (nodes[i].children && Array.isArray(nodes[i].children)) {
                    if (loopRemove(nodes[i].children)) return true;
                }
            }
            return false;
        };
        loopRemove(data);
        if (!dragObj) return;

        let targetParentId = null;

        // 2. 根据放置位置计算插入点
        if (!dropToGap) {
            // 放置在目录节点本体：插入到目录首项
            targetParentId = dropKey;
            dragObj.parentId = dropKey;
            const loopInsert = nodes => {
                for (let i = 0; i < nodes.length; i++) {
                    if (nodes[i].key === dropKey) {
                        nodes[i].children = nodes[i].children || [];
                        nodes[i].children.unshift(dragObj);
                        return true;
                    }
                    if (nodes[i].children && Array.isArray(nodes[i].children)) {
                        if (loopInsert(nodes[i].children)) return true;
                    }
                }
                return false;
            };
            loopInsert(data);
        } else if (
            (dropNode.children || []).length > 0 &&
            dropNode.expanded &&
            dropPosition === 1
        ) {
            // 展开的目录底部缝隙：插入为其第一个子项
            targetParentId = dropKey;
            dragObj.parentId = dropKey;
            const loopInsert = nodes => {
                for (let i = 0; i < nodes.length; i++) {
                    if (nodes[i].key === dropKey) {
                        nodes[i].children = nodes[i].children || [];
                        nodes[i].children.unshift(dragObj);
                        return true;
                    }
                    if (nodes[i].children && Array.isArray(nodes[i].children)) {
                        if (loopInsert(nodes[i].children)) return true;
                    }
                }
                return false;
            };
            loopInsert(data);
        } else {
            // 放置在节点之间的水平指示线间隙
            targetParentId = dropNode.parentId || null;
            dragObj.parentId = targetParentId;
            let targetList = null;
            let targetIndex = -1;

            const loopFindList = nodes => {
                for (let i = 0; i < nodes.length; i++) {
                    if (nodes[i].key === dropKey) {
                        targetList = nodes;
                        targetIndex = i;
                        return true;
                    }
                    if (nodes[i].children && Array.isArray(nodes[i].children)) {
                        if (loopFindList(nodes[i].children)) return true;
                    }
                }
                return false;
            };
            loopFindList(data);

            if (targetList && targetIndex !== -1) {
                if (dropPosition === -1) {
                    targetList.splice(targetIndex, 0, dragObj);
                } else {
                    targetList.splice(targetIndex + 1, 0, dragObj);
                }
            }
        }

        // 3. 提取目标父级下更新后的同级节点 ID 序列
        const getSiblings = (nodes, pId) => {
            if (!pId) {
                return nodes.map(n => n.key);
            }
            for (let i = 0; i < nodes.length; i++) {
                if (nodes[i].key === pId) {
                    return (nodes[i].children || []).map(c => c.key);
                }
                if (nodes[i].children && Array.isArray(nodes[i].children)) {
                    const res = getSiblings(nodes[i].children, pId);
                    if (res) return res;
                }
            }
            return null;
        };

        const orderedSiblingIds = getSiblings(data, targetParentId) || [];

        // 4. 乐观渲染最新树节点顺序
        setTreeData(data);
        if (targetParentId) {
            setExpandedKeys(prev => (prev.includes(targetParentId) ? prev : [...prev, targetParentId]));
        }

        // 5. 同步后端持久化层级与同级顺序
        await executeMoveNode(dragKey, targetParentId, orderedSiblingIds);
    }, [treeData, executeMoveNode]);

    // 根目录释放区交互
    const handleRootDropZoneDragOver = useCallback(e => {
        if (!draggingNodeRef.current) return;
        if (!draggingNodeRef.current.parentId) return;
        e.preventDefault();
        setIsOverRootDropZone(true);
    }, []);

    const handleRootDropZoneDragLeave = useCallback(() => {
        setIsOverRootDropZone(false);
    }, []);

    const handleRootDropZoneDrop = useCallback(async e => {
        e.preventDefault();
        e.stopPropagation();
        setIsOverRootDropZone(false);
        const node = draggingNodeRef.current;
        if (!node || !node.parentId) return;

        const data = cloneTreeData(treeData);
        let dragObj = null;
        const loopRemove = nodes => {
            for (let i = 0; i < nodes.length; i++) {
                if (nodes[i].key === node.key) {
                    dragObj = { ...nodes[i] };
                    nodes.splice(i, 1);
                    return true;
                }
                if (nodes[i].children && Array.isArray(nodes[i].children)) {
                    if (loopRemove(nodes[i].children)) return true;
                }
            }
            return false;
        };
        loopRemove(data);
        if (dragObj) {
            dragObj.parentId = null;
            data.push(dragObj);
            setTreeData(data);
            const orderedSiblingIds = data.map(n => n.key);
            await executeMoveNode(node.key, null, orderedSiblingIds);
        }
    }, [treeData, executeMoveNode]);

    // 加载系统辅助视图（最近/收藏/回收站）
    const loadSystemListView = useCallback(async type => {
        setLoading(true);
        try {
            let result;
            if (type === 'recent') {
                result = await getRecentNotes({ limit: 50 });
            } else if (type === 'starred') {
                result = await getStarredNotes({ limit: 50 });
            } else if (type === 'trash') {
                result = await getDeletedNotes({ limit: 50 });
            }
            setFlatListNotes(result?.notes || []);
        } catch {
            message.error('加载列表失败');
        } finally {
            setLoading(false);
        }
    }, []);

    // 初始加载与同步刷新
    useEffect(() => {
        loadNotebooks();
    }, [loadNotebooks, syncVersion]);

    useEffect(() => {
        if (viewType === 'all' && selectedNotebook) {
            loadNotebookTree(selectedNotebook);
        } else if (viewType !== 'all') {
            loadSystemListView(viewType);
        }
    }, [viewType, selectedNotebook, loadNotebookTree, loadSystemListView, syncVersion]);

    // 笔记本内全局服务端关键词搜索与防抖联动
    useEffect(() => {
        if (!selectedNotebook || viewType !== 'all') {
            return;
        }
        const term = searchTerm.trim();
        if (!term) {
            setSearchResults([]);
            setSearchLoading(false);
            return;
        }

        const timer = setTimeout(async () => {
            setSearchLoading(true);
            try {
                const res = await getNotebookNotes(selectedNotebook, { keyword: term });
                const list = res?.notes || [];
                setSearchResults(formatTreeData(list));
            } catch {
                message.error('搜索失败');
            } finally {
                setSearchLoading(false);
            }
        }, 300);

        return () => clearTimeout(timer);
    }, [searchTerm, selectedNotebook, viewType, formatTreeData]);

    // 当外部保存笔记后局部更新树中对应节点的标题
    useEffect(() => {
        if (!savedNote) {
            return;
        }
        const noteId = (savedNote.id || savedNote._id)?.toString();
        if (!noteId) {
            return;
        }
        setTreeData(prev => updateNodeTitleInTree(prev, noteId, savedNote.title));
    }, [savedNote]);

    // 关闭右键菜单
    useEffect(() => {
        const handleClickOutside = () => {
            if (contextMenu.visible) {
                setContextMenu(prev => ({ ...prev, visible: false }));
            }
        };
        window.addEventListener('click', handleClickOutside);
        return () => window.removeEventListener('click', handleClickOutside);
    }, [contextMenu.visible]);

    // 当前展示的树数据（搜索模式 vs 懒加载目录树）
    const displayedTreeData = useMemo(() => {
        if (searchTerm.trim()) {
            return searchResults;
        }
        return treeData;
    }, [searchTerm, searchResults, treeData]);

    // 切换树节点展开收起
    const handleExpand = expanded => {
        setExpandedKeys(expanded);
        setAutoExpandParent(false);
    };

    // 选择树节点
    const handleSelect = async (keys, info) => {
        if (!keys || keys.length === 0) {
            return;
        }
        const targetKey = keys[0];
        const node = info.node;

        if (node.isFolder) {
            // 点击文件夹行切换展开/收起状态
            setAutoExpandParent(false);
            const isCurrentlyExpanded = expandedKeys.includes(targetKey);
            if (isCurrentlyExpanded) {
                setExpandedKeys(prev => prev.filter(k => k !== targetKey));
            } else {
                setExpandedKeys(prev => [...prev, targetKey]);
                // 若该目录尚未加载过子节点，主动触发懒加载
                if (node.children === undefined) {
                    await onLoadData(node);
                }
            }
            return;
        }

        // 点击笔记文档进行内容载入
        if (canChangeSelection) {
            const canLeave = await canChangeSelection();
            if (!canLeave) {
                return;
            }
        }
        setSelectedNote(targetKey);
    };

    // 切换系统分类标签
    const handleViewTypeChange = async key => {
        if (canChangeSelection) {
            const canLeave = await canChangeSelection();
            if (!canLeave) {
                return;
            }
        }
        setViewType(key);
    };

    // 触发创建笔记对话框
    const triggerCreate = useCallback((type, parentNode = null) => {
        setContextMenu(prev => ({ ...prev, visible: false }));
        setDialogState({
            open: true,
            type,
            node: parentNode,
            targetParentId: parentNode ? parentNode.key : null,
            title: ''
        });
    }, []);

    useImperativeHandle(ref, () => ({
        triggerCreateNote: () => triggerCreate('createNote', null)
    }), [triggerCreate]);

    // 触发重命名对话框
    const triggerRename = node => {
        setContextMenu(prev => ({ ...prev, visible: false }));
        setDialogState({
            open: true,
            type: 'rename',
            node,
            targetParentId: null,
            title: node.title
        });
    };

    // 触发移动对话框（异步获取全量目录树供选择）
    const triggerMove = async node => {
        setContextMenu(prev => ({ ...prev, visible: false }));
        try {
            const res = await getNotebookNotes(selectedNotebook, { all: 'true' });
            const allNotes = res?.notes || [];
            const folders = allNotes.filter(n => n.type === 'folder' && (n._id?.toString() || n.id) !== node.key);

            const buildFolderOptions = (items, pId = null) => {
                return items
                    .filter(item => {
                        const itemPid = item.parentId ? item.parentId.toString() : null;
                        return itemPid === pId;
                    })
                    .map(item => {
                        const fKey = (item._id || item.id).toString();
                        return {
                            title: item.title,
                            value: fKey,
                            key: fKey,
                            children: buildFolderOptions(items, fKey)
                        };
                    });
            };

            const rootOption = {
                title: '【笔记本根目录】',
                value: 'root',
                key: 'root',
                children: buildFolderOptions(folders, null)
            };

            setMoveFolderTree([rootOption]);
            setDialogState({
                open: true,
                type: 'move',
                node,
                targetParentId: node.parentId || 'root',
                title: node.title
            });
        } catch {
            message.error('获取目录列表失败');
        }
    };

    // 执行删除操作
    const handleDelete = node => {
        setContextMenu(prev => ({ ...prev, visible: false }));
        const isFolder = node.isFolder;
        modal.confirm({
            title: `确认删除${isFolder ? '目录' : '笔记'}？`,
            content: isFolder ? '删除目录将递归把其下所有子目录和笔记移至回收站。' : '删除后可在回收站中找回。',
            okText: '删除',
            cancelText: '取消',
            okType: 'danger',
            centered: true,
            onOk: async () => {
                try {
                    await deleteNote(node.key);
                    message.success('已移至回收站');
                    if (selectedNote === node.key) {
                        setSelectedNote(null);
                    }
                    // 局部移除节点，无需重载整棵树
                    setTreeData(prev => removeNodeFromTree(prev, node.key));
                } catch {
                    message.error('删除失败');
                }
            }
        });
    };

    // 切换星标
    const handleToggleStar = async (node, e) => {
        e?.stopPropagation();
        try {
            const nextStatus = !node.isStarred;
            await updateNoteStarred(node.key, nextStatus);
            message.success(nextStatus ? '已收藏' : '已取消收藏');
            if (viewType === 'all') {
                setTreeData(prev => updateNodeStarredInTree(prev, node.key, nextStatus));
            } else {
                loadSystemListView(viewType);
            }
        } catch {
            message.error('操作失败');
        }
    };

    // 恢复回收站项目
    const handleRestore = async noteId => {
        try {
            await restoreNote(noteId);
            message.success('已恢复');
            loadSystemListView('trash');
        } catch {
            message.error('恢复失败');
        }
    };

    // 确认提交弹窗
    const handleDialogSubmit = async () => {
        const { type, node, targetParentId, title } = dialogState;
        const trimmedTitle = title.trim();

        const finalTitle = trimmedTitle || (type === 'createNote' ? '无标题笔记' : '');
        if (type !== 'move' && !finalTitle) {
            message.warning('请输入名称');
            return;
        }

        setDialogSubmitting(true);
        try {
            if (type === 'createNotebook') {
                const res = await createNotebook({ name: finalTitle });
                message.success('创建笔记本成功');
                await loadNotebooks();
                const newNbId = res?.notebook?._id || res?.data?.notebook?._id || res?._id;
                if (newNbId) {
                    setSelectedNotebook(newNbId);
                }
            } else if (type === 'createNote' || type === 'createFolder') {
                const isFolder = type === 'createFolder';
                const parentId = targetParentId && targetParentId !== 'root' ? targetParentId : null;
                const activeNotebook = selectedNotebook || (notebooks.length > 0 ? (notebooks[0].id || notebooks[0]._id) : null);
                if (!activeNotebook) {
                    message.warning('请先创建或选择笔记本');
                    return;
                }

                const res = await createNote({
                    title: finalTitle,
                    content: '',
                    notebookId: activeNotebook,
                    type: isFolder ? 'folder' : 'note',
                    parentId
                });
                message.success(isFolder ? '创建目录成功' : '创建笔记成功');

                if (viewType !== 'all') {
                    setViewType('all');
                }

                const createdItem = res?.note || res?.data?.note || res;
                if (createdItem) {
                    const formattedNode = formatTreeData([createdItem])[0];
                    setTreeData(prev => insertNodeToTree(prev, parentId, formattedNode));
                } else {
                    await loadNotebookTree(activeNotebook);
                }

                if (parentId) {
                    setExpandedKeys(prev => Array.from(new Set([...prev, parentId])));
                }
                const newNoteId = res?.note?._id || res?.data?.note?._id || res?._id;
                if (!isFolder && newNoteId) {
                    setSelectedNote(newNoteId);
                }
            } else if (type === 'rename') {
                await updateNote(node.key, { title: finalTitle });
                message.success('重命名成功');
                setTreeData(prev => updateNodeTitleInTree(prev, node.key, finalTitle));
            } else if (type === 'move') {
                const parentId = targetParentId === 'root' ? null : targetParentId;
                await executeMoveNode(node.key, parentId);
                message.success('移动成功');
            }
            setDialogState({ open: false, type: 'createNote', node: null, targetParentId: null, title: '' });
        } catch (err) {
            message.error(err?.message || '操作失败');
        } finally {
            setDialogSubmitting(false);
        }
    };

    // 右键上下文菜单项
    const renderContextMenu = () => {
        const node = contextMenu.node;
        if (!contextMenu.visible || !node) {
            return null;
        }

        const isFolder = node.isFolder;
        const menuItems = [
            ...(isFolder ? [
                {
                    key: 'createNote',
                    icon: <FileMarkdownOutlined />,
                    label: '新建笔记',
                    onClick: () => triggerCreate('createNote', node)
                },
                {
                    key: 'createFolder',
                    icon: <FolderAddOutlined />,
                    label: '新建子目录',
                    onClick: () => triggerCreate('createFolder', node)
                },
                { type: 'divider' }
            ] : [
                {
                    key: 'star',
                    icon: node.isStarred ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />,
                    label: node.isStarred ? '取消收藏' : '收藏笔记',
                    onClick: () => handleToggleStar(node)
                },
                { type: 'divider' }
            ]),
            {
                key: 'rename',
                icon: <EditOutlined />,
                label: '重命名',
                onClick: () => triggerRename(node)
            },
            {
                key: 'move',
                icon: <RollbackOutlined />,
                label: '移动到...',
                onClick: () => triggerMove(node)
            },
            { type: 'divider' },
            {
                key: 'delete',
                icon: <DeleteOutlined />,
                label: <span style={{ color: '#dc2626' }}>删除</span>,
                onClick: () => handleDelete(node)
            }
        ];

        return (
            <div
                className="custom-context-menu"
                style={{ top: contextMenu.y, left: contextMenu.x }}
            >
                {menuItems.map((item, idx) => {
                    if (item.type === 'divider') {
                        return <div key={`div-${idx}`} className="context-menu-divider" />;
                    }
                    return (
                        <div
                            key={item.key}
                            className="context-menu-item"
                            onClick={e => {
                                e.stopPropagation();
                                item.onClick();
                            }}
                        >
                            <span className="item-icon">{item.icon}</span>
                            <span className="item-label">{item.label}</span>
                        </div>
                    );
                })}
            </div>
        );
    };

    // 自定义渲染树节点
    const renderTreeNodeTitle = nodeData => {
        const isFolder = nodeData.isFolder;
        const isSelected = !isFolder && selectedNote === nodeData.key;
        const isExpanded = expandedKeys.includes(nodeData.key);

        const folderActionMenu = {
            items: [
                {
                    key: 'new-note',
                    icon: <FileMarkdownOutlined />,
                    label: '新建笔记',
                    onClick: () => triggerCreate('createNote', nodeData)
                },
                {
                    key: 'new-folder',
                    icon: <FolderAddOutlined />,
                    label: '新建子目录',
                    onClick: () => triggerCreate('createFolder', nodeData)
                }
            ]
        };

        const moreActionMenu = {
            items: [
                {
                    key: 'rename',
                    icon: <EditOutlined />,
                    label: '重命名',
                    onClick: () => triggerRename(nodeData)
                },
                {
                    key: 'move',
                    icon: <RollbackOutlined />,
                    label: '移动到...',
                    onClick: () => triggerMove(nodeData)
                },
                { type: 'divider' },
                {
                    key: 'delete',
                    icon: <DeleteOutlined />,
                    label: <span style={{ color: '#dc2626' }}>删除</span>,
                    onClick: () => handleDelete(nodeData)
                }
            ]
        };

        return (
            <div
                className={`tree-node-row ${isFolder ? 'is-folder' : 'is-note'} ${isSelected ? 'is-selected' : ''}`}
                onContextMenu={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    setContextMenu({
                        visible: true,
                        x: e.clientX,
                        y: e.clientY,
                        node: nodeData
                    });
                }}
            >
                <div className="node-content-left">
                    <span className="node-type-icon">
                        {isFolder ? (
                            isExpanded ? (
                                <FolderOpenOutlined className="folder-icon" />
                            ) : (
                                <FolderOutlined className="folder-icon" />
                            )
                        ) : (
                            <FileMarkdownOutlined className="note-icon" />
                        )}
                    </span>
                    <span className="node-title" title={nodeData.title}>
                        {nodeData.title}
                    </span>
                </div>

                <div className="node-actions" onClick={e => e.stopPropagation()}>
                    {isFolder ? (
                        <Dropdown menu={folderActionMenu} trigger={['click']} placement="bottomRight">
                            <Tooltip title="新建子项">
                                <Button
                                    type="text"
                                    size="small"
                                    className="action-btn"
                                    icon={<PlusOutlined />}
                                />
                            </Tooltip>
                        </Dropdown>
                    ) : (
                        <Tooltip title={nodeData.isStarred ? '取消收藏' : '收藏'}>
                            <Button
                                type="text"
                                size="small"
                                className={`action-btn star-btn ${nodeData.isStarred ? 'is-starred' : ''}`}
                                icon={nodeData.isStarred ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />}
                                onClick={e => handleToggleStar(nodeData, e)}
                            />
                        </Tooltip>
                    )}

                    <Dropdown menu={moreActionMenu} trigger={['click']} placement="bottomRight">
                        <Button
                            type="text"
                            size="small"
                            className="action-btn"
                            icon={<MoreOutlined />}
                        />
                    </Dropdown>
                </div>
            </div>
        );
    };

    // 顶部全局新建下拉菜单
    const globalCreateMenu = {
        items: [
            {
                key: 'new-note',
                icon: <FileMarkdownOutlined />,
                label: '新建 Markdown 笔记',
                onClick: () => triggerCreate('createNote', null)
            },
            {
                key: 'new-folder',
                icon: <FolderAddOutlined />,
                label: '新建顶级目录',
                onClick: () => triggerCreate('createFolder', null)
            }
        ]
    };

    return (
        <div className={`nav-tree-sidebar ${collapsed ? 'is-collapsed' : ''}`} ref={treeContainerRef}>
            {contextHolder}

            {/* 折叠切换浮标 */}
            <div
                className="collapse-trigger"
                onClick={() => setCollapsed(!collapsed)}
                title={collapsed ? '展开导航' : '收起导航'}
            >
                {collapsed ? <RightOutlined /> : <LeftOutlined />}
            </div>

            {!collapsed && (
                <div className="nav-tree-content">
                    {/* 顶部工作区 */}
                    <div className="nav-header">
                        {/* 笔记本切换与新建 */}
                        <div className="notebook-selector-row">
                            <Select
                                value={selectedNotebook}
                                onChange={setSelectedNotebook}
                                className="notebook-select"
                                variant="borderless"
                                popupMatchSelectWidth={false}
                                options={notebooks.map(nb => ({
                                    value: nb.id || nb._id,
                                    label: (
                                        <Space>
                                            <BookOutlined style={{ color: '#2563eb' }} />
                                            <span>{nb.name}</span>
                                        </Space>
                                    )
                                }))}
                            />
                            <Tooltip title="新建笔记本">
                                <Button
                                    type="text"
                                    icon={<FolderAddOutlined />}
                                    onClick={() => triggerCreate('createNotebook', null)}
                                />
                            </Tooltip>
                        </div>

                        {/* 快捷新建大按钮 */}
                        <Dropdown menu={globalCreateMenu} placement="bottomLeft">
                            <Button
                                type="primary"
                                icon={<PlusOutlined />}
                                className="global-create-btn"
                                block
                            >
                                新建
                            </Button>
                        </Dropdown>

                        {/* 搜索框 */}
                        <div className="search-box">
                            <Input
                                placeholder="搜索笔记或目录..."
                                prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                allowClear
                                className="search-input"
                            />
                        </div>

                        {/* 系统分类快捷标签 */}
                        <div className="system-nav-tabs">
                            {SYSTEM_VIEWS.map(item => (
                                <div
                                    key={item.key}
                                    className={`system-tab-item ${viewType === item.key ? 'is-active' : ''}`}
                                    onClick={() => handleViewTypeChange(item.key)}
                                >
                                    <span className="tab-icon">{item.icon}</span>
                                    <span className="tab-label">{item.label}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* 树核心滚动区 */}
                    <div className="tree-scroll-container">
                        {viewType === 'all' ? (
                            displayedTreeData.length > 0 ? (
                                <>
                                    <Tree
                                        draggable={!searchTerm.trim()}
                                        allowDrop={handleAllowDrop}
                                        onDragStart={handleDragStart}
                                        onDragEnd={handleDragEnd}
                                        onDragEnter={handleDragEnter}
                                        onDragLeave={handleDragLeave}
                                        onDrop={handleDrop}
                                        loadData={searchTerm.trim() ? undefined : onLoadData}
                                        treeData={displayedTreeData}
                                        showIcon={false}
                                        blockNode
                                        expandedKeys={expandedKeys}
                                        autoExpandParent={autoExpandParent}
                                        onExpand={handleExpand}
                                        onSelect={handleSelect}
                                        selectedKeys={selectedNote ? [selectedNote] : []}
                                        titleRender={renderTreeNodeTitle}
                                        className="custom-nav-tree"
                                    />
                                    {draggingKey && draggingNodeRef.current?.parentId && (
                                        <div
                                            className={`tree-root-dropzone ${isOverRootDropZone ? 'is-drag-over' : ''}`}
                                            onDragOver={handleRootDropZoneDragOver}
                                            onDragLeave={handleRootDropZoneDragLeave}
                                            onDrop={handleRootDropZoneDrop}
                                        >
                                            <span className="dropzone-text">
                                                {isOverRootDropZone ? '松开移至顶级根目录' : '拖拽到此处移出至根目录'}
                                            </span>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <Empty
                                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                                    description={loading || searchLoading ? '加载中...' : (searchTerm.trim() ? '未找到相关笔记或目录' : '暂无笔记或目录')}
                                    className="tree-empty"
                                />
                            )
                        ) : (
                            /* 系统分类平铺列表 */
                            <div className="flat-system-list">
                                {flatListNotes.length > 0 ? (
                                    flatListNotes.map(item => {
                                        const noteId = item.id || item._id;
                                        const isSelected = selectedNote === noteId;
                                        return (
                                            <div
                                                key={noteId}
                                                className={`flat-item-row ${isSelected ? 'is-selected' : ''}`}
                                                onClick={async () => {
                                                    if (viewType === 'trash') return;
                                                    if (canChangeSelection) {
                                                        const canLeave = await canChangeSelection();
                                                        if (!canLeave) return;
                                                    }
                                                    setSelectedNote(noteId);
                                                }}
                                            >
                                                <div className="flat-item-main">
                                                    <span className="flat-item-icon">
                                                        {item.type === 'folder' ? <FolderOutlined /> : <FileMarkdownOutlined />}
                                                    </span>
                                                    <span className="flat-item-title">{item.title}</span>
                                                </div>
                                                <div className="flat-item-actions">
                                                    {viewType === 'trash' ? (
                                                        <Tooltip title="还原">
                                                            <Button
                                                                type="text"
                                                                size="small"
                                                                icon={<RollbackOutlined />}
                                                                onClick={() => handleRestore(noteId)}
                                                            />
                                                        </Tooltip>
                                                    ) : (
                                                        <Button
                                                            type="text"
                                                            size="small"
                                                            icon={item.isStarred ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />}
                                                            onClick={e => handleToggleStar({ key: noteId, isStarred: item.isStarred }, e)}
                                                        />
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <Empty
                                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                                        description={loading ? '加载中...' : '暂无数据'}
                                        className="tree-empty"
                                    />
                                )}
                            </div>
                        )}
                    </div>

                    {/* 底部用户与设置区 */}
                    <div className="nav-footer">
                        <div className="user-profile">
                            <Avatar
                                size={32}
                                src={userAvatar}
                                icon={<UserOutlined />}
                                className="user-avatar"
                            />
                            <span className="username" title={user?.username || '用户'}>
                                {user?.username || '用户'}
                            </span>
                        </div>

                        <div className="footer-actions">
                            <Tooltip title="数据同步">
                                <Button
                                    type="text"
                                    icon={<SyncOutlined spin={syncing} />}
                                    onClick={() => {
                                        setSyncing(true);
                                        onSync?.();
                                        setTimeout(() => setSyncing(false), 600);
                                    }}
                                />
                            </Tooltip>
                            <Tooltip title="个人设置">
                                <Button
                                    type="text"
                                    icon={<SettingOutlined />}
                                    onClick={() => setSettingsOpen(true)}
                                />
                            </Tooltip>
                            <Tooltip title="安全登出">
                                <Button
                                    type="text"
                                    icon={<LogoutOutlined />}
                                    onClick={onLogout}
                                />
                            </Tooltip>
                        </div>
                    </div>
                </div>
            )}

            {/* 右键浮动上下文菜单 */}
            {renderContextMenu()}

            {/* 统一输入对话框（新建笔记/目录/笔记本/重命名/移动） */}
            <Modal
                open={dialogState.open}
                title={
                    dialogState.type === 'createNotebook' ? '新建笔记本' :
                    dialogState.type === 'createFolder' ? '新建目录' :
                    dialogState.type === 'createNote' ? '新建 Markdown 笔记' :
                    dialogState.type === 'rename' ? '重命名' : '移动到目标目录'
                }
                okText="确定"
                cancelText="取消"
                onOk={handleDialogSubmit}
                onCancel={() => setDialogState(prev => ({ ...prev, open: false }))}
                confirmLoading={dialogSubmitting}
                centered
                destroyOnClose
            >
                {dialogState.type === 'move' ? (
                    <div style={{ padding: '16px 0' }}>
                        <p style={{ color: '#64748b', marginBottom: 8 }}>请选择要移动到的目标位置：</p>
                        <TreeSelect
                            treeData={moveFolderTree}
                            value={dialogState.targetParentId}
                            onChange={val => setDialogState(prev => ({ ...prev, targetParentId: val }))}
                            style={{ width: '100%' }}
                            placeholder="请选择目标目录"
                            treeDefaultExpandAll
                        />
                    </div>
                ) : (
                    <div style={{ padding: '16px 0' }}>
                        <Input
                            autoFocus
                            placeholder={
                                dialogState.type === 'createFolder' ? '请输入目录名称' :
                                dialogState.type === 'createNotebook' ? '请输入笔记本名称' :
                                '请输入笔记标题'
                            }
                            value={dialogState.title}
                            onChange={e => setDialogState(prev => ({ ...prev, title: e.target.value }))}
                            onPressEnter={handleDialogSubmit}
                        />
                    </div>
                )}
            </Modal>

            {/* 用户设置弹窗 */}
            <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} onCancel={() => setSettingsOpen(false)} />
        </div>
    );
});

export default NavTree;
