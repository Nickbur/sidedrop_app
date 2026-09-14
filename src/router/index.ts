import { createRouter, createWebHistory } from 'vue-router';

const router = createRouter({
    history: createWebHistory(),
    routes: [
        { path: '/', name: 'home', component: () => import('../views/HomeView.vue') },
        { path: '/r/:room', name: 'room', component: () => import('../views/HomeView.vue') },
        { path: '/:pathMatch(.*)*', redirect: { name: 'home' } },
    ],
});

export default router;
