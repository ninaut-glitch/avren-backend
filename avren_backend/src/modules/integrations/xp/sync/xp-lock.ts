import { Inject, Injectable, Logger } from '@nestjs/common';
import { Sql } from 'postgres';
import { DATABASE_CLIENT } from '../../../../database/database.provider';

export interface XpLockHandle {
  release(): Promise<void>;
}

/**
 * Exclusao mutua por tenant SEM ocupar uma transacao durante a
 * comunicacao externa (requisito 6).
 *
 * Estrategia: advisory lock de SESSAO (pg_try_advisory_lock) numa
 * conexao RESERVADA do pool (sql.reserve). A conexao fica dedicada ao
 * lock enquanto o run durar; as escritas acontecem em transacoes
 * curtas de OUTRAS conexoes do pool. O release devolve o lock
 * (pg_advisory_unlock) e a conexao ao pool; se o processo morrer, o
 * Postgres libera o lock junto com a sessao.
 */
@Injectable()
export class XpSyncLock {
  private readonly logger = new Logger(XpSyncLock.name);

  constructor(@Inject(DATABASE_CLIENT) private readonly sql: Sql) {}

  /** null = outro run do MESMO tenant ja detem o lock. */
  async acquire(tenantId: string): Promise<XpLockHandle | null> {
    const reserved = await (this.sql as any).reserve();
    try {
      const [row] = await reserved`
        SELECT pg_try_advisory_lock(hashtext(${'xp_sync:' + tenantId})) AS locked
      `;
      if (!row?.locked) {
        reserved.release();
        return null;
      }
    } catch (err) {
      reserved.release();
      throw err;
    }

    let released = false;
    return {
      release: async () => {
        if (released) return;
        released = true;
        try {
          await reserved`
            SELECT pg_advisory_unlock(hashtext(${'xp_sync:' + tenantId}))
          `;
        } finally {
          reserved.release();
        }
      },
    };
  }
}
