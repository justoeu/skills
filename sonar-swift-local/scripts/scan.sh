#!/usr/bin/env bash
# Analisa um projeto Swift/Objective-C na instância SonarQube local.
#
# Processo manual, tipicamente pós-merge. O Quality Gate aqui é CONSULTIVO:
# quando ele reclama, o commit já está na branch principal. Este script nunca
# afirma o contrário.
#
# Uso:
#   scan.sh <caminho-do-repo> [--key <chave>] [--port 9100] [--env-file <arq>]
#
# A chave do projeto, se omitida, é o nome do diretório do repositório.

set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="" KEY="" PORT=9100 ENV_FILE=""

while [ $# -gt 0 ]; do
    case "$1" in
        --key)      KEY="$2"; shift 2 ;;
        --port)     PORT="$2"; shift 2 ;;
        --env-file) ENV_FILE="$2"; shift 2 ;;
        -*)         echo "opção desconhecida: $1" >&2; exit 2 ;;
        *)          TARGET="$1"; shift ;;
    esac
done

bold() { printf "\033[1m%s\033[0m\n" "$1"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; }
die()  { printf "  \033[31m✗\033[0m %s\n" "$1" >&2; exit 1; }

[ -n "$TARGET" ] || die "informe o caminho do repositório"
[ -d "$TARGET" ] || die "repositório não encontrado: $TARGET"
TARGET="$(cd "$TARGET" && pwd)"
[ -n "$KEY" ] || KEY="$(basename "$TARGET")"
ENV_FILE="${ENV_FILE:-$TARGET/.env.sonar-local}"
HOST="http://127.0.0.1:$PORT"

[ -f "$ENV_FILE" ] || die "arquivo de ambiente não encontrado: $ENV_FILE (rode bootstrap.py)"
# Precisa casar exatamente com a derivação em bootstrap.py.
# Duas passadas de tr: 'a-z-.' num único set seria lido como range invertido.
TOKEN_VAR="SONAR_LOCAL_TOKEN_$(echo "$KEY" | tr '[:lower:]' '[:upper:]' | tr '.-' '__')"
TOKEN=$(grep "^${TOKEN_VAR}=" "$ENV_FILE" | cut -d= -f2-)
[ -n "$TOKEN" ] || die "$TOKEN_VAR ausente em $ENV_FILE (rode bootstrap.py --project-key $KEY)"

# Processo pós-merge: árvore suja ou branch secundária produz um retrato que
# não corresponde a commit nenhum. O Git não tem blame para arquivo modificado,
# e sem blame o SonarQube não data as linhas — "código novo" vira chute.
BRANCH=$(git -C "$TARGET" branch --show-current 2>/dev/null || echo "")
DIRTY=$(git -C "$TARGET" status --porcelain 2>/dev/null | wc -l | tr -d " ")
MAIN=$(git -C "$TARGET" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||' || echo "main")

bold "1/5  Instância local"
if ! curl -fsS -m 5 "$HOST/api/system/status" 2>/dev/null | grep -q '"status":"UP"'; then
    warn "fora do ar, subindo"
    docker compose --env-file "$ENV_FILE" -f "$SKILL_DIR/assets/compose.yaml" up -d
    for _ in $(seq 1 60); do
        curl -fsS -m 5 "$HOST/api/system/status" 2>/dev/null | grep -q '"status":"UP"' && break
        sleep 5
    done
fi
curl -fsS -m 5 "$HOST/api/system/status" 2>/dev/null | grep -q '"status":"UP"' \
    || die "instância não subiu — veja os logs do serviço sonarqube"
ok "no ar em $HOST"

bold "2/5  Ferramentas"
command -v sonar-scanner >/dev/null || die "falta sonar-scanner"
if command -v swiftlint >/dev/null; then
    ok "swiftlint $(swiftlint version)"
else
    warn "swiftlint ausente — as regras de issues não vão rodar"
fi
if command -v mobsfscan >/dev/null; then
    ok "mobsfscan presente"
else
    warn "mobsfscan ausente — as regras de segurança não vão rodar"
fi

bold "3/5  Testes e cobertura"
COVERAGE_ARG=()
cd "$TARGET"
if [ -f Package.swift ]; then
    if swift test --no-parallel --enable-code-coverage >/tmp/sonar-swift-test.log 2>&1; then
        ok "swift test passou"
        PROFDATA=$(find .build -name "default.profdata" -path "*codecov*" 2>/dev/null | head -1)
        # O bundle de testes tem o nome do pacote; descobrir em vez de assumir.
        BUNDLE=$(find .build -name "*PackageTests.xctest" -type d 2>/dev/null | head -1)
        BINARY="$BUNDLE/Contents/MacOS/$(basename "$BUNDLE" .xctest)"
        if [ -n "$PROFDATA" ] && [ -f "$BINARY" ]; then
            xcrun llvm-cov export -format=lcov "$BINARY" -instr-profile="$PROFDATA" \
                -ignore-filename-regex='\.build' > /tmp/sonar-swift.lcov 2>/dev/null
            if python3 "$SKILL_DIR/scripts/lcov-to-sonar.py" /tmp/sonar-swift.lcov "$TARGET" \
                 > /tmp/sonar-swift-coverage.xml 2>/tmp/sonar-swift-cov.err; then
                ok "cobertura convertida ($(cat /tmp/sonar-swift-cov.err))"
                COVERAGE_ARG=("-Dsonar.coverageReportPaths=/tmp/sonar-swift-coverage.xml")
            else
                warn "conversão falhou: $(cat /tmp/sonar-swift-cov.err)"
            fi
        else
            warn "profdata ou bundle de testes não encontrado — sem cobertura"
        fi
    else
        # Sem este aviso, suíte quebrada viraria scan sem cobertura silencioso.
        warn "swift test FALHOU (/tmp/sonar-swift-test.log) — seguindo sem cobertura"
    fi
else
    warn "sem Package.swift — projeto Xcode precisa de .xcresult (ver SKILL.md)"
fi

bold "4/5  Análise"
VERSION=$(git -C "$TARGET" describe --tags --always 2>/dev/null || echo "sem-tag")
REVISION=$(git -C "$TARGET" rev-parse HEAD 2>/dev/null || echo "")
SOURCES="Sources"; [ -d "$TARGET/Sources" ] || SOURCES="."
TESTS_ARG=(); [ -d "$TARGET/Tests" ] && TESTS_ARG=("-Dsonar.tests=Tests")
sonar-scanner \
    -Dsonar.host.url="$HOST" \
    -Dsonar.token="$TOKEN" \
    -Dsonar.projectKey="$KEY" \
    -Dsonar.projectName="$KEY" \
    -Dsonar.projectVersion="$VERSION" \
    -Dsonar.scm.revision="$REVISION" \
    -Dsonar.sources="$SOURCES" \
    -Dsonar.sourceEncoding=UTF-8 \
    -Dsonar.exclusions='**/.build/**,**/*.generated.swift' \
    -Dsonar.qualitygate.wait=true \
    -Dsonar.qualitygate.timeout=600 \
    "${TESTS_ARG[@]}" "${COVERAGE_ARG[@]}" \
    || warn "scanner retornou erro (Quality Gate vermelho conta como erro)"

bold "5/5  Resultado"
STATUS=$(curl -fsS -u "$TOKEN:" "$HOST/api/qualitygates/project_status?projectKey=$KEY" 2>/dev/null \
    | python3 -c "import sys,json;print(json.load(sys.stdin)['projectStatus']['status'])" 2>/dev/null \
    || echo "DESCONHECIDO")
printf "  Quality Gate: \033[1m%s\033[0m  (consultivo, não bloqueia merge)\n" "$STATUS"
printf "  Analisado: %s @ %s\n" "${BRANCH:-<detached>}" "${REVISION:0:12}"
if [ "$BRANCH" != "$MAIN" ] || [ "$DIRTY" != "0" ]; then
    printf "  \033[33m!\033[0m Este retrato NÃO é de um merge em %s.\n" "$MAIN"
    [ "$BRANCH" != "$MAIN" ] && printf "      branch: %s\n" "${BRANCH:-<detached>}"
    [ "$DIRTY" != "0" ] && printf "      %s arquivos sujos, sem blame — datação de código novo não confiável\n" "$DIRTY"
fi
printf "  Painel: %s/dashboard?id=%s\n" "$HOST" "$KEY"
