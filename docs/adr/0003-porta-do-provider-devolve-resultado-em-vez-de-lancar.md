# A porta do provider devolve um resultado discriminado; só o orquestrador lança

O idiomático em NestJS seria cada adapter lançar exceções tipadas e o
orquestrador apanhá-las. Optamos pelo contrário: o adapter **nunca lança** e
devolve `{ ok: true, address } | { ok: false, reason }`, onde `reason` é uma
união fechada (`timeout | http_error | schema_invalid | not_found | capped |
circuit_open`). `capped` e `circuit_open` nunca saem de um adapter — quem os
produz é a camada de resiliência —, mas vivem na mesma união para que
tentativa, log e corpo do erro falem um vocabulário só.
Falha de provider aqui não é excepcional, é o caso de uso — e tratá-la como
dado, em vez de como fluxo de exceção, torna-a diretamente consumível pelo
circuit breaker, pelo log estruturado e pelo corpo do erro.

O fluxo de consulta tem **um** `throw`: o orquestrador lançando uma exceção de
domínio quando todos os caminhos se esgotaram. Um único exception filter global
traduz isso para `application/problem+json`, e também captura o inesperado
(500 sem vazar stack, com o identificador da requisição no log).

Fora desse fluxo, a validação de entrada rejeita pela via idiomática do Nest — o
pipe de validação lança a exceção de domínio `MalformedZipCode` — e cai no mesmo
filter; não é um segundo caminho de erro, é a porta de entrada recusando a
requisição antes de qualquer provider ser consultado.

## Consequências

- O compilador obriga a tratar cada `reason` nova — é essa exaustividade que
  cumpre o "erros diferentes merecem tratamentos diferentes" do enunciado.
- O tipo de resultado é local e sem combinadores (`map`, `andThen`): o valor
  está na união fechada de razões, não em construir uma biblioteca funcional.
