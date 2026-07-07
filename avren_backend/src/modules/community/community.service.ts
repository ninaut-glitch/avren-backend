import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { CommunityRepository } from './community.repository';
import {
  CreateEventDto, AddParticipantDto, UpdateParticipantStatusDto,
} from './dto/create-event.dto';
import { SessionContext } from '../../database/rls.helper';

@Injectable()
export class CommunityService {
  constructor(private readonly repo: CommunityRepository) {}

  async findEvents(ctx: SessionContext, filters: any) {
    const { data, total } = await this.repo.findEvents(ctx, filters);
    return {
      data,
      pagination: {
        page: filters.page, limit: filters.limit,
        total, totalPages: Math.ceil(total / filters.limit),
      },
    };
  }

  async findById(ctx: SessionContext, id: string) {
    const event = await this.repo.findById(ctx, id);
    if (!event) throw new NotFoundException(`Evento ${id} não encontrado`);
    return event;
  }

  async create(ctx: SessionContext, dto: CreateEventDto) {
    return this.repo.create(ctx, dto);
  }

  async findParticipants(ctx: SessionContext, eventId: string) {
    await this.findById(ctx, eventId);
    return this.repo.findParticipants(ctx, eventId);
  }

  async addParticipant(ctx: SessionContext, eventId: string, dto: AddParticipantDto) {
    await this.findById(ctx, eventId);

    const hasClient = !!dto.client_id;
    const hasLead = !!dto.lead_id;
    if (hasClient === hasLead) {
      throw new BadRequestException('Informe client_id OU lead_id (exatamente um).');
    }

    const participant = await this.repo.addParticipant(ctx, eventId, dto);
    if (!participant) {
      throw new ConflictException('Convidado já adicionado a este evento');
    }
    return participant;
  }

  async updateParticipantStatus(
    ctx: SessionContext, eventId: string,
    participantId: string, dto: UpdateParticipantStatusDto,
  ) {
    const row = await this.repo.updateParticipantStatus(ctx, eventId, participantId, dto);
    if (!row) throw new NotFoundException('Participante não encontrado neste evento');
    return row;
  }
}
