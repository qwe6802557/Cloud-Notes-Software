import React, { Suspense } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

const LoadingSpinner = () => <div>Loading...</div>;

export const RouterGuard = ({ component: Component, meta }) => {
    const location = useLocation();
    // const isAuthenticated = localStorage.getItem('token'); // 根据需求修改认证逻辑
    const isAuthenticated = true;

    // 处理需要认证的路由
    if (meta?.requiresAuth && !isAuthenticated) {
        return <Navigate to="/login" state={{ from: location }} replace />;
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
