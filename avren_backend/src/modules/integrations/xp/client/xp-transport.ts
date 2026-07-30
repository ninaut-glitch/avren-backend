import * as fs from 'fs';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Agent, type Dispatcher } from 'undici';

/**
 * Transporte mTLS para o fetch do Node 20+ (undici): o material do
 * certificado entra por `dispatcher` (undici.Agent com connect
 * { cert, key }); https.Agent classico e ignorado pelo fetch nativo.
 *
 * Fontes mutuamente exclusivas: PATH ou BASE64. Ambiguidade e erro.
 * O material nunca e logado; falha de carga sobe generica (sem path,
 * sem bytes do OpenSSL).
 */
@Injectable()
export class XpTransport {
  private readonly logger = new Logger(XpTransport.name);
  private cachedDispatcher: Dispatcher | null | undefined;

  constructor(private readonly config: ConfigService) {}

  getDispatcher(): Dispatcher | null {
    if (this.cachedDispatcher !== undefined) return this.cachedDispatcher;

    const certPath = this.config.get<string>('XP_MTLS_CERT_PATH');
    const keyPath = this.config.get<string>('XP_MTLS_KEY_PATH');
    const certB64 = this.config.get<string>('XP_MTLS_CERT_BASE64');
    const keyB64 = this.config.get<string>('XP_MTLS_KEY_BASE64');

    const hasPath = Boolean(certPath && keyPath);
    const hasB64 = Boolean(certB64 && keyB64);

    if (hasPath && hasB64) {
      throw new Error(
        'Configuracao mTLS ambigua: preencha PATH ou BASE64, nunca os dois.',
      );
    }
    if (!hasPath && !hasB64) {
      this.cachedDispatcher = null;
      return null;
    }

    try {
      const cert = hasPath
        ? fs.readFileSync(certPath as string)
        : Buffer.from(certB64 as string, 'base64');
      const key = hasPath
        ? fs.readFileSync(keyPath as string)
        : Buffer.from(keyB64 as string, 'base64');

      this.cachedDispatcher = new Agent({
        connect: { cert, key },
        keepAliveTimeout: 30_000,
        connections: 10,
      });
      this.logger.log(
        `Dispatcher mTLS criado (fonte: ${hasPath ? 'arquivo' : 'base64'}).`,
      );
      return this.cachedDispatcher;
    } catch {
      throw new Error('Falha ao carregar o certificado mTLS da XP.');
    }
  }

  /** Para testes. */
  reset() {
    this.cachedDispatcher = undefined;
  }
}
