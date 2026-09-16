const PREFERENCES_KEY = 'cloud_notes_user_preferences';

export const DEFAULT_PREFERENCES = {
    defaultMode: 'split',
    defaultSyncScroll: true
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
            defaultSyncScroll: typeof parsed.defaultSyncScroll === 'boolean' ? parsed.defaultSyncScroll : DEFAULT_PREFERENCES.defaultSyncScroll
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
