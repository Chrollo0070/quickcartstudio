import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'requiredRoles';

/** Restricts a route to the given role names (e.g. ADMIN, MANAGER). */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
