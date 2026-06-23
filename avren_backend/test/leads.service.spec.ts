import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { LeadsService } from '../src/modules/leads/leads.service';
import { LeadsRepository } from '../src/modules/leads/leads.repository';
import { LeadStage } from '../src/modules/leads/dto/create-lead.dto';

const mockCtx = { tenantId: 'a0000000-0000-0000-0000-000000000001', userId: '10000000-0000-0000-0000-000000000003', userRole: 'banker' };

const mockRepo = {
  findAll:     jest.fn(),
  findById:    jest.fn(),
  create:      jest.fn(),
  update:      jest.fn(),
  updateStage: jest.fn(),
  findHistory: jest.fn(),
};

describe('LeadsService', () => {
  let service: LeadsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadsService,
        { provide: LeadsRepository, useValue: mockRepo },
      ],
    }).compile();

    service = module.get<LeadsService>(LeadsService);
    jest.clearAllMocks();
  });

  describe('findById', () => {
    it('retorna o lead quando encontrado', async () => {
      const lead = { id: 'lead-1', full_name: 'João', stage: 'lead' };
      mockRepo.findById.mockResolvedValue(lead);
      const result = await service.findById(mockCtx, 'lead-1');
      expect(result).toEqual(lead);
    });

    it('lança NotFoundException quando não encontrado', async () => {
      mockRepo.findById.mockResolvedValue(null);
      await expect(service.findById(mockCtx, 'lead-x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateStage', () => {
    it('avança o stage normalmente', async () => {
      const updated = { id: 'lead-1', stage: 'contato' };
      mockRepo.updateStage.mockResolvedValue(updated);
      const result = await service.updateStage(mockCtx, 'lead-1', {
        stage: LeadStage.CONTATO,
      });
      expect(result.stage).toBe('contato');
    });

    it('lança UnprocessableEntityException sem loss_reason ao perder', async () => {
      await expect(
        service.updateStage(mockCtx, 'lead-1', { stage: LeadStage.PERDIDO }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('aceita stage perdido com loss_reason preenchido', async () => {
      const updated = { id: 'lead-1', stage: 'perdido', loss_reason: 'Fee alto' };
      mockRepo.updateStage.mockResolvedValue(updated);
      const result = await service.updateStage(mockCtx, 'lead-1', {
        stage: LeadStage.PERDIDO,
        loss_reason: 'Fee alto',
      });
      expect(result.stage).toBe('perdido');
      expect(mockRepo.updateStage).toHaveBeenCalledWith(
        mockCtx, 'lead-1',
        expect.objectContaining({ loss_reason: 'Fee alto' }),
      );
    });

    it('lança NotFoundException quando lead não existe', async () => {
      mockRepo.updateStage.mockResolvedValue(null);
      await expect(
        service.updateStage(mockCtx, 'lead-x', {
          stage: LeadStage.CONTATO,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('retorna dados paginados', async () => {
      mockRepo.findAll.mockResolvedValue({ data: [{}, {}], total: 50 });
      const result = await service.findAll(mockCtx, { page: 2, limit: 10 });
      expect(result.pagination.page).toBe(2);
      expect(result.pagination.total).toBe(50);
      expect(result.pagination.totalPages).toBe(5);
    });
  });
});
