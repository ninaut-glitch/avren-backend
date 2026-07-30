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
5. Executar `ops/rls-role-transition.sql` no clone usando a credencial de
   emergência e uma nova senha de aplicação.
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
