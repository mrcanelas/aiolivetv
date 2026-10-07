import {
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router';
import { rootRoute } from './routes/root';
import { IndexPage } from './routes/index-page';
import { LoginPage, safeNext } from './routes/login-page';
import { SplashscreenPage } from './routes/splashscreen-page';
import { LoadingSpinner } from './components/ui/loading-spinner';
import { sessionQuery, statusQuery } from './lib/queries';
import { queryClient } from './lib/query-client';
import type { StatusResponse } from '@aiolivetv/core';

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: IndexPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  beforeLoad: async () => {
    const session = await queryClient
      .ensureQueryData(sessionQuery)
      .catch(() => null);
    if (session) {
      // Honour `?next=` so deeplinks (e.g. Stremio's configure intermediary
      // 302→/login?next=/stremio/<uuid>/<blob>/configure) round-trip back to
      // the originally requested page when the user is already logged in.
      // `safeNext` rejects anything that isn't a same-origin absolute path.
      const params = new URLSearchParams(window.location.search);
      const target = safeNext(params.get('next'));
      // Non-admin users trying to reach a dashboard route should see the
      // login form so they can sign in as a different (admin) account.
      if (!session.isAdmin && target.startsWith('/dashboard')) {
        return;
      }
      throw redirect({ href: target } as never);
    }
  },
  component: LoginPage,
});

const splashscreenRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/splashscreen',
  component: SplashscreenPage,
});

// Auth gate for the configure routes: if the instance is protected, a valid
// session is required. Also pre-fetches status so the page renders immediately.
async function configureBeforeLoad({
  location,
}: {
  location: { href: string };
}) {
  const status = await queryClient
    .ensureQueryData(statusQuery)
    .catch(() => null);
  if ((status as StatusResponse | null)?.settings?.protected) {
    const session = await queryClient
      .ensureQueryData(sessionQuery)
      .catch(() => null);
    if (!session) {
      throw redirect({
        to: '/login',
        search: { next: location.href } as never,
      });
    }
  }
}

const stremioConfigureRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/stremio/configure',
  beforeLoad: configureBeforeLoad,
  component: lazyRouteComponent(
    () => import('./routes/configure-route'),
    'ConfigureRoute'
  ),
});

const stremioConfigureAuthRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/stremio/$uuid/$encryptedPassword/configure',
  beforeLoad: configureBeforeLoad,
  component: lazyRouteComponent(
    () => import('./routes/configure-route'),
    'ConfigureRoute'
  ),
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard',
  beforeLoad: async ({ location }) => {
    const session = await queryClient
      .ensureQueryData(sessionQuery)
      .catch(() => null);
    if (!session) {
      throw redirect({
        to: '/login',
        search: { next: location.href } as never,
      });
    }
    if (!session.isAdmin) {
      throw redirect({
        to: '/login',
        search: { next: location.href, error: 'forbidden' } as never,
      });
    }
  },
  component: lazyRouteComponent(
    () => import('./routes/dashboard-layout'),
    'DashboardLayout'
  ),
});

const dashboardIndexRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/',
  component: lazyRouteComponent(
    () => import('./app/dashboard/overview/overview-page'),
    'DashboardHome'
  ),
});

const dashboardAnalyticsRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: 'analytics',
  component: lazyRouteComponent(
    () => import('./app/dashboard/analytics/analytics-page'),
    'AnalyticsPage'
  ),
});

const dashboardLogsRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: 'logs',
  component: lazyRouteComponent(
    () => import('./app/dashboard/logs/logs-page'),
    'LogsPage'
  ),
});

const dashboardSystemRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: 'system',
  component: lazyRouteComponent(
    () => import('./app/dashboard/system/system-page'),
    'SystemPage'
  ),
});

const dashboardSettingsRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: 'settings',
  component: lazyRouteComponent(
    () => import('./app/dashboard/settings/settings-page'),
    'SettingsPage'
  ),
});

const dashboardProxyRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: 'proxy',
  beforeLoad: () => {
    throw redirect({ href: '/dashboard/settings?tab=proxy' } as never);
  },
  component: () => null,
});

const dashboardUsersRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: 'users',
  component: lazyRouteComponent(
    () => import('./app/dashboard/users/users-page'),
    'UsersPage'
  ),
});

const dashboardTasksRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: 'tasks',
  component: lazyRouteComponent(
    () => import('./app/dashboard/tasks/tasks-page'),
    'TasksPage'
  ),
});

const dashboardCacheRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: 'cache',
  component: lazyRouteComponent(
    () => import('./app/dashboard/cache/cache-page'),
    'CachePage'
  ),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  stremioConfigureRoute,
  stremioConfigureAuthRoute,
  loginRoute,
  splashscreenRoute,
  dashboardRoute.addChildren([
    dashboardIndexRoute,
    dashboardAnalyticsRoute,
    dashboardLogsRoute,
    dashboardSystemRoute,
    dashboardSettingsRoute,
    dashboardProxyRoute,
    dashboardUsersRoute,
    dashboardTasksRoute,
    dashboardCacheRoute,
  ]),
]);

export const router = createRouter({
  routeTree,
  context: { queryClient },
  trailingSlash: 'never',
  defaultPreload: 'intent',
  defaultPendingComponent: () => <LoadingSpinner />,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
