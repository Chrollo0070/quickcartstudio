import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Restricts a route to users whose roles grant every listed permission key
 * (e.g. "catalogue:write"). Checked against the DB-backed permission set, not
 * the JWT, so revocations take effect immediately.
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
