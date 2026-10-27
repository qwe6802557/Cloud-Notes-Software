import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Layout, Modal, message } from 'antd';
import NavTree from '../NavTree';
import NoteEditor from '../Editor';
import DesktopTitleBar from '../DesktopTitleBar';
import DesktopUpdateModal from '../DesktopUpdateModal';
import syncManager from '@/utils/storage/syncManager';
import FileStashBoard from '@/components/FileStashBoard';
import KnowledgeGraph from '@/components/KnowledgeGraph';
import CommandPalette from '@/components/CommandPalette';
import { updateNote, createNote } from '@/api/notes';
import { logout } from '@/api/user';
import { clearAuth } from '@/utils/auth';
import { getLoginPath } from '@/utils/request';
import './index.less';

const LAST_NOTE_KEY = 'cloud_notes_last_active_note_id';
const LAST_NOTEBOOK_KEY = 'cloud_notes_last_active_notebook_id';

const MainLayout = () => {
    const navTreeRef = useRef(null);
    const [collapsed, setCollapsed] = useState(false);
    const [selectedNotebook, setSelectedNotebook] = useState(() => {
        return localStorage.getItem(LAST_NOTEBOOK_KEY) || null;
    });
    const [selectedNote, setSelectedNote] = useState(() => {
        return localStorage.getItem(LAST_NOTE_KEY) || null;
    });
    const [editorDirty, setEditorDirty] = useState(false);
    const [activeNoteTitle, setActiveNoteTitle] = useState('');
    const [editorSaving, setEditorSaving] = useState(false);
    const [savedNote, setSavedNote] = useState(null);
    const [syncVersion, setSyncVersion] = useState(0);
    const [zenMode, setZenMode] = useState(false);
    const [activeView, setActiveView] = useState('notes'); // 'notes' | 'stash' | 'graph'
    const [stashMounted, setStashMounted] = useState(false);
    const [graphMounted, setGraphMounted] = useState(false);
    const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
    const [modal, contextHolder] = Modal.useModal();
    const [updateInfo, setUpdateInfo] = useState(null);
    const [updateModalOpen, setUpdateModalOpen] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState({ percent: 0, speed: 0, transferred: 0, total: 0 });
    const [downloadStatus, setDownloadStatus] = useState('idle');
    const [updateError, setUpdateError] = useState('');

    useEffect(() => {
        if (activeView === 'stash') setStashMounted(true);
        if (activeView === 'graph') setGraphMounted(true);
    }, [activeView]);

    const handleSaveNote = useCallback(async (noteId, content, meta = {}) => {
        // 若已经由 syncManager 成功保存并传入 note 实体，直接同步导航树，绝不发起二次重复写入
        if (meta?.note) {
            setSavedNote(meta.note);
            return { note: meta.note };
        }
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
        if (notebookId) {
            localStorage.setItem(LAST_NOTEBOOK_KEY, notebookId);
        } else {
            localStorage.removeItem(LAST_NOTEBOOK_KEY);
        }
        localStorage.removeItem(LAST_NOTE_KEY);
        return true;
    }, [confirmLeaveUnsavedNote, selectedNotebook]);

    const handleNoteChange = useCallback(async (noteId, options = {}) => {
        if (noteId === selectedNote) {
            return true;
        }

        if (!options.skipConfirm && editorDirty) {
            if (!await confirmLeaveUnsavedNote()) {
                return false;
            }
        }

        setSelectedNote(noteId);
        setEditorDirty(false);
        if (noteId) {
            localStorage.setItem(LAST_NOTE_KEY, noteId);
        } else {
            localStorage.removeItem(LAST_NOTE_KEY);
        }
        return true;
    }, [confirmLeaveUnsavedNote, editorDirty, selectedNote]);

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

    
    // Electron 全局系统托盘热键监听与同步状态联动
    useEffect(() => {
        if (!window.electronAPI?.tray?.onQuickNewNote) return;
        const unsubscribe = window.electronAPI.tray.onQuickNewNote(() => {
            handleCreateNote();
        });
        return () => unsubscribe?.();
    }, [handleCreateNote]);

    useEffect(() => {
        if (!window.electronAPI?.tray?.onOpenCommandPalette) return;
        const unsubscribe = window.electronAPI.tray.onOpenCommandPalette(() => {
            setCommandPaletteOpen(true);
        });
        return () => unsubscribe?.();
    }, []);

    useEffect(() => {
        if (!window.electronAPI?.tray?.updateSyncStatus) return;
        const unsubscribe = syncManager.subscribe(snapshot => {
            window.electronAPI.tray.updateSyncStatus({
                status: snapshot?.status || 'synced',
                queuedCount: snapshot?.queuedCount || 0
            });
        });
        return () => unsubscribe?.();
    }, []);

    // 监听 Electron 桌面端自动更新调度器生命周期
    useEffect(() => {
        if (!window.electronAPI?.updater) return;

        const unsubs = [
            window.electronAPI.updater.onUpdateAvailable(info => {
                setUpdateInfo(info);
                if (info?.isManual) {
                    setUpdateModalOpen(true);
                }
            }),
            window.electronAPI.updater.onUpdateNotAvailable(info => {
                if (info?.isManual) {
                    message.info(`当前已是最新版本 (v${info.currentVersion || '0.1.0'})`);
                }
            }),
            window.electronAPI.updater.onDownloadProgress(prog => {
                setDownloadProgress(prog);
                setDownloadStatus('downloading');
            }),
            window.electronAPI.updater.onUpdateDownloaded(() => {
                setDownloadStatus('downloaded');
                setUpdateModalOpen(true);
            }),
            window.electronAPI.updater.onError(err => {
                setDownloadStatus('error');
                setUpdateError(err?.message || '更新处理失败');
                if (err?.isManual) {
                    message.error(err?.message || '检查更新失败');
                }
            })
        ];

        return () => {
            unsubs.forEach(fn => fn?.());
        };
    }, []);

    const handleStartDownload = useCallback(async () => {
        try {
            setDownloadStatus('downloading');
            setUpdateError('');
            await window.electronAPI?.updater?.download();
        } catch (err) {
            setDownloadStatus('error');
            setUpdateError(err?.message || '下载启动失败');
        }
    }, []);

    const handleInstallUpdate = useCallback(() => {
        try {
            window.electronAPI?.updater?.install();
        } catch (err) {
            message.error(err?.message || '安装更新失败');
        }
    }, []);

    const handleCommandToggleZenMode = useCallback(() => {
        setZenMode(prev => !prev);
    }, []);

    return (
        <>
            {contextHolder}
            <div className="main-layout-container">
                <DesktopTitleBar
                    activeNoteTitle={activeNoteTitle}
                    isDirty={editorDirty}
                    updateInfo={updateInfo}
                    downloadStatus={downloadStatus}
                    downloadProgress={downloadProgress}
                    onOpenUpdateModal={() => setUpdateModalOpen(true)}
                />
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
                    <div
                        className="main-view-pane"
                        style={{
                            display: activeView === 'notes' ? 'flex' : 'none',
                            flex: 1,
                            height: '100%',
                            width: '100%',
                            flexDirection: 'column',
                            minWidth: 0,
                            overflow: 'hidden'
                        }}
                    >
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
                            activeView={activeView}
                            onNoteTitleChange={setActiveNoteTitle}
                        />
                    </div>
                    <div
                        className="main-view-pane"
                        style={{
                            display: activeView === 'stash' ? 'flex' : 'none',
                            flex: 1,
                            height: '100%',
                            width: '100%',
                            flexDirection: 'column',
                            minWidth: 0,
                            overflow: 'hidden'
                        }}
                    >
                        {(activeView === 'stash' || stashMounted) && (
                            <FileStashBoard />
                        )}
                    </div>
                    <div
                        className="main-view-pane"
                        style={{
                            display: activeView === 'graph' ? 'flex' : 'none',
                            flex: 1,
                            height: '100%',
                            width: '100%',
                            flexDirection: 'column',
                            minWidth: 0,
                            overflow: 'hidden'
                        }}
                    >
                        {(activeView === 'graph' || graphMounted) && (
                            <KnowledgeGraph
                                onSelectNote={noteId => {
                                    setActiveView('notes');
                                    handleNoteChange(noteId);
                                }}
                            />
                        )}
                    </div>
                </Layout.Content>
            </Layout>
            </div>

            <CommandPalette
                open={commandPaletteOpen}
                onClose={() => setCommandPaletteOpen(false)}
                onSelectNote={handleCommandSelectNote}
                onCreateNote={handleCreateNote}
                onOpenAI={handleCommandOpenAI}
                onToggleZenMode={handleCommandToggleZenMode}
                onOpenSettings={handleCommandOpenSettings}
            />
                    <DesktopUpdateModal
                open={updateModalOpen}
                onClose={() => setUpdateModalOpen(false)}
                updateInfo={updateInfo}
                downloadProgress={downloadProgress}
                downloadStatus={downloadStatus}
                errorMessage={updateError}
                onStartDownload={handleStartDownload}
                onInstall={handleInstallUpdate}
            />
        </>
    );
};

export default MainLayout;
