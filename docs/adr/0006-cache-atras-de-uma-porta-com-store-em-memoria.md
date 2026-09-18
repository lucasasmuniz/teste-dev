# Cache fica atrás de uma porta, com store em memória — Redis é plugável, não usado

A política de cache (frescor de 24h, janela de endereço vencido de 7 dias, TTL
próprio para ausência confirmada, teto de entradas) é nossa e vive acima do
store. O **store** é burro: chave, valor e um TTL só. Usamos o seam que o
NestJS já oferece — `@nestjs/cache-manager` — em vez de inventar uma interface
com um único implementador, e registramos a store em memória.

**Redis não entra**, e o motivo é de proporcionalidade, não de arquitetura: ele
arrastaria Docker, Testcontainers e uma dependência de infraestrutura para
rodar e testar um serviço que consulta CEP. O enunciado diz explicitamente que
banco de dados não é avaliado. Trocar depois é mudar a store na linha de
registro do módulo; nenhum outro arquivo é tocado.

## Consequências

- **Frescor não pode ser expresso como TTL do store.** Se fosse, a entrada
  sumiria em 24h e não haveria endereço vencido para servir no dia três. O
  valor guardado carrega o instante da gravação, o TTL do store é a janela de
  vencimento, e o frescor é calculado na leitura. Esta é a mesma propriedade
  que torna a troca por Redis trivial: nenhuma política mora no store.
- O cache é por processo. Com várias réplicas, cada uma aquece a sua — aceito
  conscientemente, e é o primeiro sintoma que justificaria plugar o Redis.
- O estado do circuito **não** vai para o cache. Store é para dados; circuito é
  estado de processo e morre com ele, de propósito.
