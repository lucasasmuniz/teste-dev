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

## Limites conhecidos, aceitos e não tratados

Consultas reais aos providers (18 de setembro de 2026) mostraram que a premissa acima
cobre só metade do problema. Foi avaliado tratar cada caso, e a decisão foi
documentar em vez de tratar: todo tratamento exigiria uma fonte de verdade
sobre o CEP que não temos, e colocaria regra de qualidade de dado dentro de um
sistema de resiliência.

- **Providers discordam também no sentido contrário.** O ADR supõe que a
  negativa é que pode estar errada. Mas `99999999` é negado pelo ViaCEP e o
  BrasilAPI devolve um endereço inventado (Sarandi/PR, fora da faixa de CEP do
  Paraná). Com fallback em ausência, esse endereço sai como `200` e vai para o
  cache. O caso previsto também acontece: `78300000` é negado pelo ViaCEP e o
  BrasilAPI devolve Tangará da Serra/MT — ali o fallback acerta. O mesmo
  mecanismo produz os dois resultados, e não há como distingui-los sem uma
  fonte de verdade. Checar faixa de CEP por UF foi rejeitado: é curadoria de dado, e o
  resultado não pode virar falha de provider sem alimentar o circuito com
  problema de dado.
- **O `404` do BrasilAPI não distingue negativa de pane interna.** O BrasilAPI
  agrega outras fontes, e responde o mesmo `404` `service_error` quando todas
  negam e quando todas estão fora (compare `v1` e `v2` de `00000001`). Só as
  mensagens em texto livre dentro de `errors[]` diferenciam, e ler texto livre
  foi rejeitado por fragilidade. Uma ausência confirmada pode, portanto, ser
  falsa. O dano é limitado pelo TTL do cache negativo, mantido em 1h e
  ajustável por variável de ambiente; reduzir para 30min foi rejeitado porque
  não corrige o erro, só o encurta, e dobra o tráfego de CEP inexistente
  contra providers que pedem uso justo.
- **Um `404` só é ausência se tiver o formato de ausência.** O que protegemos
  é o outro lado: `404` do BrasilAPI só vira ausência com corpo
  `CepPromiseError`/`service_error`. Um `404` em HTML de rota inexistente é
  falha de provider — sem isso, uma mudança de rota do provider se disfarçaria
  de ausência e nunca abriria o circuito.
- **As falhas dos dois providers não são independentes.** O BrasilAPI consulta
  o ViaCEP por dentro, então os dois podem cair juntos. Não muda o desenho, mas
  enfraquece a hipótese de que dois providers dão redundância real.
