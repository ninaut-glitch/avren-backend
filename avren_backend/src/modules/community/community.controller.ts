import {
  Body, Controller, Get, Param, Patch,
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
    @Query('from')  from?: string,
    @Query('to')    to?: string,
    @Query('page')  page  = 1,
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

  @Get(':id')
  @ApiOperation({ summary: 'Retorna evento pelo ID' })
  findOne(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findById(this.ctx(user, req), id);
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
  @ApiOperation({ summary: 'Convida cliente para o evento' })
  addParticipant(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddParticipantDto,
  ) {
    return this.service.addParticipant(this.ctx(user, req), id, dto);
  }

  @Patch(':id/participants/:clientId')
  @ApiOperation({ summary: 'Atualiza status de presença do participante' })
  updateStatus(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('id', ParseUUIDPipe)       id: string,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() dto: UpdateParticipantStatusDto,
  ) {
    return this.service.updateParticipantStatus(this.ctx(user, req), id, clientId, dto);
  }
}
