import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { 
  BoldOutlined,
  ItalicOutlined,
  UnderlineOutlined,
  UnorderedListOutlined,
  OrderedListOutlined,
  LinkOutlined,
  PictureOutlined,
  CodeOutlined,
  AlignLeftOutlined,
  AlignCenterOutlined,
  AlignRightOutlined,
  StarOutlined,
  StarFilled,
  ShareAltOutlined,
  SaveOutlined,
  ClockCircleOutlined,
  MoreOutlined
} from '@ant-design/icons';
import { Button, Tooltip, Space } from 'antd';

const NoteEditor = () => {
  const [selectedNote, setSelectedNote] = useOutletContext();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isStarred, setIsStarred] = useState(false);
  const [lastSaved, setLastSaved] = useState('');

  // 编辑器工具栏
  const EditorToolbar = () => (
    <Space className="border-b p-2">
      <Button.Group>
        <Tooltip title="加粗">
          <Button icon={<BoldOutlined />} />
        </Tooltip>
        <Tooltip title="斜体">
          <Button icon={<ItalicOutlined />} />
        </Tooltip>
        <Tooltip title="下划线">
          <Button icon={<UnderlineOutlined />} />
        </Tooltip>
      </Button.Group>

      <Button.Group>
        <Tooltip title="无序列表">
          <Button icon={<UnorderedListOutlined />} />
        </Tooltip>
        <Tooltip title="有序列表">
          <Button icon={<OrderedListOutlined />} />
        </Tooltip>
      </Button.Group>

      <Button.Group>
        <Tooltip title="左对齐">
          <Button icon={<AlignLeftOutlined />} />
        </Tooltip>
        <Tooltip title="居中对齐">
          <Button icon={<AlignCenterOutlined />} />
        </Tooltip>
        <Tooltip title="右对齐">
          <Button icon={<AlignRightOutlined />} />
        </Tooltip>
      </Button.Group>

      <Button.Group>
        <Tooltip title="插入链接">
          <Button icon={<LinkOutlined />} />
        </Tooltip>
        <Tooltip title="插入图片">
          <Button icon={<PictureOutlined />} />
        </Tooltip>
        <Tooltip title="插入代码">
          <Button icon={<CodeOutlined />} />
        </Tooltip>
      </Button.Group>
    </Space>
  );

  // 模拟笔记数据
  const notes = [
    { 
      id: 1, 
      title: '项目计划书', 
      content: '这是一个关于云笔记项目的计划书，包含功能规划和时间节点...\n\n## 功能规划\n\n1. 用户认证\n2. 笔记编辑器\n3. 笔记管理\n4. 云同步\n\n## 时间节点\n\n- 第一周：完成基础架构\n- 第二周：实现编辑器功能\n- 第三周：完成云同步', 
      updatedAt: '2023-06-15 14:30', 
      starred: true 
    },
    { 
      id: 2, 
      title: 'React Hooks 学习笔记', 
      content: '# React Hooks 学习笔记\n\n## useState\n\n用于在函数组件中添加状态管理。\n\n```jsx\nconst [state, setState] = useState(initialState);\n```\n\n## useEffect\n\n用于处理副作用，如数据获取、订阅或手动更改 DOM。\n\n```jsx\nuseEffect(() => {\n  // 执行副作用\n  return () => {\n    // 清理函数\n  };\n}, [dependencies]);\n```', 
      updatedAt: '2023-06-14 09:15', 
      starred: false 
    },
    { 
      id: 3, 
      title: '每周工作总结', 
      content: '# 每周工作总结\n\n本周完成了以下工作：\n\n- 用户认证模块\n  - 登录页面\n  - 注册功能\n  - 密码重置\n\n- 笔记编辑器基础功能\n  - 富文本编辑\n  - 图片上传\n  - 代码高亮\n\n## 下周计划\n\n1. 完成笔记列表页面\n2. 实现笔记分类功能\n3. 开始云同步模块开发', 
      updatedAt: '2023-06-13 18:45', 
      starred: false 
    },
    { 
      id: 4, 
      title: 'Electron 应用打包指南', 
      content: '# Electron 应用打包指南\n\n## 使用 electron-builder\n\n1. 安装依赖\n\n```bash\nnpm install electron-builder --save-dev\n```\n\n2. 配置 package.json\n\n```json\n{\n  "build": {\n    "appId": "com.example.app",\n    "mac": {\n      "category": "public.app-category.productivity"\n    },\n    "win": {\n      "target": ["nsis", "msi"]\n    }\n  }\n}\n```\n\n3. 添加打包脚本\n\n```json\n{\n  "scripts": {\n    "pack": "electron-builder --dir",\n    "dist": "electron-builder"\n  }\n}\n```', 
      updatedAt: '2023-06-12 11:20', 
      starred: true 
    },
    { 
      id: 5, 
      title: '设计灵感收集', 
      content: '# 设计灵感收集\n\n## 优秀的笔记应用UI设计\n\n1. **Notion**\n   - 简洁的黑白界面\n   - 模块化的内容块\n   - 灵活的页面组织\n\n2. **Evernote**\n   - 三栏式布局\n   - 绿色主题色调\n   - 标签系统\n\n3. **有道云笔记**\n   - 清晰的层级结构\n   - 简洁的编辑界面\n   - 良好的中文支持\n\n## 交互设计思路\n\n- 减少用户操作步骤\n- 提供直观的视觉反馈\n- 保持一致的设计语言', 
      updatedAt: '2023-06-10 16:05', 
      starred: false 
    },
  ];

  // 当选中的笔记改变时，更新编辑器内容
  useEffect(() => {
    if (selectedNote) {
      const note = notes.find(n => n.id === selectedNote);
      if (note) {
        setTitle(note.title);
        setContent(note.content);
        setIsStarred(note.starred);
        setLastSaved(note.updatedAt);
      }
    } else {
      setTitle('');
      setContent('');
      setIsStarred(false);
      setLastSaved('');
    }
  }, [selectedNote]);

  // 模拟保存笔记
  const handleSave = () => {
    const now = new Date();
    const formattedDate = `${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    setLastSaved(formattedDate);
    // 实际应用中这里应该调用API保存笔记
  };

  if (!selectedNote) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500">
        <p className="text-xl">请选择或创建一个笔记</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <EditorToolbar />
      
      {/* 编辑区 */}
      <div className="flex-1 overflow-auto p-6 bg-white">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full text-3xl font-bold mb-4 border-none outline-none"
          placeholder="笔记标题"
        />
        
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="w-full h-full min-h-[calc(100%-4rem)] resize-none border-none outline-none font-normal text-base leading-relaxed"
          placeholder="开始输入笔记内容..."
        />
      </div>
    </div>
  );
};

export default NoteEditor;
