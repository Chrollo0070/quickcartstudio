import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { HealthService } from './health.service';
// Value import: @ApiOkResponse({ type }) consumes the class at runtime.
import { HealthResponseDto } from './health-response.dto';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Service liveness and dependency report' })
  @ApiOkResponse({ type: HealthResponseDto })
  async getHealth(): Promise<HealthResponseDto> {
    const report = await this.healthService.check();
    if (report.checks.database === 'down') {
      throw new ServiceUnavailableException(report);
    }
    return report;
  }
}
