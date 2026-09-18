# A porta do provider devolve um resultado discriminado; só o orquestrador lança

O idiomático em NestJS seria cada adapter lançar exceções tipadas e o
orquestrador apanhá-las. Optamos pelo contrário: o adapter **nunca lança** e
devolve `{ ok: true, endereco } | { ok: false, reason }`, onde `reason` é uma
união fechada (`timeout | http_error | schema_invalid | not_found | capped`).
Falha de provider aqui não é excepcional, é o caso de uso — e tratá-la como
dado, em vez de como fluxo de exceção, torna-a diretamente consumível pelo
circuit breaker, pelo log estruturado e pelo corpo do erro.

O sistema inteiro tem **um** `throw`: o orquestrador lançando uma exceção de
domínio quando todos os caminhos se esgotaram. Um único exception filter global
traduz isso para `application/problem+json`, e também captura o inesperado
(500 sem vazar stack, com o identificador da requisição no log).

## Consequências

- O compilador obriga a tratar cada `reason` nova — é essa exaustividade que
  cumpre o "erros diferentes merecem tratamentos diferentes" do enunciado.
- O tipo de resultado é local e sem combinadores (`map`, `andThen`): o valor
  está na união fechada de razões, não em construir uma biblioteca funcional.
