# deep-audit — remediação 2.0.0 / schema 2

Ownership respeitado: somente deep-audit/** e este relatório. Sem commit/push, rede,
serviços externos ou alteração de projeto real. Todos os comandos Git/execução usaram
fixtures temporárias. Revisão independente forward está sendo feita por outro agente.

## Resultado por achado

| Item | Correção e evidência |
|---|---|
| DA-01 | Init emite JSON literal, docs removem eval; teste com $(), crases, aspas/quebra de linha faz round-trip sem interpretação. |
| DA-02 | Sec tally valida três votos/lentes/contexto; falha preserva achados anteriores e publica coverage unverified com candidatos pendentes; gate revalida hashes dos inputs. |
| DA-03 | IDs por identidade/hash; carry exige identidade e conteúdo correspondentes; candidato novo CRITICAL não recebe refutação anterior. |
| DA-04 | Merge valida todos os inputs antes de gravar; JSON truncado preserva FINDINGS byte a byte. Ausência de achado preserva registro até desfecho explícito. |
| DA-05 | review-start e tally inválido retiram aprovação anterior; done e gate revalidam votos/prova/conteúdo atuais, inclusive após apagar voto sem reapurar. |
| DA-06 | Run/OUT únicos, diretório não vazio recusado, init concorrente serializado; resume explícito valida root/branch/HEAD/modo/escopo, snapshot rejeita HEAD alterado. |
| DA-07 | Manifesto de etapas esperadas, snapshot de fonte e hash de artefatos; audit-gate exige execução completa inclusive resultado vazio; deps schema e erros são validados. Closure gate acrescenta provas/desfechos. |
| DA-08 | Writer lock exclusivo com owner antes de publicação, busy explícito para retry, gravações atômicas. Concorrência real preserva duas atualizações ou recusa uma que é repetida. |
| DA-09 | Reconsolidação preserva review/in_progress válidos; alteração substantiva reabre; desaparecimento não apaga. |
| DA-10 | CORRECTNESS APROVA exige runner real green/red/green, contexto atual e logs íntegros. False-green, voto false e fonte alterada não fecham. |
| DA-11 | Ref/base/merge-base inválidos falham antes de persistir run. Delta sem base exige decisão explícita full; noGit exige --full --no-git. |
| DA-12 | Zero candidatos passa apenas com inventory/hunters concluídos; matriz required_hunters é verificada exatamente e falta de assignment falha. Sem superfície exige no_attack_surface/razão explícitos. |

## Sete oportunidades

1. Reversão isolada em worktree temporária, com restore/cleanup em sucesso e erro normal; checkout compartilhado não muda. Timeout/sinal não é RED.
2. Maestro é dono de dispatch, tally e done; Ferreiro entrega patch/prova e não se aprova. Ordem fix → painel → disposição → relatório corrigida.
3. Cético mantém PLAUSÍVEL quando não consegue reproduzir; Refutador mantém UNVERIFIED quando não completa traço.
4. Enxame tem procedimento local N+1 completo quando nplus1-check não existe; indisponibilidade é failed, nunca resultado vazio presumido.
5. SKILL_ROOT deriva do SKILL.md carregado; flags reais propagadas, default delta preservado.
6. Banner delimitado/idempotente, incluindo remoção de banners legados duplicados; mesma nota/progresso/desfecho repetido não duplica histórico.
7. Contextos/rounds e tentativas imutáveis, summary derivado de todas as IDs; repetir mesmo tally é idempotente. Tentativa persistida antes do resumo para permitir retry após interrupção.

## Validação executada

- `node --test deep-audit/scripts/tests/regression.test.mjs`: **12 PASS, 0 FAIL**, última execução ~84s.
- Cobertura comportamental: init/resume/flags/branch com barra/base inválida/noGit; duas runs no mesmo dia; corrupção; status/IDs; segurança vazia/inválida/voto alterado; fix real Node RED/GREEN/reversão e worktree cleanup; gate antigo; concurrent sync/retry; SIGKILL antes e depois de rename de FINDINGS, lock recovery e remerge; full com todas as 15 lentes; HTML/TASKS; migração sem importar confiança; múltiplas IDs/reviews e idempotência.
- `node --check` nos **15 scripts .mjs**: passou.
- `uv run --offline --with pyyaml python .../skill-creator/scripts/quick_validate.py deep-audit`: **Skill is valid!**
- Check-deps-latest real foi executado em fixture sem dependências: zero consultas externas; resultados de zero válidos no gate.

## Contrato e limites

Versão 2.0.0 porque schema 2 e saída JSON do init são incompatíveis com v1. Pack legado
renderiza como histórico incompleto; migração explícita inicia nova run com legacy_source
e revalida conteúdo. Não há promoção automática de aprovação.

Snapshot de fonte é conservador: alterações posteriores invalidam evidência de etapas,
revisões e disposições. HEAD/branch novo exige nova run. Estabilize o lote antes da revisão
final. Hashes verificam consistência local, não autenticam votante nem provam raciocínio.
Matriz de componentes, independência dos agentes e correção semântica dos votos continuam
responsabilidade explícita do orquestrador.

Não testados: registries/CVEs vivos, todos os parsers de manifests/stacks, browser visual,
modelos independentes efetivos, ferramentas de produção ou workflows CI externos.
SIGKILL pode deixar apenas worktree temporária/lock; recuperação documentada exige dono
morto e writers parados. Atomicidade é por arquivo; gate rejeita transação interrompida.

Após a suíte completa, normalizei o path real do pack no runner de reversão (aliases
macOS /var e ~/tmp). Reexecutei os dois cenários afetados de reversão/revisão:
**2 PASS, 0 FAIL** (~23s), incluindo checkout original intacto e limpeza de worktree.

Forward independente posterior: **PASS sem achado novo**, executado pelo agente
responsável por Ultra, com 71 CLIs Git/Node e mais 10 numa fixture genuína sem superfície
de ataque. Relatório /tmp/deep-forward-independent.md. Incluiu bug quantity real,
RED/GREEN/reversão isolada, closure/remerge/reopen, voto removido, candidato omitido,
UNKNOWN, deps/base inválidos, HEAD/retomada/nova run. Votos foram fixtures instrumentais,
não alegação de painel humano/modelos de produto realmente executado.
