# SDD confirmado — fixture de exportação

RF-1: POST /exports aceita CSV, cria job QUEUED e retorna 202 com id.
RF-2: GET /exports/{id} retorna estado.
RF-3: Se formato não for CSV, rejeitar pedido. Código HTTP não definido.
RF-4: Pedidos de outros tenants são negados sem revelar existência. Código HTTP não definido.

Arquitetura existente: controller → service → repository. Sem novas filas.

Esta fixture contém somente os fatos fornecidos. Não contém código, contratos existentes,
nomes de arquivos canônicos ou decisões adicionais de produto.
