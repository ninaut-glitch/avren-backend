# Endurecimento de isolamento por tenant

## Estado desta entrega

Esta entrega prepara código, migrations e procedimento operacional. Ela não altera
produção, roles, senhas, ownership, flags da XP nem executa migrations.

O problema confirmado em produção é que `avren_service` tem `SUPERUSER` e
`BYPASSRLS`, além de ser a role de bootstrap do container. O PostgreSQL não
permite demover a role de bootstrap. A API deve migrar para `avren_app`, uma
role de runtime sem poderes administrativos e sem bypass de RLS.

## Ordem segura de implantação

1. Confirmar e guardar a credencial administrativa de `avren_service` fora da
   aplicação, testar login e restauração e não reutilizá-la na API.
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

- `avren_app`: `rolsuper=false`, `rolbypassrls=false`,
  `rolcreatedb=false`, `rolcreaterole=false`.
- A `DATABASE_URL` da API usa `avren_app`, nunca `avren_service`.
- `avren_owner`: `NOLOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`.
- `avren_migrator`: `LOGIN`, `NOINHERIT`, membro de `avren_owner`, com
  credencial exclusiva armazenada no cofre.
- Credencial de emergência testada.
- Backup restaurável confirmado.
- Nenhuma tabela de negócio com tenant sem RLS.
- Nenhum acesso direto de `avren_app` às views materializadas globais.
- Todas as tabelas protegidas da migration 032 com `relforcerowsecurity=true`.
- Testes PostgreSQL executados com uma role de aplicação sem `BYPASSRLS`.
- XP permanece desligada durante toda a mudança.

## Rollback

O rollback deve ser ensaiado no clone. Se a aplicação falhar depois da troca
para `avren_app`:

1. Interromper tráfego de escrita.
2. Reverter o deploy da aplicação.
3. Reverter temporariamente a `DATABASE_URL` para a credencial administrativa
   anterior apenas durante a recuperação, com janela e responsáveis definidos.
4. Se houver dano de dados, restaurar o backup validado.
5. Registrar o motivo e corrigir a policy ou o contexto faltante antes de nova
   tentativa.

## Observações

As funções de autenticação da migration 029 usam `SECURITY DEFINER` porque login e
validação de sessão ocorrem antes de existir contexto RLS. Elas têm
`search_path` fixo, acesso público revogado e devem pertencer a `avren_owner`.

O script de transição não usa `REASSIGN OWNED`. Como `avren_service` é a role de
bootstrap do container PostgreSQL, ela também é dona de objetos internos
exigidos pelo servidor e não pode perder `SUPERUSER`. A transferência é
limitada aos objetos dos oito schemas da aplicação e ao banco informado em
`target_database`. A API passa a usar `avren_app`.

Os processos automáticos de notificações, IA e XP percorrem tenants ativos e
abrem transações curtas com role lógica `system`. Não existe contexto global de
negócio nesses fluxos.

### Como executar migrations depois da separação

`avren_app` nunca executa migrations. A automação de migrations deve
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
4. confirmação de que `avren_app` recebe `permission denied` no mesmo
   `ALTER TABLE`.

### Regra para toda nova migration

Os default privileges de `avren_app` foram removidos de propósito. Toda
migration que criar uma tabela, sequência ou função consumida pela aplicação
deve declarar os privilégios necessários explicitamente.

Use `docs/MIGRATION_TEMPLATE.sql` como ponto de partida. Antes do merge:

1. conceda apenas `SELECT`, `INSERT`, `UPDATE` e `DELETE` realmente usados;
2. conceda `USAGE, SELECT` apenas nas sequências necessárias;
3. revogue acesso público de funções privilegiadas antes do `GRANT EXECUTE`;
4. execute `ops/verify-rls-posture.sql` e confirme zero achados;
5. valide o endpoint com `avren_app`, não com owner ou superuser.

### Views globais sem consumidor

`compliance.kyc_alerts` e as cinco `analytics.mv_*` permanecem deliberadamente
sem acesso para `avren_app`. A busca no backend não encontrou leitura direta
dessas relações. `compliance.kyc_alerts` é consumida apenas dentro de
`compliance.fn_sync_kyc_alerts(UUID)`.

Se uma delas ganhar consumidor no futuro, a migration deve criar um wrapper com
filtro obrigatório de tenant e conceder acesso apenas ao wrapper. O verificador
falha se qualquer materialized view dos schemas da aplicação ficar legível por
`avren_app`.

`NOINHERIT` é intencional tanto para a aplicação quanto para o migrator. Conceder
uma nova role não produz efeito automático; qualquer elevação exige `SET ROLE`
explícito e auditável.
