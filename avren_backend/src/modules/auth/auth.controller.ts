import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Login com email e senha' })
  login(@Body() dto: LoginDto, @Req() req: FastifyRequest) {
    return this.authService.login(
      dto,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Invalida a sessão atual' })
  async logout(@Req() req: FastifyRequest) {
    const token = (req.headers.authorization ?? '').replace('Bearer ', '');
    await this.authService.logout(token);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Retorna o usuário autenticado' })
  me(@CurrentUser() user: JwtPayload) {
    return user;
  }
}
