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
from local_config import read_env, write_env, config_lock, token_variable, resolve_port
from local_http import open_local


def make_client(host):
    def request(path, data=None, auth=None):
        body = urllib.parse.urlencode(data).encode() if data is not None else None
        headers = {"Authorization": "Basic " + auth} if auth else {}
        req = urllib.request.Request(host + path, data=body, headers=headers)
        try:
            with open_local(req, timeout=60) as response:
                raw = response.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as exc:
            # Nunca imprimir o corpo: pode conter token.
            exc.close()
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
    parser.add_argument("--port", type=int)
    args = parser.parse_args()
    with config_lock(args.env_file):
        return configure(args)


def configure(args):
    env = read_env(args.env_file)
    port = resolve_port(args.port, env)
    env['SONAR_LOCAL_PORT'] = str(port)
    host = f"http://127.0.0.1:{port}"

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
        password = env.get('SONAR_LOCAL_ADMIN_PENDING')
        if password is None:
            password = secrets.token_urlsafe(24)
            env['SONAR_LOCAL_ADMIN_PENDING'] = password
            write_env(args.env_file, env)
        # If the response/persistence was interrupted, the pending credential
        # may already be active. Probe it before trying the default password.
        if not request('/api/authentication/validate', auth=basic(password)).get('valid'):
            request("/api/users/change_password",
                    {"login": "admin", "previousPassword": "admin", "password": password},
                    auth=basic("admin"))
        env["SONAR_LOCAL_ADMIN_PASSWORD"] = password
        env.pop('SONAR_LOCAL_ADMIN_PENDING', None)
        write_env(args.env_file, env)
        print("Senha do admin trocada e gravada.")

    auth = basic(password)
    if not request("/api/authentication/validate", auth=auth).get("valid"):
        raise SystemExit(
            "Autenticação falhou. Se a instância foi recriada do zero, apague "
            f"SONAR_LOCAL_ADMIN_PASSWORD de {args.env_file} e rode de novo."
        )

    key = args.project_key
    if not request('/api/projects/search?' + urllib.parse.urlencode({'projects':key}), auth=auth).get("components", []):
        request("/api/projects/create",
                {"project": key, "name": key, "visibility": "private", "mainBranch": "main"},
                auth=auth)
        print(f"Projeto criado: {key}")
    else:
        print(f"Projeto já existe: {key}")

    token_var = token_variable(key)
    if token_var in env:
        token_auth = base64.b64encode((env[token_var] + ':').encode()).decode()
        if not request('/api/authentication/validate', auth=token_auth).get('valid'):
            env.pop(token_var)
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

    write_env(args.env_file, env)
    print(f"\nPainel: {host}/dashboard?" + urllib.parse.urlencode({'id':key}))
    return 0


if __name__ == "__main__":
    try: sys.exit(main())
    except (RuntimeError, OSError, ValueError) as error:
        print(f'Bootstrap incompleto: {error}', file=sys.stderr); sys.exit(1)
