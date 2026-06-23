import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { LeadsRepository } from './leads.repository';
import { CreateLeadDto, UpdateLeadStageDto } from './dto/create-lead.dto';
import { SessionContext } from '../../database/rls.helper';

@Injectable()
export class LeadsService {
  constructor(private readonly repo: LeadsRepository) {}

  async findAll(ctx: SessionContext, filters: any) {
    const { data, total } = await this.repo.findAll(ctx, filters);
    const totalPages = Math.ceil(total / filters.limit);
    return {
      data,
      pagination: { page: filters.page, limit: filters.limit, total, totalPages },
    };
  }

  async findById(ctx: SessionContext, id: string) {
    const lead = await this.repo.findById(ctx, id);
    if (!lead) throw new NotFoundException(`Lead ${id} não encontrado`);
    return lead;
  }

  async create(ctx: SessionContext, dto: CreateLeadDto) {
    return this.repo.create(ctx, dto);
  }

  // FIX #1: service.update() agora existe e chama repo.update()
  async update(ctx: SessionContext, id: string, dto: Partial<CreateLeadDto>) {
    await this.findById(ctx, id); // garante 404 se não existir
    const lead = await this.repo.update(ctx, id, dto);
    if (!lead) throw new NotFoundException(`Lead ${id} não encontrado`);
    return lead;
  }

  async updateStage(ctx: SessionContext, id: string, dto: UpdateLeadStageDto) {
    if (dto.stage === 'perdido' && !dto.loss_reason) {
      throw new UnprocessableEntityException(
        'loss_reason é obrigatório quando stage = perdido',
      );
    }
    const lead = await this.repo.updateStage(ctx, id, dto);
    if (!lead) throw new NotFoundException(`Lead ${id} não encontrado`);
    return lead;
  }

  async findHistory(ctx: SessionContext, id: string) {
    return this.repo.findHistory(ctx, id);
  }
}
