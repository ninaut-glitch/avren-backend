import {
  Body, Controller, Get, Param, Post, Patch, Delete,
  Query, ParseUUIDPipe, Req, HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InteractionsService } from './interactions.service';
import { CreateInteractionDto, UpdateInteractionDto } from './dto/create-interaction.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('Interactions')
@ApiBearerAuth()
@Controller('clients/:clientId/interactions')
export class InteractionsController {
  constructor(private readonly service: InteractionsService) {}

  private ctx(user: JwtPayload, req: any) {
    return req.rlsContext ?? {
      tenantId: user.tenantId, userId: user.sub, userRole: user.role,
    };
  }

  @Get()
  @ApiOperation({ summary: 'Timeline de interações do cliente' })
  findAll(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Query('type') type?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.service.findByClient(this.ctx(user, req), clientId, {
      type, page: Number(page), limit: Number(limit),
    });
  }

  @Post()
  @ApiOperation({ summary: 'Registra nova interação do cliente' })
  create(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() dto: CreateInteractionDto,
  ) {
    return this.service.create(this.ctx(user, req), clientId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhes de uma interação' })
  findOne(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findById(this.ctx(user, req), id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edita uma interação do cliente (todos os papéis)' })
  update(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInteractionDto,
  ) {
    return this.service.update(this.ctx(user, req), id, dto, { clientId });
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Exclui uma interação do cliente (somente sócio)' })
  remove(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.remove(this.ctx(user, req), id, { clientId });
  }
}
