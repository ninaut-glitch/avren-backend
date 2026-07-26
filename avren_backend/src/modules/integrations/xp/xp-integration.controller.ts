import { Controller, Get, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from '../../../common/decorators/current-user.decorator';
import { XpIntegrationService } from './xp-integration.service';

@ApiTags('Integrações — XP')
@ApiBearerAuth()
@Controller('integrations/xp')
@Roles('supervisor', 'socio', 'operacoes', 'admin')
export class XpIntegrationController {
  constructor(private readonly service: XpIntegrationService) {}

  @Get('status')
  @ApiOperation({ summary: 'Status e prontidão da integração XP' })
  status(@CurrentUser() user: JwtPayload, @Req() req: any) {
    const ctx = req.rlsContext ?? {
      tenantId: user.tenantId,
      userId: user.sub,
      userRole: user.role,
    };
    return this.service.getStatus(ctx);
  }

  @Get('capabilities')
  @ApiOperation({ summary: 'Dados suportados pelo conector XP' })
  capabilities() {
    return this.service.getCapabilities();
  }
}
