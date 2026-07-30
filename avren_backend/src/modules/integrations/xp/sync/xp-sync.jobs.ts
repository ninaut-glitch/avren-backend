import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { XpSyncService } from './xp-sync.service';

/**
 * Cron noturno. DESATIVADO POR PADRAO: exige XP_INTEGRATION_ENABLED e
 * XP_SYNC_CRON_ENABLED ambas 'true'. Usa runAsSystem (contexto de
 * tenant explicito, sem usuario ficticio).
 */
@Injectable()
export class XpSyncJobs {
  private readonly logger = new Logger(XpSyncJobs.name);

  constructor(
    private readonly config: ConfigService,
    private readonly sync: XpSyncService,
  ) {}

  @Cron('30 5 * * *', { timeZone: 'America/Sao_Paulo' })
  async nightlySync() {
    const integrationOn = this.config.get('XP_INTEGRATION_ENABLED') === 'true';
    const cronOn = this.config.get('XP_SYNC_CRON_ENABLED') === 'true';
    if (!integrationOn || !cronOn) return;

    const tenantId = this.config.get<string>('XP_TENANT_ID');
    if (!tenantId) {
      this.logger.warn('Cron XP ligado mas XP_TENANT_ID ausente. Pulando.');
      return;
    }

    this.logger.log('Cron XP: iniciando sincronizacao noturna.');
    const result = await this.sync.runAsSystem(tenantId, {
      mode: 'live',
      trigger: 'cron',
    });
    this.logger.log(
      `Cron XP: run ${result.runId ?? 'sem-registro'} status ${result.status}.`,
    );
  }
}
