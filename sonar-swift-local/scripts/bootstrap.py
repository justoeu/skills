#!/usr/bin/env python3
"""Prepara a instância local: senha do banco, senha admin, projeto e token.

Idempotente. Cada segredo é gerado aleatoriamente e gravado apenas no arquivo
de ambiente local, com permissão 0600. Nada é impresso: o token da API do
SonarQube só é devolvido UMA vez na criação, e um token perdido fica pendurado
no servidor sem ninguém saber para quê.

Uso:
    bootstrap.py --project-key <chave> [--env-file <arquivo>] [--port 9100]

Rode duas vezes na primeira instalação: a primeira gera a senha do banco (a
stack ainda não pode subir sem ela), a segunda configura o servidor já no ar.
"""
import argparse
import base64
import json
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


def read_env(path):
    if not path.exists():
        return {}
    return dict(
        line.split("=", 1)
        for line in path.read_text().splitlines()
        if line and not line.startswith("#") and "=" in line
    )


def write_env(path, values):
    body = "\n".join(f"{k}={v}" for k, v in sorted(values.items()))
    path.write_text(
        "# Gerado por bootstrap.py (skill sonar-swift-local).\n"
        "# Contém segredos. Garanta que o Git ignore este arquivo.\n"
        f"{body}\n"
    )
    path.chmod(0o600)


def make_client(host):
    def request(path, data=None, auth=None):
        body = urllib.parse.urlencode(data).encode() if data is not None else None
        headers = {"Authorization": "Basic " + auth} if auth else {}
        req = urllib.request.Request(host + path, data=body, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                raw = response.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as exc:
            # Nunca imprimir o corpo: pode conter token.
            raise RuntimeError(f"API {path.split('?')[0]} devolveu HTTP {exc.code}") from None
        except urllib.error.URLError:
            raise SystemExit(f"Instância não responde em {host}. Suba a stack primeiro.") from None
    return request


def basic(password):
    return base64.b64encode(("admin:" + password).encode()).decode()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-key", required=True)
    parser.add_argument("--env-file", type=Path, default=Path(".env.sonar-local"))
    parser.add_argument("--port", type=int, default=9100)
    args = parser.parse_args()

    host = f"http://127.0.0.1:{args.port}"
    env = read_env(args.env_file)

    if "SONAR_LOCAL_DB_PASSWORD" not in env:
        env["SONAR_LOCAL_DB_PASSWORD"] = secrets.token_urlsafe(32)
        write_env(args.env_file, env)
        print(f"Senha do banco gerada em {args.env_file}.")
        print("Suba a stack e rode este script de novo.")
        return 0

    request = make_client(host)

    # A senha admin default é 'admin'; o SonarQube exige a troca no primeiro uso.
    password = env.get("SONAR_LOCAL_ADMIN_PASSWORD")
    if password is None:
        password = secrets.token_urlsafe(24)
        request("/api/users/change_password",
                {"login": "admin", "previousPassword": "admin", "password": password},
                auth=basic("admin"))
        env["SONAR_LOCAL_ADMIN_PASSWORD"] = password
        write_env(args.env_file, env)
        print("Senha do admin trocada e gravada.")

    auth = basic(password)
    if not request("/api/authentication/validate", auth=auth).get("valid"):
        raise SystemExit(
            "Autenticação falhou. Se a instância foi recriada do zero, apague "
            f"SONAR_LOCAL_ADMIN_PASSWORD de {args.env_file} e rode de novo."
        )

    key = args.project_key
    if not request(f"/api/projects/search?projects={key}", auth=auth).get("components", []):
        request("/api/projects/create",
                {"project": key, "name": key, "visibility": "private", "mainBranch": "main"},
                auth=auth)
        print(f"Projeto criado: {key}")
    else:
        print(f"Projeto já existe: {key}")

    token_var = "SONAR_LOCAL_TOKEN_" + key.upper().replace("-", "_").replace(".", "_")
    if token_var not in env:
        name = f"local-scan-{key}"
        # Um token órfão de execução anterior impede recriar com o mesmo nome.
        for old in request("/api/user_tokens/search", auth=auth).get("userTokens", []):
            if old["name"] == name:
                request("/api/user_tokens/revoke", {"name": name}, auth=auth)
        result = request("/api/user_tokens/generate",
                         {"name": name, "type": "PROJECT_ANALYSIS_TOKEN", "projectKey": key},
                         auth=auth)
        env[token_var] = result["token"]
        write_env(args.env_file, env)
        print(f"Token de análise gerado e gravado em {token_var}.")
    else:
        print(f"Token de análise já existe ({token_var}).")

    print(f"\nPainel: {host}/dashboard?id={key}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
