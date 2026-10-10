import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Layout, Modal, message } from 'antd';
import NavTree from '../NavTree';
import NoteEditor from '../Editor';
import FileStashBoard from '@/components/FileStashBoard';
import KnowledgeGraph from '@/components/KnowledgeGraph';
import CommandPalette from '@/components/CommandPalette';
import { updateNote, createNote } from '@/api/notes';
import { logout } from '@/api/user';
import { clearAuth } from '@/utils/auth';
import { getLoginPath } from '@/utils/request';
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
    const [zenMode, setZenMode] = useState(false);
    const [activeView, setActiveView] = useState('notes'); // 'notes' | 'stash'
    const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
    const [modal, contextHolder] = Modal.useModal();

    const handleSaveNote = useCallback(async (noteId, content, meta = {}) => {
        const result = await updateNote(noteId, {
            content,
            rawContent: content,
            ...meta
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
            window.location.href = getLoginPath();
        }
    }, [confirmLeaveUnsavedNote]);

    useEffect(() => {
        const handleKeyDown = e => {
            if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'k' || e.key.toLowerCase() === 'p')) {
                e.preventDefault();
                setCommandPaletteOpen(prev => !prev);
            }
        };

        const handleCustomToggle = () => setCommandPaletteOpen(prev => !prev);

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('toggle-command-palette', handleCustomToggle);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('toggle-command-palette', handleCustomToggle);
        };
    }, []);

    const handleCommandSelectNote = useCallback(noteId => {
        handleNoteChange(noteId);
    }, [handleNoteChange]);

    const handleCommandOpenAI = useCallback(() => {
        window.dispatchEvent(new CustomEvent('open-ai-modal'));
    }, []);

    const handleCommandOpenSettings = useCallback(() => {
        navTreeRef.current?.triggerOpenSettings?.();
    }, []);

    const handleCommandToggleZenMode = useCallback(() => {
        setZenMode(prev => !prev);
    }, []);

    return (
        <>
            {contextHolder}
            <Layout hasSider className={`main-layout ${zenMode ? 'is-zen-mode' : ''}`}>
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
                    activeView={activeView}
                    onViewChange={setActiveView}
                />
                <Layout.Content className="main-content">
                    {activeView === 'stash' ? (
                        <FileStashBoard />
                    ) : activeView === 'graph' ? (
                        <KnowledgeGraph
                            onSelectNote={noteId => {
                                setActiveView('notes');
                                handleNoteChange(noteId);
                            }}
                        />
                    ) : (
                        <NoteEditor
                            selectedNote={selectedNote}
                            selectedNotebook={selectedNotebook}
                            onSelectNote={handleNoteChange}
                            onSave={handleSaveNote}
                            onDirtyChange={setEditorDirty}
                            onSaveStateChange={handleSaveStateChange}
                            onCreateNote={handleCreateNote}
                            zenMode={zenMode}
                            onToggleZenMode={setZenMode}
                        />
                    )}
                </Layout.Content>
            </Layout>

            <CommandPalette
                open={commandPaletteOpen}
                onClose={() => setCommandPaletteOpen(false)}
                onSelectNote={handleCommandSelectNote}
                onCreateNote={handleCreateNote}
                onOpenAI={handleCommandOpenAI}
                onToggleZenMode={handleCommandToggleZenMode}
                onOpenSettings={handleCommandOpenSettings}
            />
        </>
    );
};

export default MainLayout;
