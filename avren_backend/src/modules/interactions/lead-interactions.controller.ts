import {
  Body, Controller, Get, Param, Post, Patch, Delete,
  Query, ParseUUIDPipe, Req, HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InteractionsService } from './interactions.service';
import { CreateInteractionDto } from './dto/create-interaction.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { Inject } from '@nestjs/common';
import { DATABASE_CLIENT } from '../../database/database.provider';
import { Sql } from 'postgres';

@ApiTags('Lead Interactions')
@ApiBearerAuth()
@Controller('leads/:leadId/interactions')
export class LeadInteractionsController {
  constructor(
    private readonly service: InteractionsService,
    @Inject(DATABASE_CLIENT) private readonly sql: Sql,
  ) {}

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

  @Patch(':id')
  @ApiOperation({ summary: 'Edita uma interação do lead' })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: any,
  ) {
    const [row] = await this.sql`
      UPDATE wealth.interactions SET
        subject      = COALESCE(${body.subject ?? null}, subject),
        notes        = COALESCE(${body.notes ?? null}, notes),
        occurred_at  = COALESCE(${body.occurred_at ? body.occurred_at + '::timestamptz' : null}::timestamptz, occurred_at),
        duration_min = COALESCE(${body.duration_min ?? null}, duration_min)
      WHERE id = ${id} AND lead_id = ${leadId}
      RETURNING *
    `;
    return row;
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Deleta uma interação do lead' })
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.sql`
      DELETE FROM wealth.interactions WHERE id = ${id} AND lead_id = ${leadId}
    `;
  }
}
