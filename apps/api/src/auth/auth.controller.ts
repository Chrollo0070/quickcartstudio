import { Body, Controller, HttpCode, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { routeThrottle } from '../common/utils/route-throttle';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { getEnv } from '../config/env';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { requestMeta } from '../common/utils/request-meta';
import { REFRESH_COOKIE, AuthService } from './auth.service';
import {
  AccessTokenDto,
  loginSchema,
  refreshTokenSchema,
  type LoginInput,
  type RefreshTokenInput,
} from './dto';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

function refreshCookieOptions() {
  const env = getEnv();
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/api/v1/auth',
  };
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle(routeThrottle(5))
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AccessTokenDto> {
    const result = await this.authService.login(body, requestMeta(request));
    response.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions());
    return { accessToken: result.accessToken, user: result.user };
  }

  /**
   * Rotate the refresh token and mint a new access token. Browsers present the
   * httpOnly cookie; API clients may present the token in the body instead.
   * The presented token is revoked atomically (replays fail).
   */
  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Throttle(routeThrottle(30))
  async refresh(
    @Body(new ZodValidationPipe(refreshTokenSchema)) body: RefreshTokenInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AccessTokenDto> {
    const cookies = request.cookies as Record<string, string | undefined> | undefined;
    const presented = body.refreshToken ?? cookies?.[REFRESH_COOKIE];
    if (!presented) {
      throw new UnauthorizedException({
        message: 'No refresh token presented',
        code: 'NO_REFRESH_TOKEN',
      });
    }
    const result = await this.authService.refresh(presented, requestMeta(request));
    response.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions());
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const cookies = request.cookies as Record<string, string | undefined> | undefined;
    await this.authService.logout(cookies?.[REFRESH_COOKIE], {
      id: user.id,
      ...requestMeta(request),
    });
    response.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
  }
}
