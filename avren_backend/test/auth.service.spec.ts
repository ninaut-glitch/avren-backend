import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../src/modules/auth/auth.service';
import { DATABASE_CLIENT } from '../src/database/database.provider';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt', () => ({
  hash: jest.fn(async (value: string) => `test-hash:${value}`),
  compare: jest.fn(async (value: string, hash: string) =>
    hash === `test-hash:${value}`),
}));

const mockSql = jest.fn() as any;
mockSql.mockReturnValue([]);

const mockJwt = { sign: jest.fn().mockReturnValue('mock-token') };

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: DATABASE_CLIENT, useValue: mockSql },
        { provide: JwtService, useValue: mockJwt },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('8h') } },
      ],
    }).compile();
    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  it('lança UnauthorizedException para usuário inexistente', async () => {
    mockSql.mockResolvedValueOnce([]);  // query retorna vazio
    await expect(
      service.login({ email: 'x@x.com', password: 'senha123' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('lança UnauthorizedException para senha errada', async () => {
    const hash = await bcrypt.hash('correta', 10);
    mockSql.mockResolvedValueOnce([{
      id: 'u-1', tenantId: 't-1', businessUnitId: null,
      email: 'a@b.com', passwordHash: hash,
      mfaEnabled: false, role: 'banker', fullName: 'Ana', isActive: true,
    }]);
    await expect(
      service.login({ email: 'a@b.com', password: 'errada12' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
