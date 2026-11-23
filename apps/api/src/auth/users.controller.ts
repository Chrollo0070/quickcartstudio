import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { CurrentUserDto } from './dto';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly authService: AuthService) {}

  @Get('me')
  @ApiOperation({ summary: 'Current user profile, roles, permissions and branch' })
  @ApiOkResponse({ type: CurrentUserDto })
  async me(@CurrentUser() user: AuthenticatedUser): Promise<CurrentUserDto> {
    return this.authService.getMe(user.id);
  }
}
