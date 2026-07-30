import { Body, Controller, Get, Post, Patch, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RemindersService } from './reminders.service';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('Reminders')
@ApiBearerAuth()
@Controller('reminders')
export class RemindersController {
  constructor(private readonly service: RemindersService) {}

  private ctx(user: JwtPayload, req: any) {
    return req.rlsContext ?? {
      tenantId: user.tenantId, userId: user.sub, userRole: user.role,
    };
  }

  @Get()
  @ApiOperation({ summary: 'Lista lembretes — sócio vê todos, banker vê os seus' })
  findAll(
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
    @Query('date') date?: string,
    @Query('done') done?: string,
  ) {
    const ctx = this.ctx(user, req)
    const isSocio = ['socio', 'supervisor', 'operacoes', 'admin'].includes(ctx.userRole)
    if (isSocio) {
      return this.service.findAllTenant(ctx, { date, done: done === 'true' })
    }
    return this.service.findAll(ctx, { date, done: done === 'true' })
  }

  @Post()
  @ApiOperation({ summary: 'Cria um lembrete' })
  create(@CurrentUser() user: JwtPayload, @Req() req: any, @Body() body: any) {
    return this.service.create(this.ctx(user, req), body)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza lembrete' })
  update(
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: any,
  ) {
    return this.service.update(this.ctx(user, req), id, body)
  }
}
