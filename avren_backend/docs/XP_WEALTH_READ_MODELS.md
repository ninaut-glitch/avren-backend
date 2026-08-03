# Etapa C — leitura patrimonial XP no AVREN OS

## Objetivo

Transformar os dados internos da integração XP em duas experiências de produto,
sem acionar a API externa e sem duplicar dados:

1. **Visão consolidada**, para supervisão, sócios, operações e administração.
2. **Dossiê patrimonial do cliente**, disponível também ao assessor responsável.

Os contratos usam exclusivamente as tabelas `integrations.xp_*`. Com
`XP_INTEGRATION_ENABLED=false`, devolvem `available=false`, valores zerados e
listas vazias. Nenhuma chamada à XP é realizada.

## Contratos

### `GET /integrations/xp/wealth/overview?month=YYYY-MM`

Visão gerencial do tenant:

- custódia atual em BRL;
- captação líquida da competência;
- receita bruta e líquida;
- contas totais, vinculadas e pendentes;
- clientes ativados e que saíram no mês;
- alocação por classe de ativo.

A custódia considera a última posição disponível de cada conta. Valores de
outras moedas não são somados ao total em BRL sem uma fonte oficial de câmbio.

### `GET /integrations/xp/wealth/clients/:clientId?month=YYYY-MM`

Dossiê do cliente:

- contas XP vinculadas;
- saldo bruto, líquido e investido;
- captação e receita da competência;
- alocação por classe;
- posições atuais;
- vinte movimentações mais recentes.

Antes de consultar qualquer tabela XP, o serviço procura o cliente sob RLS em
`wealth.clients`. Assim, um assessor não consegue consultar um cliente de outro
assessor apenas conhecendo o UUID.

## Exibição no frontend

- A tela **Integração XP** recebe o painel consolidado.
- A aba **Patrimônio** do Perfil 360 recebe a custódia individual.
- Com a integração desligada, ambas exibem um estado vazio informativo.
- Nenhum segredo, documento, número integral de conta ou payload bruto é
  devolvido pelos read models.

## Fora do escopo desta etapa

- ativar flags, cron ou credenciais;
- consultar a XP;
- converter moedas;
- rentabilidade calculada;
- recomendação de investimento;
- mapear `advisor_code` da XP para usuários do AVREN. O acesso do assessor é
  determinado pelo vínculo do cliente no CRM, que já possui RLS própria.
