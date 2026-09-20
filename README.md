# Consulta de CEP

API NestJS que consulta CEP em `GET /cep/{cep}`, alternando entre ViaCEP e
BrasilAPI em round-robin e devolvendo o mesmo contrato seja qual for o provider
que respondeu. O enunciado está em [`DESAFIO.md`](DESAFIO.md); este README
segue os quatro pontos que ele pede. As decisões com alternativa avaliada estão
em [`docs/adr/`](docs/adr/), e o vocabulário em [`CONTEXT.md`](CONTEXT.md).

## Como rodar

```sh
npm install
npm start
```

Não precisa de configuração: toda variável tem default. A API sobe em
`http://localhost:3000`.

- `GET /cep/01310-930` — consulta.
- `GET /docs` — Swagger, com o contrato e o `problem+json` de cada erro.
- `GET /health` — estado do circuito de cada provider.

```sh
npm test            # suíte completa, sem rede
npm run typecheck
npm run lint
```

## O contrato

```sh
$ curl -i localhost:3000/cep/50680-000
HTTP/1.1 200 OK
Address-Provider: viacep
Server-Timing: provider;desc="viacep";dur=143
Request-Id: 0f8a6c1e-…

{
  "zipCode": "50680000",
  "street": "Rua São Mateus",
  "complement": "de 420/421 ao fim",
  "neighborhood": "Iputinga",
  "city": "Recife",
  "state": "PE"
}
```

- O CEP é aceito como `01310930`, `01310-930`, `01.310-930` ou `01310 930`.
- Campo que o provider não tem sai `null`, nunca string vazia.
- Quem respondeu não faz parte do corpo: é topologia interna. A procedência
  sai nos headers `Address-Provider` e `Server-Timing` e no log
  ([ADR-0005](docs/adr/0005-endereco-vencido-em-vez-de-erro.md)).
- Erros saem em `application/problem+json` (RFC 9457). Nos erros vindos dos
  providers, o corpo diz o que aconteceu com cada um:

```json
{
  "type": "/problems/providers-exhausted",
  "title": "No provider could answer",
  "status": 503,
  "detail": "No provider returned a usable answer for this zip code.",
  "attempts": [
    { "provider": "viacep", "reason": "timeout" },
    { "provider": "brasilapi", "reason": "circuit_open" }
  ],
  "instance": "/cep/50680000"
}
```

## 1. Abstração

Cada provider é um **adapter** atrás de uma única porta:

```ts
interface AddressLookup {
  readonly provider: string;
  lookup(zipCode: string, signal: AbortSignal): Promise<LookupResult>;
}
```

O adapter sabe duas coisas: montar a consulta e traduzir a resposta em endereço
canônico. Timeout, circuito, teto de concorrência, orçamento de tempo, fallback,
cache, log e `/health` vivem fora dele
([ADR-0002](docs/adr/0002-resiliencia-fora-dos-adapters.md)). A porta **nunca
lança**: devolve `{ ok: true, address } | { ok: false, reason }`, com `reason`
numa união fechada, e o compilador obriga a tratar cada razão nova
([ADR-0003](docs/adr/0003-porta-do-provider-devolve-resultado-em-vez-de-lancar.md)).

**Um terceiro provider é um arquivo em `providers/` e uma linha de registro.** Tudo acima passa
a valer para ele sem outra mudança:

```ts
// src/zip-code/providers/novo-provider.lookup.ts
export class NovoProviderLookup implements AddressLookup {
  readonly provider = 'novo-provider';

  async lookup(zipCode: string, signal: AbortSignal): Promise<LookupResult> {
    const response = await fetchJson(`https://…/${zipCode}`, signal);
    if (!response.ok) {
      return response; // timeout | http_error
    }
    // Cada provider sinaliza ausência do seu jeito; é aqui que ela vira not_found.
    if (response.status === 404) {
      return { ok: false, reason: FailureReason.NotFound };
    }
    if (response.status !== 200) {
      return { ok: false, reason: FailureReason.HttpError };
    }
    const parsed = responseSchema.safeParse(response.body);
    if (!parsed.success) {
      return outsideContract(response.raw);
    }
    return toCanonicalAddress({ zipCode, ...traduzido(parsed.data) });
  }
}
```

```ts
// src/zip-code/zip-code.module.ts
useFactory: () => [
  new ViaCepLookup(),
  new BrasilApiLookup(),
  new NovoProviderLookup(),
],
```

## 2. Resiliência

```
GET /cep/{cep}
  └─ validação do CEP ─────────────── 400, sem tocar em provider
  └─ cache ────────────────────────── fresco? responde · ausência confirmada? 404
  └─ providers em round-robin, dentro de um orçamento de tempo da requisição
       para cada provider:
         circuito aberto? ─────────── pula (circuit_open)
         teto de concorrência cheio? ─ pula (capped)
         timeout com cancelamento real
         adapter ─────────────────── ok | not_found | timeout | http_error | schema_invalid
       falhou ou não encontrou? tenta o próximo
  └─ conclusão: 200 · 200 vencido · 404 confirmada · 404 parcial · 503
```

**"E quando uma API demora 30 segundos?"** A tentativa tem timeout de 3 s com
`AbortController`, então a requisição é cancelada de verdade, e a requisição
inteira tem um orçamento de 7 s: o segundo provider recebe o tempo que sobrou,
não um timeout novo. Pior caso: 3 s no provider lento, o resto no outro, nunca
mais de 7 s. Depois de 5 falhas consecutivas o circuito daquele provider abre
por 30 s e ele deixa de ser consultado; passado o cooldown, uma sonda decide se
ele volta.

**"E quando as duas estão fora?"** O cache responde. Um endereço fica fresco por
24 h e, com os providers fora, pode ser servido como **endereço vencido** por
até 7 dias, marcado no corpo (`freshness`) e no header `Warning`: CEP muda em
escala de anos, e um endereço de cinco dias com etiqueta é melhor que um erro.
Sem nada em cache, `503` com `Retry-After` amarrado ao cooldown do circuito.

O que cada peça garante, e por quê, está nos ADRs
([0001](docs/adr/0001-arsenal-de-resiliencia-minimo.md) a
[0006](docs/adr/0006-cache-atras-de-uma-porta-com-store-em-memoria.md)). O cache
fica atrás do `@nestjs/cache-manager` e, por padrão, em memória: Redis não é
necessário na escala deste projeto, e a consulta já sobrevive a uma store fora
(a suíte injeta essa falha). Trocar a store é mudar a linha de registro em
`zip-code.module.ts`.

## 3. Observabilidade

Qualquer requisição pode ser reconstruída a partir do log:

- **Um identificador por requisição** em toda linha, via `AsyncLocalStorage`.
  Herdado do header `Request-Id` de entrada quando existe, devolvido na
  resposta.
- **Uma linha por tentativa de provider**: provider, resultado, duração, estado
  do circuito e número da tentativa. Quando o provider responde fora do
  contrato, a linha carrega a evidência em `detail`.
- **Uma linha de resumo por requisição**: resultado, providers tentados em
  ordem, origem (provider, cache fresco ou vencido) e latência total.
- **Níveis com significado.** `warn` é degradado mas recuperado; `error` só
  quando o cliente não recebeu resposta.

```json
{"level":40,"requestId":"0f8a6c1e-…","provider":"viacep","zipCode":"50680000","attempt":1,"result":"timeout","durationMs":3001,"circuit":"closed","msg":"provider attempt"}
{"level":30,"requestId":"0f8a6c1e-…","provider":"brasilapi","zipCode":"50680000","attempt":2,"result":"ok","durationMs":212,"circuit":"closed","msg":"provider attempt"}
{"level":40,"requestId":"0f8a6c1e-…","zipCode":"50680000","result":"ok","source":"provider","providers":["viacep","brasilapi"],"durationMs":3214,"msg":"lookup summary"}
```

Com `NEW_RELIC_LICENSE_KEY`, o agente do New Relic envia as transações (com o
`requestId` como atributo), as chamadas externas aos providers, os logs com
todos os campos e um evento `CircuitStateChange` por transição de circuito.
`400` e `429` são marcados como erro esperado, fora da taxa de erro, porque o
erro ali é do cliente. Abaixo, uma hora de tráfego real contra os providers:

<img width="1415" height="633" alt="APM Summary: throughput, latência e taxa de erro" src="https://github.com/user-attachments/assets/f2838dec-d2c6-4b6c-8f28-33aaca97a7ce" />

_Quase todo o tempo de resposta é "Web external": a latência é dos providers,
não nossa._

<img width="1423" height="526" alt="Serviços externos: ViaCEP e BrasilAPI" src="https://github.com/user-attachments/assets/cea3316a-ed48-484c-bb6a-063244b769ad" />

_Os dois providers com o mesmo throughput, que é o round-robin funcionando._

<img width="1646" height="644" alt="Dashboard: respostas por status, latência, origem das respostas e tentativas por provider" src="https://github.com/user-attachments/assets/2e380c88-7a48-45b4-806e-c02e68954aa4" />

_Montado sobre os logs: origem das respostas (a maioria do cache) e tentativas
por provider e resultado, onde aparece a fatia `viacep, schema_invalid` abaixo._

<img width="1276" height="659" alt="Logs de uma requisição filtrados pelo requestId" src="https://github.com/user-attachments/assets/de21d1e2-9ea7-445f-a1fb-c2d03345fa7d" />

_Uma requisição inteira pelo `requestId`. Foi assim que apareceu um caso real:
o ViaCEP documenta a negativa como `erro: true`, costuma responder a string
`"true"`, e para `78300000` alternou entre os dois formatos em respostas
seguidas. O `detail` da linha em `warn` mostrou o corpo; hoje os dois formatos
são lidos como ausência. Se só um fosse, a outra metade contaria como falha e
abriria o circuito de um provider saudável._

## 4. Tratamento de erros

Timeout não é `404`, e a diferença aparece em quatro lugares: se há fallback, se
conta para o circuito, como entra no log e o que o cliente recebe.

| Razão do provider | O que é                          | Fallback | Circuito | Log    |
| ----------------- | -------------------------------- | -------- | -------- | ------ |
| `timeout`         | não respondeu em 3 s (cancelada) | sim      | falha    | `warn` |
| `http_error`      | status inesperado ou rede        | sim      | falha    | `warn` |
| `schema_invalid`  | respondeu fora do contrato       | sim      | falha    | `warn` |
| `not_found`       | negou o CEP                      | sim      | **não**  | `info` |
| `circuit_open`    | pulado: circuito aberto          | sim      | neutro   | `warn` |
| `capped`          | pulado: teto de concorrência     | sim      | neutro   | `warn` |

Duas dessas linhas são as invariantes centrais. **Ausência não alimenta o
circuito**: ele mede saúde de provider, não existência de dado, senão uma
varredura de CEPs inexistentes tiraria de jogo um provider saudável. E há
**fallback também em "não encontrei"**, porque as bases dos providers diferem e
um CEP novo entra numa antes da outra
([ADR-0004](docs/adr/0004-fallback-tambem-em-ausencia.md)).

O que chega ao cliente:

| Situação                                                   | Status | Observações                                     |
| ---------------------------------------------------------- | ------ | ----------------------------------------------- |
| Endereço encontrado, por provider ou cache fresco          | `200`  | `Address-Provider`, `Server-Timing`             |
| Endereço vencido servido com todos os providers fora       | `200`  | `freshness` no corpo e header `Warning`         |
| CEP malformado                                             | `400`  | nenhum provider é consultado                    |
| Ausência confirmada: todos os providers alcançados negaram | `404`  | `/problems/confirmed-absence`, cacheada por 1 h |
| Ausência parcial: um negou, outro não respondeu            | `404`  | `/problems/partial-absence`, não cacheada       |
| Limite de entrada excedido                                 | `429`  | `Retry-After`                                   |
| Todos os providers esgotados e nada em cache               | `503`  | `Retry-After` amarrado ao cooldown do circuito  |
| Erro inesperado                                            | `500`  | nada vaza no corpo; o erro vai para o log       |

Um `503` só, em vez de `502`/`503`/`504` conforme a causa: a ação do cliente é
a mesma, e a diferença chega pela `reason` de cada provider no corpo.

### O que os providers fizeram na prática

Consultas reais em setembro de 2026, aceitas e não tratadas, porque tratá-las
exigiria uma fonte de verdade sobre o CEP que não temos:

- **Os providers discordam nos dois sentidos.** Em `78300000` o ViaCEP nega e
  o BrasilAPI acerta (Tangará da Serra/MT); em `99999999` o ViaCEP nega e o
  BrasilAPI devolve um endereço inventado em Sarandi/PR. O fallback salva o
  primeiro e deixa passar o segundo, e sem fonte de verdade não há como
  distingui-los.
- **O `404` do BrasilAPI não distingue negativa de pane interna**: é o mesmo
  `service_error` quando todas as fontes negam e quando todas estão fora. Uma
  ausência confirmada pode ser falsa; o dano fica limitado pelo TTL de 1 h.
- **A negativa do ViaCEP alterna de formato** (`erro: true` e `"true"`), como
  mostrado no print dos logs.
- **O BrasilAPI consulta o ViaCEP por dentro**, então a redundância real é
  menor do que dois providers sugerem.

## Configuração

Todas as variáveis são opcionais e validadas no boot. Veja
[`.env.example`](.env.example).

| Variável                    | Default              | O que controla                                                       |
| --------------------------- | -------------------- | -------------------------------------------------------------------- |
| `PORT`                      | `3000`               | porta HTTP                                                           |
| `LOG_LEVEL`                 | `info`               | nível do pino                                                        |
| `PROVIDER_TIMEOUT_MS`       | `3000`               | timeout de cada tentativa                                            |
| `REQUEST_BUDGET_MS`         | `7000`               | orçamento de tempo da requisição inteira                             |
| `CIRCUIT_FAILURE_THRESHOLD` | `5`                  | falhas consecutivas para abrir o circuito                            |
| `CIRCUIT_COOLDOWN_MS`       | `30000`              | tempo aberto antes da sonda; também vira o `Retry-After` do `503`    |
| `CACHE_FRESH_MS`            | `86400000` (24 h)    | janela em que o endereço é servido como atual                        |
| `CACHE_EXPIRED_WINDOW_MS`   | `604800000` (7 dias) | janela em que ainda sai como endereço vencido                        |
| `CACHE_ABSENCE_TTL_MS`      | `3600000` (1 h)      | quanto tempo uma ausência confirmada fica em cache                   |
| `CACHE_MAX_ENTRIES`         | `10000`              | teto de entradas do cache em memória (LRU)                           |
| `RATE_LIMIT_MAX`            | `60`                 | requisições por IP por janela                                        |
| `RATE_LIMIT_WINDOW_MS`      | `60000`              | janela do limite de entrada                                          |
| `PROVIDER_MAX_CONCURRENCY`  | `20`                 | requisições simultâneas por provider; além disso pula, não enfileira |
| `NEW_RELIC_LICENSE_KEY`     | vazio                | liga o agente do New Relic                                           |
| `NEW_RELIC_APP_NAME`        | `zip-code-lookup`    | nome da aplicação no New Relic                                       |

Os limites são conservadores e arbitrários: nenhum dos providers publica limite
numérico, por isso são variáveis de ambiente.

## Testes

Dois seams: o **HTTP de saída**, interceptado com `msw`, com a app real exercida
ponta a ponta e fixtures capturadas dos providers; e a **interface do adapter**,
com adapters falsos, só onde o teste precisa manipular o relógio (circuito,
orçamento) ou segurar uma tentativa em voo (teto de concorrência). Não há mock
de `fetch` nem store falsa. O teste mais importante da suíte prova que ausência
repetida não abre o circuito.

## Estrutura

```
src/
  main.ts, app.module.ts
  config.ts                  schema das variáveis de ambiente
  observability.ts           pino, identificador de requisição, New Relic
  problems.ts                base do problem+json e o 429
  problem-details.filter.ts  o único exception filter
  rate-limit.ts              limite de entrada
  openapi.ts                 Swagger em /docs
  zip-code/
    zip-code.module.ts       registro dos providers e da store de cache
    zip-code.controller.ts   GET /cep/{cep}
    zip-code.openapi.ts      documentação do endpoint
    zip-code.ts              validação e normalização do CEP
    problems.ts              400, 404 confirmada e parcial, 503
    zip-code-lookup.ts       cache, conclusão e o único throw da consulta
    address-resolver.ts      round-robin, fallback e orçamento
    guarded-lookup.ts        circuito, teto, timeout e log da tentativa
    circuit-breakers.ts      um circuito por provider
    address-cache.ts         política de frescor sobre o store
    address-lookup.ts        a porta do provider
    canonical-address.ts     o contrato de saída
    health.controller.ts     GET /health
    providers/               adapters; o núcleo só os vê pelo módulo
      fetch-json.ts          fetch que nunca lança
      viacep.lookup.ts
      brasilapi.lookup.ts
```
