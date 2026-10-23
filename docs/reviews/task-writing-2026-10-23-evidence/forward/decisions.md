# Decisões que impedem fechar os contratos

Antes de perguntar ao usuário, consulte os contratos e padrões existentes do produto.
Esta fixture não fornece código; por isso não é possível eliminar essas lacunas por inspeção.
O fato de o SDD estar confirmado não autoriza preencher contratos ausentes por suposição.

| ID | Requisitos / tasks | Informação necessária | Critério de resolução |
|---|---|---|---|
| D-01 | RF-1 / T-001 | Como o pedido expressa CSV e como a resposta transporta id? | Referenciar contrato existente ou registrar representação aprovada; manter HTTP 202 e QUEUED. |
| D-02 | RF-2 / T-002 | Qual o código HTTP e a representação da resposta de estado? | Referenciar contrato existente ou registrar resposta aprovada; não criar estados adicionais. |
| D-03 | RF-3 / T-001 | Qual código HTTP e resposta significam rejeição de formato? | Registrar contrato aprovado sem escolher automaticamente 400, 415 ou 422. |
| D-04 | RF-4 / T-003 | Quais pedidos/rotas estão abrangidos, como se reconhece outro tenant e qual resposta evita revelar existência? | Vincular identidade/autorização ao padrão existente e definir código, corpo e comparação observável autorizada. Não inferir 403, 404 nem garantia de tempo constante. |

O caso de id inexistente não está definido. Confirme somente o comportamento necessário
para tornar RF-4 verificável e para fechar a consulta solicitada; não expanda para uma
matriz universal de erros. O processamento posterior do job e seus estados futuros não
são decisões necessárias para inventar novas tasks nesta fixture.

Nenhum código de erro, campo de payload, retry ou componente foi decidido neste ensaio.
