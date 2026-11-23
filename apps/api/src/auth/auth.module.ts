import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { getEnv, accessTokenTtl } from '../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersController } from './users.controller';
import { RolesGuard } from './roles.guard';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: getEnv().JWT_ACCESS_SECRET,
        signOptions: { expiresIn: accessTokenTtl() },
      }),
    }),
  ],
  controllers: [AuthController, UsersController],
  providers: [AuthService, JwtAuthGuard, RolesGuard],
  // JwtModule re-exported so the globally registered JwtAuthGuard (APP_GUARD in
  // AppModule) can inject JwtService.
  exports: [AuthService, JwtAuthGuard, RolesGuard, JwtModule],
})
export class AuthModule {}
