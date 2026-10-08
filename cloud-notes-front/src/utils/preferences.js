const PREFERENCES_KEY = 'cloud_notes_user_preferences';

export const DEFAULT_PREFERENCES = {
    defaultMode: 'split',
    defaultSyncScroll: true,
    fontFamily: 'lxgw',
    fontSize: 'medium'
};

export const getEditorPreferences = () => {
    try {
        const raw = localStorage.getItem(PREFERENCES_KEY);
        if (!raw) {
            return { ...DEFAULT_PREFERENCES };
        }
        const parsed = JSON.parse(raw);
        return {
            defaultMode: parsed.defaultMode || DEFAULT_PREFERENCES.defaultMode,
            defaultSyncScroll: typeof parsed.defaultSyncScroll === 'boolean' ? parsed.defaultSyncScroll : DEFAULT_PREFERENCES.defaultSyncScroll,
            fontFamily: parsed.fontFamily || DEFAULT_PREFERENCES.fontFamily,
            fontSize: parsed.fontSize || DEFAULT_PREFERENCES.fontSize
        };
    } catch {
        return { ...DEFAULT_PREFERENCES };
    }
};

export const setEditorPreferences = (prefs = {}) => {
    try {
        const current = getEditorPreferences();
        const next = { ...current, ...prefs };
        localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
        return next;
    } catch {
        return { ...DEFAULT_PREFERENCES, ...prefs };
    }
};

const AI_CONFIG_KEY = 'cloud_notes_ai_config';

export const SYSTEM_MODEL_LABELS = {
    'grok-chat-fast': 'grok-chat-fast',
    'glm-4-flash': 'GLM-4-Flash',
    'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B': 'DeepSeek-R1 蒸馏',
    'Qwen/Qwen2.5-Coder-7B-Instruct': 'Qwen2.5-Coder',
    'Qwen/Qwen2.5-7B-Instruct': '通义千问 7B',
    'THUDM/glm-4-9b-chat': 'GLM-4 9B'
};

export const getCachedAIConfig = () => {
    try {
        const raw = localStorage.getItem(AI_CONFIG_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
};

export const setCachedAIConfig = (config = {}) => {
    try {
        const current = getCachedAIConfig() || {};
        const next = { ...current, ...config };
        localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(next));
        return next;
    } catch {
        return config;
    }
};

export const getAIModelDisplayTag = (config = null) => {
    const aiConfig = config || getCachedAIConfig() || {};
    if (aiConfig.enabled && aiConfig.model) {
        return aiConfig.model;
    }
    const sys = aiConfig.systemModel || 'grok-chat-fast';
    return SYSTEM_MODEL_LABELS[sys] || sys;
};

