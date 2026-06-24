import {
  Body, Controller, Get, Param, Post,
  Query, ParseUUIDPipe, Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InteractionsService } from './interactions.service';
import { CreateInteractionDto } from './dto/create-interaction.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('Lead Interactions')
@ApiBearerAuth()
@Controller('leads/:leadId/interactions')
export class LeadInteractionsController {
  constructor(private readonly service: InteractionsService) {}

  private ctx(user: JwtPayload, req: any) {
    return req.rlsContext ?? {
      tenantId: user.tenantId, userId: user.sub, userRole: user.role,
    };
  }

  @Get()
  @ApiOperation({ summary: 'Timeline de interações do lead' })
  findAll(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Query('type')  type?: string,
    @Query('page')  page  = 1,
    @Query('limit') limit = 20,
  ) {
    return this.service.findByLead(this.ctx(user, req), leadId, {
      type, page: Number(page), limit: Number(limit),
    });
  }

  @Post()
  @ApiOperation({ summary: 'Registra nova interação do lead' })
  create(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Body() dto: CreateInteractionDto,
  ) {
    return this.service.createForLead(this.ctx(user, req), leadId, dto);
  }
}
