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
    const c = this.ctx(user, req);
    return c.userRole === 'socio'
      ? this.service.findAllTenant(c.tenantId)
      : this.service.findAll(c.tenantId, c.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe de uma visita' })
  findOne(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const c = this.ctx(user, req);
    return this.service.findOne(c.tenantId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Salva visita: cria lead, interação e reminder da devolutiva' })
  create(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Body() body: any,
  ) {
    const c = this.ctx(user, req);
    return this.service.create(c.tenantId, c.userId, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza o diagnóstico de uma visita salva' })
  update(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: any,
  ) {
    const c = this.ctx(user, req);
    return this.service.update(c.tenantId, c.userId, id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Exclui uma visita (o lead permanece no pipeline)' })
  remove(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const c = this.ctx(user, req);
    return this.service.remove(c.tenantId, c.userId, id, c.userRole === 'socio');
  }
}
