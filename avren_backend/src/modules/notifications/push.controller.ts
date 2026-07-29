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

  @Get('public-key')
  @ApiOperation({ summary: 'Chave publica VAPID para inscricao no navegador' })
  getPublicKey() {
    return this.service.getPublicKey();
  }

  @Get('status')
  @ApiOperation({ summary: 'Dispositivos inscritos do usuario atual' })
  getStatus(@CurrentUser() user: JwtPayload) {
    return this.service.getStatus(user.sub);
  }

  @Post('subscribe')
  @ApiOperation({ summary: 'Registra um dispositivo para receber notificacoes' })
  subscribe(
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
    @Body() body: any,
  ) {
    return this.service.subscribe(user.tenantId, user.sub, {
      ...body,
      user_agent: body.user_agent ?? req.headers?.['user-agent'] ?? null,
    });
  }

  @Delete('subscribe')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a inscricao de um dispositivo' })
  async unsubscribe(@CurrentUser() user: JwtPayload, @Body() body: any) {
    await this.service.unsubscribe(user.sub, body.endpoint);
  }

  @Post('test')
  @ApiOperation({ summary: 'Envia uma notificacao de teste para o usuario atual' })
  sendTest(@CurrentUser() user: JwtPayload) {
    return this.service.sendToUser(user.sub, {
      title: 'AVREN OS',
      body: 'Notificacoes ativadas com sucesso.',
      url: '/dashboard',
      tag: 'test',
    });
  }
}
