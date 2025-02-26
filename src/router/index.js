import React from 'react';
import { useRoutes } from 'react-router-dom';
import { RouterGuard } from './routerGuard';
import { routes } from './routes';

// 递归处理路由配置
const processRoutes = (routes) => {
    return routes.map(route => {
        const processedRoute = {
            path: route.path,
            element: <RouterGuard component={route.component} meta={route.meta} />
        };

        // 处理子路由
        if (route.children) {
            processedRoute.children = processRoutes(route.children);
        }

        return processedRoute;
    });
};

export const Router = () => {
    const processedRoutes = processRoutes(routes);
    return useRoutes(processedRoutes);
};
