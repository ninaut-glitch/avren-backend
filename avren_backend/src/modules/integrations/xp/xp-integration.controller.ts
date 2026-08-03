import {
  Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe,
  Post, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from '../../../common/decorators/current-user.decorator';
import { SessionContext } from '../../../database/rls.helper';
import { XpIntegrationService } from './xp-integration.service';
import { XpSyncService } from './sync/xp-sync.service';
import { XpReconciliationService } from './reconciliation/xp-reconciliation.service';
import { XpReadModelService } from './xp-read-model.service';
import { LinkAccountDto, ListRunsQueryDto } from './dto/xp.dto';

/**
 * PERMISSOES (v3.1 - correcao).
 *
 * O @Roles de CLASSE do controller original e PRESERVADO: banker nao
 * acessa nada aqui. A afirmacao da v3 de que status/capabilities
 * estavam abertos a qualquer autenticado estava ERRADA.
 *
 *   @Roles('supervisor','socio','operacoes','admin')  -> classe inteira
 *   status / capabilities                              -> herdam a classe
 *   sync/* e reconciliation/*                          -> restricao
 *     ADICIONAL a socio/admin, via assertOperator abaixo.
 *
 * A restricao adicional e guard de negocio no backend: a UI apenas
 * esconde, o backend decide.
 */
function toCtx(user: JwtPayload, req?: any): SessionContext {
  // Preserva o padrao do controller original: usa o rlsContext ja
  // montado pelo middleware quando existir.
  return (
    req?.rlsContext ?? {
      tenantId: user.tenantId,
      userId: user.sub,
      userRole: user.role,
    }
  );
}

function assertOperator(user: JwtPayload) {
  if (user.role !== 'socio' && user.role !== 'admin') {
    throw new ForbiddenException(
      'Apenas sócios e administradores podem operar a integração XP.',
    );
  }
}

@ApiTags('Integrações — XP')
@ApiBearerAuth()
@Controller('integrations/xp')
@Roles('supervisor', 'socio', 'operacoes', 'admin')
export class XpIntegrationController {
  constructor(
    private readonly service: XpIntegrationService,
    private readonly sync: XpSyncService,
    private readonly reconciliation: XpReconciliationService,
    private readonly readModel: XpReadModelService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Status e prontidão da integração XP' })
  status(@CurrentUser() user: JwtPayload, @Req() req: any) {
    return this.service.getStatus(toCtx(user, req));
  }

  @Get('capabilities')
  @ApiOperation({ summary: 'Dados suportados pelo conector XP' })
  capabilities() {
    return this.service.getCapabilities();
  }

  // ── Read models patrimoniais ────────────────────────────────

  @Get('wealth/overview')
  @ApiOperation({ summary: 'Visao consolidada dos dados patrimoniais da XP' })
  wealthOverview(
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
    @Query('month') month?: string,
  ) {
    return this.readModel.getWealthOverview(toCtx(user, req), month);
  }

  @Get('wealth/clients/:clientId')
  @Roles('banker', 'supervisor', 'socio', 'operacoes', 'admin')
  @ApiOperation({ summary: 'Posicoes, movimentacoes e receita XP por cliente' })
  clientWealth(
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Query('month') month?: string,
  ) {
    return this.readModel.getClientWealth(toCtx(user, req), clientId, month);
  }

  // ── Sincronização (socio/admin) ─────────────────────────────

  @Get('sync/runs')
  @ApiOperation({ summary: 'Histórico de execuções (limit 1..100)' })
  listRuns(
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
    @Query() query: ListRunsQueryDto,
  ) {
    assertOperator(user);
    return this.sync.listRuns(toCtx(user, req), query.limit);
  }

  @Post('sync/dry-run')
  @ApiOperation({
    summary:
      'Pipeline com dados fictícios, sem rede; dados revertidos, persiste conexão e auditoria',
  })
  dryRun(@CurrentUser() user: JwtPayload, @Req() req: any) {
    assertOperator(user);
    return this.sync.runAsUser(toCtx(user, req), {
      mode: 'fixture',
      trigger: 'fixture',
    });
  }

  @Post('sync/trigger')
  @ApiOperation({
    summary: 'Sincronização real (bloqueada com XP_INTEGRATION_ENABLED=false)',
  })
  trigger(@CurrentUser() user: JwtPayload, @Req() req: any) {
    assertOperator(user);
    return this.sync.runAsUser(toCtx(user, req), { mode: 'live', trigger: 'manual' });
  }

  // ── Conciliação (socio/admin) ───────────────────────────────

  @Get('reconciliation/pending')
  listPending(@CurrentUser() user: JwtPayload, @Req() req: any) {
    assertOperator(user);
    return this.reconciliation.listPending(toCtx(user, req));
  }

  @Get('reconciliation/clients')
  @ApiOperation({ summary: 'Busca de clientes para vínculo manual' })
  searchClients(
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
    @Query('q') q: string,
  ) {
    assertOperator(user);
    return this.reconciliation.searchClients(toCtx(user, req), q ?? '');
  }

  @Post('reconciliation/:accountId/link')
  link(
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
    @Param('accountId', new ParseUUIDPipe({ version: '4' })) accountId: string,
    @Body() body: LinkAccountDto,
  ) {
    assertOperator(user);
    return this.reconciliation.link(toCtx(user, req), accountId, body.client_id);
  }

  @Post('reconciliation/:accountId/unlink')
  unlink(
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
    @Param('accountId', new ParseUUIDPipe({ version: '4' })) accountId: string,
  ) {
    assertOperator(user);
    return this.reconciliation.unlink(toCtx(user, req), accountId);
  }

  @Post('reconciliation/:accountId/ignore')
  ignore(
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
    @Param('accountId', new ParseUUIDPipe({ version: '4' })) accountId: string,
  ) {
    assertOperator(user);
    return this.reconciliation.ignore(toCtx(user, req), accountId);
  }
}
