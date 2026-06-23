import {
  Body, Controller, Get, Param, Patch, Post,
  Query, ParseUUIDPipe, Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ComplianceService } from './compliance.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('Compliance')
@ApiBearerAuth()
@Controller('compliance')
export class ComplianceController {
  constructor(private readonly service: ComplianceService) {}

  private ctx(user: JwtPayload, req: any) {
    return req.rlsContext ?? {
      tenantId: user.tenantId,
      userId: user.sub,
      userRole: user.role,
    };
  }

  @Get('alerts')
  @ApiOperation({ summary: 'Lista alertas de KYC e Suitability' })
  findAlerts(
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
    @Query('severity') severity?: string,
    @Query('status') status?: string,
    @Query('banker_id') banker_id?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.service.findAlerts(this.ctx(user, req), {
      severity, status, banker_id,
      page: Number(page), limit: Number(limit),
    });
  }

  @Patch('alerts/:id')
  @ApiOperation({ summary: 'Atualiza status de um alerta' })
  updateStatus(
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { status: string; notes?: string },
  ) {
    return this.service.updateStatus(this.ctx(user, req), id, body.status, body.notes);
  }

  @Post('alerts/sync')
  @Roles('socio', 'operacoes')
  @ApiOperation({ summary: 'Sincronização manual de alertas KYC/Suitability' })
  sync(@CurrentUser() user: JwtPayload, @Req() req: any) {
    return this.service.syncAlerts(this.ctx(user, req));
  }
}
