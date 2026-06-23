import {
  Body, Controller, Get, Param, Patch,
  Post, Query, ParseUUIDPipe, Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { LeadsService } from './leads.service';
import { CreateLeadDto, UpdateLeadStageDto } from './dto/create-lead.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('Leads')
@ApiBearerAuth()
@Controller('leads')
export class LeadsController {
  constructor(private readonly service: LeadsService) {}

  private ctx(user: JwtPayload, req: any) {
    return req.rlsContext ?? {
      tenantId: user.tenantId,
      userId:   user.sub,
      userRole: user.role,
    };
  }

  @Get()
  @ApiOperation({ summary: 'Lista leads com filtros e paginação' })
  findAll(
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
    @Query('stage')     stage?: string,
    @Query('banker_id') banker_id?: string,
    @Query('priority')  priority?: string,
    @Query('page')      page  = 1,
    @Query('limit')     limit = 20,
  ) {
    return this.service.findAll(this.ctx(user, req), {
      stage, banker_id, priority,
      page: Number(page), limit: Number(limit),
    });
  }

  @Post()
  @ApiOperation({ summary: 'Cria um novo lead' })
  create(
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
    @Body() dto: CreateLeadDto,
  ) {
    return this.service.create(this.ctx(user, req), dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Retorna lead pelo ID' })
  findOne(
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findById(this.ctx(user, req), id);
  }

  // FIX #1: PATCH /:id agora chama service.update(), não service.create()
  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza dados do lead' })
  update(
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Partial<CreateLeadDto>,
  ) {
    return this.service.update(this.ctx(user, req), id, dto);
  }

  @Patch(':id/stage')
  @ApiOperation({ summary: 'Avança ou retrocede o stage do lead' })
  updateStage(
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeadStageDto,
  ) {
    return this.service.updateStage(this.ctx(user, req), id, dto);
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'Histórico de stages do lead' })
  history(
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findHistory(this.ctx(user, req), id);
  }
}
