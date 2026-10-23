# Tasks — /tmp/mmh-task-writing-forward-2026-10-23/SDD.md

- [ ] **T-001** Crie jobs de exportação CSV e rejeite outros formatos  | tests: 0 | validation: red-green (pending) | immutability: no | wt: 1 | OPEN

  Escopo: Contrato de POST /exports nas camadas controller, service e repository existentes.

  Descrição: Antes da implementação, resolva D-01 e D-03.
  Se o formato for CSV, crie o job no estado QUEUED.
  Se o formato for CSV, retorne HTTP 202 com id.
  Se o formato não for CSV, rejeite o pedido.

  Aceite:
  - Com formato CSV, POST /exports cria um job no estado QUEUED.
  - Com formato CSV, POST /exports retorna HTTP 202 com o id do job criado.
  - Com formato diferente de CSV, POST /exports rejeita o pedido conforme o contrato a definir em D-03.

  Referências: RF-1, RF-3
- [ ] **T-002** Retorne o estado do job consultado  | tests: 0 | validation: red-green (pending) | immutability: no | wt: 1 | OPEN

  Escopo: Contrato de GET /exports/{id} nas camadas controller, service e repository existentes.

  Descrição: Antes da implementação, resolva D-02.
  Consulte o job identificado por id.
  Retorne o estado do job.

  Aceite:
  - Para o id de um job criado por POST /exports, GET /exports/{id} retorna o estado desse job.

  Referências: RF-2, RF-1

  Dependências: T-001
- [ ] **T-003** Negue pedidos de outros tenants sem revelar existência  | tests: 0 | validation: red-green (pending) | immutability: no | wt: 1 | OPEN

  Escopo: Autorização dos pedidos de exportação nas camadas existentes, no escopo a confirmar em D-04.

  Descrição: Antes da implementação, resolva D-04.
  Se o pedido for de outro tenant, negue o pedido.
  Não revele a existência do recurso na resposta.

  Aceite:
  - Pedidos de outros tenants são negados conforme o contrato a definir em D-04.
  - A resposta de negação não revela a existência do recurso, conforme o critério observável a definir em D-04.

  Referências: RF-4

  Dependências: T-001, T-002
