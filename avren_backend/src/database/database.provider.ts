import postgres from 'postgres';
import { ConfigService } from '@nestjs/config';

export const DATABASE_CLIENT = 'DATABASE_CLIENT';

export const databaseProvider = {
  provide: DATABASE_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    return postgres(config.get<string>('DATABASE_URL')!, {
      max: config.get<number>('DATABASE_POOL_MAX', 10),
      idle_timeout: 30,
      connect_timeout: 10,
      transform: {
        // Snake_case columns → camelCase in JS
        column: postgres.toCamel,
      },
    });
  },
};
