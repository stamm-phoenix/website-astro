import { authStore } from './authStore.svelte';
import type { StaffModule } from './staffModules';

/**
 * Whether the logged-in user may open the module. A module for some teams stays hidden until the
 * login is known; the API checks the teams again.
 */
export function canOpenModule(module: Pick<StaffModule, 'roles'>): boolean {
  const roles = authStore.principal?.userRoles ?? [];
  return !module.roles || module.roles.some((role) => roles.includes(role));
}
