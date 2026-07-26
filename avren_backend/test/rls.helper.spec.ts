import { assertRole, assertUuid } from '../src/database/rls.helper';

describe('RLS helpers', () => {
  it('aceita UUID e roles válidos', () => {
    expect(() => assertUuid('0ee9d973-bc64-4dae-8757-4d276dc1908c', 'id')).not.toThrow();
    expect(assertRole('socio')).toBe('socio');
    expect(assertRole('admin')).toBe('admin');
  });

  it('rejeita UUID e roles inválidos', () => {
    expect(() => assertUuid('não-é-uuid', 'id')).toThrow('id inválido');
    expect(() => assertRole('visitante')).toThrow('Role inválida');
  });
});
