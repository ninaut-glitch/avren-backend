import { setRlsContext } from '../src/database/rls.helper';

describe('setRlsContext', () => {
  const mockSql = jest.fn();

  beforeEach(() => mockSql.mockResolvedValue([{}]));

  it('aceita UUIDs e roles válidos sem lançar erro', async () => {
    await expect(
      setRlsContext(mockSql as any, {
        tenantId: 'a0000000-0000-0000-0000-000000000001',
        userId:   '10000000-0000-0000-0000-000000000003',
        userRole: 'banker',
      }),
    ).resolves.not.toThrow();
    expect(mockSql).toHaveBeenCalledTimes(3);
  });

  it('lança erro para tenantId inválido (não UUID)', async () => {
    await expect(
      setRlsContext(mockSql as any, {
        tenantId: 'not-a-uuid',
        userId:   '10000000-0000-0000-0000-000000000003',
        userRole: 'banker',
      }),
    ).rejects.toThrow('tenantId is not a valid UUID');
  });

  it('lança erro para role inválida', async () => {
    await expect(
      setRlsContext(mockSql as any, {
        tenantId: 'a0000000-0000-0000-0000-000000000001',
        userId:   '10000000-0000-0000-0000-000000000003',
        userRole: 'admin',   // não existe no sistema
      }),
    ).rejects.toThrow('userRole "admin" is not a recognized role');
  });
});
