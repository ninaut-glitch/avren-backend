import {
  Body, Controller, Delete, Get, Param, Patch, Post,
  ParseUUIDPipe, Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { VisitsService } from './visits.service';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('Visits')
@ApiBearerAuth()
@Controller('visits')
export class VisitsController {
  constructor(private readonly service: VisitsService) {}

  private ctx(user: JwtPayload, req: any) {
    return req.rlsContext ?? {
      tenantId: user.tenantId, userId: user.sub, userRole: user.role,
    };
  }

  @Get()
  @ApiOperation({ summary: 'Lista visitas (banker vê as próprias, sócio vê todas)' })
  findAll(@CurrentUser() user: JwtPayload, @Req() req: any) {
    const { tenantId, userId, userRole } = this.ctx(user, req);
    return userRole === 'socio'
      ? this.service.findAllTenant(tenantId)
      : this.service.findAll(tenantId, userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe de uma visita (payload completo)' })
  findOne(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const { tenantId } = this.ctx(user, req);
    return this.service.findOne(tenantId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Salva visita + cria lead, interação e reminder da devolutiva' })
  create(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Body() body: any,
  ) {
    const { tenantId, userId } = this.ctx(user, req);
    return this.service.create(tenantId, userId, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza uma visita salva (não recria lead nem reminder)' })
  update(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: any,
  ) {
    const { tenantId, userId, userRole } = this.ctx(user, req);
    return this.service.update(tenantId, userId, userRole, id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Exclui uma visita (o lead permanece no pipeline)' })
  remove(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const { tenantId, userId, userRole } = this.ctx(user, req);
    return this.service.remove(tenantId, userId, userRole, id);
  }
}
