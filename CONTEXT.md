# Consulta de CEP

Uma API que responde um endereço a partir de um CEP, apoiada em mais de um
provider externo que não controlamos. O domínio aqui não é "endereço" — é
**confiança na resposta**: de quem ela veio, quão fresca é, e o que significa
não ter resposta.

## Language

### O dado

**CEP**:
A chave de consulta: oito dígitos que identificam um logradouro ou uma
localidade no Brasil. Normalizado para dígitos puros antes de qualquer uso.
_Avoid_: zipcode, código postal, postal code

**Endereço canônico**:
O contrato único de saída da API, idêntico independentemente de qual provider
respondeu. É o nosso formato, não o de ninguém de fora.
_Avoid_: DTO, payload, resposta da API

**Endereço vencido**:
Um endereço canônico que passou da janela em que o consideramos atual, mas que
ainda é servível quando não há nenhum provider capaz de responder. Sempre sai
marcado como tal — entregar endereço vencido sem etiqueta seria mentir.
_Avoid_: stale, cache velho, dado sujo

### Os providers

**Provider**:
Uma API externa de CEP que pode nos responder (ViaCEP, BrasilAPI). Cada um tem
sua própria base de dados; eles podem discordar, e discordam.
_Avoid_: fonte, API externa, serviço, integração, vendor

**Adapter**:
O que traduz um provider específico para a nossa língua: monta a consulta e
converte a resposta dele em endereço canônico. É a única parte do sistema que
sabe que aquele provider existe.
_Avoid_: client, gateway, wrapper, integração

**Falha de provider**:
Um provider não conseguiu nos dar uma resposta utilizável — porque demorou,
porque errou, ou porque respondeu algo que não bate o contrato dele. É uma
afirmação sobre o provider, nunca sobre o CEP.
_Avoid_: erro, exceção, indisponibilidade

### As respostas negativas

**Ausência confirmada**:
Todos os providers que conseguimos alcançar disseram que não conhecem aquele
CEP. É a única base para afirmar ao cliente que o CEP não existe.
_Avoid_: not found, 404, CEP inválido, CEP inexistente

**Ausência parcial**:
Ao menos um provider disse que não conhece o CEP, e ao menos um outro não
respondeu. Vale como resposta ao cliente, mas não como conclusão sobre o CEP —
a evidência está incompleta.
_Avoid_: not found parcial, 404 fraco

### O estado do sistema

**Modo degradado**:
A API continua respondendo corretamente, mas com menos providers disponíveis do
que o normal. É um estado esperado e observável, não uma falha.
_Avoid_: fora do ar, quebrado, com erro
