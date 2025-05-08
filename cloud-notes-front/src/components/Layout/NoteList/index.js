import React, { useState } from 'react';
import { Layout, List, Card, Button, Space, Tooltip, Input, Typography, Badge } from 'antd';
import {
  PlusOutlined, UnorderedListOutlined, AppstoreOutlined,
  SortAscendingOutlined, StarOutlined, StarFilled,
  ClockCircleOutlined, MoreOutlined, SearchOutlined,
  FileTextOutlined
} from '@ant-design/icons';
import './index.less';

const { Sider } = Layout;
const { Text, Paragraph } = Typography;

const NoteList = ({ selectedNotebook, selectedNote, setSelectedNote }) => {
  const [viewMode, setViewMode] = useState('list');
  const [searchTerm, setSearchTerm] = useState('');

  const notes = [
    {
      id: 1,
      title: '项目计划书',
      content: '这是一个关于云笔记项目的计划书，包含功能规划和时间节点...',
      updatedAt: '2023-06-15 14:30',
      starred: true
    },
    {
      id: 2,
      title: '周会记录',
      content: '本次会议主要讨论了项目进度和遇到的问题，确定了下一步的行动计划...',
      updatedAt: '2023-06-14 10:15',
      starred: false
    },
    {
      id: 3,
      title: '学习笔记：React Hooks',
      content: 'useState, useEffect, useContext等hook的用法和最佳实践...',
      updatedAt: '2023-06-13 18:45',
      starred: true
    },
    {
      id: 4,
      title: '读书笔记',
      content: '《深入浅出Node.js》读书笔记，主要包括事件循环、异步IO、模块系统等内容...',
      updatedAt: '2023-06-12 20:30',
      starred: false
    }
  ];

  const filteredNotes = selectedNotebook
      ? notes.filter(note => note.id % 4 === selectedNotebook % 4)
      : notes;

  const searchedNotes = searchTerm
      ? filteredNotes.filter(note =>
          note.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
          note.content.toLowerCase().includes(searchTerm.toLowerCase())
      )
      : filteredNotes;

  const notebookName = selectedNotebook
      ? ['我的笔记本', '工作', '学习', '生活'][selectedNotebook % 4]
      : '全部笔记';

  return (
      <Sider width={300} theme="light" className="note-list">
        <div className="note-list-header">
          <div className="notebook-info">
            <span className="notebook-name">{notebookName}</span>
            <Badge count={searchedNotes.length} className="note-count-badge" />
          </div>

          <Input
              prefix={<SearchOutlined className="search-icon" />}
              placeholder="搜索笔记..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
          />

          <div className="note-actions">
            <Button type="primary" icon={<PlusOutlined />} className="new-note-btn">
              新建笔记
            </Button>

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
          {searchedNotes.length === 0 ? (
              <div className="empty-state">
                <FileTextOutlined className="empty-icon" />
                <p>没有找到笔记</p>
                <Button type="primary">新建笔记</Button>
              </div>
          ) : (
              <List
                  dataSource={searchedNotes}
                  renderItem={note => (
                      <Card
                          size="small"
                          className={`note-card ${viewMode === 'grid' ? 'grid-mode' : ''} ${selectedNote === note.id ? 'selected' : ''}`}
                          onClick={() => setSelectedNote(note.id)}
                      >
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                            <Text className="note-title">{note.title}</Text>
                            {note.starred ?
                                <StarFilled className="star-icon starred" /> :
                                <StarOutlined className="star-icon" />
                            }
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
                              <ClockCircleOutlined className="time-icon" />
                              <Text>{note.updatedAt}</Text>
                            </Space>
                            <Button
                                type="text"
                                icon={<MoreOutlined />}
                                size="small"
                                className="more-btn"
                            />
                          </Space>
                        </Space>
                      </Card>
                  )}
                  grid={viewMode === 'grid' ? { gutter: 8, column: 2 } : null}
              />
          )}
        </div>
      </Sider>
  );
};

export default NoteList;