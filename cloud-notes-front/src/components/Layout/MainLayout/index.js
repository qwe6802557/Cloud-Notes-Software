import React, { useState } from 'react';
import { Layout } from 'antd';
import Sidebar from '../Sidebar';
import NoteList from '../NoteList';
import NoteEditor from '../Editor';
import './index.less';

const MainLayout = () => {
    const [collapsed, setCollapsed] = useState(false);
    const [selectedNotebook, setSelectedNotebook] = useState(null);
    const [selectedNote, setSelectedNote] = useState(null);

    // 保存笔记的回调函数
    const handleSaveNote = (noteId, content) => {
        console.log('保存笔记:', noteId, content);
        // 实际项目中，这里应该调用API保存笔记内容
    };

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
            <NoteEditor
                selectedNote={selectedNote}
                onSave={handleSaveNote}
            />
        </Layout.Content>
    </Layout>
  );
};

export default MainLayout;