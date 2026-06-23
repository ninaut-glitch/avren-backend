// ============================================================
// modules/opportunities/opportunities.controller.ts — CORRIGIDO
// Remove import duplicado de Controller
// ============================================================
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common'
import { JwtAuthGuard }        from '../../common/guards/jwt-auth.guard'
import { RolesGuard }          from '../../common/guards/roles.guard'
import { Roles }               from '../../common/decorators/roles.decorator'
import { OpportunitiesService } from './opportunities.service'

@Controller('opportunities')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OpportunitiesController {
  constructor(private readonly svc: OpportunitiesService) {}

  @Get()
  findAll(@Request() req: any, @Query() query: any) {
    return this.svc.findAll(req.rlsContext, {
      status:    query.status,
      type:      query.type,
      client_id: query.client_id,
      page:      Number(query.page  ?? 1),
      limit:     Number(query.limit ?? 20),
    })
  }

  @Get(':id')
  findOne(@Request() req: any, @Param('id') id: string) {
    return this.svc.findOne(req.rlsContext, id)
  }

  @Post()
  @Roles('banker', 'supervisor', 'socio')
  create(@Request() req: any, @Body() dto: any) {
    return this.svc.create(req.rlsContext, dto)
  }

  @Patch(':id')
  @Roles('banker', 'supervisor', 'socio')
  update(@Request() req: any, @Param('id') id: string, @Body() dto: any) {
    return this.svc.update(req.rlsContext, id, dto)
  }

  @Patch(':id/stage')
  @Roles('banker', 'supervisor', 'socio')
  updateStage(@Request() req: any, @Param('id') id: string, @Body() dto: any) {
    return this.svc.updateStage(req.rlsContext, id, dto.status, dto.loss_reason)
  }
}

// Controller secundário para rotas aninhadas em /clients/:clientId/opportunities
@Controller('clients/:clientId/opportunities')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClientOpportunitiesController {
  constructor(private readonly svc: OpportunitiesService) {}

  @Get()
  findByClient(@Request() req: any, @Param('clientId') clientId: string) {
    return this.svc.findAll(req.rlsContext, {
      client_id: clientId,
      page:  1,
      limit: 50,
    })
  }

  @Post()
  @Roles('banker', 'supervisor', 'socio')
  create(
    @Request() req: any,
    @Param('clientId') clientId: string,
    @Body() dto: any,
  ) {
    return this.svc.create(req.rlsContext, { ...dto, client_id: clientId })
  }
}
