# Resultado da preparação local

Data: 30/07/2026

Branch local: `codex/rls-hardening`

## Entregue

- Bootstrap mínimo de autenticação e enumeração de tenants antes do contexto RLS.
- Contexto transacional `system` para processos automáticos.
- Notificações diárias e fila de IA processadas tenant por tenant.
- Lembretes, visitas, auditoria e sincronização manual de compliance dentro de RLS.
- Policies para tabelas com tenant direto e tenant derivado.
- Wrappers filtrados para views materializadas, que não suportam RLS nativo,
  com revogação do acesso direto às fontes globais.
- Correção das policies existentes para a role `admin`.
- Migração separada para `FORCE ROW LEVEL SECURITY`.
- Procedimento revisável para separar bootstrap, owner, migrator e runtime,
  usando `avren_app` na aplicação.
- Runbook de implantação e rollback.

## Verificações executadas

- Build Nest: passou, zero erros.
- Teste novo dos helpers de tenant: 3 de 3 passaram.
- Suítes unitárias e de contrato: 63 testes passaram.
- Testes PostgreSQL da integração XP: 5 de 5 passaram contra PostgreSQL 16.14,
  usando uma role `NOBYPASSRLS`.
- Suíte de autenticação: 2 de 2 passou. O teste agora simula apenas o algoritmo
  bcrypt, enquanto a integração real com o banco foi validada separadamente.
- Binding nativo do `bcrypt` recompilado e validado com Node.js 20.20.2:
  geração e comparação real de hash passaram.
- Migrations 001 a 032, exceto a demo 015, aplicadas do zero em banco
  descartável.
- Migrations 029 a 032 reaplicadas com sucesso para validar idempotência.
- Transição de ownership ensaiada com `avren_service` como bootstrap
  `SUPERUSER BYPASSRLS` e `avren_app` como runtime restrito.
- Funções reais de login, criação, validação e revogação de sessão executadas
  pela role de runtime sem bypass.
- Smoke test confirmou 1 lead visível no tenant A, zero registros vazados do
  tenant B e bloqueio de escrita cruzada.
- Acesso direto à materialized view global ficou revogado e o wrapper filtrado
  permaneceu acessível.
- `verify-rls-posture.sql`: zero achados após a transição.
- `git diff --check`: passou.

## Defeitos encontrados pelo ensaio e corrigidos

- `crm.reminders` e `crm.visits` não possuíam migration reproduzível.
- Policy de enqueue da IA tinha referência ambígua a `tenant_id`.
- A role `avren_owner` precisava assumir também o ownership dos schemas.
- Os `GRANT EXECUTE` das funções de autenticação desapareciam depois da troca
  de owner e agora são reaplicados explicitamente.
- Não havia uma role separada para migrations depois da demotion.
- Default privileges históricos permitiam que futuras materialized views
  nascessem acessíveis pela aplicação.
- Logout removia a sessão no banco, mas o JWT guard não verificava se ela
  continuava ativa.
- Revogação e consulta de sessão não eram escopadas pelo usuário.
- A role `avren_service` é o bootstrap user do PostgreSQL e não pode perder
  `SUPERUSER`; a role de runtime correta passou a ser `avren_app`.
- `REASSIGN OWNED` tentava transferir objetos internos exigidos pelo servidor;
  a transição agora limita ownership aos schemas da aplicação.
- Sequências `OWNED BY` acompanham a tabela e não aceitam troca de owner
  separada; o script trata apenas sequências independentes.

## Ensaio com cópia recente de produção

- Backup `pre-rls-hardening-2026-07-30` concluído no Easypanel.
- Cópia restaurada num PostgreSQL 16 isolado, com 51 tabelas de aplicação.
- Acesso privado temporário entre os dois containers removido após a cópia.
- Migrations 029, 030 e 031 aplicadas na cópia.
- Transição para `avren_owner`, `avren_migrator` e `avren_app` concluída.
- Migration 032 aplicada depois da transição.
- Verificador completo retornou zero achados.
- `avren_app`: `superuser=false` e `bypass_rls=false`.
- Smoke test: 143 leads visíveis no tenant selecionado, zero leads de outro
  tenant e `ALTER TABLE` bloqueado.
- Transição e migration 032 reaplicadas com sucesso para validar idempotência.

## Ainda obrigatório antes de merge

- Revisão independente do modelo atualizado com `avren_app`.
- Definir o procedimento coordenado de senha e troca da `DATABASE_URL`.

## Segunda rodada após revisão independente

- Criada `avren_migrator`, com `NOINHERIT` e elevação explícita por
  `SET ROLE avren_owner`.
- Confirmado que `avren_app` não consegue executar `ALTER TABLE`.
- Confirmado que `avren_migrator` consegue criar, alterar e remover objetos
  depois de `SET ROLE`.
- Removidos default privileges históricos de todas as roles que concediam
  tabelas futuras a `avren_app`.
- Materialized view futura criada como `avren_owner`: acesso de
  `avren_app` permaneceu falso.
- Verificador agora exige policy de leitura e de escrita para cada tabela com
  FORCE RLS.
- `analytics.refresh_aum_summary()` e
  `compliance.fn_sync_kyc_alerts(UUID)` executaram após a demotion.
- Trigger de `compliance.alert_history` gravou uma linha com FORCE RLS ativo.
- Sessão do tenant B não pôde ser revogada nem consultada usando o usuário do
  tenant A.
- Usuário inativo foi impedido de receber nova sessão.
- O JWT guard agora rejeita tokens cuja sessão foi revogada.
- As suítes de autenticação e JWT passaram sob Node.js 20, além do teste direto
  do binding nativo do bcrypt.

## Terceira rodada após revisão independente final

- Corrigido `migrations/run.sh`, que alcançava apenas migrations 000 a 019.
- Bootstrap completo executado do zero num banco descartável: 31 migrations
  existentes processadas, incluindo 020 a 032; a 015 foi pulada como previsto.
- Removido o acesso direto de `avren_app` a `auth.sessions` e às colunas
  `password_hash` e `mfa_secret` de `auth.users`.
- `auth.is_session_active` agora invalida imediatamente a sessão de usuário
  inativo.
- Bankers não podem adulterar `created_by` em tarefas.
- Unidades de negócio só podem ser gravadas por `socio`, `operacoes` ou `admin`.
- O verificador passou a falhar se a role de runtime recuperar acesso a
  credenciais ou à tabela de sessões.
- Testes direcionados no clone confirmaram: três privilégios sensíveis falsos,
  sessão inativa rejeitada, escrita de unidade de negócio bloqueada e autoria
  falsa de tarefa bloqueada.
- Migrations 029 e 030, transição de roles e verificador foram reaplicados no
  clone. Resultado final: zero achados.
- Suíte local: 64 testes aprovados, 5 testes PostgreSQL da integração XP
  pulados por exigirem URLs dedicadas; build Nest aprovado.

## Garantias de escopo

As migrations de endurecimento não foram executadas no banco de produção.
Nenhuma role, senha, flag ou credencial de produção foi alterada. Foi
configurada uma rotina de backup diário com retenção de 14 cópias, mas o
Easypanel ainda exibe a ação `Enable`; portanto, a ativação automática permanece
pendente de confirmação. O backup manual foi concluído e o serviço isolado
`avren-db-rls-test` foi criado para o ensaio.
