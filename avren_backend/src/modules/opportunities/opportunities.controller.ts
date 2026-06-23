import {
  Body, Controller, Get, Param, Patch,
  Post, Query, ParseUUIDPipe, Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { OpportunitiesService } from './opportunities.service';
import { CreateOpportunityDto, UpdateOpportunityDto } from './dto/create-opportunity.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('Opportunities')
@ApiBearerAuth()
@Controller('clients/:clientId/opportunities')
export class ClientOpportunitiesController {
  constructor(private readonly service: OpportunitiesService) {}

  private ctx(user: JwtPayload, req: any) {
    return req.rlsContext ?? {
      tenantId: user.tenantId, userId: user.sub, userRole: user.role,
    };
  }

  @Get()
  @ApiOperation({ summary: 'Lista oportunidades do cliente' })
  findAll(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Query('status') status?: string,
    @Query('page')   page  = 1,
    @Query('limit')  limit = 20,
  ) {
    return this.service.findByClient(this.ctx(user, req), clientId, {
      status, page: Number(page), limit: Number(limit),
    });
  }

  @Post()
  @ApiOperation({ summary: 'Cria oportunidade para o cliente' })
  create(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() dto: CreateOpportunityDto,
  ) {
    return this.service.create(this.ctx(user, req), clientId, dto);
  }
}

// Controller standalone para PATCH /opportunities/:id
import { Controller } from '@nestjs/common';

@ApiTags('Opportunities')
@ApiBearerAuth()
@Controller('opportunities')
export class OpportunitiesController {
  constructor(private readonly service: OpportunitiesService) {}

  private ctx(user: JwtPayload, req: any) {
    return req.rlsContext ?? {
      tenantId: user.tenantId, userId: user.sub, userRole: user.role,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Retorna oportunidade pelo ID' })
  findOne(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findById(this.ctx(user, req), id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza status ou dados da oportunidade' })
  update(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOpportunityDto,
  ) {
    return this.service.update(this.ctx(user, req), id, dto);
  }
}
