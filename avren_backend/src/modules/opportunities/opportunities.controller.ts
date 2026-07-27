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
import { OpportunitiesService } from './opportunities.service'

@Controller('opportunities')
export class OpportunitiesController {
  constructor(private readonly svc: OpportunitiesService) {}

  @Get()
  findAll(@Request() req: any, @Query() query: any) {
    return this.svc.findAll(req.rlsContext, {
      status: query.status,
      type: query.type,
      page: Number(query.page ?? 1),
      limit: Number(query.limit ?? 20),
    })
  }

  @Post()
  createForSubject(@Request() req: any, @Body() body: any) {
    const { client_id, lead_id, ...dto } = body
    return this.svc.createForSubject(req.rlsContext, { client_id, lead_id }, dto)
  }

  @Get('client/:clientId')
  findByClient(
    @Request() req: any,
    @Param('clientId') clientId: string,
    @Query() query: any,
  ) {
    return this.svc.findByClient(req.rlsContext, clientId, {
      status: query.status,
      type:   query.type,
      page:   Number(query.page  ?? 1),
      limit:  Number(query.limit ?? 20),
    })
  }

  @Get(':id')
  findById(@Request() req: any, @Param('id') id: string) {
    return this.svc.findById(req.rlsContext, id)
  }

  @Post('client/:clientId')
  create(
    @Request() req: any,
    @Param('clientId') clientId: string,
    @Body() dto: any,
  ) {
    return this.svc.create(req.rlsContext, clientId, dto)
  }

  @Patch(':id')
  update(@Request() req: any, @Param('id') id: string, @Body() dto: any) {
    return this.svc.update(req.rlsContext, id, dto)
  }
}

@Controller('clients/:clientId/opportunities')
export class ClientOpportunitiesController {
  constructor(private readonly svc: OpportunitiesService) {}

  @Get()
  findByClient(@Request() req: any, @Param('clientId') clientId: string, @Query() query: any) {
    return this.svc.findByClient(req.rlsContext, clientId, {
      page:  Number(query.page  ?? 1),
      limit: Number(query.limit ?? 20),
    })
  }

  @Post()
  create(@Request() req: any, @Param('clientId') clientId: string, @Body() dto: any) {
    return this.svc.create(req.rlsContext, clientId, dto)
  }
}
