import type { Router } from '../http/router.ts';
import { auditRoutes } from './audit.ts';
import { authRoutes } from './auth.ts';
import { cashRoutes } from './cash.ts';
import { catalogRoutes } from './catalog.ts';
import { customerRoutes } from './customers.ts';
import { dashboardRoutes } from './dashboard.ts';
import { reportRoutes } from './reports.ts';
import { saleRoutes } from './sales.ts';
import { searchRoutes } from './search.ts';
import { serviceOrderRoutes } from './service-orders.ts';
import { settingsRoutes } from './settings.ts';
import { teamRoutes } from './team.ts';

export function registerModules(router: Router) {
  authRoutes(router);
  teamRoutes(router);
  customerRoutes(router);
  catalogRoutes(router);
  settingsRoutes(router);
  auditRoutes(router);
  searchRoutes(router);
  cashRoutes(router);
  saleRoutes(router);
  serviceOrderRoutes(router);
  dashboardRoutes(router);
  reportRoutes(router);
}
