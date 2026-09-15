import React, { useCallback, useRef, useState } from 'react';
import { Layout, Modal, message } from 'antd';
import NavTree from '../NavTree';
import NoteEditor from '../Editor';
import { updateNote, createNote } from '@/api/notes';
import { logout } from '@/api/user';
import { clearAuth } from '@/utils/auth';
import './index.less';

const MainLayout = () => {
    const navTreeRef = useRef(null);
    const [collapsed, setCollapsed] = useState(false);
    const [selectedNotebook, setSelectedNotebook] = useState(null);
    const [selectedNote, setSelectedNote] = useState(null);
    const [editorDirty, setEditorDirty] = useState(false);
    const [editorSaving, setEditorSaving] = useState(false);
    const [savedNote, setSavedNote] = useState(null);
    const [syncVersion, setSyncVersion] = useState(0);
    const [modal, contextHolder] = Modal.useModal();

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
            content: '当前笔记有未保存的修改，离开后这些更改将不会被保存。',
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

    const handleCreateNote = useCallback(async () => {
        if (navTreeRef.current?.triggerCreateNote) {
            navTreeRef.current.triggerCreateNote();
            return;
        }

        if (!selectedNotebook) {
            message.warning('请先选择笔记本');
            return;
        }

        try {
            const res = await createNote({
                title: '无标题笔记',
                content: '',
                notebookId: selectedNotebook,
                type: 'note'
            });
            const newNoteId = res?.note?._id || res?.data?.note?._id || res?._id;
            if (newNoteId) {
                setSelectedNote(newNoteId);
                setSyncVersion(v => v + 1);
            }
        } catch {
            message.error('创建笔记失败');
        }
    }, [selectedNotebook]);

    const handleSync = useCallback(() => {
        setSyncVersion(version => version + 1);
    }, []);

    const handleLogout = useCallback(async () => {
        if (!await confirmLeaveUnsavedNote()) {
            return;
        }

        try {
            await logout();
        } catch {
            // 本地清理优先，确保即便网络异常也能正常退出
        } finally {
            clearAuth();
            window.location.href = '/login';
        }
    }, [confirmLeaveUnsavedNote]);

    return (
        <>
            {contextHolder}
            <Layout hasSider className="main-layout">
                <NavTree
                    ref={navTreeRef}
                    collapsed={collapsed}
                    setCollapsed={setCollapsed}
                    selectedNotebook={selectedNotebook}
                    setSelectedNotebook={handleNotebookChange}
                    selectedNote={selectedNote}
                    setSelectedNote={handleNoteChange}
                    canChangeSelection={confirmLeaveUnsavedNote}
                    savedNote={savedNote}
                    syncVersion={syncVersion}
                    onSync={handleSync}
                    onLogout={handleLogout}
                />
                <Layout.Content className="main-content">
                    <NoteEditor
                        selectedNote={selectedNote}
                        onSave={handleSaveNote}
                        onDirtyChange={setEditorDirty}
                        onSaveStateChange={handleSaveStateChange}
                        onCreateNote={handleCreateNote}
                    />
                </Layout.Content>
            </Layout>
        </>
    );
};

export default MainLayout;
