import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { XpReadModelService } from '../xp-read-model.service';

const CTX = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  userRole: 'banker',
};

describe('XpReadModelService', () => {
  it('nao consulta o banco no overview quando a integracao esta desligada', async () => {
    const sql = { begin: jest.fn() } as any;
    const config = { get: jest.fn().mockReturnValue('false') } as unknown as ConfigService;
    const service = new XpReadModelService(sql, config);

    await expect(service.getWealthOverview(CTX, '2026-08')).resolves.toMatchObject({
      available: false,
      month: '2026-08',
      totals: { aum: 0, netCapture: 0 },
    });
    expect(sql.begin).not.toHaveBeenCalled();
  });

  it('rejeita competencia invalida antes de consultar dados', async () => {
    const sql = { begin: jest.fn() } as any;
    const config = { get: jest.fn().mockReturnValue('false') } as unknown as ConfigService;
    const service = new XpReadModelService(sql, config);

    await expect(service.getWealthOverview(CTX, '08/2026'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(sql.begin).not.toHaveBeenCalled();
  });

  it('valida a visibilidade do cliente mesmo com a integracao desligada', async () => {
    const tx = jest.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(' ');
      if (query.includes('set_config')) return [];
      if (query.includes('FROM wealth.clients')) return [];
      throw new Error(`Consulta inesperada: ${query}`);
    });
    const sql = { begin: (fn: any) => fn(tx) } as any;
    const config = { get: jest.fn().mockReturnValue('false') } as unknown as ConfigService;
    const service = new XpReadModelService(sql, config);

    await expect(service.getClientWealth(
      CTX,
      '33333333-3333-4333-8333-333333333333',
      '2026-08',
    )).rejects.toBeInstanceOf(NotFoundException);
  });

  it('devolve estrutura vazia para cliente visivel sem chamar tabelas XP', async () => {
    const tx = jest.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(' ');
      if (query.includes('set_config')) return [];
      if (query.includes('FROM wealth.clients')) {
        return [{ id: '33333333-3333-4333-8333-333333333333', fullName: 'Cliente Teste' }];
      }
      throw new Error(`Consulta XP nao deveria ocorrer: ${query}`);
    });
    const sql = { begin: (fn: any) => fn(tx) } as any;
    const config = { get: jest.fn().mockReturnValue('false') } as unknown as ConfigService;
    const service = new XpReadModelService(sql, config);

    await expect(service.getClientWealth(
      CTX,
      '33333333-3333-4333-8333-333333333333',
      '2026-08',
    )).resolves.toMatchObject({
      available: false,
      client: { fullName: 'Cliente Teste' },
      positions: [],
      recentMovements: [],
    });
  });
});
