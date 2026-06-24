import { Injectable, NotFoundException } from '@nestjs/common';
import { InteractionsRepository } from './interactions.repository';
import { CreateInteractionDto } from './dto/create-interaction.dto';
import { SessionContext } from '../../database/rls.helper';

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
    return
