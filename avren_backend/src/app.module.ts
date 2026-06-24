import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { DatabaseModule }      from './database/database.module';
import { AuthModule }          from './modules/auth/auth.module';
import { LeadsModule }         from './modules/leads/leads.module';
import { ClientsModule }       from './modules/clients/clients.module';
import { InteractionsModule }  from './modules/interactions/interactions.module';
import { OpportunitiesModule } from './modules/opportunities/opportunities.module';
import { TasksModule }         from './modules/tasks/tasks.module';
import { ComplianceModule }    from './modules/compliance/compliance.module';
import { AnalyticsModule }     from './modules/analytics/analytics.module';
import { CommunityModule }     from './modules/community/community.module';
import { AiModule }            from './modules/ai/ai.module';
import { RemindersModule }     from './modules/reminders/reminders.module';
import { JwtAuthGuard }          from './common/guards/jwt.guard';
import { RolesGuard }            from './common/guards/roles.guard';
import { RlsInterceptor }        from './common/interceptors/rls.interceptor';
import { AuditInterceptor }      from './common/interceptors/audit.interceptor';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { globalValidationPipe }  from './common/pipes/validation.pipe';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    ThrottlerModule.forRoot([{
      ttl:   Number(process.env.THROTTLE_TTL   ?? 60),
      limit: Number(process.env.THROTTLE_LIMIT ?? 100),
    }]),
    DatabaseModule,
    AuthModule,
    LeadsModule,
    ClientsModule,
    InteractionsModule,
    OpportunitiesModule,
    TasksModule,
    ComplianceModule,
    AnalyticsModule,
    CommunityModule,
    AiModule,
    RemindersModule,
  ],
  providers: [
    { provide: APP_GUARD,       useClass: ThrottlerGuard },
    { provide: APP_GUARD,       useClass: JwtAuthGuard },
    { provide: APP_GUARD,       useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: RlsInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_FILTER,      useClass: GlobalExceptionFilter },
    { provide: APP_PIPE,        useValue: globalValidationPipe },
  ],
})
export class AppModule {}
