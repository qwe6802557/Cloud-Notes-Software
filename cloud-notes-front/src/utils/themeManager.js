import { getEditorPreferences, setEditorPreferences } from './preferences';

/**
 * 统一应用主题管理器 (ThemeManager)
 * 遵循 Karpathy 原则：极简实效单例，统一调度 OS/Electron 与浏览器外观模式。
 */
class ThemeManager {
    constructor() {
        this.listeners = new Set();
        this.themeMode = 'system'; // 'system' | 'light' | 'dark'
        this.resolvedTheme = 'light'; // 'light' | 'dark'
        this.mediaQuery = null;
        this.isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI?.isElectron);
        this.initialized = false;
    }

    init() {
        if (typeof window === 'undefined') return 'light';
        if (this.initialized) return this.resolvedTheme;

        const prefs = getEditorPreferences();
        this.themeMode = prefs.themeMode || 'system';

        // 监听 Web 端系统外观变更
        if (window.matchMedia) {
            this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            const handleMediaChange = () => {
                if (this.themeMode === 'system') {
                    this.applyTheme();
                }
            };
            if (this.mediaQuery.addEventListener) {
                this.mediaQuery.addEventListener('change', handleMediaChange);
            } else if (this.mediaQuery.addListener) {
                this.mediaQuery.addListener(handleMediaChange);
            }
        }

        // 监听 Electron 桌面端 nativeTheme 广播
        if (this.isElectron && window.electronAPI?.theme?.onThemeChange) {
            window.electronAPI.theme.onThemeChange(data => {
                if (this.themeMode === 'system') {
                    this.applyTheme(data?.shouldUseDarkColors ? 'dark' : 'light');
                }
            });
            // 启动时同步至 Electron nativeTheme
            window.electronAPI.theme.set(this.themeMode).catch(() => {});
        }

        this.initialized = true;
        this.applyTheme();
        return this.resolvedTheme;
    }

    getThemeMode() {
        return this.themeMode;
    }

    getResolvedTheme() {
        return this.resolvedTheme;
    }

    resolveSystemTheme() {
        if (typeof window === 'undefined') return 'light';
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light';
    }

    applyTheme(forcedResolved = null) {
        if (forcedResolved) {
            this.resolvedTheme = forcedResolved;
        } else if (this.themeMode === 'dark') {
            this.resolvedTheme = 'dark';
        } else if (this.themeMode === 'light') {
            this.resolvedTheme = 'light';
        } else {
            this.resolvedTheme = this.resolveSystemTheme();
        }

        if (typeof document !== 'undefined') {
            const root = document.documentElement;
            root.setAttribute('data-theme', this.resolvedTheme);
            root.style.colorScheme = this.resolvedTheme;
        }

        this.notify();
    }

    setThemeMode(mode, persist = true) {
        if (!['system', 'light', 'dark'].includes(mode)) return;
        this.themeMode = mode;
        if (persist) {
            setEditorPreferences({ themeMode: mode });
        }

        if (this.isElectron && window.electronAPI?.theme?.set) {
            window.electronAPI.theme.set(mode).catch(() => {});
        }

        this.applyTheme();
    }

    subscribe(callback) {
        this.listeners.add(callback);
        // 初始立即分发一次当前主题状态
        callback({ themeMode: this.themeMode, resolvedTheme: this.resolvedTheme });
        return () => {
            this.listeners.delete(callback);
        };
    }

    notify() {
        const payload = {
            themeMode: this.themeMode,
            resolvedTheme: this.resolvedTheme
        };
        this.listeners.forEach(cb => {
            try { cb(payload); } catch {}
        });
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('app-theme-changed', { detail: payload }));
        }
    }
}

export const themeManager = new ThemeManager();
export default themeManager;
