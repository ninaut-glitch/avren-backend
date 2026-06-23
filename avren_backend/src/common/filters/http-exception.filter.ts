import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Erro interno do servidor';
    let errors: unknown[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();

      if (typeof response === 'object' && response !== null) {
        const r = response as Record<string, unknown>;
        message = (r['message'] as string) ?? message;
        if (Array.isArray(r['message'])) {
          errors = r['message'] as unknown[];
          message = 'Erro de validação';
        }
      } else {
        message = response as string;
      }
    } else {
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: Record<string, unknown> = { statusCode: status, message };
    if (errors) {
      body['errors'] = errors.map((e) =>
        typeof e === 'object' ? e : { message: e },
      );
    }

    reply.status(status).send(body);
  }
}
