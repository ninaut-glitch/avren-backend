import {
  Body, Controller, Get, Param, Post, Patch, Delete,
  Query, ParseUUIDPipe, Req, HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InteractionsService } from './interactions.service';
import { CreateInteractionDto, UpdateInteractionDto } from './dto/create-interaction.dto';
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
    @Query('type') type?: string,
    @Query('page') page = 1,
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

  @Patch(':id')
  @ApiOperation({ summary: 'Edita uma interação do lead (todos os papéis)' })
  update(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInteractionDto,
  ) {
    return this.service.update(this.ctx(user, req), id, dto, { leadId });
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Exclui uma interação do lead (somente sócio)' })
  remove(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.remove(this.ctx(user, req), id, { leadId });
  }
}
