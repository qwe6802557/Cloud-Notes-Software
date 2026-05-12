import React, { useCallback, useState } from 'react';
import { Layout, Modal, message } from 'antd';
import Sidebar from '../Sidebar';
import NoteList from '../NoteList';
import NoteEditor from '../Editor';
import { updateNote } from '@/api/notes';
import './index.less';

const MainLayout = () => {
    const [collapsed, setCollapsed] = useState(false);
    const [selectedNotebook, setSelectedNotebook] = useState(null);
    const [selectedNote, setSelectedNote] = useState(null);
    const [editorDirty, setEditorDirty] = useState(false);
    const [editorSaving, setEditorSaving] = useState(false);
    const [savedNote, setSavedNote] = useState(null);
    const [modal, contextHolder] = Modal.useModal();

    // 保存笔记的回调函数
    const handleSaveNote = useCallback(async (noteId, content) => {
        const result = await updateNote(noteId, {
            content,
            rawContent: content
        });
        if (result?.note) {
            setSavedNote(result.note);
        }
        return result;
    }, []);

    const confirmLeaveUnsavedNote = useCallback(async () => {
        if (editorSaving) {
            message.warning('笔记正在保存，请稍后再切换');
            return false;
        }

        if (!editorDirty) {
            return true;
        }

        return modal.confirm({
            title: '离开当前笔记？',
            content: '当前笔记有未保存更改，离开后这些更改将不会保存。',
            okText: '离开',
            cancelText: '继续编辑',
            okType: 'danger',
            centered: true
        });
    }, [editorDirty, editorSaving, modal]);

    const handleNotebookChange = useCallback(async notebookId => {
        if (notebookId === selectedNotebook) {
            return true;
        }

        if (!await confirmLeaveUnsavedNote()) {
            return false;
        }

        setSelectedNotebook(notebookId);
        setSelectedNote(null);
        setEditorDirty(false);
        return true;
    }, [confirmLeaveUnsavedNote, selectedNotebook]);

    const handleNoteChange = useCallback(async (noteId, options = {}) => {
        if (noteId === selectedNote) {
            return true;
        }

        if (!options.skipConfirm && !await confirmLeaveUnsavedNote()) {
            return false;
        }

        setSelectedNote(noteId);
        setEditorDirty(false);
        return true;
    }, [confirmLeaveUnsavedNote, selectedNote]);

    const handleSaveStateChange = useCallback(status => {
        setEditorSaving(Boolean(status?.saving || status?.autoSaving));
    }, []);

  return (
    <>
        {contextHolder}
        <Layout className="main-layout">
          <Sidebar
            collapsed={collapsed}
            setCollapsed={setCollapsed}
            selectedNotebook={selectedNotebook}
            setSelectedNotebook={handleNotebookChange}
          />
          <NoteList
            selectedNotebook={selectedNotebook}
            isTrash={selectedNotebook === 'trash'}
            isStarred={selectedNotebook === 'starred'}
            isRecent={selectedNotebook === 'recent'}
            selectedNote={selectedNote}
            setSelectedNote={handleNoteChange}
            canChangeSelection={confirmLeaveUnsavedNote}
            savedNote={savedNote}
          />
            <Layout.Content className="main-content">
                <NoteEditor
                    selectedNote={selectedNote}
                    onSave={handleSaveNote}
                    onDirtyChange={setEditorDirty}
                    onSaveStateChange={handleSaveStateChange}
                />
            </Layout.Content>
        </Layout>
    </>
  );
};

export default MainLayout;
