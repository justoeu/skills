# Plano preliminar — exportação CSV

Objetivo: criar jobs de exportação CSV e consultar seus estados. Ator: solicitante
vinculado a um tenant; mecanismo de identidade não fornecido. RF-1 define POST /exports,
QUEUED e HTTP 202 com id. RF-2 define GET /exports/{id} e retorno do estado. RF-3 exige
rejeitar formatos diferentes de CSV. RF-4 exige negar pedidos de outros tenants sem
revelar existência.

O plano contém três tasks OPEN na mesma slice. T-001 reúne as alternativas do contrato
POST; T-002 depende da criação de um job; T-003 reúne a autorização dos contratos após
confirmação de seu escopo. A execução é sequencial para evitar edição concorrente das
mesmas camadas. Esses vínculos são decisões de planejamento, não requisitos de produto.

As tasks são preliminares e não estão liberadas para despacho. Resolva as decisões
materiais em decisions.md antes de fechar os contratos. O aceite conhecido foi
preservado; aceite pendente está identificado e não conta como contrato completo.

Use controller → service → repository existentes. Não adicione filas. Processamento do
job, novos estados, retries, interfaces de UI e novos componentes não foram definidos
nesta fixture; não planeje essas entregas por inferência.

A fixture não fornece arquivos canônicos de acompanhamento do app. Antes de executar
num produto, descubra esses arquivos no repositório; atualize apenas os requisitos cuja
entrega tenha evidência. Não invente ROADMAP, STATE ou nomes de arquivos de produto.
