# O arsenal de resiliência é timeout, fallback, circuit breaker e cache — e nada além disso

Com dois providers equivalentes e um GET idempotente, cada mecanismo de
resiliência tem que provar o que faz que o anterior já não faça. **Retry com
backoff** foi cortado: gastar tentativas no provider ruim antes de tentar o
irmão saudável piora a latência do caminho degradado — retry serve a quem não
tem alternativa, e nós temos. **Fila (BullMQ) e rate limiting de saída via
Redis** foram cortados junto com o próprio Redis: pré-aquecer cache de CEP não
resolve nenhum problema que o cache sob demanda já não resolva, e o README diz
explicitamente que banco não é avaliado. O **circuit breaker** ficou porque é o
único que remove o imposto de latência de um provider morto ser escolhido pelo
round-robin a cada duas requisições. O **cache** ficou porque é a única coisa
capaz de responder com os dois providers fora.

## Consequências

- Sem Redis, o cache é em memória e limitado por número de entradas (LRU), não
  só por TTL — TTL sozinho não impede o processo de crescer sem limite.
- Testcontainers deixa de se justificar: não há dependência externa para subir.
- O breaker é escrito à mão (~60 linhas, três estados) em vez de `opossum`: uma
  dependência com opções que não usamos custaria mais explicação do que o
  código próprio.
