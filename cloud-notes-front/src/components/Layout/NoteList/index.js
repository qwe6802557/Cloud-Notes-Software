import React, { useEffect, useState } from 'react';
import { Layout, List, Card, Button, Space, Tooltip, Input, Typography, Badge, message, Dropdown, Modal } from 'antd';
import {
  PlusOutlined, UnorderedListOutlined, AppstoreOutlined,
  SortAscendingOutlined, StarOutlined, StarFilled,
  ClockCircleOutlined, MoreOutlined, SearchOutlined,
  FileTextOutlined, RollbackOutlined
} from '@ant-design/icons';
import {
  createNote,
  deleteNote,
  getDeletedNotes,
  getNotebookNotes,
  getRecentNotes,
  getStarredNotes,
  restoreNote,
  updateNote,
  updateNoteStarred
} from '@/api/notes';
import './index.less';

const { Sider } = Layout;
const { Text, Paragraph } = Typography;

const getNoteId = note => note?.id || note?._id;

const NoteList = ({ selectedNotebook, isTrash, isStarred, isRecent, selectedNote, setSelectedNote, canChangeSelection, savedNote }) => {
  const [viewMode, setViewMode] = useState('list');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [noteTitleModal, setNoteTitleModal] = useState({ open: false, mode: 'create', note: null });
  const [noteTitle, setNoteTitle] = useState('');
  const [noteTitleSubmitting, setNoteTitleSubmitting] = useState(false);
  const [modal, contextHolder] = Modal.useModal();

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm.trim());
    }, 400);

    return () => {
      clearTimeout(timer);
    };
  }, [searchTerm]);

  useEffect(() => {
    let mounted = true;

    const loadNotes = async () => {
      if (!selectedNotebook) {
        setNotes([]);
        return;
      }

      setLoading(true);
      try {
        const params = debouncedSearchTerm ? { keyword: debouncedSearchTerm } : undefined;
        const result = isTrash
            ? await getDeletedNotes(params)
            : isStarred
                ? await getStarredNotes(params)
                : isRecent
                    ? await getRecentNotes(params)
                    : await getNotebookNotes(selectedNotebook, params);
        if (mounted) {
          setNotes(result?.notes || []);
        }
      } catch (error) {
        message.error(isTrash ? '回收站加载失败' : isStarred ? '收藏笔记加载失败' : isRecent ? '最近文档加载失败' : '笔记列表加载失败');
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadNotes();

    return () => {
      mounted = false;
    };
  }, [debouncedSearchTerm, isRecent, isStarred, isTrash, selectedNotebook]);

  useEffect(() => {
    if (!savedNote || isTrash) {
      return;
    }

    const savedNoteId = getNoteId(savedNote);
    setNotes(prevNotes => {
      const currentNote = prevNotes.find(note => getNoteId(note) === savedNoteId);
      if (!currentNote) {
        return prevNotes;
      }

      const nextNote = {
        ...currentNote,
        ...savedNote
      };
      return [
        nextNote,
        ...prevNotes.filter(note => getNoteId(note) !== savedNoteId)
      ];
    });
  }, [isTrash, savedNote]);

  const handleCreateNote = async () => {
    if (isTrash || isStarred || isRecent) {
      message.warning(isTrash ? '回收站中不能新建笔记' : isStarred ? '收藏文档中不能新建笔记' : '最近文档中不能新建笔记');
      return;
    }

    if (!selectedNotebook) {
      message.warning('请先选择笔记本');
      return;
    }

    if (canChangeSelection && !await canChangeSelection()) {
      return;
    }

    setNoteTitle('');
    setNoteTitleModal({ open: true, mode: 'create', note: null });
  };

  const handleRenameNote = note => {
    setNoteTitle(note.title || '');
    setNoteTitleModal({ open: true, mode: 'rename', note });
  };

  const closeNoteTitleModal = () => {
    if (noteTitleSubmitting) {
      return;
    }

    setNoteTitle('');
    setNoteTitleModal({ open: false, mode: 'create', note: null });
  };

  const handleNoteTitleSubmit = async () => {
    if (noteTitleSubmitting) {
      return;
    }

    const title = noteTitle.trim();
    if (!title) {
      message.warning('请输入笔记名称');
      return;
    }

    setNoteTitleSubmitting(true);
    try {
      if (noteTitleModal.mode === 'create') {
        const result = await createNote({
          title,
          content: '',
          notebookId: selectedNotebook
        });
        const newNote = result?.note;
        if (newNote) {
          setNotes(prevNotes => [newNote, ...prevNotes]);
          await setSelectedNote(getNoteId(newNote), { skipConfirm: true });
        }
        message.success('新建笔记成功');
      } else {
        const noteId = getNoteId(noteTitleModal.note);
        const result = await updateNote(noteId, { title });
        const updatedNote = result?.note || {
          ...noteTitleModal.note,
          title,
          updatedAt: new Date().toISOString()
        };
        setNotes(prevNotes => prevNotes.map(note =>
            getNoteId(note) === noteId ? { ...note, ...updatedNote } : note
        ));
        message.success('修改名称成功');
      }
      setNoteTitle('');
      setNoteTitleModal({ open: false, mode: 'create', note: null });
    } catch (error) {
      message.error(noteTitleModal.mode === 'create' ? '新建笔记失败' : '修改名称失败');
    } finally {
      setNoteTitleSubmitting(false);
    }
  };

  const handleDeleteNote = note => {
    const noteId = getNoteId(note);
    modal.confirm({
      title: '删除笔记？',
      content: `确定要删除「${note.title || '未命名笔记'}」吗？`,
      okText: '删除',
      cancelText: '取消',
      okType: 'danger',
      centered: true,
      async onOk() {
        try {
          await deleteNote(noteId);
          setNotes(prevNotes => prevNotes.filter(item => getNoteId(item) !== noteId));
          if (selectedNote === noteId) {
            await setSelectedNote(null, { skipConfirm: true });
          }
          message.success('删除笔记成功');
        } catch (error) {
          message.error('删除笔记失败');
          throw error;
        }
      }
    });
  };

  const handleRestoreNote = note => {
    const noteId = getNoteId(note);
    modal.confirm({
      title: '恢复笔记？',
      content: '确认要恢复该笔记吗?',
      okText: '恢复',
      cancelText: '取消',
      centered: true,
      async onOk() {
        try {
          await restoreNote(noteId);
          setNotes(prevNotes => prevNotes.filter(item => getNoteId(item) !== noteId));
          if (selectedNote === noteId) {
            await setSelectedNote(null, { skipConfirm: true });
          }
          message.success('恢复笔记成功');
        } catch (error) {
          message.error('恢复笔记失败');
          throw error;
        }
      }
    });
  };

  const handleToggleStarred = async (note, event) => {
    event?.stopPropagation();
    const noteId = getNoteId(note);
    const nextStarred = !note.isStarred;

    try {
      const result = await updateNoteStarred(noteId, nextStarred);
      const updatedNote = result?.note || {
        ...note,
        isStarred: nextStarred,
        updatedAt: new Date().toISOString()
      };

      if (isStarred && !nextStarred) {
        setNotes(prevNotes => prevNotes.filter(item => getNoteId(item) !== noteId));
      } else {
        setNotes(prevNotes => prevNotes.map(item =>
            getNoteId(item) === noteId ? { ...item, ...updatedNote } : item
        ));
      }
      message.success(nextStarred ? '收藏笔记成功' : '取消收藏成功');
    } catch (error) {
      message.error(nextStarred ? '收藏笔记失败' : '取消收藏失败');
    }
  };

  const getNoteMenu = note => ({
    items: [
      ...(isTrash ? [
        {
          key: 'restore',
          label: '恢复笔记'
        }
      ] : isStarred ? [
        {
          key: 'unstar',
          label: '取消收藏'
        }
      ] : [
        {
          key: 'rename',
          label: '修改名称'
        },
        {
          key: 'delete',
          label: '删除笔记',
          danger: true
        }
      ])
    ],
    onClick: ({ key, domEvent }) => {
      domEvent.stopPropagation();
      if (key === 'restore') {
        handleRestoreNote(note);
        return;
      }
      if (key === 'unstar') {
        handleToggleStarred(note, domEvent);
        return;
      }
      if (key === 'rename') {
        handleRenameNote(note);
        return;
      }
      handleDeleteNote(note);
    }
  });

  const formatTime = value => {
    return value ? new Date(value).toLocaleString() : '';
  };

  const getListTitle = () => {
    if (isTrash) {
      return '回收站';
    }
    if (isStarred) {
      return '收藏文档';
    }
    if (isRecent) {
      return '最近文档';
    }
    return '笔记列表';
  };

  const getNoteTime = note => {
    if (isTrash) {
      return note.deletedAt;
    }
    if (isRecent) {
      return note.lastOpenedAt || note.updatedAt;
    }
    return note.updatedAt;
  };

  return (
      <Sider width={300} theme="light" className="note-list">
        {contextHolder}
        <div className="note-list-header">
          <div className="notebook-info">
            <span className="notebook-name">{getListTitle()}</span>
            <Badge count={notes.length} className="note-count-badge" />
          </div>

          <Input
              prefix={<SearchOutlined className="search-icon" />}
              placeholder="搜索笔记..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
          />

          <div className="note-actions">
            {!isTrash && !isStarred && !isRecent && (
              <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  className="new-note-btn"
                  onClick={handleCreateNote}
              >
                新建笔记
              </Button>
            )}

            <Space className="view-options">
              <Tooltip title="列表视图">
                <Button
                    type={viewMode === 'list' ? 'primary' : 'text'}
                    icon={<UnorderedListOutlined />}
                    onClick={() => setViewMode('list')}
                    className="view-btn"
                />
              </Tooltip>
              <Tooltip title="网格视图">
                <Button
                    type={viewMode === 'grid' ? 'primary' : 'text'}
                    icon={<AppstoreOutlined />}
                    onClick={() => setViewMode('grid')}
                    className="view-btn"
                />
              </Tooltip>
              <Tooltip title="排序">
                <Button
                    type="text"
                    icon={<SortAscendingOutlined />}
                    className="view-btn"
                />
              </Tooltip>
            </Space>
          </div>
        </div>

        <div className="note-list-container">
          {notes.length === 0 ? (
              <div className="empty-state">
                <FileTextOutlined className="empty-icon" />
                <p>{loading ? '加载中...' : isTrash ? '回收站为空' : isStarred ? '暂无收藏笔记' : isRecent ? '暂无最近文档' : '没有找到笔记'}</p>
              </div>
          ) : (
              <List
                  loading={loading}
                  dataSource={notes}
                  renderItem={note => (
                      <Card
                          size="small"
                          className={`note-card ${viewMode === 'grid' ? 'grid-mode' : ''} ${selectedNote === getNoteId(note) ? 'selected' : ''}`}
                          onClick={() => {
                            if (!isTrash) {
                              setSelectedNote(getNoteId(note));
                            }
                          }}
                      >
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                            <Text className="note-title">{note.title}</Text>
                            {!isTrash && (
                                note.isStarred ?
                                    <StarFilled className="star-icon starred" onClick={event => handleToggleStarred(note, event)} /> :
                                    <StarOutlined className="star-icon" onClick={event => handleToggleStarred(note, event)} />
                            )}
                          </Space>

                          <Paragraph
                              className="note-content"
                              ellipsis={{
                                rows: 2,
                                tooltip: note.content
                              }}
                          >
                            {note.content}
                          </Paragraph>

                          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                            <Space className="note-meta">
                              {isTrash ? <RollbackOutlined className="time-icon" /> : <ClockCircleOutlined className="time-icon" />}
                              <Tooltip title={formatTime(getNoteTime(note))}>
                                <Text className="note-time" ellipsis>{formatTime(getNoteTime(note))}</Text>
                              </Tooltip>
                            </Space>
                            <Dropdown
                                menu={getNoteMenu(note)}
                                trigger={['click']}
                                placement="bottomRight"
                            >
                              <Button
                                  type="text"
                                  icon={<MoreOutlined />}
                                  size="small"
                                  className="more-btn"
                                  onClick={event => event.stopPropagation()}
                              />
                            </Dropdown>
                          </Space>
                        </Space>
                      </Card>
                  )}
                  grid={viewMode === 'grid' ? { gutter: 8, column: 2 } : null}
              />
          )}
        </div>
        <Modal
            title={noteTitleModal.mode === 'create' ? '新建笔记' : '修改名称'}
            open={noteTitleModal.open}
            okText={noteTitleModal.mode === 'create' ? '创建' : '保存'}
            cancelText="取消"
            confirmLoading={noteTitleSubmitting}
            onOk={handleNoteTitleSubmit}
            onCancel={closeNoteTitleModal}
            centered
        >
          <Input
              placeholder="请输入笔记名称"
              value={noteTitle}
              maxLength={50}
              showCount
              autoFocus
              disabled={noteTitleSubmitting}
              onChange={event => setNoteTitle(event.target.value)}
              onPressEnter={handleNoteTitleSubmit}
          />
        </Modal>
      </Sider>
  );
};

export default NoteList;
