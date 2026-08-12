import {
  BadRequestException, Body, Controller, Headers,
  HttpCode, Post, UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { SessionContext } from '../../database/rls.helper';
import { LeadsRepository } from './leads.repository';
import { CreateLeadDto, LeadPriority, OrigemTipo } from './dto/create-lead.dto';

// ============================================================
// Recebe leads do site institucional (aureninvest.com).
// Endpoint público protegido por token compartilhado no header
// x-avren-site-token (env WEBSITE_LEADS_TOKEN). Os leads entram
// no tenant AVREN atribuídos ao Admin (sócio), que redistribui
// no pipeline. Origem marcada como 'digital'.
// ============================================================

const WEBSITE_CTX: SessionContext = {
  tenantId: process.env.WEBSITE_TENANT_ID ?? 'a0000000-0000-0000-0000-000000000001',
  userId:   process.env.WEBSITE_USER_ID   ?? '10000000-0000-0000-0000-000000000001',
  userRole: 'socio',
};

interface WebsiteLeadBody {
  origem?:   string; // 'site-contato' | 'site-newsletter'
  nome?:     string;
  email?:    string;
  telefone?: string;
  empresa?:  string;
  mensagem?: string;
  pagina?:   string;
}

@ApiTags('Leads')
@Controller('public/website-leads')
export class WebsiteLeadsController {
  constructor(private readonly repo: LeadsRepository) {}

  @Public()
  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Recebe leads do site institucional (aureninvest.com)' })
  async create(
    @Headers('x-avren-site-token') token: string | undefined,
    @Body() body: WebsiteLeadBody,
  ) {
    const expected = process.env.WEBSITE_LEADS_TOKEN;
    if (!expected || token !== expected) {
      throw new UnauthorizedException('token inválido');
    }

    const email = (body.email ?? '').trim();
    if (!email.includes('@')) {
      throw new BadRequestException('email inválido');
    }

    const isNewsletter = body.origem === 'site-newsletter';
    const fullName = (body.nome ?? '').trim() || email;

    const contexto = [
      isNewsletter
        ? 'Assinatura de newsletter pelo site'
        : 'Formulário de contato do site',
      body.empresa?.trim()  ? `Empresa: ${body.empresa.trim()}`   : null,
      body.mensagem?.trim() ? `Mensagem: ${body.mensagem.trim()}` : null,
      body.pagina           ? `Página: ${body.pagina}`            : null,
    ]
      .filter(Boolean)
      .join(' · ');

    const dto: CreateLeadDto = {
      full_name: fullName,
      email,
      phone: body.telefone?.trim() || undefined,
      banker_id: WEBSITE_CTX.userId,
      origem_tipo: OrigemTipo.DIGITAL,
      contexto_relacionamento: contexto,
      priority: isNewsletter ? LeadPriority.LOW : LeadPriority.MED,
    };

    const lead = await this.repo.create(WEBSITE_CTX, dto);
    return { ok: true, id: lead.id };
  }
}
