import React, { Suspense } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { isAuthenticated } from '@/utils/auth';

const LoadingSpinner = () => <div>Loading...</div>;

export const RouterGuard = ({ component: Component, meta }) => {
    const location = useLocation();
    const authenticated = isAuthenticated();

    // 处理需要认证的路由
    if (meta?.requiresAuth && !authenticated) {
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    if (!meta?.requiresAuth && authenticated && ['/login', '/register'].includes(location.pathname)) {
        return <Navigate to="/" replace />;
    }

    // 页面标题
    if (meta?.title) {
        document.title = meta.title;
    }

    return (
        <Suspense fallback={<LoadingSpinner />}>
            <Component />
        </Suspense>
    );
};
