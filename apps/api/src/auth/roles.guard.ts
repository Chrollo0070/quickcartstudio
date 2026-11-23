import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { PERMISSIONS_KEY } from '../common/decorators/permissions.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

/**
 * Authorization guard. Runs after JwtAuthGuard (which guarantees a live,
 * active user on `request.user`):
 * - `@Roles('ADMIN', ...)` — user must hold one of the named roles.
 * - `@RequirePermissions('catalogue:write', ...)` — the user's roles must grant
 *   every listed permission key, resolved fresh from the database.
 * Routes with neither decorator are open to any authenticated user.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if ((!requiredRoles || requiredRoles.length === 0) && !requiredPermissions) {
      return true;
    }

    const user = context.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
    if (!user) {
      // Guard ordering bug: RolesGuard must run after JwtAuthGuard.
      throw new ForbiddenException({ message: 'Not authenticated', code: 'NOT_AUTHENTICATED' });
    }

    if (
      requiredRoles &&
      requiredRoles.length > 0 &&
      !user.roles.some((role) => requiredRoles.includes(role))
    ) {
      throw new ForbiddenException({
        message: 'Insufficient role',
        code: 'FORBIDDEN_ROLE',
        required: requiredRoles,
      });
    }

    if (requiredPermissions && requiredPermissions.length > 0) {
      const granted = await this.loadPermissionKeys(user.id);
      const missing = requiredPermissions.filter((p) => !granted.has(p));
      if (missing.length > 0) {
        throw new ForbiddenException({
          message: 'Insufficient permissions',
          code: 'FORBIDDEN_PERMISSION',
          missing,
        });
      }
    }

    return true;
  }

  private async loadPermissionKeys(userId: string): Promise<Set<string>> {
    const roles = await this.prisma.role.findMany({
      where: { users: { some: { userId } } },
      select: { permissions: { select: { permission: { select: { key: true } } } } },
    });
    const keys = new Set<string>();
    for (const role of roles) {
      for (const rp of role.permissions) {
        keys.add(rp.permission.key);
      }
    }
    return keys;
  }
}
