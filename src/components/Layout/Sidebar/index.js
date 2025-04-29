import React from 'react';
import { Layout, Menu, Avatar, Button, Divider, Space, Tooltip } from 'antd';
import {
    FileTextOutlined, StarOutlined, DeleteOutlined, BookOutlined,
    PlusOutlined, LeftOutlined, RightOutlined,
    SettingOutlined, UserOutlined, SyncOutlined
} from '@ant-design/icons';
import './index.less';

const { Sider } = Layout;

const Sidebar = ({ collapsed, setCollapsed, selectedNotebook, setSelectedNotebook }) => {
    const notebooks = [
        { id: 1, name: '我的笔记本', count: 5 },
        { id: 2, name: '工作', count: 8 },
        { id: 3, name: '学习', count: 3 },
        { id: 4, name: '生活', count: 12 },
    ];

    return (
        <Sider
            width={200}
            collapsed={collapsed}
            theme="light"
            className="sidebar"
        >
            <div className="user-info">
                <div className="user-content">
                    <Avatar icon={<UserOutlined />} className="user-avatar" />
                    {!collapsed && (
                        <div className="user-details">
                            <div className="username">用户名</div>
                            <div className="user-type">个人版</div>
                        </div>
                    )}
                </div>
            </div>

            <div className="sidebar-scroll-container">
                <Menu
                    theme="light"
                    mode="inline"
                    selectedKeys={[]}
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
                        />
                    </Tooltip>
                </div>

                <Menu
                    theme="light"
                    mode="inline"
                    selectedKeys={[selectedNotebook?.toString()]}
                    onClick={({ key }) => setSelectedNotebook(parseInt(key))}
                    className="menu-section notebooks-menu"
                    items={notebooks.map(notebook => ({
                        key: notebook.id,
                        icon: <BookOutlined />,
                        label: (
                            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                                <span className="notebook-name">{notebook.name}</span>
                                {!collapsed && <span className="notebook-count">{notebook.count}</span>}
                            </Space>
                        )
                    }))}
                />
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
                            icon: <SyncOutlined />,
                            label: '同步'
                        },
                        {
                            key: 'settings',
                            icon: <SettingOutlined />,
                            label: '设置'
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
        </Sider>
    );
};

export default Sidebar;