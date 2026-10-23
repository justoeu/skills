"""Shared local configuration: never source an env file as shell code."""
import contextlib
import fcntl
import os
from pathlib import Path
import tempfile
import time


def read_env(path):
    path = Path(path)
    if not path.exists(): return {}
    result = {}
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith('#'): continue
        key, sep, value = line.partition('=')
        if not sep or key in result or not key.replace('_', '').isalnum():
            raise ValueError('Arquivo de ambiente inválido (campo malformado ou duplicado).')
        result[key] = value
    return result


def write_env(path, values):
    path = Path(path)
    for key, value in values.items():
        if not key.replace('_', '').isalnum() or any(c in str(value) for c in '\n\r'):
            raise ValueError('Campo de ambiente inválido.')
    body = '# Gerado por bootstrap.py. Contém segredos; mantenha fora do Git.\n'
    body += '\n'.join(f'{k}={v}' for k, v in sorted(values.items())) + '\n'
    fd, temporary = tempfile.mkstemp(prefix=f'.{path.name}.', dir=path.parent)
    try:
        # mkstemp uses O_EXCL and 0600, before any secret is written.
        with os.fdopen(fd, 'w') as stream:
            stream.write(body); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)


@contextlib.contextmanager
def config_lock(path, timeout=10):
    """OS releases flock after a crash; do not unlink its inode after unlock."""
    lock = Path(str(path) + '.lock')
    fd = os.open(lock, os.O_CREAT | os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    try:
        deadline = time.monotonic() + timeout
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB); break
            except BlockingIOError:
                if time.monotonic() >= deadline: raise RuntimeError('Outro bootstrap usa este arquivo de ambiente; tente novamente.')
                time.sleep(0.05)
        yield
    finally:
        os.close(fd)


def token_variable(key):
    # Reversible UTF-8 encoding: dots, hyphens and case stay distinct.
    return 'SONAR_LOCAL_TOKEN_V2_' + key.encode('utf-8').hex().upper()


def resolve_port(explicit, values):
    value = explicit if explicit is not None else os.environ.get('SONAR_LOCAL_PORT', values.get('SONAR_LOCAL_PORT', '9100'))
    try: port = int(value)
    except (ValueError, TypeError): raise ValueError('Porta local inválida.') from None
    if not 1 <= port <= 65535: raise ValueError('Porta local fora de 1..65535.')
    return port
