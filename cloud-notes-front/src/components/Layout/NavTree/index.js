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
    const [autoExpandParent, setAutoExpandParent] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
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
    const [settingsOpen, setSettingsOpen] = useState(false);

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

    // 加载笔记本列表
    const loadNotebooks = useCallback(async () => {
        try {
            const result = await getNotebooks();
            const list = result?.notebooks || [];
            setNotebooks(list);
            if (!selectedNotebook && list.length > 0) {
                const firstId = list[0].id || list[0]._id;
                setSelectedNotebook(firstId);
            }
        } catch {
            message.error('笔记本加载失败');
        }
    }, [selectedNotebook, setSelectedNotebook]);

    // 格式化后端数据为 Ant Design Tree 结构
    const formatTreeData = useCallback(nodes => {
        return nodes.map(item => {
            const isFolder = item.type === 'folder';
            const nodeKey = item._id ? item._id.toString() : item.id;
            const hasChildren = Array.isArray(item.children) && item.children.length > 0;

            return {
                title: item.title,
                key: nodeKey,
                isFolder,
                isStarred: Boolean(item.isStarred),
                parentId: item.parentId ? item.parentId.toString() : null,
                notebookId: item.notebookId,
                rawItem: item,
                children: hasChildren ? formatTreeData(item.children) : []
            };
        });
    }, []);

    // 递归筛选树节点
    const filterTreeByKeyword = useCallback((nodes, keyword) => {
        if (!keyword) {
            return nodes;
        }
        const lower = keyword.toLowerCase();

        return nodes.reduce((acc, node) => {
            const matchCurrent = (node.title || '').toLowerCase().includes(lower);
            const filteredChildren = node.children ? filterTreeByKeyword(node.children, keyword) : [];

            if (matchCurrent || filteredChildren.length > 0) {
                acc.push({
                    ...node,
                    children: filteredChildren
                });
            }
            return acc;
        }, []);
    }, []);

    // 加载全部树形笔记
    const loadNotebookTree = useCallback(async notebookId => {
        if (!notebookId) {
            return;
        }
        setLoading(true);
        try {
            const result = await getNotebookNotes(notebookId);
            const raw = result?.notes || [];
            const tree = result?.tree || [];
            const formatted = formatTreeData(tree);
            setTreeData(formatted);

            // 首次加载默认展开根级目录
            const folderKeys = raw.filter(n => n.type === 'folder').map(n => n._id.toString());
            setExpandedKeys(prev => (prev.length === 0 ? folderKeys : prev));
        } catch {
            message.error('加载目录树失败');
        } finally {
            setLoading(false);
        }
    }, [formatTreeData]);

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

    // 当外部保存笔记后局部更新树中对应节点的标题
    useEffect(() => {
        if (!savedNote) {
            return;
        }
        const noteId = (savedNote.id || savedNote._id)?.toString();
        if (!noteId) {
            return;
        }

        const updateNodeTitle = list => list.map(item => {
            if (item.key === noteId) {
                return { ...item, title: savedNote.title };
            }
            if (item.children) {
                return { ...item, children: updateNodeTitle(item.children) };
            }
            return item;
        });

        setTreeData(prev => updateNodeTitle(prev));
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

    // 搜索过滤后的树数据
    const displayedTreeData = useMemo(() => {
        return filterTreeByKeyword(treeData, searchTerm);
    }, [treeData, searchTerm, filterTreeByKeyword]);

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
            // 点击文件夹仅切换展开/收起状态
            setAutoExpandParent(false);
            setExpandedKeys(prev => {
                return prev.includes(targetKey)
                    ? prev.filter(k => k !== targetKey)
                    : [...prev, targetKey];
            });
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

    // 触发移动对话框
    const triggerMove = node => {
        setContextMenu(prev => ({ ...prev, visible: false }));
        setDialogState({
            open: true,
            type: 'move',
            node,
            targetParentId: node.parentId || 'root',
            title: node.title
        });
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
                    if (selectedNotebook) {
                        loadNotebookTree(selectedNotebook);
                    }
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
            if (viewType === 'all' && selectedNotebook) {
                loadNotebookTree(selectedNotebook);
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
                await loadNotebookTree(activeNotebook);

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
                await loadNotebookTree(selectedNotebook);
            } else if (type === 'move') {
                const parentId = targetParentId === 'root' ? null : targetParentId;
                await moveNoteNode(node.key, { targetParentId: parentId });
                message.success('移动成功');
                await loadNotebookTree(selectedNotebook);
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

    // 构建移动目标目录树
    const folderTreeSelectData = useMemo(() => {
        const rootOption = {
            title: '【笔记本根目录】',
            value: 'root',
            key: 'root',
            children: []
        };

        const buildFolderNodes = nodes => {
            return nodes
                .filter(n => n.isFolder && (!dialogState.node || n.key !== dialogState.node.key))
                .map(f => ({
                    title: f.title,
                    value: f.key,
                    key: f.key,
                    children: f.children ? buildFolderNodes(f.children) : []
                }));
        };

        rootOption.children = buildFolderNodes(treeData);
        return [rootOption];
    }, [treeData, dialogState.node]);

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
                                <Tree
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
                            ) : (
                                <Empty
                                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                                    description={loading ? '加载中...' : '暂无笔记或目录'}
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
                            treeData={folderTreeSelectData}
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
