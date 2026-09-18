# teste-dev — API de consulta de CEP resiliente

Enunciado em `README.md`. Glossário do domínio em `CONTEXT.md` — use os termos
de lá (**provider**, **adapter**, **falha de provider**, **ausência confirmada**,
**ausência parcial**, **endereço vencido**, **modo degradado**) e não invente
sinônimos.

## Antes de mexer

Leia o ADR da área que você vai tocar. Eles são curtos e existem para você não
reabrir uma decisão que já foi tomada com alternativa avaliada:

| Se você vai mexer em | Leia |
| --- | --- |
| escopo de resiliência, adicionar retry/fila/Redis | `docs/adr/0001` |
| onde mora timeout, circuito ou concorrência | `docs/adr/0002` |
| a porta do provider, tratamento de erro | `docs/adr/0003` |
| o que fazer quando um provider não encontra o CEP | `docs/adr/0004` |
| resposta em falha total, status codes, procedência | `docs/adr/0005` |
| cache, store, TTL | `docs/adr/0006` |

## Invariantes que quebram em silêncio

Estas são as armadilhas específicas deste desenho. Quebrar qualquer uma passa
nos testes existentes se você não escrever o teste certo.

- **Ausência não alimenta o circuito.** O circuit breaker mede saúde de
  provider, nunca existência de dado. Se `not_found` contar como falha, o
  sistema tira providers saudáveis de jogo por causa de dados. É a invariante
  central.
- **A porta do provider nunca lança.** Adapter devolve resultado discriminado
  com uma razão da união fechada. Existe **um** `throw` no sistema, no
  orquestrador, e **um** exception filter.
- **Frescor não é o TTL do store.** O TTL do store é a janela de vencimento; o
  valor carrega o instante da gravação e o frescor é calculado na leitura. Se
  inverter, endereço vencido deixa de existir.
- **Adapters não implementam resiliência.** Timeout, circuito, concorrência e
  fallback vivem fora deles. Adapter sabe montar consulta e traduzir resposta.
- **Validação de resposta de provider é `safeParse`, nunca `parse`.**
- **Timeout aborta de verdade.** `AbortController` com o `signal` no cliente
  HTTP; `Promise.race` sozinho deixa a requisição viva.
- **Quem introduz um resultado novo entrega a linha de log dele no mesmo
  commit.** Observabilidade não é uma fase.

## Testes

Dois seams, e só dois. O primário é o **HTTP de saída**, interceptado, com a app
exercida ponta a ponta. O secundário é a **interface do adapter**, com adapters
falsos em memória, usado apenas onde o teste precisa manipular o relógio
(circuito, orçamento de tempo).

Não mocke `fetch` e não substitua a store de cache por uma falsa — os dois
afirmariam implementação em vez de comportamento.

## Ferramental de agente

Esta seção é fiação local de skills. Os arquivos abaixo existem no disco mas
**não são versionados** — não fazem parte da entrega, e quem clonar o repo não
os terá. Se estiverem ausentes, ignore esta seção e siga.

- **Issue tracker** — specs e tickets vivem como markdown em
  `.scratch/<feature>/`. Ver `docs/agents/issue-tracker.md`.
- **Triage labels** — os cinco papéis canônicos, sem renomeações. Ver
  `docs/agents/triage-labels.md`.
- **Domain docs** — single-context: `CONTEXT.md` na raiz + `docs/adr/`. Ver
  `docs/agents/domain.md`.

O trabalho desta entrega está em `.scratch/consulta-cep/` — `spec.md` e nove
tickets em `issues/`, numerados em ordem de dependência.
