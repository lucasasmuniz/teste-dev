# Timeout, circuit breaker e limite de concorrência vivem fora dos adapters

O requisito central do teste é "se amanhã adicionarmos uma terceira API, o que
muda no código?". Se cada adapter cuidasse da própria resiliência, a resposta
seria "reimplementa tudo de novo". Então os adapters são **deliberadamente
rasos** — sabem apenas montar a consulta e traduzir a resposta daquele provider
em endereço canônico — e toda a resiliência (timeout com cancelamento, circuit
breaker, limite de concorrência, round-robin, fallback, orçamento de tempo,
cache) mora no módulo que envolve a lista de adapters.

O sistema tem um único módulo profundo, atrás de uma interface de uma função e
um tipo de retorno. Adicionar um provider é um arquivo novo e uma linha no
registro; nada mais muda.

## Consequências

- O *parse* da resposta é a única coisa específica de provider, e fica no
  adapter — é o único lugar onde conhecimento do provider pode viver.
- Os testes do orquestrador usam adapters falsos em memória, não HTTP mockado:
  a interface do adapter é a superfície de teste.
