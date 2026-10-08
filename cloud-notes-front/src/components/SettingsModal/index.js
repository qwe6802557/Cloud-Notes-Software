import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Form, Input, Upload, message, Button, Radio, Switch, Tag, Select } from 'antd';
import {
    UserOutlined,
    CameraOutlined,
    LockOutlined,
    SafetyCertificateOutlined,
    CheckCircleFilled,
    SettingOutlined,
    EyeInvisibleOutlined,
    EyeTwoTone,
    DeleteOutlined,
    AppstoreOutlined,
    SyncOutlined,
    RobotOutlined,
    ThunderboltOutlined,
    ApiOutlined,
    CheckCircleOutlined,
    CloseCircleOutlined,
    RocketOutlined,
    BulbOutlined,
    CodeOutlined
} from '@ant-design/icons';
import { updateUserInfo } from '@/api/user';
import { getAIConfig, updateAIConfig, testAIConnection } from '@/api/ai';
import { getUser, setUser } from '@/utils/auth';
import { getEditorPreferences, setEditorPreferences, setCachedAIConfig } from '@/utils/preferences';
import './index.less';

const FEATURED_SYSTEM_MODELS = [
    {
        id: 'grok-chat-fast',
        name: 'Grok 极速创作',
        badge: '高速推荐',
        badgeColor: 'purple',
        icon: <RocketOutlined style={{ color: '#7c3aed' }} />,
        desc: '系统内置极速通道，响应飞快，适合扩写、润色与大纲生成'
    },
    {
        id: 'glm-4-flash',
        name: '智谱 GLM-4-Flash',
        badge: '免费轻量',
        badgeColor: 'amber',
        icon: <ThunderboltOutlined style={{ color: '#eab308' }} />,
        desc: '智谱开放平台，中文理解力卓越，长文总结与知识归纳强'
    },
    {
        id: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B',
        name: 'DeepSeek-R1 蒸馏',
        badge: '推理思考',
        badgeColor: 'indigo',
        icon: <BulbOutlined style={{ color: '#8b5cf6' }} />,
        desc: '硅基流动推理模型，逻辑严密，适合论文提炼与深度问答'
    },
    {
        id: 'Qwen/Qwen2.5-Coder-7B-Instruct',
        name: 'Qwen2.5-Coder',
        badge: '技术编程',
        badgeColor: 'blue',
        icon: <CodeOutlined style={{ color: '#0284c7' }} />,
        desc: '硅基流动代码特化，精通多种语法、代码解释与技术文档'
    }
];

const MORE_SYSTEM_MODELS = [
    {
        id: 'Qwen/Qwen2.5-7B-Instruct',
        name: '通义千问 7B (通用)',
        icon: <BulbOutlined style={{ color: '#0284c7' }} />
    },
    {
        id: 'THUDM/glm-4-9b-chat',
        name: 'GLM-4 9B 开源版',
        icon: <ThunderboltOutlined style={{ color: '#eab308' }} />
    }
];

const ALL_SYSTEM_MODELS = [
    ...FEATURED_SYSTEM_MODELS,
    ...MORE_SYSTEM_MODELS
];

const computePasswordStrength = pwd => {
    if (!pwd) return 0;
    let score = 0;
    if (pwd.length >= 6) score += 1;
    if (pwd.length >= 10) score += 1;
    if (/[0-9]/.test(pwd) && /[a-zA-Z]/.test(pwd)) score += 1;
    return Math.min(score, 3);
};

const SettingsModal = ({ open, onClose, onCancel }) => {
    const handleClose = onClose || onCancel;
    const [form] = Form.useForm();
    const [activeTab, setActiveTab] = useState('profile');
    const [submitting, setSubmitting] = useState(false);
    const [avatarUrl, setAvatarUrl] = useState('');
    const [testingAI, setTestingAI] = useState(false);
    const [testResult, setTestResult] = useState(null);
    const [systemModel, setSystemModel] = useState('grok-chat-fast');
    const user = getUser() || {};

    const watchedPassword = Form.useWatch('password', form) || '';
    const watchedAiEnabled = Form.useWatch('aiEnabled', form) || false;
    const passwordStrength = useMemo(() => computePasswordStrength(watchedPassword), [watchedPassword]);
    const hasCustomAvatar = avatarUrl && avatarUrl !== 'default-avatar.png';

    useEffect(() => {
        if (open) {
            const currentUser = getUser() || {};
            const currentPrefs = getEditorPreferences();
            form.resetFields();
            form.setFieldsValue({
                username: currentUser.username || '',
                password: '',
                confirmPassword: '',
                defaultMode: currentPrefs.defaultMode || 'split',
                defaultSyncScroll: currentPrefs.defaultSyncScroll ?? true,
                fontFamily: currentPrefs.fontFamily || 'lxgw',
                fontSize: currentPrefs.fontSize || 'medium',
                aiEnabled: false,
                aiBaseUrl: '',
                aiApiKey: '',
                aiModel: '',
                aiSystemModel: 'grok-chat-fast'
            });
            setAvatarUrl(currentUser.avatar || '');
            setActiveTab('profile');
            setTestResult(null);
            setSystemModel('grok-chat-fast');

            getAIConfig().then(res => {
                if (res) {
                    setCachedAIConfig(res);
                    const loadedSystemModel = res.systemModel || 'grok-chat-fast';
                    form.setFieldsValue({
                        aiEnabled: Boolean(res.enabled),
                        aiBaseUrl: res.baseUrl || '',
                        aiApiKey: res.apiKey || '',
                        aiModel: res.model || '',
                        aiSystemModel: loadedSystemModel
                    });
                    setSystemModel(loadedSystemModel);
                }
            }).catch(() => {});
        }
    }, [open, form]);

    const handleOk = async () => {
        try {
            setSubmitting(true);

            // 仅在当前处于对应面板或字段被编辑时进行针对性校验
            const fieldsToValidate = [];
            if (activeTab === 'profile' || form.isFieldTouched('username')) {
                fieldsToValidate.push('username');
            }

            const currentPwd = (form.getFieldValue('password') || '').trim();
            const isPasswordTouched = form.isFieldTouched('password') || form.isFieldTouched('confirmPassword');
            const shouldValidatePassword = (activeTab === 'security' && currentPwd) || (isPasswordTouched && currentPwd);

            if (shouldValidatePassword) {
                fieldsToValidate.push('password', 'confirmPassword');
            }

            if (fieldsToValidate.length > 0) {
                await form.validateFields(fieldsToValidate);
            }

            const values = form.getFieldsValue(true);

            // 保存偏好设置并分发事件
            const nextPrefs = {
                defaultMode: values.defaultMode,
                defaultSyncScroll: values.defaultSyncScroll,
                fontFamily: values.fontFamily,
                fontSize: values.fontSize
            };
            setEditorPreferences(nextPrefs);
            window.dispatchEvent(new CustomEvent('editor-preferences-changed', { detail: nextPrefs }));

            // 仅在资料或密码发生实质变更时请求后端
            const trimmedUsername = (values.username || '').trim();
            const isUsernameModified = trimmedUsername && trimmedUsername !== (user.username || '');
            const isAvatarModified = avatarUrl && avatarUrl !== (user.avatar || '');
            const isPasswordModified = Boolean(shouldValidatePassword && currentPwd);

            if (isUsernameModified || isAvatarModified || isPasswordModified) {
                const payload = {
                    username: trimmedUsername || user.username,
                    avatar: avatarUrl || 'default-avatar.png'
                };

                if (isPasswordModified) {
                    payload.password = currentPwd;
                }

                const result = await updateUserInfo(payload);
                if (result?.user) {
                    setUser(result.user);
                }
            }

            // 保存 AI 模型配置
            const isAiTouched = activeTab === 'ai' || form.isFieldTouched('aiEnabled') || form.isFieldTouched('aiApiKey') || form.isFieldTouched('aiBaseUrl') || form.isFieldTouched('aiModel') || form.isFieldTouched('aiSystemModel');
            if (isAiTouched) {
                const aiPayload = {
                    enabled: Boolean(values.aiEnabled),
                    baseUrl: (values.aiBaseUrl || '').trim(),
                    apiKey: (values.aiApiKey || '').trim(),
                    model: (values.aiModel || '').trim(),
                    systemModel: values.aiSystemModel || systemModel || 'grok-chat-fast'
                };
                await updateAIConfig(aiPayload);
                setCachedAIConfig(aiPayload);
                window.dispatchEvent(new CustomEvent('ai-config-changed', { detail: aiPayload }));
            }

            message.success('个人设置已成功更新');
            handleClose?.();
        } catch (error) {
            if (error?.errorFields?.length) {
                const firstError = error.errorFields[0];
                const fieldName = firstError.name?.[0];
                const errorMsg = firstError.errors?.[0] || '请完善表单必填项';
                message.warning(errorMsg);
                if (fieldName === 'username') {
                    setActiveTab('profile');
                } else if (fieldName === 'password' || fieldName === 'confirmPassword') {
                    setActiveTab('security');
                }
                return;
            }
            message.error(error?.message || '保存设置失败，请稍后重试');
            console.error('Settings submit failed:', error);
        } finally {
            setSubmitting(false);
        }
    };

    const handleSelectSystemModel = modelId => {
        setSystemModel(modelId);
        form.setFieldsValue({ aiSystemModel: modelId });
    };

    const applyAiPreset = presetKey => {
        if (presetKey === 'deepseek') {
            form.setFieldsValue({
                aiBaseUrl: 'https://api.deepseek.com/v1',
                aiModel: 'deepseek-chat'
            });
        } else if (presetKey === 'qwen') {
            form.setFieldsValue({
                aiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
                aiModel: 'qwen-plus'
            });
        } else if (presetKey === 'openai') {
            form.setFieldsValue({
                aiBaseUrl: 'https://api.openai.com/v1',
                aiModel: 'gpt-4o-mini'
            });
        } else if (presetKey === 'ollama') {
            form.setFieldsValue({
                aiBaseUrl: 'http://localhost:11434/v1',
                aiModel: 'llama3'
            });
        }
    };

    const handleTestAI = async () => {
        const baseUrl = form.getFieldValue('aiBaseUrl');
        const apiKey = form.getFieldValue('aiApiKey');
        const model = form.getFieldValue('aiModel');

        try {
            setTestingAI(true);
            setTestResult(null);
            const res = await testAIConnection({ baseUrl, apiKey, model });
            setTestResult({ ok: true, message: `连通成功！延迟 ${res?.latencyMs || 0}ms` });
            message.success(`模型连通性测试通过！延迟 ${res?.latencyMs || 0}ms`);
        } catch (err) {
            setTestResult({ ok: false, message: err.message || '连接失败' });
            message.error(`模型连接测试失败: ${err.message || '网络异常'}`);
        } finally {
            setTestingAI(false);
        }
    };

    const handleCancel = () => {
        if (submitting) {
            return;
        }
        handleClose?.();
    };

    const uploadProps = {
        name: 'avatar',
        showUploadList: false,
        beforeUpload: file => {
            const isJpgOrPng = file.type === 'image/jpeg' || file.type === 'image/png';
            if (!isJpgOrPng) {
                message.error('只支持上传 JPG 或 PNG 格式图片');
                return false;
            }
            const isLt2M = file.size / 1024 / 1024 < 2;
            if (!isLt2M) {
                message.error('头像大小不能超过 2MB');
                return false;
            }
            const reader = new FileReader();
            reader.addEventListener('load', () => setAvatarUrl(reader.result));
            reader.readAsDataURL(file);
            return false;
        }
    };

    const navTabs = [
        {
            key: 'profile',
            label: '个人资料',
            icon: <UserOutlined />,
            desc: '基础信息与头像档案'
        },
        {
            key: 'security',
            label: '账号安全',
            icon: <LockOutlined />,
            desc: '登录密码与安全校验'
        },
        {
            key: 'preferences',
            label: '偏好设置',
            icon: <SettingOutlined />,
            desc: '编辑器视图与交互习惯'
        },
        {
            key: 'ai',
            label: 'AI 创作助手',
            icon: <RobotOutlined />,
            desc: '大模型与驱动引擎'
        }
    ];

    return (
        <Modal
            title={(
                <div className="settings-header">
                    <div className="header-left">
                        <span className="header-title">个人设置</span>
                        <span className="header-subtitle">管理个人档案、密码安全与编辑器习惯</span>
                    </div>
                    <div className="header-badge">
                        <Tag color="blue" className="account-tag">
                            {user.role === 'admin' ? '管理员' : '个人版账户'}
                        </Tag>
                    </div>
                </div>
            )}
            open={open}
            onCancel={handleCancel}
            centered
            className="modern-settings-modal"
            destroyOnClose
            width={780}
            footer={(
                <div className="settings-footer">
                    <span className="footer-tip">修改后将实时同步至当前工作区</span>
                    <div className="footer-actions">
                        <Button disabled={submitting} onClick={handleCancel}>
                            取消
                        </Button>
                        <Button type="primary" loading={submitting} onClick={handleOk}>
                            保存更改
                        </Button>
                    </div>
                </div>
            )}
        >
            <div className="settings-layout">
                {/* 左侧分类导航 */}
                <div className="settings-sidebar">
                    {navTabs.map(tab => {
                        const isActive = activeTab === tab.key;
                        return (
                            <div
                                key={tab.key}
                                className={`settings-tab-btn ${isActive ? 'is-active' : ''}`}
                                onClick={() => setActiveTab(tab.key)}
                            >
                                <span className="tab-icon">{tab.icon}</span>
                                <div className="tab-text">
                                    <span className="tab-label">{tab.label}</span>
                                    <span className="tab-desc">{tab.desc}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* 右侧表单配置区 */}
                <div className="settings-content">
                    <Form
                        form={form}
                        layout="vertical"
                        requiredMark={false}
                        className="settings-form"
                        autoComplete="off"
                    >
                        {/* 个人资料面板 */}
                        <div className={`tab-panel ${activeTab === 'profile' ? 'is-visible' : 'is-hidden'}`}>
                            <div className="panel-section-title">头像档案</div>
                            <div className="avatar-section">
                                <Upload {...uploadProps}>
                                    <div className="avatar-circle-wrapper" title="点击更换头像">
                                        {hasCustomAvatar ? (
                                            <img src={avatarUrl} alt="头像" className="avatar-circle-img" />
                                        ) : (
                                            <div className="avatar-circle-placeholder">
                                                <UserOutlined />
                                            </div>
                                        )}
                                        <div className="avatar-overlay">
                                            <CameraOutlined />
                                            <span>更换</span>
                                        </div>
                                    </div>
                                </Upload>
                                <div className="avatar-info">
                                    <div className="avatar-info-title">支持 JPG / PNG 格式，小于 2MB</div>
                                    <div className="avatar-info-desc">建议上传正方形头像以获得最佳展示效果</div>
                                    {hasCustomAvatar && (
                                        <Button
                                            type="link"
                                            size="small"
                                            danger
                                            className="reset-avatar-btn"
                                            icon={<DeleteOutlined />}
                                            onClick={() => setAvatarUrl('default-avatar.png')}
                                        >
                                            恢复默认头像
                                        </Button>
                                    )}
                                </div>
                            </div>

                            <div className="panel-divider" />

                            <div className="panel-section-title">基本信息</div>
                            <Form.Item
                                name="username"
                                label="用户昵称"
                                extra="3-50 个字符，支持英文字母与数字组合"
                                rules={[
                                    { required: true, message: '请输入用户昵称' },
                                    { min: 3, message: '昵称至少 3 个字符' },
                                    { max: 50, message: '昵称最多 50 个字符' },
                                    { pattern: /^[a-zA-Z0-9]+$/, message: '昵称仅支持英文字母和数字' }
                                ]}
                            >
                                <Input placeholder="输入新的用户名" maxLength={50} autoComplete="off" />
                            </Form.Item>

                            <Form.Item label="绑定邮箱">
                                <div className="readonly-field-box">
                                    <span className="readonly-text">{user.email || '未绑定'}</span>
                                    <Tag color="success" icon={<CheckCircleFilled />}>已验证</Tag>
                                </div>
                            </Form.Item>
                        </div>

                        {/* 账号安全面板 */}
                        <div className={`tab-panel ${activeTab === 'security' ? 'is-visible' : 'is-hidden'}`}>
                            <div className="security-notice-card">
                                <SafetyCertificateOutlined className="notice-icon" />
                                <div className="notice-body">
                                    <div className="notice-title">账号防护提示</div>
                                    <div className="notice-text">定期更换包含字母与数字的复杂密码，能有效保障笔记数据安全。若不修改密码，留空下方输入框即可。</div>
                                </div>
                            </div>

                            <div className="panel-section-title" style={{ marginTop: 20 }}>修改登录密码</div>
                            <Form.Item
                                name="password"
                                label="新登录密码"
                                extra="留空则保持原密码不变；若修改则不可少于 6 位"
                                rules={[
                                    {
                                        validator: (_, val) => {
                                            const trimmed = (val || '').trim();
                                            if (!trimmed || trimmed.length >= 6) return Promise.resolve();
                                            return Promise.reject(new Error('密码长度不能少于 6 位'));
                                        }
                                    }
                                ]}
                            >
                                <Input.Password
                                    placeholder="请输入新密码（留空则不修改）"
                                    autoComplete="new-password"
                                    iconRender={visible => (visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
                                />
                            </Form.Item>

                            {watchedPassword && (
                                <div className="password-strength-container">
                                    <div className="strength-header">
                                        <span>密码强度：</span>
                                        <span className={`strength-text level-${passwordStrength}`}>
                                            {passwordStrength === 1 ? '弱' : passwordStrength === 2 ? '中等' : '高强度'}
                                        </span>
                                    </div>
                                    <div className="strength-bars">
                                        <div className={`bar ${passwordStrength >= 1 ? 'is-active level-1' : ''}`} />
                                        <div className={`bar ${passwordStrength >= 2 ? 'is-active level-2' : ''}`} />
                                        <div className={`bar ${passwordStrength >= 3 ? 'is-active level-3' : ''}`} />
                                    </div>
                                </div>
                            )}

                            <Form.Item
                                name="confirmPassword"
                                label="确认新密码"
                                dependencies={['password']}
                                rules={[
                                    ({ getFieldValue }) => ({
                                        validator(_, val) {
                                            const pwd = (getFieldValue('password') || '').trim();
                                            if (!pwd) return Promise.resolve();
                                            const confirmTrimmed = (val || '').trim();
                                            if (!confirmTrimmed) return Promise.reject(new Error('请再次输入新密码进行确认'));
                                            if (confirmTrimmed !== pwd) return Promise.reject(new Error('两次输入的新密码不一致'));
                                            return Promise.resolve();
                                        }
                                    })
                                ]}
                            >
                                <Input.Password
                                    placeholder="请再次输入新密码"
                                    autoComplete="new-password"
                                    iconRender={visible => (visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
                                />
                            </Form.Item>
                        </div>

                        {/* 偏好设置面板 */}
                        <div className={`tab-panel ${activeTab === 'preferences' ? 'is-visible' : 'is-hidden'}`}>
                            <div className="panel-section-title">Markdown 编辑器视图习惯</div>
                            <Form.Item name="defaultMode" label="默认编辑模式">
                                <Radio.Group className="preference-mode-group">
                                    <Radio.Button value="split" className="mode-option">
                                        <AppstoreOutlined /> 双栏分屏对照
                                    </Radio.Button>
                                    <Radio.Button value="edit" className="mode-option">
                                        <UserOutlined /> 纯编辑录入
                                    </Radio.Button>
                                    <Radio.Button value="preview" className="mode-option">
                                        <EyeInvisibleOutlined /> 纯预览阅读
                                    </Radio.Button>
                                </Radio.Group>
                            </Form.Item>

                            <div className="panel-divider" />

                            <div className="panel-section-title">滚动与同步</div>
                            <div className="switch-setting-row">
                                <div className="switch-setting-info">
                                    <div className="setting-title">
                                        <SyncOutlined style={{ color: '#2563eb', marginRight: 6 }} />
                                        默认开启双向同步滚动
                                    </div>
                                    <div className="setting-desc">双栏分屏状态下，编辑区与预览区滚动条自动保持同屏比例对照。</div>
                                </div>
                                <Form.Item name="defaultSyncScroll" valuePropName="checked" noStyle>
                                    <Switch />
                                </Form.Item>
                            </div>

                            <div className="panel-divider" />

                            <div className="panel-section-title">排版与正文字体</div>
                            <Form.Item
                                name="fontFamily"
                                label="默认阅读字体"
                                extra="推荐【霞鹜文楷】，接近有道云笔记/微信读书温润墨水质感，久读不累"
                            >
                                <Radio.Group className="preference-font-group">
                                    <Radio.Button value="lxgw" className="font-option font-lxgw-preview">
                                        霞鹜文楷 (推荐)
                                    </Radio.Button>
                                    <Radio.Button value="sans" className="font-option font-sans-preview">
                                        思源黑体
                                    </Radio.Button>
                                    <Radio.Button value="system" className="font-option font-system-preview">
                                        系统默认
                                    </Radio.Button>
                                </Radio.Group>
                            </Form.Item>

                            <Form.Item name="fontSize" label="默认正文字号">
                                <Radio.Group className="preference-size-group">
                                    <Radio.Button value="small">小 (14px)</Radio.Button>
                                    <Radio.Button value="medium">标准 (16px / 默认)</Radio.Button>
                                    <Radio.Button value="large">大 (18px)</Radio.Button>
                                </Radio.Group>
                            </Form.Item>
                        </div>

                        {/* AI 创作助手面板 */}
                        <div className={`tab-panel ${activeTab === 'ai' ? 'is-visible' : 'is-hidden'}`}>
                            <div className="ai-system-card">
                                <div className="ai-system-header">
                                    <ThunderboltOutlined className="ai-card-icon" />
                                    <div className="ai-card-titles">
                                        <div className="ai-card-main-title">系统内置 AI 创作引擎</div>
                                        <div className="ai-card-sub-title">默认免配置开箱即用，已集成主流写作与推理大模型。划词创作、续写润色时默认生效所选模型：</div>
                                    </div>
                                </div>

                                <Form.Item name="aiSystemModel" hidden>
                                    <Input />
                                </Form.Item>

                                <div className="ai-models-grid">
                                    {FEATURED_SYSTEM_MODELS.map(item => {
                                        const isSelected = (systemModel || 'grok-chat-fast') === item.id;
                                        return (
                                            <div
                                                key={item.id}
                                                className={`model-card-item ${isSelected ? 'is-selected' : ''}`}
                                                onClick={() => handleSelectSystemModel(item.id)}
                                            >
                                                <div className="model-card-header">
                                                    <div className="model-title-wrap">
                                                        <span className="model-vector-icon">{item.icon}</span>
                                                        <span className="model-name">{item.name}</span>
                                                    </div>
                                                    <span className={`model-tag tag-${item.badgeColor}`}>{item.badge}</span>
                                                </div>
                                                <div className="model-desc">{item.desc}</div>
                                                {isSelected && (
                                                    <CheckCircleFilled className="model-checked-badge" />
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>

                                <div className="more-models-row">
                                    <span className="more-models-label">更多内置模型：</span>
                                    <Select
                                        value={systemModel}
                                        onChange={handleSelectSystemModel}
                                        style={{ flex: 1, minWidth: 0 }}
                                        optionLabelProp="label"
                                        popupMatchSelectWidth={false}
                                        dropdownStyle={{ minWidth: 320 }}
                                        options={ALL_SYSTEM_MODELS.map(m => ({
                                            value: m.id,
                                            label: (
                                                <span className="selected-model-label">
                                                    {m.icon}
                                                    <span className="selected-model-name">{m.name}</span>
                                                </span>
                                            ),
                                            renderItem: (
                                                <div className="select-model-dropdown-item">
                                                    <span className="item-left">
                                                        {m.icon}
                                                        <span className="item-name">{m.name}</span>
                                                    </span>
                                                    <span className="item-id" title={m.id}>
                                                        {m.id}
                                                    </span>
                                                </div>
                                            )
                                        }))}
                                        optionRender={option => option.data.renderItem}
                                    />
                                </div>
                            </div>

                            <div className="panel-divider" />

                            <div className="panel-section-title">大模型运行模式</div>
                            <div className="switch-setting-row">
                                <div className="switch-setting-info">
                                    <div className="setting-title">
                                        <ApiOutlined style={{ color: '#7c3aed', marginRight: 6 }} />
                                        启用个人专属自定义大模型
                                    </div>
                                    <div className="setting-desc">
                                        开启后将优先使用您自备的 API Key 和端点；若关闭，则自动安全回退至系统内置引擎。
                                    </div>
                                </div>
                                <Form.Item name="aiEnabled" valuePropName="checked" noStyle>
                                    <Switch />
                                </Form.Item>
                            </div>

                            {watchedAiEnabled && (
                                <div className="custom-ai-config-area" style={{ marginTop: 20 }}>
                                    <div className="panel-section-title">服务商快捷预设</div>
                                    <div className="preset-buttons-row" style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                        <Button size="small" onClick={() => applyAiPreset('deepseek')}>DeepSeek (推荐)</Button>
                                        <Button size="small" onClick={() => applyAiPreset('qwen')}>阿里通义千问</Button>
                                        <Button size="small" onClick={() => applyAiPreset('openai')}>OpenAI</Button>
                                        <Button size="small" onClick={() => applyAiPreset('ollama')}>本地 Ollama</Button>
                                    </div>

                                    <Form.Item
                                        name="aiBaseUrl"
                                        label="API 接口端点 (Base URL)"
                                        extra="遵循 OpenAI 格式标准端点，如 https://api.deepseek.com/v1"
                                        rules={[{ required: watchedAiEnabled, message: '请输入 Base URL' }]}
                                    >
                                        <Input placeholder="https://api.deepseek.com/v1" />
                                    </Form.Item>

                                    <Form.Item
                                        name="aiApiKey"
                                        label="个人 API Key"
                                        extra="您的 API Key 仅保存在个人加密配置中，绝不对外公开"
                                        rules={[{ required: watchedAiEnabled, message: '请输入 API Key' }]}
                                    >
                                        <Input.Password
                                            placeholder="sk-..."
                                            iconRender={visible => (visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
                                        />
                                    </Form.Item>

                                    <Form.Item
                                        name="aiModel"
                                        label="模型名称 (Model)"
                                        extra="例如: deepseek-chat, qwen-plus, gpt-4o-mini, llama3"
                                        rules={[{ required: watchedAiEnabled, message: '请输入模型名称' }]}
                                    >
                                        <Input placeholder="deepseek-chat" />
                                    </Form.Item>

                                    <div className="test-connection-row" style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                                        <Button
                                            icon={<ApiOutlined />}
                                            loading={testingAI}
                                            onClick={handleTestAI}
                                        >
                                            测试模型连通性
                                        </Button>
                                        {testResult && (
                                            <Tag
                                                color={testResult.ok ? 'success' : 'error'}
                                                icon={testResult.ok ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                                            >
                                                {testResult.message}
                                            </Tag>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </Form>
                </div>
            </div>
        </Modal>
    );
};

export default SettingsModal;
