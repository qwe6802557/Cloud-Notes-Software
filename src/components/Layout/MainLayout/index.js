import React, { useState } from 'react';
import { Layout } from 'antd';
import Sidebar from '../Sidebar';
import NoteList from '../NoteList';
import './index.less';

const MainLayout = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [selectedNotebook, setSelectedNotebook] = useState(null);
  const [selectedNote, setSelectedNote] = useState(null);

  return (
    <Layout className="main-layout">
      <Sidebar
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        selectedNotebook={selectedNotebook}
        setSelectedNotebook={setSelectedNotebook}
      />
      <NoteList
        selectedNotebook={selectedNotebook}
        selectedNote={selectedNote}
        setSelectedNote={setSelectedNote}
      />
      <Layout.Content className="main-content">
        {/* 笔记内容区域 */}
      </Layout.Content>
    </Layout>
  );
};

export default MainLayout;