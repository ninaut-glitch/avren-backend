import {
  Injectable, NotFoundException, ForbiddenException,
} from '@nestjs/common';
import { InteractionsRepository } from './interactions.repository';
import { CreateInteractionDto, UpdateInteractionDto } from './dto/create-interaction.dto';
import { SessionContext } from '../../database/rls.helper';

// Regra de negócio: TODOS podem incluir e editar o histórico.
// Somente sócio (e o admin do sistema) pode EXCLUIR.
// Para liberar supervisor no futuro, basta somar 'supervisor' aqui.
const ROLES_PODEM_EXCLUIR = ['socio', 'admin'];

@Injectable()
export class InteractionsService {
  constructor(private readonly repo: InteractionsRepository) {}

  async findByClient(ctx: SessionContext, clientId: string, filters: any) {
    const { data, total } = await this.repo.findByClient(ctx, clientId, filters);
    return {
      data,
      pagination: {
        page: filters.page, limit: filters.limit,
        total, totalPages: Math.ceil(total / filters.limit),
      },
    };
  }

  async findByLead(ctx: SessionContext, leadId: string, filters: any) {
    const { data, total } = await this.repo.findByLead(ctx, leadId, filters);
    return {
      data,
      pagination: {
        page: filters.page, limit: filters.limit,
        total, totalPages: Math.ceil(total / filters.limit),
      },
    };
  }

  async findById(ctx: SessionContext, id: string) {
    const row = await this.repo.findById(ctx, id);
    if (!row) throw new NotFoundException(`Interação ${id} não encontrada`);
    return row;
  }

  async create(ctx: SessionContext, clientId: string, dto: CreateInteractionDto) {
    return this.repo.create(ctx, clientId, dto);
  }

  async createForLead(ctx: SessionContext, leadId: string, dto: CreateInteractionDto) {
    return this.repo.createForLead(ctx, leadId, dto);
  }

  // Confere se a interação existe e pertence de fato ao lead/cliente da URL
  private async assertScope(
    ctx: SessionContext,
    id: string,
    scope?: { leadId?: string; clientId?: string },
  ) {
    const existing = await this.repo.findById(ctx, id);
    if (!existing) throw new NotFoundException(`Interação ${id} não encontrada`);

    if (scope?.leadId && existing.lead_id !== scope.leadId) {
      throw new NotFoundException('Esta interação não pertence a este lead');
    }
    if (scope?.clientId && existing.client_id !== scope.clientId) {
      throw new NotFoundException('Esta interação não pertence a este cliente');
    }
    return existing;
  }

  // Edição liberada para todos os papéis
  async update(
    ctx: SessionContext,
    id: string,
    dto: UpdateInteractionDto,
    scope?: { leadId?: string; clientId?: string },
  ) {
    await this.assertScope(ctx, id, scope);

    const row = await this.repo.update(ctx, id, dto);
    if (!row) throw new NotFoundException(`Interação ${id} não encontrada`);
    return row;
  }

  // Exclusão restrita a sócio/admin
  async remove(
    ctx: SessionContext,
    id: string,
    scope?: { leadId?: string; clientId?: string },
  ) {
    if (!ROLES_PODEM_EXCLUIR.includes(ctx.userRole)) {
      throw new ForbiddenException(
        'Apenas sócios podem excluir registros do histórico de interações.',
      );
    }

    await this.assertScope(ctx, id, scope);

    const row = await this.repo.remove(ctx, id);
    if (!row) throw new NotFoundException(`Interação ${id} não encontrada`);
  }
}
