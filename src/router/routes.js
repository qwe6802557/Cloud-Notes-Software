import { lazy } from 'react';

// 路由配置
export const routes = [
    {
        path: '/',
        component: lazy(() => import('@/pages/Home')),
        meta: {
            title: '首页',
            requiresAuth: false
        }
    },
    {
        path: '/login',
        component: lazy(() => import('@/pages/Login')),
        meta: {
            title: '登录页',
            requiresAuth: false
        }
    },
    // {
    //     path: '/settings',
    //     element: lazy(() => import('../pages/Settings')),
    //     meta: {
    //         title: '设置',
    //         requiresAuth: true
    //     },
    //     children: [
    //         {
    //             path: 'profile',
    //             element: lazy(() => import('../pages/Settings/Profile')),
    //             meta: {
    //                 title: '个人信息',
    //                 requiresAuth: true
    //             }
    //         }
    //     ]
    // }
];
