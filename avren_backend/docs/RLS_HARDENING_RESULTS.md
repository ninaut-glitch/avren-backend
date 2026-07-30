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
- Procedimento revisável para separar owner e aplicação e demover
  `avren_service`.
- Runbook de implantação e rollback.

## Verificações executadas

- Build Nest: passou, zero erros.
- Teste novo dos helpers de tenant: 3 de 3 passaram.
- Suítes unitárias e de contrato: 61 testes passaram.
- Testes PostgreSQL da integração XP: 5 de 5 passaram contra PostgreSQL 16.14,
  usando uma role `NOBYPASSRLS`.
- Suíte de autenticação: 2 de 2 passou. O teste agora simula apenas o algoritmo
  bcrypt, enquanto a integração real com o banco foi validada separadamente.
- Migrations 001 a 032, exceto a demo 015, aplicadas do zero em banco
  descartável.
- Migrations 029 a 032 reaplicadas com sucesso para validar idempotência.
- Transição de ownership e demotion ensaiada com
  `avren_service` inicialmente `SUPERUSER BYPASSRLS`.
- Funções reais de login, criação, validação e revogação de sessão executadas
  com `avren_service` já demovida.
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

## Ainda obrigatório antes de merge

- Revisão independente das migrations 029 a 032 e do script operacional.
- Executar todas as migrations num dump restaurado, nunca primeiro em produção.
- Rodar lint após instalar as dependências de desenvolvimento ausentes.
- Repetir o ensaio num dump recente de produção e validar o rollback.

## Garantias de escopo

Nada foi enviado ao GitHub. Nenhuma migration foi executada. Nenhuma role, senha,
flag, credencial, banco ou serviço de produção foi alterado.
