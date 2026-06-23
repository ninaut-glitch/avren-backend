import { Injectable, NotFoundException } from '@nestjs/common';
import { OpportunitiesRepository } from './opportunities.repository';
import { CreateOpportunityDto, UpdateOpportunityDto } from './dto/create-opportunity.dto';
import { SessionContext } from '../../database/rls.helper';

@Injectable()
export class OpportunitiesService {
  constructor(private readonly repo: OpportunitiesRepository) {}

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

  async findById(ctx: SessionContext, id: string) {
    const row = await this.repo.findById(ctx, id);
    if (!row) throw new NotFoundException(`Oportunidade ${id} não encontrada`);
    return row;
  }

  async create(ctx: SessionContext, clientId: string, dto: CreateOpportunityDto) {
    return this.repo.create(ctx, clientId, dto);
  }

  async update(ctx: SessionContext, id: string, dto: UpdateOpportunityDto) {
    await this.findById(ctx, id);
    const row = await this.repo.update(ctx, id, dto);
    if (!row) throw new NotFoundException(`Oportunidade ${id} não encontrada`);
    return row;
  }
}
