import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ClientsService } from '../src/modules/clients/clients.service';
import { ClientsRepository } from '../src/modules/clients/clients.repository';

const mockCtx = { tenantId: 'a0000000-0000-0000-0000-000000000001', userId: '10000000-0000-0000-0000-000000000003', userRole: 'banker' };

const mockRepo = {
  findAll:          jest.fn(),
  findById:         jest.fn(),
  create:           jest.fn(),
  update:           jest.fn(),
  findContacts:     jest.fn(),
  addContact:       jest.fn(),
  findFamilyMembers: jest.fn(),
  addFamilyMember:  jest.fn(),
  findRelationships: jest.fn(),
  addRelationship:  jest.fn(),
};

describe('ClientsService', () => {
  let service: ClientsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
        { provide: ClientsRepository, useValue: mockRepo },
      ],
    }).compile();
    service = module.get<ClientsService>(ClientsService);
    jest.clearAllMocks();
  });

  describe('findById', () => {
    it('retorna cliente quando encontrado', async () => {
      const client = { id: 'c-1', full_name: 'João Ferreira' };
      mockRepo.findById.mockResolvedValue(client);
      expect(await service.findById(mockCtx, 'c-1')).toEqual(client);
    });

    it('lança NotFoundException quando ausente', async () => {
      mockRepo.findById.mockResolvedValue(null);
      await expect(service.findById(mockCtx, 'c-x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('cria cliente com sucesso', async () => {
      const dto = { lead_id: 'l-1', full_name: 'João', banker_id: 'b-1' };
      const created = { id: 'c-new', ...dto };
      mockRepo.create.mockResolvedValue(created);
      expect(await service.create(mockCtx, dto as any)).toEqual(created);
    });

    it('lança ConflictException em CPF duplicado (pg code 23505)', async () => {
      mockRepo.create.mockRejectedValue({ code: '23505' });
      await expect(
        service.create(mockCtx, { lead_id: 'l-1', full_name: 'X', banker_id: 'b-1' } as any),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('addContact', () => {
    it('lança NotFoundException se cliente não existe antes de adicionar contato', async () => {
      mockRepo.findById.mockResolvedValue(null);
      await expect(
        service.addContact(mockCtx, 'c-x', { type: 'celular', value: '11999' }),
      ).rejects.toThrow(NotFoundException);
      expect(mockRepo.addContact).not.toHaveBeenCalled();
    });
  });
});
