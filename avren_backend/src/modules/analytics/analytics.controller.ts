import {
  Controller, Get, HttpCode, Post, Query, Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AnalyticsRepository } from './analytics.repository';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly repo: AnalyticsRepository) {}

  @Get('dashboard')
  @Roles('supervisor', 'socio', 'operacoes')
  @ApiOperation({ summary: 'Dashboard executivo' })
  dashboard(
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
    @Query('month')  month?:  string,
    @Query('period') period?: string,
  ) {
    const ctx = req.rlsContext ?? {
      tenantId: user.tenantId, userId: user.sub, userRole: user.role,
    };
    return this.repo.getExecutiveDashboard(ctx, month, period);
  }

  @Get('bankers')
  @Roles('supervisor', 'socio', 'operacoes')
  @ApiOperation({ summary: 'Performance por banker' })
  bankers(@CurrentUser() user: JwtPayload, @Req() req: any) {
    const ctx = req.rlsContext ?? {
      tenantId: user.tenantId, userId: user.sub, userRole: user.role,
    };
    return this.repo.getBankerPerformance(ctx);
  }

  @Post('aum/refresh')
  @HttpCode(204)
  @Roles('socio', 'operacoes')
  @ApiOperation({ summary: 'Atualiza a materialized view de AUM' })
  async refreshAum() {
    await this.repo.refreshAumSummary();
  }
}
