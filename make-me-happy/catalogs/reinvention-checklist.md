# Reinvention checklist — hook `reinvention`

Capacidades canônicas: o ecossistema já entrega, reescrever é defeito (não estilo).
Aplica ao **diff**. Como o catálogo de Fowler: rótulo + julgamento, nunca cego.

**Três regras que o amarram:**

1. **O SDD manda.** Se o spec pede explicitamente a implementação caseira (ex.: lib de
   aprendizado, constraint de licença, ambiente air-gapped sem deps), o achado vira
   `info` com o `spec_ref` — não é reinvenção, é requisito.
2. **O repo manda.** Manifest já traz lib que cobre a capacidade → usar ela; stdlib
   cobre → nem lib nova. Mas lib **não** pode ser pretexto para dep nova quando a
   stdlib cobre (aí o problema inverte: `dep-desnecessária`).
3. **Julgamento, com prova.** Cada achado cita a hunk e nomeia a fonte canônica
   (stdlib X / lib Y já no manifest). Sem fonte nomeada, não é achado.

Cada item: **sinal no diff → fonte canônica** (por ecossistema, quando muda).

### Empacotamento e compressão
zip/gzip/tar/deflate/zip64 escrito à mão (tabelas de Huffman, bit-twiddling, headers
de arquivo). → `archive/zip` (Go), `zipfile`/`gzip`/`tarfile` (PY stdlib),
`node:zlib` (JS), `java.util.zip` (JVM), `System.IO.Compression` (.NET).

### Criptografia e hashing
MD5/SHA/HMAC/AES/RSA/PBKDF2 implementados no diff; nonce/IV manual; padding manual.
→ `crypto` (Go/Node), `hashlib`/`hmac`/`cryptography` (PY), `javax.crypto` (JVM),
`System.Security.Cryptography` (.NET). **Sempre high**: além de roda, é superfície.

### Parsing de formato comum
JSON/XML/CSV/YAML/TOML/INI lido com `split`/`regex`/índice de char; parser de
querystring caseiro; unescape de HTML manual. → stdlib de cada stack
(`encoding/json`, `JSON.parse`, `json`/`xml.etree`, Jackson já no manifest).

### Datas, tempo e timezone
Aritmética de meses/DST à mão (`+86400000`, `if month == 2`), parser de ISO 8601
caseiro, tabela própria de anos bissextos. → `time` (Go), `temporal`/`date-fns`
se no manifest, `datetime`/`zoneinfo` (PY), `java.time`, `System.DateTimeOffset`.

### HTTP client/server
Socket TCP virando HTTP na mão; parsing de header/chunked/status; server sem
framework quando o repo já tem um. → `net/http` (Go), `fetch`/`undici` (Node),
`requests`/`httpx` (PY), cliente do repo já no manifest.

### Encoding e identificadores
base64/hex/url-encode/unescape caseiros; gerador de UUID por `Math.random`;
normalização Unicode manual; escape de regex à mão. → `encoding/base64`,
`crypto.randomUUID`, `btoa`/`Buffer`, `base64`/`binascii`/`uuid` (PY),
`java.util.UUID`, `System.Text.Encodings`.

### SQL e persistência
Concatenação/escape de SQL manual (em vez de driver parametrizado); query builder
caseiro quando o repo já usa ORM/query builder; paginação de app quando o banco
dá `LIMIT/OFFSET`. → driver parametrizado da stack; lib de persistência do manifest.

### Confiabilidade distribuída
Retry/backoff com jitter escrito à mão (loops + `sleep`); rate limiter caseiro sem
teste de concorrência; circuit breaker próprio; lock distribuído com `SETNX`
sem token. → lib madura do ecossistema (`retry`, `backoff`, `resilience4j`,
`ratelimit`, `golang.org/x/time/rate`) — aqui dep nova é a escolha **certa**.

### Validação de input
Schema de validação reescrito em `if`s encadeados quando o repo já usa
validator/zod/pydactic/jakarta-validation. → a lib de validação do manifest.

### Reescrita de módulo próprio ("do zero" interno)
Arquivo novo assumindo a responsabilidade de módulo existente sem o antigo ser
removido/marcado deprecated; copy-paste de serviço com nomes trocados. →
estender o módulo existente; se é substituição, ela é **uma task de refactor com
imutability test**, não um arquivo irmão silencioso.

### Dep desnecessária (o inverso)
Dep nova para capacidade que a stdlib já cobre (ex.: `left-pad`, `lodash.isarray`
moderno, `moment` em stack com `temporal`). → stdlib. Sinal: import usado para
função trivial presente na stdlib da stack.
