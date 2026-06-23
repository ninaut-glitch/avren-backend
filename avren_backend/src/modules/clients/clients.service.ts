import {
  Injectable, NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ClientsRepository } from './clients.repository';
import {
  CreateClientDto, UpdateClientDto,
  CreateContactDto, CreateFamilyMemberDto, CreateRelationshipDto,
} from './dto/create-client.dto';
import { SessionContext } from '../../database/rls.helper';

@Injectable()
export class ClientsService {
  constructor(private readonly repo: ClientsRepository) {}

  async findAll(ctx: SessionContext, filters: any) {
    const { data, total } = await this.repo.findAll(ctx, filters);
    return {
      data,
      pagination: {
        page: filters.page, limit: filters.limit,
        total, totalPages: Math.ceil(total / filters.limit),
      },
    };
  }

  async findById(ctx: SessionContext, id: string) {
    const client = await this.repo.findById(ctx, id);
    if (!client) throw new NotFoundException(`Cliente ${id} não encontrado`);
    return client;
  }

  async create(ctx: SessionContext, dto: CreateClientDto) {
    try {
      return await this.repo.create(ctx, dto);
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new ConflictException('CPF já cadastrado para outro cliente');
      }
      throw err;
    }
  }

  async update(ctx: SessionContext, id: string, dto: UpdateClientDto) {
    await this.findById(ctx, id);
    const client = await this.repo.update(ctx, id, dto);
    if (!client) throw new NotFoundException(`Cliente ${id} não encontrado`);
    return client;
  }

  // ── Sub-recursos ─────────────────────────────────────────────

  async findContacts(ctx: SessionContext, clientId: string) {
    await this.findById(ctx, clientId);
    return this.repo.findContacts(ctx, clientId);
  }

  async addContact(ctx: SessionContext, clientId: string, dto: CreateContactDto) {
    await this.findById(ctx, clientId);
    return this.repo.addContact(ctx, clientId, dto);
  }

  async findFamilyMembers(ctx: SessionContext, clientId: string) {
    await this.findById(ctx, clientId);
    return this.repo.findFamilyMembers(ctx, clientId);
  }

  async addFamilyMember(ctx: SessionContext, clientId: string, dto: CreateFamilyMemberDto) {
    await this.findById(ctx, clientId);
    return this.repo.addFamilyMember(ctx, clientId, dto);
  }

  async findRelationships(ctx: SessionContext, clientId: string) {
    await this.findById(ctx, clientId);
    return this.repo.findRelationships(ctx, clientId);
  }

  async addRelationship(ctx: SessionContext, clientId: string, dto: CreateRelationshipDto) {
    await this.findById(ctx, clientId);
    return this.repo.addRelationship(ctx, clientId, dto);
  }
}
