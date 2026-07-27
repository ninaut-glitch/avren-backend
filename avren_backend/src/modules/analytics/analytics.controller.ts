import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AnalyticsRepository } from './analytics.repository';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import {
  CreatePipeDreamDto, UpdatePipeDreamDto, UpsertGoalDto,
} from './dto/performance.dto';

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

  @Get('performance')
  @ApiOperation({ summary: 'Metas e ritmo comercial da equipe' })
  performance(
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
    @Query('month') month?: string,
  ) {
    const ctx = req.rlsContext ?? {
      tenantId: user.tenantId, userId: user.sub, userRole: user.role,
    };
    return this.repo.getTeamPerformance(ctx, month);
  }

  @Put('goals/:participantId')
  @Roles('socio', 'admin')
  @ApiOperation({ summary: 'Cria ou ajusta meta mensal' })
  upsertGoal(
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
    @Param('participantId', ParseUUIDPipe) participantId: string,
    @Body() dto: UpsertGoalDto,
  ) {
    const ctx = req.rlsContext ?? {
      tenantId: user.tenantId, userId: user.sub, userRole: user.role,
    };
    return this.repo.upsertGoal(ctx, participantId, dto);
  }

  @Post('pipe-dreams')
  @ApiOperation({ summary: 'Adiciona prospect ao Pipe Dream' })
  createPipeDream(
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
    @Body() dto: CreatePipeDreamDto,
  ) {
    const ctx = req.rlsContext ?? {
      tenantId: user.tenantId, userId: user.sub, userRole: user.role,
    };
    return this.repo.createPipeDream(ctx, dto);
  }

  @Patch('pipe-dreams/:id')
  @ApiOperation({ summary: 'Atualiza ou qualifica Pipe Dream' })
  updatePipeDream(
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePipeDreamDto,
  ) {
    const ctx = req.rlsContext ?? {
      tenantId: user.tenantId, userId: user.sub, userRole: user.role,
    };
    return this.repo.updatePipeDream(ctx, id, dto);
  }

  @Post('aum/refresh')
  @HttpCode(204)
  @Roles('socio', 'operacoes')
  @ApiOperation({ summary: 'Atualiza a materialized view de AUM' })
  async refreshAum() {
    await this.repo.refreshAumSummary();
  }
}
