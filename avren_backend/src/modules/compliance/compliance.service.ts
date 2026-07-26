import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ComplianceRepository } from './compliance.repository';
import { SessionContext } from '../../database/rls.helper';

@Injectable()
export class ComplianceService {
  constructor(private readonly repo: ComplianceRepository) {}

  async findAlerts(ctx: SessionContext, filters: any) {
    const { data, total } = await this.repo.findAlerts(ctx, filters);
    const totalPages = Math.ceil(total / filters.limit);
    return {
      data,
      pagination: { page: filters.page, limit: filters.limit, total, totalPages },
    };
  }

  async updateStatus(ctx: SessionContext, id: string, status: string, notes?: string) {
    const allowed = new Set(['open', 'in_progress', 'resolved', 'dismissed']);
    if (!allowed.has(status)) {
      throw new BadRequestException('Status de compliance inválido');
    }
    if ((status === 'resolved' || status === 'dismissed') && !notes?.trim()) {
      throw new BadRequestException(
        'Informe a evidência ou justificativa para encerrar o alerta',
      );
    }
    const alert = await this.repo.updateAlertStatus(ctx, id, status, notes);
    if (!alert) throw new NotFoundException(`Alerta ${id} não encontrado`);
    return alert;
  }

  async syncAlerts(ctx: SessionContext) {
    const count = await this.repo.syncKycAlerts(ctx);
    return { alerts_created: count };
  }
}
