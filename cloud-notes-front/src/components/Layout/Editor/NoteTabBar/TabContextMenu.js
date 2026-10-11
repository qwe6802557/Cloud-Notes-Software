import React from 'react';
import { Dropdown, message } from 'antd';
import {
    CloseOutlined,
    CloseCircleOutlined,
    ArrowRightOutlined,
    PushpinOutlined,
    PushpinFilled,
    SplitCellsOutlined,
    CopyOutlined
} from '@ant-design/icons';

/**
 * 标签页右键上下文菜单组件
 */
const TabContextMenu = ({
    children,
    tab,
    pane = 'primary',
    onCloseTab,
    onCloseOtherTabs,
    onCloseTabsToRight,
    onTogglePinTab,
    onOpenInOppositePane
}) => {
    if (!tab) return children;

    const handleCopyWikiLink = () => {
        const link = `[[${tab.title}]]`;
        navigator.clipboard.writeText(link).then(() => {
            message.success(`已复制双链引用: ${link}`);
        }).catch(() => {
            message.error('复制失败');
        });
    };

    const menuItems = [
        {
            key: 'close',
            label: '关闭标签页',
            icon: <CloseOutlined />,
            onClick: () => onCloseTab(tab.id, pane)
        },
        {
            key: 'close-others',
            label: '关闭其他标签页',
            icon: <CloseCircleOutlined />,
            onClick: () => onCloseOtherTabs(tab.id, pane)
        },
        {
            key: 'close-to-right',
            label: '关闭右侧标签页',
            icon: <ArrowRightOutlined />,
            onClick: () => onCloseTabsToRight(tab.id, pane)
        },
        {
            type: 'divider'
        },
        {
            key: 'toggle-pin',
            label: tab.isPinned ? '取消固定' : '固定标签页',
            icon: tab.isPinned ? <PushpinFilled style={{ color: '#d97706' }} /> : <PushpinOutlined />,
            onClick: () => onTogglePinTab(tab.id, pane)
        },
        {
            key: 'open-opposite',
            label: pane === 'primary' ? '在副屏分栏打开' : '在主屏分栏打开',
            icon: <SplitCellsOutlined style={{ color: '#1890ff' }} />,
            onClick: () => onOpenInOppositePane(tab.id, pane)
        },
        {
            type: 'divider'
        },
        {
            key: 'copy-wikilink',
            label: `复制双链引用: [[${tab.title}]]`,
            icon: <CopyOutlined />,
            onClick: handleCopyWikiLink
        }
    ];

    return (
        <Dropdown menu={{ items: menuItems }} trigger={['contextMenu']}>
            {children}
        </Dropdown>
    );
};

export default TabContextMenu;
