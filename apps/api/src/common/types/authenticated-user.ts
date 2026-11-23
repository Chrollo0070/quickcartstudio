/**
 * The request-scoped identity attached by JwtAuthGuard. Role/permission
 * details live in the database; the token carries only identity.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  branchId: string | null;
  roles: string[];
}
