import {
  Body, Controller, Delete, Get, Post, HttpCode, Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PushService } from './push.service';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications/push')
export class PushController {
  constructor(private readonly service: PushService) {}

  private ctx(user: JwtPayload, req: any) {
    return req.rlsContext ?? {
      tenantId: user.tenantId, userId: user.sub, userRole: user.role,
    };
  }

  @Get('public-key')
  @ApiOperation({ summary: 'Chave publica VAPID para inscricao no navegador' })
  getPublicKey() {
    return this.service.getPublicKey();
  }

  @Get('status')
  @ApiOperation({ summary: 'Dispositivos inscritos do usuario atual' })
  getStatus(@CurrentUser() user: JwtPayload, @Req() req: any) {
    return this.service.getStatus(this.ctx(user, req));
  }

  @Post('subscribe')
  @ApiOperation({ summary: 'Registra um dispositivo para receber notificacoes' })
  subscribe(
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
    @Body() body: any,
  ) {
    return this.service.subscribe(this.ctx(user, req), {
      ...body,
      user_agent: body.user_agent ?? req.headers?.['user-agent'] ?? null,
    });
  }

  @Delete('subscribe')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a inscricao de um dispositivo' })
  async unsubscribe(
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
    @Body() body: any,
  ) {
    await this.service.unsubscribe(this.ctx(user, req), body.endpoint);
  }

  @Post('test')
  @ApiOperation({ summary: 'Envia uma notificacao de teste para o usuario atual' })
  sendTest(@CurrentUser() user: JwtPayload, @Req() req: any) {
    const ctx = this.ctx(user, req);
    return this.service.sendToUser(ctx, ctx.userId, {
      title: 'AVREN OS',
      body: 'Notificacoes ativadas com sucesso.',
      url: '/dashboard',
      tag: 'test',
    });
  }
}
