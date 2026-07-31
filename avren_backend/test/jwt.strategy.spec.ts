import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from '../src/modules/auth/jwt.strategy';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

describe('JwtStrategy', () => {
  const payload = {
    sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    email: 'banker@teste.avren',
    role: 'banker',
    tenantId: '11111111-1111-4111-8111-111111111111',
    businessUnitId: null,
  };
  const request = {
    headers: { authorization: 'Bearer token-atual' },
  } as any;

  it('aceita JWT somente quando a sessão correspondente está ativa', async () => {
    const authService = {
      isSessionActive: jest.fn().mockResolvedValue(true),
    };
    const strategy = new JwtStrategy(
      { get: jest.fn().mockReturnValue('segredo-de-teste') } as any,
      authService as any,
    );

    await expect(strategy.validate(request, payload)).resolves.toEqual(payload);
    expect(authService.isSessionActive).toHaveBeenCalledWith(
      payload.sub,
      'token-atual',
    );
  });

  it('rejeita JWT válido cuja sessão foi revogada', async () => {
    const strategy = new JwtStrategy(
      { get: jest.fn().mockReturnValue('segredo-de-teste') } as any,
      { isSessionActive: jest.fn().mockResolvedValue(false) } as any,
    );

    await expect(strategy.validate(request, payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejeita com 401 quando a validação da sessão falha no banco', async () => {
    const strategy = new JwtStrategy(
      { get: jest.fn().mockReturnValue('segredo-de-teste') } as any,
      { isSessionActive: jest.fn().mockRejectedValue(new Error('database unavailable')) } as any,
    );

    await expect(strategy.validate(request, payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
