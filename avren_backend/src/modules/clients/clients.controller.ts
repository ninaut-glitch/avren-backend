import {
  Body, Controller, Get, Param, Patch,
  Post, Query, ParseUUIDPipe, Req, HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ClientsService } from './clients.service';
import {
  CreateClientDto, UpdateClientDto,
  CreateContactDto, CreateFamilyMemberDto, CreateRelationshipDto,
} from './dto/create-client.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('Clients')
@ApiBearerAuth()
@Controller('clients')
export class ClientsController {
  constructor(private readonly service: ClientsService) {}

  private ctx(user: JwtPayload, req: any) {
    return req.rlsContext ?? {
      tenantId: user.tenantId, userId: user.sub, userRole: user.role,
    };
  }

  @Get()
  @ApiOperation({ summary: 'Lista clientes com filtros' })
  findAll(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Query('banker_id') banker_id?: string,
    @Query('status')    status?: string,
    @Query('page')      page  = 1,
    @Query('limit')     limit = 20,
  ) {
    return this.service.findAll(this.ctx(user, req), {
      banker_id, status, page: Number(page), limit: Number(limit),
    });
  }

  @Post()
  @ApiOperation({ summary: 'Converte lead em cliente' })
  create(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Body() dto: CreateClientDto,
  ) {
    return this.service.create(this.ctx(user, req), dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Perfil 360° do cliente' })
  findOne(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findById(this.ctx(user, req), id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza dados do cliente' })
  update(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClientDto,
  ) {
    return this.service.update(this.ctx(user, req), id, dto);
  }

  // ── Contatos ─────────────────────────────────────────────────
  @Get(':id/contacts')
  @ApiOperation({ summary: 'Lista contatos do cliente' })
  findContacts(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findContacts(this.ctx(user, req), id);
  }

  @Post(':id/contacts')
  @ApiOperation({ summary: 'Adiciona contato ao cliente' })
  addContact(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateContactDto,
  ) {
    return this.service.addContact(this.ctx(user, req), id, dto);
  }

  // ── Família ───────────────────────────────────────────────────
  @Get(':id/family')
  @ApiOperation({ summary: 'Lista hierarquia familiar' })
  findFamily(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findFamilyMembers(this.ctx(user, req), id);
  }

  @Post(':id/family')
  @ApiOperation({ summary: 'Adiciona membro da família' })
  addFamily(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateFamilyMemberDto,
  ) {
    return this.service.addFamilyMember(this.ctx(user, req), id, dto);
  }

  // ── Relacionamentos ───────────────────────────────────────────
  @Get(':id/relationships')
  @ApiOperation({ summary: 'Lista rede de relacionamentos (contador, advogado...)' })
  findRelationships(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findRelationships(this.ctx(user, req), id);
  }

  @Post(':id/relationships')
  @ApiOperation({ summary: 'Adiciona contato à rede do cliente' })
  addRelationship(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRelationshipDto,
  ) {
    return this.service.addRelationship(this.ctx(user, req), id, dto);
  }
}
