# "Não encontrei" de um provider dispara fallback para o outro

A decisão inicial era o oposto: tratar `not_found` como resposta autoritativa,
responder 404 direto e economizar uma chamada. Foi revertida durante o desenho.
Os providers têm bases de dados distintas e mantidas por gente diferente — um
CEP recém-criado entra numa antes da outra. "Não encontrei" é uma afirmação
sobre a base daquele provider, não sobre a existência do CEP, e devolver 404 a
partir dela é exatamente o acoplamento a um provider único que o teste manda
evitar. Só há **ausência confirmada** quando todos os providers alcançáveis
disseram que não conhecem o CEP.

O que não mudou: ausência **não** conta para o circuit breaker. O breaker mede
saúde de provider, não existência de dado.

## Consequências

- Todo CEP inexistente passou a custar duas chamadas, o que reabre o risco de
  uso abusivo contra providers que pedem uso justo. Por isso ausência
  confirmada é cacheada — mas com TTL próprio e muito menor (1h contra 24h do
  positivo), porque CEP inexistente vira existente, e sem janela de vencido:
  um 404 vencido é pior que um erro honesto.
- **Ausência parcial** (um provider nega, outro está fora) responde 404, porque
  descartar a única informação obtida seria pior — mas não entra no cache e é
  registrada em log como conclusão incompleta.
