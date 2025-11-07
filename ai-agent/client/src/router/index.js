import { createRouter, createWebHistory } from 'vue-router';
import { auth } from '../firebase/config';
import { onAuthStateChanged } from 'firebase/auth';

// Lazy loading views for better performance
const Home = () => import('../views/Home.vue');
const Login = () => import('../views/Login.vue');
const SignUp = () => import('../views/SignUp.vue');
const TaskSubmission = () => import('../views/TaskSubmission.vue');
const NotFound = () => import('../views/NotFound.vue');

const routes = [
  {
    path: '/',
    name: 'Home',
    component: Home,
    meta: { requiresAuth: true }
  },
  {
    path: '/login',
    name: 'Login',
    component: Login,
    meta: { requiresGuest: true }
  },
  {
    path: '/signup',
    name: 'SignUp',
    component: SignUp,
    meta: { requiresGuest: true }
  },
  {
    path: '/task',
    name: 'TaskSubmission',
    component: TaskSubmission,
    meta: { requiresAuth: true }
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: NotFound
  }
];

const router = createRouter({
  history: createWebHistory(process.env.BASE_URL),
  routes
});

// Navigation guard
router.beforeEach((to, from, next) => {
  const requiresAuth = to.matched.some(record => record.meta.requiresAuth);
  const requiresGuest = to.matched.some(record => record.meta.requiresGuest);

  onAuthStateChanged(auth, (user) => {
    // Requires auth and user is not logged in
    if (requiresAuth && !user) {
      next('/login');
    } 
    // Requires guest and user is logged in
    else if (requiresGuest && user) {
      next('/');
    } 
    // Otherwise, proceed
    else {
      next();
    }
  });
});

export default router; 