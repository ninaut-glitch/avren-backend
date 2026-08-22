import {
  Body, Controller, Get, Param, Patch, Delete, HttpCode,
  Post, Query, ParseUUIDPipe, Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CommunityService } from './community.service';
import {
  CreateEventDto, AddParticipantDto, UpdateParticipantStatusDto,
} from './dto/create-event.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('Community')
@ApiBearerAuth()
@Controller('events')
export class CommunityController {
  constructor(private readonly service: CommunityService) {}

  private ctx(user: JwtPayload, req: any) {
    return req.rlsContext ?? {
      tenantId: user.tenantId, userId: user.sub, userRole: user.role,
    };
  }

  @Get()
  @ApiOperation({ summary: 'Lista eventos do Members Club' })
  findAll(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.service.findEvents(this.ctx(user, req), {
      from, to, page: Number(page), limit: Number(limit),
    });
  }

  @Post()
  @ApiOperation({ summary: 'Cria novo evento' })
  create(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Body() dto: CreateEventDto,
  ) {
    return this.service.create(this.ctx(user, req), dto);
  }

  // IMPORTANTE: esta rota precisa vir ANTES de @Get(':id'), senão o Nest casaria
  // "by-lead" como :id e o ParseUUIDPipe rejeitaria (400). Lista os eventos de um lead.
  @Get('by-lead/:leadId')
  @ApiOperation({ summary: 'Lista os eventos dos quais um lead participou' })
  findByLead(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('leadId', ParseUUIDPipe) leadId: string,
  ) {
    return this.service.findEventsByLead(this.ctx(user, req), leadId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Retorna evento pelo ID' })
  findOne(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findById(this.ctx(user, req), id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Exclui um evento (e seus participantes)' })
  remove(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.remove(this.ctx(user, req), id);
  }

  @Get(':id/participants')
  @ApiOperation({ summary: 'Lista participantes do evento' })
  findParticipants(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findParticipants(this.ctx(user, req), id);
  }

  @Post(':id/participants')
  @ApiOperation({ summary: 'Convida cliente ou lead para o evento' })
  addParticipant(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddParticipantDto,
  ) {
    return this.service.addParticipant(this.ctx(user, req), id, dto);
  }

  @Patch(':id/participants/:participantId')
  @ApiOperation({ summary: 'Atualiza status de presença do participante' })
  updateStatus(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('participantId', ParseUUIDPipe) participantId: string,
    @Body() dto: UpdateParticipantStatusDto,
  ) {
    return this.service.updateParticipantStatus(this.ctx(user, req), id, participantId, dto);
  }

  @Delete(':id/participants/:participantId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove um convidado do evento' })
  removeParticipant(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('participantId', ParseUUIDPipe) participantId: string,
  ) {
    return this.service.removeParticipant(this.ctx(user, req), id, participantId);
  }
}
