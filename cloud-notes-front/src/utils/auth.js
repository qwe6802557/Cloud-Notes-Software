const TOKEN_KEY = 'token';
const USER_KEY = 'userInfo';

export const getToken = () => localStorage.getItem(TOKEN_KEY);

export const setToken = token => {
    localStorage.setItem(TOKEN_KEY, token);
};

export const removeToken = () => {
    localStorage.removeItem(TOKEN_KEY);
};

export const getUser = () => {
    const userInfo = localStorage.getItem(USER_KEY);

    if (!userInfo) {
        return null;
    }

    try {
        return JSON.parse(userInfo);
    } catch (error) {
        localStorage.removeItem(USER_KEY);
        return null;
    }
};

export const setUser = user => {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
};

export const removeUser = () => {
    localStorage.removeItem(USER_KEY);
};

export const clearAuth = () => {
    removeToken();
    removeUser();
};

export const isAuthenticated = () => Boolean(getToken());
