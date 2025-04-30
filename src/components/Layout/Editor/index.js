import React, { useState, useEffect } from 'react';
import { Editor, Viewer } from '@bytemd/react';
import gfm from '@bytemd/plugin-gfm';
import highlight from '@bytemd/plugin-highlight';
import gemoji from '@bytemd/plugin-gemoji';
import mediumZoom from '@bytemd/plugin-medium-zoom';
import math from '@bytemd/plugin-math';
import mermaid from '@bytemd/plugin-mermaid';
import breaks from '@bytemd/plugin-breaks';
import { Empty, Spin, Button, Space, message, Tooltip } from 'antd';
import {
    EditOutlined,
    EyeOutlined,
    ColumnWidthOutlined,
    SaveOutlined,
    ShareAltOutlined,
    FileImageOutlined,
    DownloadOutlined
} from '@ant-design/icons';

// 引入所有中文语言文件
import zhHans from "bytemd/locales/zh_Hans.json";
import zhHansMermaid from "@bytemd/plugin-mermaid/locales/zh_Hans.json";
import zhHansGfm from "@bytemd/plugin-gfm/locales/zh_Hans.json";
import zhHansMath from "@bytemd/plugin-math/locales/zh_Hans.json";

import 'bytemd/dist/index.css';
import 'highlight.js/styles/github.css';
import 'katex/dist/katex.css';
import './index.less';
import {replaceTargetDomChild} from "@/utils/common";

// 中文本地化
const locale = {
    ...zhHans
};

// 插件配置
const plugins = [
    gfm({
        locale: zhHansGfm,
    }), // GitHub
    highlight(), // 代码高亮
    gemoji(), // emoji支持
    mediumZoom(), // 图片缩放
    math({
        locale: zhHansMath,
    }), // 数学公式
    mermaid({
        locale: zhHansMermaid,
    }), // 流程图等
    breaks() // 换行符支持
];

const NoteEditor = ({ selectedNote, onSave }) => {
    const [content, setContent] = useState('# 欢迎使用囧人云笔记\n\n请在左侧选择一个笔记本，然后选择或创建一个笔记开始编辑。');
    const [mode, setMode] = useState('split'); // 'edit', 'split', 'preview'
    const [loading, setLoading] = useState(false);
    const [isDirty, setIsDirty] = useState(false);
    const [wordCount, setWordCount] = useState({ words: 0, lines: 0 });

    // 监听选中笔记变化，加载笔记内容
    useEffect(() => {
        if (selectedNote) {
            setLoading(true);
            // 模拟加载笔记内容
            setTimeout(() => {
                // 模拟加载笔记内容
                const noteContent = selectedNote === 1
                    ? '# 项目计划书\n\n这是一个关于云笔记项目的计划书，包含功能规划和时间节点...\n\n## 功能规划\n\n- [x] 用户登录注册\n- [x] 笔记本管理\n- [ ] 笔记编辑器\n- [ ] 笔记分享\n\n## 时间节点\n\n|  阶段  |  时间  |  内容  |\n|  ----  |  ----  |  ----  |\n| 第一阶段 | 5月 | 基础框架搭建 |\n| 第二阶段 | 6月 | 核心功能开发 |\n| 第三阶段 | 7月 | 测试与优化 |\n'
                    : '# 新建笔记\n\n开始编写你的笔记吧...';

                setContent(noteContent);
                updateWordCount(noteContent);
                setLoading(false);
                setIsDirty(false);
            }, 500);
        }
    }, [selectedNote]);

    // 更新字数统计
    const updateWordCount = (text) => {
        const lines = text.split('\n').length;
        const words = text.trim().split(/\s+/).filter(Boolean).length;
        setWordCount({ words, lines });
    };

    // 内容变更处理
    const handleChange = (value) => {
        setContent(value);
        updateWordCount(value);
        setIsDirty(true);
    };

    // 保存笔记
    const handleSave = () => {
        if (!selectedNote) {
            message.warning('请先选择一个笔记');
            return;
        }

        setLoading(true);
        // 模拟保存操作
        setTimeout(() => {
            if (onSave) {
                onSave(selectedNote, content);
            }
            setLoading(false);
            setIsDirty(false);
            message.success('保存成功');
        }, 800);
    };

    // 编辑时隐藏工具
    const hideToolByEdit = () => {
        const tabElements = document.querySelectorAll('.bytemd-toolbar-tab');
        if (tabElements && tabElements.length > 0) {
            tabElements.forEach(element => {
                if (element.textContent === '编辑' || element.textContent === '预览') {
                    element.style.display = 'none';
                }
            });
        }

        // 隐藏整个左侧工具栏区域
        const toolbarLeft = document.querySelector('.bytemd-toolbar-left');
        if (toolbarLeft) {
            toolbarLeft.style.display = 'none';
        }
    }

    // 更新状态栏内容
    const updateStatusBar = () => {
        setTimeout(() => {
            replaceTargetDomChild('.bytemd-status-left', ` 自动保存于 ${new Date().toLocaleTimeString()}`)
        }, 100);
    };

    // 渲染编辑器工具栏
    const renderToolbar = () => (
        <div className="editor-toolbar">
            <div className="editor-left-actions">
                <Space>
                    <Button
                        type={mode === 'edit' ? 'primary' : 'default'}
                        icon={<EditOutlined />}
                        onClick={() => setMode('edit')}
                    >
                        编辑
                    </Button>
                    <Button
                        type={mode === 'split' ? 'primary' : 'default'}
                        icon={<ColumnWidthOutlined />}
                        onClick={() => setMode('split')}
                    >
                        分屏
                    </Button>
                    <Button
                        type={mode === 'preview' ? 'primary' : 'default'}
                        icon={<EyeOutlined />}
                        onClick={() => setMode('preview')}
                    >
                        预览
                    </Button>
                </Space>

                <div className="word-count">
                    <Tooltip title="字数统计">
                        <span>
                          <span className="count-label">字数:</span> {wordCount.words} <span className="count-separator">|</span>
                          <span className="count-label">行数:</span> {wordCount.lines}
                        </span>
                    </Tooltip>
                </div>
            </div>

            <div className="editor-right-actions">
                <Space>
                    <Button
                        type="primary"
                        icon={<SaveOutlined />}
                        onClick={handleSave}
                        loading={loading}
                        disabled={!isDirty}
                    >
                        保存
                    </Button>
                    <Button
                        icon={<ShareAltOutlined />}
                        disabled={!selectedNote}
                    >
                        分享
                    </Button>
                    <Button
                        icon={<FileImageOutlined />}
                        disabled={!selectedNote}
                    >
                        插入图片
                    </Button>
                    <Button
                        icon={<DownloadOutlined />}
                        disabled={!selectedNote}
                    >
                        导出
                    </Button>
                </Space>
            </div>
        </div>
    );

    // 监听mode变化
    useEffect(() => {
        if (mode === 'edit') {
            setTimeout(() => {
                hideToolByEdit();
            }, 50);
        }
    }, [mode]);
    // 时间更新
    useEffect(() => {
        updateStatusBar();
    });

    // 如果没有选中笔记且非加载状态，显示空状态
    if (!selectedNote && !loading) {
        return (
            <div className="note-editor">
                {renderToolbar()}
                <div className="empty-state">
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description="请选择或创建一个笔记"
                    >
                        <Button type="primary">新建笔记</Button>
                    </Empty>
                </div>
            </div>
        );
    }

    return (
        <div className="note-editor">
            {renderToolbar()}

            <div className="editor-content">
                <Spin spinning={loading} tip="加载中...">
                    <div className={mode === 'edit' ? "editor-container editor-container-edit" : "editor-container"}>
                        {mode === 'edit' ? (
                            <Editor
                                value={content}
                                plugins={[...plugins]}
                                onChange={handleChange}
                                mode={'tab'}
                                locale={locale}
                            />
                        ) : mode === 'preview' ? (
                            <div className="preview-only">
                                <Viewer value={content} plugins={[...plugins]} />
                            </div>
                        ) : (
                            <Editor
                                value={content}
                                plugins={[...plugins]}
                                onChange={handleChange}
                                mode={'split'}
                                locale={locale}
                            />
                        )}
                    </div>
                </Spin>
            </div>

            {/*<div className="editor-footer">*/}
            {/*    <div className="sync-info">*/}
            {/*        <SyncOutlined className="sync-icon" /> 自动保存于 {new Date().toLocaleTimeString()}*/}
            {/*    </div>*/}
            {/*    <div className="action-info">*/}
            {/*        字数: {wordCount.words} | 行数: {wordCount.lines}*/}
            {/*    </div>*/}
            {/*</div>*/}
        </div>
    );
};

export default NoteEditor;