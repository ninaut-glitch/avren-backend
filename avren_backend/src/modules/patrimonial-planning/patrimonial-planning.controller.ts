import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { PatrimonialPlanningService } from './patrimonial-planning.service';

@ApiTags('Planejamento Patrimonial')
@ApiBearerAuth()
@Controller('patrimonial-planning')
export class PatrimonialPlanningController {
  constructor(private readonly service: PatrimonialPlanningService) {}

  private ctx(user: JwtPayload, req: any) {
    return req.rlsContext ?? {
      tenantId: user.tenantId, userId: user.sub, userRole: user.role,
    };
  }

  @Get()
  @ApiOperation({ summary: 'Lista dossiês acessíveis ao usuário' })
  list(@CurrentUser() user: JwtPayload, @Req() req: any) {
    return this.service.list(this.ctx(user, req));
  }

  @Get('client/:clientId')
  @ApiOperation({ summary: 'Busca o dossiê atual do cliente' })
  findByClient(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('clientId') clientId: string,
  ) {
    return this.service.findByClient(this.ctx(user, req), clientId);
  }

  @Post()
  @ApiOperation({ summary: 'Inicia ou retorna o dossiê de um cliente' })
  create(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Body() body: { client_id: string },
  ) {
    return this.service.create(this.ctx(user, req), body.client_id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Autosave parcial do dossiê' })
  autosave(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('id') id: string,
    @Body() body: {
      data?: Record<string, unknown>;
      current_block?: string;
      completion_pct?: number;
      status?: string;
      create_version?: boolean;
    },
  ) {
    return this.service.autosave(this.ctx(user, req), id, body);
  }

  @Get(':id/versions')
  @ApiOperation({ summary: 'Histórico de versões do dossiê' })
  versions(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('id') id: string,
  ) {
    return this.service.versions(this.ctx(user, req), id);
  }
}
