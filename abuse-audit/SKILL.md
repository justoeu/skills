---
name: abuse-audit
description: "Encontra superfície de abuso: rota que aceita trabalho sem teto, escrita pública sem cota, chave de rate limit que o cliente controla, fan-out e leitura sem limite, limitador que vaza memória. Use quando o pedido for sobre rate limiting, DoS, exaustão de recursos, força bruta, 429, ou 'esta rota está protegida?'."
---

# /abuse-audit

Procura **um** tipo de defeito: um caminho pelo qual alguém faz a instância trabalhar mais do que deveria poder pedir.

Não é uma auditoria de segurança geral. XSS, IDOR, injeção e vazamento de segredo ficam fora deste escopo. Aqui a pergunta é sempre a mesma:

> **Quem pode pedir isso, quantas vezes, e quanto custa cada vez?**

Um achado só existe quando as três respostas juntas formam um problema. "Sem limite" sozinho não é achado — `GET /healthz` não tem limite e está certo.

## Uso

```
/abuse-audit                    # varre o repo inteiro
/abuse-audit <caminho>          # escopo estreito
/abuse-audit --diff             # só o que mudou vs. a branch base
/abuse-audit --lens quota       # uma lente só (nomes na tabela abaixo)
```

---

## A barra de evidência

**Todo achado precisa das três colunas. Sem as três, não reporte.**

| coluna | pergunta | exemplo de resposta válida |
|---|---|---|
| **entrada** | quem alcança isto, com qual credencial? | anônimo, `POST /go/{slug}` |
| **guarda ausente** | qual controle deveria estar aqui e não está? | nenhum limitador; `contentAudit` cobre, cota não |
| **custo por requisição** | o que uma requisição consome? | 1 INSERT em `click_log` + 1 conexão do pool de 16 |

Um achado sem a coluna do **custo** é ruído: é o que produz "adicione rate limit em tudo", que é como se chega a um limitador que tranca usuário legítimo.

**Escreva o caminho de ataque como uma frase de uma linha**, não como uma categoria:

> ✅ "Anônimo faz laço em `/go/conhecido`; cada acerto escreve uma linha em `click_log`; nada limita; 10 mil requisições = 10 mil linhas e 10 mil aquisições do pool."
> ❌ "Falta rate limiting no endpoint público."

---

## As sete lentes

Rode as que fizerem sentido para o escopo. Cada uma tem uma forma no código, uma consulta que a encontra, e **o falso positivo que ela mais produz** — leia o falso positivo antes de reportar.

### 1. `quota` — rota que aceita trabalho sem teto por chamador

**A forma:** um handler mutante (POST/PUT/PATCH/DELETE) alcançável com credencial válida, sem nenhum controle de quantidade. Uma sessão válida vira requisições ilimitadas.

**Como achar:** liste TODA rota registrada; separe por verbo; cruze com o mapa de cobertura do middleware de cota. O cruzamento é o achado — ler handler por handler perde o que ninguém lembrou de olhar.

```bash
grep -rnE '\.(Post|Put|Patch|Delete)\(' --include='*.go' | grep -v _test.go
```

**Falso positivo mais comum:** rota mutante que já é limitada por outra coisa — um upload com cap de corpo, um endpoint que exige prova de credencial fresca. Cheque antes.

**A regra que decide:** cobertura por MIDDLEWARE conta; cobertura por chamada dentro de cada handler não conta. Cobertura que depende de alguém lembrar tem buraco invisível.

### 2. `public-write` — superfície não autenticada que ESCREVE

**A forma:** rota sem sessão cujo caminho feliz insere ou atualiza linha, envia e-mail, dispara job, ou toca armazenamento de objeto.

**Como achar:** para cada rota fora do grupo autenticado, siga até o repositório e procure `INSERT`/`UPDATE`/`DELETE`/`Enqueue`/`Publish`/`PutObject`.

**Falso positivo:** escrita idempotente e barata cujo custo é menor que o de recusá-la (um upsert de heartbeat). Diga o custo e deixe passar.

**Severidade sobe** quando a escrita é **por requisição** e não por recurso: um contador de clique cresce sem teto; um upsert em linha fixa não.

### 3. `key` — chave de rate limit que o cliente controla

**A forma:** um balde cuja chave contém `User-Agent`, um header custom, um campo do corpo, um cookie, ou `X-Forwarded-For` sem par confiável.

**Como achar:** liste as CHAMADAS ao limitador e leia a expressão da chave. Grepar por acesso a headers perto da palavra "key" não basta: chaves criptográficas e chaves de cache geram falsos positivos.

```bash
grep -rnE '\.(Begin|Fail|FailFor|CommitFail|CommitFailFor|Allow|Reserve)\(' --include='*.go' | grep -v _test.go
```

O passo mecânico lista os call sites; o passo de julgamento lê o que compõe a chave em cada um. Não há atalho — a pergunta é semântica.

**Por que é grave:** uma dimensão livre é uma **saída** do próprio balde. O atacante manda um valor novo por tentativa e ganha um orçamento inteiro por requisição. O balde deixa de existir enquanto continua parecendo existir — o pior modo de falha desta categoria.

**Não é falso positivo** só porque o valor "normalmente não muda". A pergunta é se o cliente PODE mudá-lo de graça.

**Registrar ≠ confiar.** Gravar o User-Agent na trilha de auditoria está certo e é útil justamente por não ter autoridade nenhuma. Só entre a chave de limite é achado.

### 4. `leak` — estrutura keyed por entrada do atacante, sem varredura

**A forma:** um `map`/cache/set cuja chave vem de fora (e-mail, slug, endereço, token) e que nada remove. Alguns milhões de requisições transformam a defesa num vazamento de memória.

**Como achar:** todo `map[string]` de longa vida no processo. Para cada um: quem escreve a chave? existe sweep/TTL/LRU? existe TETO?

**A pergunta que separa achado de ruído:** *a cardinalidade da chave é limitada pelo domínio ou pelo atacante?* Keyed por id de usuário = limitada pela instância. Keyed por e-mail tentado = ilimitada.

**Cuidado com o segundo nível:** um conjunto POR chave (contas distintas por IP) precisa de teto próprio. Um teto no mapa externo e nenhum no conjunto interno é o mesmo defeito uma camada abaixo.

### 5. `fanout` — trabalho concorrente derivado da entrada

**A forma:** `go func` dentro de um laço sobre dados da requisição; `errgroup` sem `SetLimit`; worker pool cujo tamanho vem do payload; recursão sobre estrutura de árvore controlada pelo usuário (pasta dentro de pasta).

**Como achar:**
```bash
grep -rn 'go func' --include='*.go' | grep -v _test.go
grep -rn 'errgroup\|semaphore\|WaitGroup' --include='*.go' | grep -v _test.go
# Em Go, um canal com buffer também pode funcionar como semáforo; a busca
# acima não encontra esse padrão sozinha.
grep -rn 'make(chan struct{},' --include='*.go' | grep -v _test.go
```

**A regra:** concorrência tem de ser derivada de um orçamento do PROCESSO, nunca do tamanho da entrada. Uma requisição que escolhe quantas goroutines nascem escolhe o consumo da máquina.

### 6. `read` — leitura sem cap

**A forma:** `io.ReadAll` sem `MaxBytesReader`; decode de JSON sem limite de corpo; `SELECT` sem `LIMIT` numa tabela que cresce; decode de imagem sem cap de pixels; descompressão sem cap (zip bomb).

**Como achar:**
```bash
grep -rn 'io.ReadAll\|ioutil.ReadAll\|json.NewDecoder' --include='*.go' | grep -v _test.go
grep -rniE 'select .* from' --include='*.go' | grep -vi 'limit' | grep -v _test.go
```

**Falso positivo grande aqui:** consulta sem `LIMIT` sobre tabela de cardinalidade fixa (papéis, permissões, jobs de backup). Diga qual é a tabela e por que não cresce.

### 7. `wait` — chamada externa sem timeout, pool sem teto

**A forma:** cliente HTTP sem `Timeout`; `context.Background()` num caminho de requisição; pool de banco sem `MaxConns`; ausência de `ReadHeaderTimeout` no servidor.

**Por que conta como abuso:** sem timeout, N conexões lentas seguram N slots para sempre. O atacante não precisa de volume, precisa de paciência — e é o vetor barato contra um pool pequeno.

---

## Procedimento

1. **Meça antes de opinar.** Primeiro produza a tabela de superfície: toda rota, verbo, autenticação exigida, controles que a cobrem. Sem essa tabela, as lentes 1 e 2 viram palpite.
2. **Rode as lentes em paralelo**, uma por vez de forma independente — elas não compartilham estado e uma achar nada não diz nada sobre as outras.
3. **Descarte tudo que não tem as três colunas** da barra de evidência.
4. **Tente refutar cada achado sobrevivente.** Para cada um, procure ativamente o controle que você pode não ter visto: um middleware montado acima, um cap de corpo por path, uma prova de credencial. O default é FALSO POSITIVO.
5. **Ordene por (custo por requisição × alcance do chamador)**, não por categoria. Uma rota anônima que escreve vale mais que dez rotas autenticadas que leem.
6. **Diga o que você NÃO varreu.** Um relatório que não declara sua própria cobertura lê como completo e não é.

## Formato de saída

Uma tabela, e depois um parágrafo por achado ALTO.

```
| # | lente | caminho | quem alcança | custo/req | guarda ausente | sev |
```

Para cada ALTO, o parágrafo tem de responder: qual seria a correção **mínima**, e qual é o **falso positivo que ela cria**. Uma correção que não declara seu próprio custo é como se ship um limitador que tranca usuário legítimo.

## O que esta skill NÃO reporta

- "Adicione rate limit em tudo." Um teto sem um custo medido atrás dele é decoração que um dia nega serviço de graça.
- **Bloqueio automático baseado em heurística.** O modo de falha não é "um bloqueio que não funciona" — é uma instância que ninguém alcança, trancada de madrugada pelo controle, com o operador do lado de fora. Proponha o SINAL e o botão; nunca o gatilho.
- Fingerprinting de dispositivo, ou qualquer identificador novo do cliente. É a lente 3 vestida de solução.
- DDoS volumétrico. Não é defensável na camada da aplicação, e fingir que é gera trabalho que não protege.
