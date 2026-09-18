# Com todos os providers fora, servimos endereço vencido em vez de erro

O cache aqui foi adotado como mecanismo de resiliência, não de performance — e
essa é a decisão que cobra o preço da afirmação. Esgotados todos os providers,
se existir um endereço em cache dentro da janela de vencimento (7 dias, contra
24h de frescor), respondemos `200` com ele, marcado como vencido no corpo e com
aviso no header. CEP muda em escala de anos; um endereço de cinco dias atrás,
entregue com etiqueta, é melhor resposta que um erro. Sem nada para servir, a
resposta é um **`503` único** com `Retry-After` amarrado ao cooldown do breaker.

Resistimos à tentação de espalhar `502`/`503`/`504` conforme a causa: "erros
diferentes merecem tratamentos diferentes" é sobre o tratamento interno — se
faz fallback, se conta para o breaker, em que nível loga — e não obriga a
multiplicar status codes para um cliente cuja ação é a mesma em todos os casos.
A diferenciação vai no corpo `problem+json`, que carrega a razão por provider.

## Consequências

- O cliente precisa conseguir distinguir endereço atual de vencido, então o
  frescor é parte do contrato público. A procedência (qual provider respondeu)
  **não** é: sai por header e log, porque é topologia interna e acoplar o
  cliente a ela é convidar o problema que o contrato único veio resolver.
