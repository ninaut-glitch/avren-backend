import {
  listActiveTenantIds,
  withSystemTenantRls,
} from '../src/database/tenant-rls.helper';

describe('tenant RLS helpers', () => {
  const tenantId = '0ee9d973-bc64-4dae-8757-4d276dc1908c';

  it('define tenant e role system dentro da transação', async () => {
    const calls: unknown[][] = [];
    const tx = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(values);
      return Promise.resolve([]);
    }) as any;
    const sql = {
      begin: jest.fn(async (callback: (transaction: any) => Promise<any>) =>
        callback(tx)),
    } as any;

    const result = await withSystemTenantRls(sql, tenantId, async () => 'ok');

    expect(result).toBe('ok');
    expect(sql.begin).toHaveBeenCalledTimes(1);
    expect(calls[0]).toEqual([tenantId]);
  });

  it('rejeita tenant inválido antes de abrir a transação', async () => {
    const sql = { begin: jest.fn() } as any;

    await expect(
      withSystemTenantRls(sql, 'tenant-inválido', async () => undefined),
    ).rejects.toThrow('tenantId inválido');
    expect(sql.begin).not.toHaveBeenCalled();
  });

  it('enumera somente os ids devolvidos pela função de bootstrap', async () => {
    const sql = jest.fn().mockResolvedValue([
      { tenantId },
      { tenantId: '2a1b58c1-b4cc-4f4d-a1f3-b6f8f646a001' },
    ]) as any;

    await expect(listActiveTenantIds(sql)).resolves.toEqual([
      tenantId,
      '2a1b58c1-b4cc-4f4d-a1f3-b6f8f646a001',
    ]);
  });
});
