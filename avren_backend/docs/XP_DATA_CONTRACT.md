# Contrato XP Data Access para o AVREN OS

Fonte: documentação credenciada do XP Inc. Developer Portal, consultada em
31/07/2026. Este documento descreve o contrato estrutural. A integração
permanece desligada e os mapeamentos devem ser confirmados com payloads de HML.

## Princípios

- Dados Star Schema são brutos e devem ser relacionados por chaves de dimensão.
- O Log de Reprocessamento deve ser consultado antes de qualquer recurso.
- A atualização padrão é D-1, apenas em dias úteis no calendário bancário B3.
- APIs de fato têm retenção de 60 a 90 dias; dimensões mantêm histórico.
- Fatos não devem ser relacionados diretamente entre si.
- Dados analíticos, como o Positivador, devem ser tratados como ponto final.

## Fase 1: persistência já existente

| Recurso AVREN | Endpoint XP | Frequência | Destino |
| --- | --- | --- | --- |
| Log | `/api/v1/reprocessing-log` | D-1 | `xp_sync_runs` |
| Contas | `/api/v1/account` | D-1 | `xp_accounts` |
| Custódia | `/api/v1/auc` | D-1 | `xp_positions` |
| Captação | `/api/v1/inflow` | D-1 | `xp_movements` |
| Comissão | `/api/v1/commission` | D-1 | `xp_commissions` |

### Chaves e métricas

- Conta: `dimAccountCode` é a chave técnica usada pelos fatos;
  `accountCode` é o número de conta exibível apenas de forma mascarada.
- Custódia: `dimAccountCode`, `dimProductCode`, `dimTimeCode`,
  `positionAmount` e `positionValue`.
- Captação: `dimAccountCode`, `dimProductCode`, `dimMovementTypeCode`,
  `movementNatureCode`, `movementAmount` e `movementValue`.
- Comissão: `dimAccountCode`, `dimAdvisorCode`, `dimProductCode`,
  `grossRevenueValue`, `netRevenueValue` e `comissionValue`.
- Log: `tableName`, `referenceDate`, `typeProcessing`,
  `minimumProcessingDate` e `maximumProcessingDate`.

## Fase 2: novos modelos necessários

| Recurso | Endpoint | Uso no AVREN OS |
| --- | --- | --- |
| Relação conta-assessor | `/api/v1/account-advisor-relation` | Carteira e histórico de responsável |
| Produto | `/api/v1/product-partner` | Nome, classe, emissor, vencimento e indexador |
| Positivador | `/api/v1/positivador` | Dashboard, metas, captação e receita |
| Posição consolidada | `/api/v1/consolidated-positions/customer/{customerCode}` | Cliente 360 |
| Evolução patrimonial | `/api/v1/wealth-evolution/customer/{customerCode}` | Gráficos e benchmarks |
| Extrato | `/api/v1/investment-account/statement/customer/{customerCode}` | Histórico financeiro D0 |
| Saldo investimento | `/api/v1/investment-account/balance/customer/{customerCode}` | Saldo disponível D0 |
| Saldo digital | `/api/v1/digital-account/balance/customer/{customerCode}` | Saldo e valores bloqueados D0 |
| Operações | `/api/v2/operations/customers/{customerCode}` | Operações por ativo, D-3 |

## Fonte de verdade dos indicadores

- Patrimônio e posição: Custódia, enriquecida pela dimensão Produto.
- Captação detalhada: API Captação.
- Captação bruta, resgates e líquida mensais: Positivador.
- Receita detalhada e fechamento: Comissão.
- Receita e indicadores comerciais por cliente: Positivador.
- Evolução e rentabilidade: APIs de posição/evolução, não inferidas da custódia.

O cálculo legado que soma todas as movimentações não deve ser usado como
captação líquida quando o Positivador estiver disponível.

## Paginação

O cliente aceita os dois envelopes observados:

- `data` com `$skip` e `$top`;
- `value` com `@odata.nextLink`.

O portal recomenda páginas de 10.000 registros para alto volume e limita cada
requisição a 50.000 registros. O limite global informado é 300 requisições por
minuto por subscription e 30 requisições por segundo por operação.

## Portões antes de ativar

1. Credenciais e certificado de HML aprovados.
2. Payload real de cada recurso capturado sem PII em logs.
3. Mappers comparados campo a campo com HML.
4. Migration da fase 2 revisada e executada deliberadamente.
5. Dry-run e testes de banco executados com papel sem `BYPASSRLS`.
6. Conferência financeira de patrimônio, captação e receita com a XP.
7. Somente então habilitar `XP_INTEGRATION_ENABLED`.
