# Endurecimento de isolamento por tenant

## Estado desta entrega

Esta entrega prepara código, migrations e procedimento operacional. Ela não altera
produção, roles, senhas, ownership, flags da XP nem executa migrations.

O problema confirmado em produção é que `avren_service` tem `SUPERUSER` e
`BYPASSRLS`, além de ser owner das tabelas. Enquanto isso permanecer, as policies
RLS não formam uma barreira efetiva.

## Ordem segura de implantação

1. Criar uma credencial administrativa de emergência diferente de
   `avren_service`, armazená-la fora do repositório e testar login e restauração.
2. Fazer backup verificável e restaurar um clone descartável do banco.
3. No clone, aplicar `029_rls_bootstrap_functions.sql`,
   `030_rls_policy_hardening.sql` e `031_rls_policy_completion.sql`.
4. Executar os testes de isolamento e o smoke test completo no clone.
5. Executar `ops/rls-role-transition.sql` no clone usando a credencial
   administrativa de emergência.
6. Aplicar `032_force_rls.sql` no clone.
7. Confirmar que login, pipeline, clientes, visitas, lembretes, metas,
   notificações e processamento de IA continuam funcionando.
8. Confirmar que uma sessão do tenant A não lê nem altera registros do tenant B.
9. Ensaiar o rollback e medir a janela.
10. Repetir em produção numa janela aprovada. Atualizar a senha no Easypanel
    somente no momento coordenado da troca.

## Critérios obrigatórios antes de produção

- `avren_service`: `rolsuper=false`, `rolbypassrls=false`,
  `rolcreatedb=false`, `rolcreaterole=false`.
- `avren_owner`: `NOLOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`.
- `avren_migrator`: `LOGIN`, `NOINHERIT`, membro de `avren_owner`, com
  credencial exclusiva armazenada no cofre.
- Credencial de emergência testada.
- Backup restaurável confirmado.
- Nenhuma tabela de negócio com tenant sem RLS.
- Nenhum acesso direto de `avren_service` às views materializadas globais.
- Todas as tabelas protegidas da migration 032 com `relforcerowsecurity=true`.
- Testes PostgreSQL executados com uma role de aplicação sem `BYPASSRLS`.
- XP permanece desligada durante toda a mudança.

## Rollback

O rollback deve ser ensaiado no clone. Se a aplicação falhar após a demotion:

1. Interromper tráfego de escrita.
2. Reverter o deploy da aplicação.
3. Usar apenas a credencial administrativa de emergência para restaurar os
   atributos anteriores temporariamente ou restaurar o backup.
4. Não transformar `avren_service` em superuser como correção permanente.
5. Registrar o motivo e corrigir a policy ou o contexto faltante antes de nova
   tentativa.

## Observações

As funções de autenticação da migration 029 usam `SECURITY DEFINER` porque login e
validação de sessão ocorrem antes de existir contexto RLS. Elas têm
`search_path` fixo, acesso público revogado e devem pertencer a `avren_owner`.

Os processos automáticos de notificações, IA e XP percorrem tenants ativos e
abrem transações curtas com role lógica `system`. Não existe contexto global de
negócio nesses fluxos.

### Como executar migrations depois da demotion

`avren_service` nunca mais executa migrations. A automação de migrations deve
usar `MIGRATION_DATABASE_URL` da role `avren_migrator` e iniciar cada sessão com
`SET ROLE avren_owner`. Como `avren_migrator` é `NOINHERIT`, o membership não
concede poderes até esse `SET ROLE` explícito.

A senha de `avren_migrator` não é criada pelo script versionado. Ela deve ser
definida por procedimento separado, diretamente no cofre e no ambiente de
migration. Não reutilizar `DATABASE_URL` da aplicação.

Antes de qualquer migration real, testar:

1. conexão como `avren_migrator`;
2. `SET ROLE avren_owner`;
3. criação e remoção de uma tabela de teste em schema descartável;
4. confirmação de que `avren_service` recebe `permission denied` no mesmo
   `ALTER TABLE`.

### Views globais sem consumidor

`compliance.kyc_alerts` e as cinco `analytics.mv_*` permanecem deliberadamente
sem acesso para `avren_service`. A busca no backend não encontrou leitura direta
dessas relações. `compliance.kyc_alerts` é consumida apenas dentro de
`compliance.fn_sync_kyc_alerts(UUID)`.

Se uma delas ganhar consumidor no futuro, a migration deve criar um wrapper com
filtro obrigatório de tenant e conceder acesso apenas ao wrapper. O verificador
falha se qualquer materialized view dos schemas da aplicação ficar legível por
`avren_service`.

`NOINHERIT` é intencional tanto para a aplicação quanto para o migrator. Conceder
uma nova role não produz efeito automático; qualquer elevação exige `SET ROLE`
explícito e auditável.
