# Revisão da superfície de abuso — fixture local

Skill aplicada: `~/Developer/harness/skills/abuse-audit/SKILL.md`, versão 1.0.1. Código analisado: `/var/folders/0z/c5nklh457hbfkp524n88czhc0000gn/T/abuse-forward-6oniumlq/app.py`. Apenas leitura de fonte e chamadas diretas das funções em processos locais descartáveis, com strings sintéticas; nenhum servidor, rede, envio ou alteração da fixture.

## Superfície inventariada

| Verbo/rota | Acesso | Controles efetivamente executados | Trabalho alcançado |
|---|---|---|---|
| POST /orders | sessão validada por `authenticate` | middleware aplica Budget compartilhado: 2 por user_id/segundo e 8 totais/segundo | Um dicionário em jobs contendo o corpo; linhas 28–35, 57 |
| POST /receipts | mesma sessão | handler aplica o MESMO Budget, com os mesmos limites | Um dicionário em jobs contendo o corpo; linhas 37–40, 58 |
| POST /uploads | anônimo | `len(body) <= 2048`; nenhum Budget | Um dicionário em jobs com o corpo; linhas 42–44, 59 |
| POST /dispatch | credential igual ao valor aceito pela fixture | comparação da credencial; sem consumo, expiração, unicidade ou Budget | Um job marcado email, sem implementação de envio; linhas 46–48, 60 |
| POST /register | anônimo | nenhum controle de quantidade/cardinalidade/tamanho | Nova entrada em accounts e em cache; linhas 50–54, 61 |

`jobs`, `accounts` e `cache` vivem no módulo (linhas 18–20). O arquivo completo não contém consumo de jobs, limpeza, TTL ou teto dessas estruturas. Isto é uma propriedade da fixture; não presume infraestrutura não fornecida.

## Achados

| # | Lente | Caminho e evidência | Quem alcança | Custo/req | Guarda ausente | Sev |
|---|---|---|---|---|---|---|
| 1 | quota / custo variável | `/orders`, `/receipts`: app.py:34,40; ambos chegam a enqueue:25 | Uma sessão válida | Retém um corpo de B caracteres/bytes ASCII e uma entrada em jobs; B não é limitado nesses caminhos | Limite do payload antes de retenção e orçamento de bytes/backlog da fila | ALTO |
| 2 | public-write / leak | `/register`: app.py:51–53 | Anônimo | Uma entrada em accounts com body e outra em cache com dicionário quota | Orçamento de criação, limites de retenção/cardinalidade, admissão antes de alocar | ALTO |
| 3 | public-write / quota | `/uploads`: app.py:43–44,25 | Anônimo | Uma entrada em jobs e retenção de até 2048 unidades de len por chamada | Quota de repetição e fila com capacidade/retirada; cap de tamanho não cobre frequência | ALTO |
| 4 | quota | `/dispatch`: app.py:47–48,25 | Quem possui a credencial aceita | Uma entrada em jobs e retenção de body por chamada | Quota de operações/backlog; a mesma credencial pode ser reutilizada sem custo comprovado | ALTO |
| 5 | key | `/orders` e `/receipts`: app.py:23,30,39 | Uma sessão válida que controla user_id na requisição da fixture | Até oito jobs por segundo em vez dos dois atribuídos à mesma identidade, usando chaves diferentes | Vincular user_id ao principal da sessão validada; o teto global de oito CONTINUA funcionando | MÉDIO |

**1 — Uma sessão válida manda um corpo arbitrariamente grande em orders/receipts; mesmo dentro de duas aceitações no segundo, o serviço retém ambos em jobs.** Prova direta: um corpo ASCII de 1 MiB em cada rota recebeu 202; os dois jobs retiveram 2.097.152 caracteres ASCII. O Budget limita operações, não B nem memória já acumulada. Correção mínima: tamanho máximo adequado ao contrato antes de enqueue e fila com orçamento de bytes/itens, recusa/backpressure e consumo/expiração. Em servidor HTTP real, o limite deve ocorrer antes de materializar o corpo, mas o parser não foi fornecido e não afirmo que falta controle nessa camada. Falso positivo/custo: limite baixo rejeita documentos legítimos ou bursts; selecionar tamanho pelo uso documentado e permitir caminho explícito para cargas grandes, em vez de bloquear heurísticas.

**2 — Anônimo repete register com dados novos; cada aceitação cria um ID, uma entrada em accounts e outra em cache; ambas permanecem.** Prova: cem chamadas criaram cem accounts e cem entradas cache, com IDs 98–100 nas últimas três. O fato de cache usar ID interno não limita cardinalidade, pois o atacante aciona a criação desse ID. Correção mínima: orçamento de admissão/criação com teto de recursos e política explícita para registros provisórios/abandonados; limitar o cache por capacidade/evicção. Falso positivo/custo: teto ou quota mal dimensionado bloqueia cadastro legítimo ou descarta estado necessário; diferenciar estado durável de cache e fornecer capacidade/recuperação operacional, sem apagar contas válidas automaticamente.

**3 — Anônimo repete uploads abaixo de 2048; cada requisição aceita acrescenta um job e nenhuma delas consulta Budget.** Prova: corpo de 2049 recebeu 413; vinte corpos distintos de 2048 no mesmo instante lógico receberam vinte 202 e deixaram vinte jobs. Há cap por chamada, mas não há cota de chamadas nem teto de fila. Correção mínima: admissão com orçamento global e quota por chamador apropriada à interface pública, além de capacidade/retirada da fila. Falso positivo/custo: quotas só por IP prejudicam usuários atrás de NAT e bursts legítimos; manter limite global de recursos com resposta de saturação previsível e uma identidade comprovada quando ela existir.

**4 — O possuidor da credencial válida repete dispatch sem renová-la; cada chamada adiciona outro job email.** Prova: vinte chamadas usando a mesma credencial da fixture, no mesmo instante lógico, receberam vinte 202 e deixaram vinte jobs. Não há prova de que a credencial represente trabalho único ou seja cara de obter. Correção mínima: quota por principal/credencial validada e orçamento da fila; se o contrato for operação única, implementar consumo/idempotência real. Falso positivo/custo: tornar uma credencial reutilizável artificialmente descartável quebra integrações legítimas; não impor unicidade sem que o contrato a preveja. A fixture não envia e-mail: o custo comprovado é retenção na fila, não entrega nem cobrança de provedor.

**5 — A chave por usuário é fornecida pelo pedido, sem relação demonstrada com a sessão.** `authenticate` só compara session; não valida o user_id. Com uma sessão e IDs diferentes, oito chamadas são aceitas antes de 429; com o mesmo ID, a terceira recebe 429. Vincular a chave ao principal autenticado corrige a evasão da quota individual. Isso não prova ausência de limite global: a nona chamada recebe 429. O risco demonstrado é fairness/consumo do orçamento compartilhado, não chamadas ilimitadas.

## Controles que refutaram suspeitas

- **Middleware e handler têm cobertura equivalente:** orders seguido de receipts com o mesmo user_id retornou `[202,202,429]` na terceira operação. Não há achado de falta de quota em receipts só por ela aplicar o controle dentro do handler.
- **Budget.users não é leak demonstrado:** a admissão global para em oito e a mudança de segundo limpa o mapa. Na prova com dez IDs, apenas oito entradas ficaram ativas. A chave livre é problema de quota individual, não crescimento ilimitado desse mapa.
- Não foi inferida escrita no banco, criação de linhas de log, envio de e-mail, fan-out ou chamada externa: esses efeitos não aparecem no código fornecido.

## Provas e limites

Resultados completos em `/tmp/abuse-forward-results.json`. `time.monotonic` foi fixado em 100 nas chamadas diretas para tornar os limites comparáveis; não houve teste de carga, tráfego HTTP, serviço real nem recursos externos. Imports foram executados com bytecode desabilitado; fixture e skill permaneceram intactas.

Cobertura: todas as cinco rotas registradas e seus caminhos até Budget/enqueue/accounts/cache. Lentes quota, public-write, key, leak e custo do corpo produziram os achados acima. Não há fan-out, clientes externos, parser de rede ou pool neste arquivo. Não avaliei proxy, autenticação de produção, múltiplos workers/threads, atomicidade concorrente, tamanho real do heap, throughput de consumidor ou políticas fora da fixture. Os limites de Budget foram comprovados na execução sequencial; não são prova de limite distribuído. Severidades refletem retenção sem teto alcançável neste código, sem extrapolar para uma implantação desconhecida.
