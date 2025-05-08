import { lazy } from 'react';

// 路由配置
export const routes = [
    {
        path: '/',
        component: lazy(() => import('@/components/Layout/MainLayout')),
        meta: {
            requiresAuth: true
        },
        children: [
            {
                path: '',  // 默认子路由
                component: lazy(() => import('@/pages/Home')),
                meta: {
                    title: '首页',
                    requiresAuth: true
                }
            }
        ]
    },
    {
        path: '/login',
        component: lazy(() => import('@/pages/Login')),
        meta: {
            title: '登录页',
            requiresAuth: false
        }
    },
    {
        path: '/register',
        component: lazy(() => import('@/pages/Register')),
        meta: {
            title: '注册页',
            requiresAuth: false
        }
    }
];