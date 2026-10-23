#!/usr/bin/env python3
"""Local advisory analysis. An operational failure is never a successful scan."""
import argparse
import base64
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from local_config import read_env, resolve_port, token_variable
from local_http import open_local

HERE = Path(__file__).resolve().parent


class ScanError(RuntimeError): pass


def api(host, endpoint, token=None, params=None):
    url = host + endpoint + ('?' + urllib.parse.urlencode(params) if params else '')
    credential = ':'.join(token) if isinstance(token, tuple) else (token + ':' if token else '')
    headers = {'Authorization': 'Basic ' + base64.b64encode(credential.encode()).decode()} if credential else {}
    try:
        with open_local(urllib.request.Request(url, headers=headers), timeout=10) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        error.close()
        raise ScanError(f'API {endpoint}: HTTP {error.code}') from None
    except (urllib.error.URLError, TimeoutError, ValueError):
        raise ScanError(f'API {endpoint}: indisponível ou resposta inválida') from None


def git(target, *args):
    r = subprocess.run(['git', '-C', str(target), *args], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ''


def command(args, target, log, env=None):
    with open(log, 'w') as stream:
        try: return subprocess.run(args, cwd=target, env=env, stdout=stream, stderr=subprocess.STDOUT).returncode
        except OSError: raise ScanError(f'Não foi possível executar {Path(args[0]).name}; veja requisitos da skill.') from None


def ensure_server(host, env_file, port, artifacts, timeout):
    def ready():
        try: return api(host, '/api/system/status').get('status') == 'UP'
        except ScanError: return False
    if ready(): return
    env = {**os.environ, 'SONAR_LOCAL_PORT': str(port)}
    if command(['docker', 'compose', '--env-file', str(env_file), '-f', str(HERE.parent/'assets/compose.yaml'), 'up', '-d', '--renew-anon-volumes'], HERE.parent, artifacts/'compose.log', env):
        raise ScanError('Compose falhou; resultado de análise indisponível.')
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if ready(): return
        time.sleep(min(2, max(0, deadline - time.monotonic())))
    raise ScanError(f'Instância não ficou pronta em {host}.')


def coverage(target, artifacts, xcresult=None):
    if xcresult is not None:
        bundle = Path(xcresult).resolve()
        if not bundle.is_dir() or bundle.suffix != '.xcresult':
            raise ScanError('Bundle .xcresult informado não existe ou não é diretório .xcresult.')
        report = artifacts/'xccov.json'
        with report.open('w') as stream, (artifacts/'xccov.log').open('w') as errors:
            try:
                r = subprocess.run(['xcrun','xccov','view','--archive','--json',str(bundle)],cwd=target,stdout=stream,stderr=errors)
            except OSError: raise ScanError('xccov indisponível; selecione o toolchain Xcode com DEVELOPER_DIR.') from None
        if r.returncode: raise ScanError('Não foi possível ler a cobertura do .xcresult informado.')
        result = artifacts/'coverage.xml'
        with result.open('w') as stream, (artifacts/'coverage.log').open('w') as errors:
            r = subprocess.run([sys.executable,str(HERE/'xccov-to-sonar.py'),str(report),str(target)],stdout=stream,stderr=errors)
        if r.returncode: raise ScanError('O .xcresult informado não contém cobertura válida para este repositório.')
        print('Cobertura: usando .xcresult fornecido; os testes não são reexecutados por este scan.')
        return result
    if not (target/'Package.swift').is_file():
        print('Cobertura SwiftPM: não aplicável; para Xcode informe --xcresult <bundle>.'); return None
    scratch = artifacts/'swift-build'
    args = ['swift', 'test', '--scratch-path', str(scratch), '--no-parallel', '--enable-code-coverage']
    if command(args, target, artifacts/'swift-test.log'):
        print('AVISO: swift test falhou; cobertura não medida.'); return None
    profiles = list(scratch.rglob('default.profdata'))
    bundles = list(scratch.rglob('*PackageTests.xctest'))
    binaries = [p/'Contents/MacOS'/p.stem if p.is_dir() else p for p in bundles]
    binaries = [p for p in binaries if p.is_file()]
    if len(profiles) != 1 or len(binaries) != 1:
        print('AVISO: artefatos SwiftPM ambíguos/ausentes; cobertura não medida.'); return None
    lcov = artifacts/'coverage.lcov'
    with lcov.open('w') as stream, (artifacts/'llvm-cov.log').open('w') as errors:
        try:
            r = subprocess.run(['xcrun','llvm-cov','export','-format=lcov',str(binaries[0]),'-instr-profile='+str(profiles[0]),'-ignore-filename-regex=swift-build'],cwd=target,stdout=stream,stderr=errors)
        except OSError:
            print('AVISO: llvm-cov indisponível; cobertura não medida.'); return None
    if r.returncode:
        print('AVISO: exportação llvm-cov falhou; cobertura não medida.'); return None
    result = artifacts/'coverage.xml'
    with result.open('w') as stream, (artifacts/'coverage.log').open('w') as errors:
        r = subprocess.run([sys.executable,str(HERE/'lcov-to-sonar.py'),str(lcov),str(target)],stdout=stream,stderr=errors)
    if r.returncode:
        print('AVISO: LCOV sem cobertura válida; cobertura não medida.'); return None
    return result


def wait_analysis(host, token, task_id, key, timeout):
    deadline = time.monotonic() + timeout
    while True:
        task = api(host, '/api/ce/task', token, {'id':task_id}).get('task', {})
        if task.get('id') != task_id or task.get('componentKey') != key:
            raise ScanError('Tarefa retornada não corresponde ao projeto/scan atual.')
        state = task.get('status')
        if state == 'SUCCESS':
            if not task.get('analysisId'): raise ScanError('Tarefa concluída sem analysisId.')
            return task['analysisId']
        if state not in {'PENDING','IN_PROGRESS'}: raise ScanError('Processamento da análise falhou ou retornou estado inválido.')
        if time.monotonic() >= deadline: raise ScanError('Timeout aguardando a análise atual.')
        time.sleep(min(1, max(0, deadline-time.monotonic())))


def current_metrics(host, token, key, analysis, expected_languages, coverage_sent):
    def current():
        items = api(host, '/api/project_analyses/search', token, {'project':key,'ps':1}).get('analyses', [])
        if not items or items[0].get('key') != analysis:
            raise ScanError('Outra análise está ativa; métricas não podem ser atribuídas a esta execução.')
    current()
    metrics = api(host, '/api/measures/component', token, {'component':key,'metricKeys':'ncloc,ncloc_language_distribution,coverage'}).get('component', {}).get('measures', [])
    current()
    values = {item['metric']:item.get('value') for item in metrics}
    try:
        size = int(values['ncloc'])
        languages = dict(item.split('=',1) for item in values.get('ncloc_language_distribution','').split(';') if item)
        if size <= 0 or not all(float(languages.get(lang, 0)) > 0 for lang in expected_languages): raise ValueError()
    except (KeyError, TypeError, ValueError):
        raise ScanError('Análise sem linhas Apple comprovadas; não publicar gate como medição útil.') from None
    measured = values.get('coverage')
    if coverage_sent:
        try:
            number = float(measured)
            if isinstance(measured, bool) or not math.isfinite(number) or not 0 <= number <= 100: raise ValueError()
        except (ValueError, TypeError):
            raise ScanError('Relatório de cobertura enviado, mas medição válida não confirmada pela análise atual.') from None
    return size, measured if coverage_sent else None


def run(args, artifacts):
    target = args.target.resolve()
    if not target.is_dir(): raise ScanError('Repositório não encontrado.')
    env_file = (args.env_file or target/'.env.sonar-local').resolve()
    if not env_file.is_file(): raise ScanError('Arquivo de ambiente ausente; execute bootstrap.py.')
    values = read_env(env_file); port = resolve_port(args.port, values)
    key = args.key or target.name
    token = values.get(token_variable(key))
    if not token: raise ScanError('Token v2 deste projeto ausente; execute bootstrap.py para migrar com segurança.')
    host = f'http://127.0.0.1:{port}'
    ensure_server(host, env_file, port, artifacts, args.startup_timeout)
    languages = {x.get('key') for x in api(host, '/api/languages/list', token).get('languages', [])}
    sources = target/'Sources' if (target/'Sources').is_dir() else target
    suffixes = {p.suffix for p in sources.rglob('*') if p.is_file() and not any(part in {'.build','.git','Tests'} for part in p.relative_to(target).parts)}
    expected = ({'swift'} if '.swift' in suffixes else set()) | ({'objc'} if suffixes & {'.m','.mm'} else set())
    if not expected: raise ScanError('Nenhum arquivo Swift/Objective-C encontrado no escopo.')
    if not expected <= languages: raise ScanError('Servidor não anuncia as linguagens Apple necessárias; verifique plugin/edição.')
    for tool in ['swiftlint','mobsfscan']:
        if not shutil.which(tool): print(f'AVISO: {tool} ausente; regras correspondentes não executadas.')
    bundle = getattr(args, 'xcresult', None)
    cov = coverage(target, artifacts, bundle)
    revision = git(target,'rev-parse','HEAD'); branch = git(target,'branch','--show-current')
    dirty = bool(git(target,'status','--porcelain'))
    metadata = artifacts/'report-task.txt'
    scanner_args = ['sonar-scanner', '-Dsonar.host.url='+host, '-Dsonar.projectKey='+key,
        '-Dsonar.projectName='+key, '-Dsonar.projectVersion='+(git(target,'describe','--tags','--always') or 'sem-tag'),
        '-Dsonar.scm.revision='+revision, '-Dsonar.sources='+str(sources.relative_to(target)),
        '-Dsonar.sourceEncoding=UTF-8', '-Dsonar.exclusions=**/.build/**,**/*.generated.swift,Tests/**',
        '-Dsonar.qualitygate.wait=false', '-Dsonar.scanner.metadataFilePath='+str(metadata),
        '-Dsonar.working.directory='+str(artifacts/'scannerwork')]
    if (target/'Tests').is_dir(): scanner_args.append('-Dsonar.tests=Tests')
    if cov: scanner_args.append('-Dsonar.coverageReportPaths='+str(cov))
    scanner_env = {key: value for key, value in os.environ.items() if not key.startswith('SONAR_LOCAL_')}
    scanner_env['SONAR_TOKEN'] = token
    if command(scanner_args, target, artifacts/'scanner.log', scanner_env):
        raise ScanError('Scanner falhou; nenhuma aprovação foi atribuída a esta execução.')
    if not metadata.is_file(): raise ScanError('Scanner não produziu identificador desta análise.')
    meta = dict(line.split('=',1) for line in metadata.read_text().splitlines() if '=' in line)
    if meta.get('projectKey') != key or not meta.get('ceTaskId'): raise ScanError('Metadados do scanner não correspondem ao projeto atual.')
    analysis = wait_analysis(host, token, meta['ceTaskId'], key, args.timeout)
    status = api(host, '/api/qualitygates/project_status', token, {'analysisId':analysis}).get('projectStatus',{}).get('status')
    if status not in {'OK','WARN','ERROR','NONE'}: raise ScanError('Quality Gate atual indisponível.')
    # Analysis tokens cannot Browse private projects. Use a supplied reader
    # token or the existing local admin only for these read-only API calls.
    reader_var = token_variable(key).replace('SONAR_LOCAL_TOKEN_V2_', 'SONAR_LOCAL_READ_TOKEN_V2_')
    reader = values.get(reader_var)
    if not reader:
        password = values.get('SONAR_LOCAL_ADMIN_PASSWORD')
        reader = ('admin', password) if password else token
    size, measured_cov = current_metrics(host, reader, key, analysis, expected, bool(cov))
    print(f'Quality Gate: {status} (consultivo); análise {analysis}; {size} linhas.')
    print(f'Analisado: {branch or "<detached>"} @ {revision[:12] or "sem commit"}' + (' + alterações locais' if dirty else ''))
    print(f'Cobertura: {measured_cov}%' if measured_cov is not None else 'Cobertura: não medida por este fluxo.')
    print('Painel: '+host+'/dashboard?'+urllib.parse.urlencode({'id':key}))
    (artifacts/'result.json').write_text(json.dumps({'analysis_id':analysis,'task_id':meta['ceTaskId'],'revision':revision,'dirty':dirty,'quality_gate':status,'ncloc':size,'coverage':measured_cov,'coverage_source':('supplied_xcresult' if bundle else 'swiftpm') if cov else None},indent=2)+'\n')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('target',type=Path); parser.add_argument('--key')
    parser.add_argument('--env-file',type=Path); parser.add_argument('--port',type=int)
    parser.add_argument('--xcresult',type=Path,help='Bundle gerado para este checkout; importa cobertura sem reexecutar testes')
    parser.add_argument('--timeout',type=float,default=600)
    parser.add_argument('--startup-timeout',type=float,default=300)
    parser.add_argument('--keep-artifacts',action='store_true')
    args=parser.parse_args()
    if args.timeout <= 0 or args.startup_timeout <= 0: parser.error('timeouts devem ser positivos')
    artifacts=Path(tempfile.mkdtemp(prefix='sonar-swift-')).resolve()
    try: run(args, artifacts)
    except (ScanError, OSError, ValueError) as error:
        print(f'Scan incompleto: {error}\nLogs locais: {artifacts}', file=sys.stderr); return 1
    if args.keep_artifacts: print(f'Artefatos: {artifacts}')
    else: shutil.rmtree(artifacts)
    return 0


if __name__ == '__main__': sys.exit(main())
