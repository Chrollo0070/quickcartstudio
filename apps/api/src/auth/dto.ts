import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshTokenSchema = z
  .object({
    /** Optional when the refresh cookie is present (browser flow). */
    refreshToken: z.string().min(20).max(500).optional(),
  })
  // Browsers send only the httpOnly cookie and no JSON body at all.
  .default({});
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;

/** Shape returned by login/refresh/me. */
export class AuthUserDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'cashier@quickmart.dev' })
  email!: string;

  @ApiProperty({ example: 'Demo Cashier' })
  fullName!: string;

  @ApiProperty({ type: [String], example: ['CASHIER'] })
  roles!: string[];

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  branchId!: string | null;
}

export class AccessTokenDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIs…' })
  accessToken!: string;

  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;
}

export class CurrentUserDto extends AuthUserDto {
  @ApiProperty({ type: [String], example: ['catalogue:read', 'pos:operate'] })
  permissions!: string[];

  @ApiProperty({ nullable: true, type: Object })
  branch!: { id: string; code: string; name: string } | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  lastLoginAt!: string | null;
}
