# Integração AVREN OS ↔ XP

## Objetivo

Consolidar no AVREN OS os dados da base do escritório mantida na XP, começando
por contas, posições patrimoniais e movimentações. Produtos, captação e
comissões entram na segunda etapa, conforme os produtos liberados para a AVREN
no portal da XP.

## Canal recomendado

### 1. API de parceiros da XP

É o canal principal para a AVREN porque foi criado para integrações de
parceiros e escritórios. O portal público informa produtos de API para
captação, posição, movimentação, produto, conta e comissão, além de ambiente
sandbox.

Portal: <https://developer.xpinc.com/>

Os endpoints, escopos, autenticação e contratos efetivamente disponíveis
dependem do cadastro e da liberação comercial/técnica concedida à AVREN. O
conector não deve presumir URLs ou contratos antes dessa liberação.

### 2. Open Finance

É uma alternativa complementar para trazer investimentos de instituições
participantes mediante consentimento individual do cliente. Exige jornada de
consentimento, requisitos regulatórios e certificação compatível.

XP Open Finance: <https://developer.xpinc.com/open-finance>

Documentação oficial de investimentos:
<https://openfinancebrasil.atlassian.net/wiki/spaces/OF/pages/103284839/DC%2BAPIs%2B-%2BInvestimentos>

## O que já está preparado

- Estrutura multiempresa com isolamento por tenant (RLS).
- Cadastro da conexão e seu estado operacional.
- Espelho de contas da XP e vínculo opcional com o cliente do CRM.
- Posições por data-base, sem apagar o histórico.
- Movimentações financeiras.
- Comissões para a segunda etapa.
- Histórico de sincronizações, cursores, quantidades e erros.
- Endpoint de status e prontidão da integração.
- Tela administrativa “Integração XP”.
- Segredos somente no ambiente seguro da aplicação, nunca no banco.
- Integração desligada por padrão.

## Liberações a solicitar à XP

Solicitar ao responsável comercial/técnico da XP:

1. Cadastro da AVREN no Portal do Desenvolvedor.
2. Acesso ao sandbox da API de parceiros.
3. Produtos/escopos de conta, posição e movimentação.
4. Depois, produtos/escopos de catálogo, captação e comissão.
5. URL de autenticação e URL-base de cada ambiente.
6. Client ID e Client Secret.
7. Confirmação sobre uso de certificado mTLS e processo de emissão.
8. Identificador do escritório/assessor exigido nas consultas.
9. Limites de requisição, paginação, janela histórica e política de retry.
10. Processo de homologação e credenciais de produção.

## Configuração

Copiar os nomes de `.env.xp.example` para o ambiente seguro do backend no
EasyPanel. Não colocar os valores reais em arquivos versionados.

Enquanto não houver credenciais:

```env
XP_INTEGRATION_ENABLED=false
XP_CHANNEL=partner_api
XP_ENVIRONMENT=sandbox
XP_DOCUMENT_PEPPER=<segredo-aleatorio-exclusivo>
```

Depois de cadastrar as credenciais do sandbox e confirmar os contratos:

```env
XP_INTEGRATION_ENABLED=true
XP_CHANNEL=partner_api
XP_ENVIRONMENT=sandbox
XP_DOCUMENT_PEPPER=<segredo-aleatorio-exclusivo>
```

## Implantação

1. Fazer backup do banco.
2. Executar `migrations/018_xp_integration_foundation.sql`.
3. Publicar o backend e o frontend.
4. Confirmar que a tela exibe “Aguardando credenciais”.
5. Cadastrar as credenciais apenas no ambiente seguro do EasyPanel.
6. Implementar o cliente HTTP usando os contratos liberados pela XP.
7. Homologar no sandbox com uma conta de teste.
8. Validar conciliação de patrimônio e movimentações.
9. Liberar produção gradualmente e monitorar sincronizações.

## Fases sugeridas

### Fase 1 — Visão patrimonial

- Contas.
- Vínculo conta ↔ cliente.
- Posições e patrimônio.
- Movimentações.
- Conciliação e monitoramento.

### Fase 2 — Gestão comercial

- Catálogo de produtos.
- Captação.
- Comissões.
- Indicadores por assessor e carteira.

### Fase 3 — Automação

- Alertas de vencimento e liquidez.
- Identificação de patrimônio sem relacionamento no CRM.
- Oportunidades geradas por movimentação.
- Sugestões de contato e rebalanceamento, sujeitas às regras de suitability e
  compliance da AVREN.

## Segurança e privacidade

- Nunca registrar tokens, Client Secret, certificados ou payloads sensíveis em
  logs.
- Criptografar segredos no provedor de infraestrutura.
- Usar privilégio mínimo por escopo.
- Manter trilha de sincronização e acesso.
- Minimizar dados pessoais persistidos; documento é armazenado somente como
  hash quando necessário para conciliação.
- Definir retenção, base legal e responsabilidades de tratamento antes da
  produção.
- Não habilitar escrita ou movimentação financeira sem um projeto específico,
  controles adicionais e autorização expressa.
