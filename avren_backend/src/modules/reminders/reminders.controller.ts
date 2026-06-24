import { Body, Controller, Get, Post, Patch, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RemindersService } from './reminders.service';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('Reminders')
@ApiBearerAuth()
@Controller('reminders')
export class RemindersController {
  constructor(private readonly service: RemindersService) {}

  @Get()
  @ApiOperation({ summary: 'Lista lembretes do usuário' })
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('date') date?: string,
    @Query('done') done?: string,
  ) {
    return this.service.findAll(user.tenantId, user.sub, { date, done: done === 'true' });
  }

  @Post()
  @ApiOperation({ summary: 'Cria um lembrete' })
  create(@CurrentUser() user: JwtPayload, @Body() body: any) {
    return this.service.create(user.tenantId, user.sub, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza lembrete' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: any,
  ) {
    return this.service.update(user.sub, id, body);
  }
}
