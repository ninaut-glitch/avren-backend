# AVREN CRM — Backend API

Stack: **NestJS + Fastify + PostgreSQL (`postgres` driver) + JWT**

## Estrutura

```
src/
├── common/
│   ├── decorators/      # @CurrentUser, @Roles, @Public
│   ├── filters/         # GlobalExceptionFilter
│   ├── guards/          # JwtAuthGuard, RolesGuard
│   ├── interceptors/    # RlsInterceptor, AuditInterceptor
│   └── pipes/           # globalValidationPipe
├── database/
│   ├── database.provider.ts   # Pool postgres
│   ├── database.module.ts     # @Global
│   └── rls.helper.ts          # withRls(), setRlsContext()
└── modules/
    ├── auth/            # Login, JWT, MFA
    ├── leads/           # Pipeline de prospecção
    ├── clients/         # Cadastro 360°
    ├── wealth/          # Ativos patrimoniais
    ├── interactions/    # Timeline + trigger IA
    ├── opportunities/   # Oportunidades de negócio
    ├── tasks/           # Tasks e next steps
    ├── compliance/      # Alertas KYC/Suitability
    ├── analytics/       # Dashboards e métricas
    ├── community/       # Members Club e eventos
    └── ai/              # Worker de resumos IA
```

## Setup

```bash
cp .env.example .env
# Editar .env com DATABASE_URL e JWT_SECRET

npm install
npm run start:dev
# Swagger: http://localhost:3000/docs
```

## Padrão de acesso ao banco

Todo repositório usa `withRls()` do `rls.helper.ts`:

```typescript
return withRls(this.sql, ctx, async (tx) => {
  // SET LOCAL app.current_tenant_id / user_id / user_role
  // executados automaticamente dentro da transação
  return tx`SELECT * FROM crm.leads`;
});
```

O `RlsInterceptor` popula `req.rlsContext` com os dados do JWT
antes de cada controller. O `AuditInterceptor` grava em
`auth.audit_logs` após cada write bem-sucedido.

## Fluxo de autenticação

```
POST /v1/auth/login
  → valida email + bcrypt + TOTP (se MFA ativo)
  → retorna JWT com { sub, email, role, tenantId, businessUnitId }

Requests subsequentes:
  Authorization: Bearer <token>
  → JwtAuthGuard valida e popula req.user
  → RlsInterceptor cria req.rlsContext
  → RolesGuard verifica @Roles() se presente
  → Controller chama service → repository → withRls()
```

## Fluxo de IA

```
POST /v1/clients/:id/interactions
  → Cria wealth.interactions
  → trigger trg_enqueue_ai_summary → ai.pending_jobs
  → Worker AiService.processPendingJobs() (cron 5min)
    → SELECT FOR UPDATE SKIP LOCKED
    → Chama Anthropic API (claude-sonnet-4-6)
    → Persiste ai.interaction_summaries
    → Atualiza wealth.interactions.ai_summary
```

## Roles e permissões

| Role        | Acesso                              |
|-------------|-------------------------------------|
| banker      | Apenas própria carteira (RLS)       |
| supervisor  | Equipe inteira do tenant            |
| socio       | Global no tenant                    |
| operacoes   | Global + compliance + sync          |
