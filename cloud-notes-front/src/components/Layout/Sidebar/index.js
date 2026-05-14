import React, { useEffect, useState } from 'react';
import { Layout, Menu, Avatar, Button, Divider, Space, Tooltip, message, Modal, Input } from 'antd';
import {
    FileTextOutlined,
    StarOutlined,
    DeleteOutlined,
    BookOutlined,
    PlusOutlined,
    LeftOutlined,
    RightOutlined,
    SettingOutlined,
    UserOutlined,
    SyncOutlined,
    LogoutOutlined
} from '@ant-design/icons';
import { createNotebook, getNotebooks } from '@/api/notes';
import { getUser } from '@/utils/auth';
import SettingsModal from '@/components/SettingsModal';
import './index.less';

const { Sider } = Layout;

const Sidebar = ({ collapsed, setCollapsed, selectedNotebook, setSelectedNotebook, syncVersion, onSync, onLogout }) => {
    const [notebooks, setNotebooks] = useState([]);
    const [notebookModalOpen, setNotebookModalOpen] = useState(false);
    const [notebookName, setNotebookName] = useState('');
    const [notebookSubmitting, setNotebookSubmitting] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const user = getUser();
    const userAvatar = user?.avatar && user.avatar !== 'default-avatar.png' ? user.avatar : null;

    useEffect(() => {
        let mounted = true;

        const loadNotebooks = async () => {
            setSyncing(true);
            try {
                const result = await getNotebooks();
                const list = result?.notebooks || [];

                if (!mounted) {
                    return;
                }

                setNotebooks(list);
                if (!selectedNotebook && list.length > 0) {
                    setSelectedNotebook(list[0].id || list[0]._id);
                }
            } catch (error) {
                message.error('笔记本加载失败');
            } finally {
                if (mounted) {
                    setSyncing(false);
                }
            }
        };

        loadNotebooks();

        return () => {
            mounted = false;
        };
    }, [selectedNotebook, setSelectedNotebook, syncVersion]);

    const handleSync = () => {
        if (syncing) {
            return;
        }

        onSync?.();
    };

    const handleCreateNotebook = async () => {
        const name = notebookName.trim();
        if (!name) {
            message.warning('请输入笔记本名称');
            return;
        }

        setNotebookSubmitting(true);
        try {
            const result = await createNotebook({ name });
            const notebook = result?.notebook;
            if (notebook) {
                setNotebooks(prevNotebooks => [notebook, ...prevNotebooks]);
                await setSelectedNotebook(notebook.id || notebook._id);
            }
            setNotebookName('');
            setNotebookModalOpen(false);
            message.success('新建笔记本成功');
        } catch (error) {
            message.error('新建笔记本失败');
        } finally {
            setNotebookSubmitting(false);
        }
    };

    const closeNotebookModal = () => {
        if (notebookSubmitting) {
            return;
        }

        setNotebookName('');
        setNotebookModalOpen(false);
    };

    return (
        <Sider
            width={200}
            collapsed={collapsed}
            theme="light"
            className="sidebar"
        >
            <div className="user-info">
                <div className="user-content">
                    <Avatar src={userAvatar} icon={!userAvatar && <UserOutlined />} className="user-avatar" />
                    {!collapsed && (
                        <div className="user-details">
                            <div className="username">{user?.username || '用户名'}</div>
                            <div className="user-type">个人版</div>
                        </div>
                    )}
                </div>
            </div>

            <div className="sidebar-static-section">
                <Menu
                    theme="light"
                    mode="inline"
                    selectedKeys={['trash', 'starred', 'recent'].includes(selectedNotebook) ? [selectedNotebook] : []}
                    onClick={({ key }) => {
                        if (['trash', 'starred', 'recent'].includes(key)) {
                            setSelectedNotebook(key);
                        }
                    }}
                    className="menu-section"
                    items={[
                        {
                            key: 'recent',
                            icon: <FileTextOutlined />,
                            label: '最近文档'
                        },
                        {
                            key: 'starred',
                            icon: <StarOutlined />,
                            label: '收藏文档'
                        },
                        {
                            key: 'trash',
                            icon: <DeleteOutlined />,
                            label: '回收站'
                        }
                    ]}
                />

                <Divider className="menu-divider" />

                <div className="notebook-header">
                    {!collapsed && <span className="notebook-title">笔记本</span>}
                    <Tooltip title="新建笔记本">
                        <Button
                            type="text"
                            icon={<PlusOutlined />}
                            size="small"
                            className="add-notebook-btn"
                            onClick={() => setNotebookModalOpen(true)}
                        />
                    </Tooltip>
                </div>
            </div>

            <div className="sidebar-scroll-container">
                <div className="notebooks-scroll-container">
                    <Menu
                        theme="light"
                        mode="inline"
                        selectedKeys={['trash', 'starred', 'recent'].includes(selectedNotebook) ? [] : [selectedNotebook?.toString()]}
                        onClick={({ key }) => setSelectedNotebook(key)}
                        className="menu-section notebooks-menu"
                        items={notebooks.map(notebook => ({
                            key: notebook.id || notebook._id,
                            icon: <BookOutlined />,
                            label: (
                                <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                                    <span className="notebook-name">{notebook.name}</span>
                                    {!collapsed && <span className="notebook-count">{notebook.noteCount || 0}</span>}
                                </Space>
                            )
                        }))}
                    />
                </div>
            </div>

            <div className="bottom-actions">
                <Menu
                    theme="light"
                    mode="inline"
                    selectedKeys={[]}
                    className="bottom-menu"
                    items={[
                        {
                            key: 'sync',
                            icon: <SyncOutlined spin={syncing} />,
                            label: '同步',
                            onClick: handleSync
                        },
                        {
                            key: 'settings',
                            icon: <SettingOutlined />,
                            label: '设置',
                            onClick: () => setSettingsOpen(true)
                        },
                        {
                            key: 'logout',
                            icon: <LogoutOutlined />,
                            label: '退出',
                            onClick: onLogout
                        },
                        {
                            key: 'collapse',
                            icon: collapsed ? <RightOutlined /> : <LeftOutlined />,
                            label: collapsed ? '展开' : '收起',
                            onClick: () => setCollapsed(!collapsed)
                        }
                    ]}
                />
            </div>

            <Modal
                title="新建笔记本"
                open={notebookModalOpen}
                okText="创建"
                cancelText="取消"
                confirmLoading={notebookSubmitting}
                onOk={handleCreateNotebook}
                onCancel={closeNotebookModal}
                centered
            >
                <Input
                    placeholder="请输入笔记本名称"
                    value={notebookName}
                    maxLength={100}
                    showCount
                    autoFocus
                    disabled={notebookSubmitting}
                    onChange={event => setNotebookName(event.target.value)}
                    onPressEnter={handleCreateNotebook}
                />
            </Modal>

            <SettingsModal
                open={settingsOpen}
                onClose={() => setSettingsOpen(false)}
            />
        </Sider>
    );
};

export default Sidebar;
