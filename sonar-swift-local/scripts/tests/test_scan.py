import contextlib
import base64
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.parse import urlparse, parse_qs

sys.dont_write_bytecode=True
SCRIPTS=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(SCRIPTS))
import scan
import bootstrap
from local_config import write_env, token_variable, resolve_port


class ScanTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.base=Path(self.tmp.name).resolve(); self.bin=self.base/'bin'; self.bin.mkdir()
        self.mode='success'; self.calls=[]; owner=self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*a): pass
            def do_GET(self):
                parsed=urlparse(self.path); params=parse_qs(parsed.query); endpoint=parsed.path
                owner.calls.append((endpoint,params))
                if endpoint=='/redirect':
                    self.send_response(302);self.send_header('Location', '/redirect-target');self.end_headers();return
                if owner.mode=='needs_reader' and endpoint in {'/api/project_analyses/search','/api/measures/component'}:
                    expected='Basic '+base64.b64encode(b'admin:synthetic-admin').decode()
                    if self.headers.get('Authorization') != expected:
                        self.send_response(403);self.end_headers();return
                if owner.mode=='auth_error' and endpoint!='/api/system/status':
                    self.send_response(401);self.end_headers();return
                if endpoint=='/api/system/status': data={'status':'UP'}
                elif endpoint=='/api/languages/list': data={'languages':[{'key':'swift'}] if owner.mode!='no_language' else []}
                elif endpoint=='/api/ce/task':
                    task=params['id'][0];key=task.removeprefix('task-')
                    data={'task':{'id':task,'componentKey':key,'status': 'PENDING' if owner.mode=='timeout' else ('FAILED' if owner.mode=='ce_failed' else 'SUCCESS'),'analysisId':'analysis-'+key}}
                elif endpoint=='/api/qualitygates/project_status':
                    data={'projectStatus':{'status':'ERROR' if owner.mode=='red_gate' else 'OK'}}
                elif endpoint=='/api/project_analyses/search':
                    key=params['project'][0]; data={'analyses':[{'key':'old' if owner.mode=='stale' else 'analysis-'+key}]}
                elif endpoint=='/api/measures/component':
                    size='0' if owner.mode=='empty' else '2'
                    data={'component':{'measures':[{'metric':'ncloc','value':size},{'metric':'ncloc_language_distribution','value':'swift='+size},{'metric':'coverage','value':'100.0'}]}}
                else: self.send_response(404);self.end_headers();return
                self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps(data).encode())
        self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.addCleanup(self.stop)
        self.port=self.server.server_address[1]
        self.exe('sonar-scanner', '''import os,sys,pathlib,json
args=dict(a[2:].split('=',1) for a in sys.argv[1:] if a.startswith('-D'))
assert 'sonar.token' not in args
assert os.environ.get('SONAR_TOKEN')
if os.environ.get('SCAN_FIXTURE_MODE')=='scanner_fail': raise SystemExit(2)
if os.environ.get('SCAN_FIXTURE_MODE')=='missing_metadata': raise SystemExit(0)
key=args['sonar.projectKey']; meta=pathlib.Path(args['sonar.scanner.metadataFilePath'])
meta.write_text('projectKey='+key+'\\nceTaskId=task-'+key+'\\n')
(meta.parent/'arguments.json').write_text(json.dumps(args))
(meta.parent/'local-env-names.json').write_text(json.dumps([key for key in os.environ if key.startswith('SONAR_LOCAL_')]))
''')
        self.exe('swift', '''import pathlib,sys,os
scratch=pathlib.Path(sys.argv[sys.argv.index('--scratch-path')+1]); root=scratch/'debug'; root.mkdir(parents=True)
(root/'codecov').mkdir(); (root/'codecov/default.profdata').write_text('current')
binary=root/'FixturePackageTests.xctest/Contents/MacOS/FixturePackageTests'; binary.parent.mkdir(parents=True); binary.write_text('current')
if os.environ.get('SCAN_FIXTURE_MODE')=='ambiguous': (root/'default.profdata').write_text('second')
''')
        self.exe('xcrun', '''import pathlib,sys
assert all('stale' not in a for a in sys.argv)
print('SF:'+str(pathlib.Path.cwd()/'Sources/App.swift')+'\\nDA:1,2,checksum\\nend_of_record')
''')

    def stop(self): self.server.shutdown(); self.server.server_close(); self.thread.join()
    def exe(self,name,body):
        p=self.bin/name;p.write_text('#!'+sys.executable+'\n'+body);p.chmod(0o755)
    def repo(self,name='fixture',package=False):
        root=self.base/name;root.mkdir();(root/'Sources').mkdir();(root/'Sources/App.swift').write_text('let one = 1\n')
        write_env(root/'.env.sonar-local', {'SONAR_LOCAL_PORT':str(self.port),token_variable(name):'synthetic-token'})
        if package:
            (root/'Package.swift').write_text('// fixture');(root/'.build/stale').mkdir(parents=True)
            (root/'.build/stale/default.profdata').write_text('stale')
        return root
    def invoke(self,root,mode=None,extra=()):
        env={**os.environ,'PATH':str(self.bin)+os.pathsep+os.environ['PATH'],'SCAN_FIXTURE_MODE':mode or self.mode,'PYTHONDONTWRITEBYTECODE':'1'}
        env.pop('SONAR_LOCAL_PORT',None)
        r=subprocess.run(['bash',str(SCRIPTS/'scan.sh'),str(root),'--key',root.name,'--keep-artifacts','--timeout','0.02',*extra],env=env,capture_output=True,text=True)
        match=re.search(r'(?:Logs locais|Artefatos): (.+)',r.stdout+r.stderr)
        folder=Path(match[1]) if match else None
        if folder:
            self.assertTrue(folder.name.startswith('sonar-swift-'))
            self.addCleanup(shutil.rmtree,folder,True)
        return r,folder

    def test_scanner_failure_never_reads_old_gate(self):
        r,_=self.invoke(self.repo(),'scanner_fail')
        self.assertNotEqual(r.returncode,0);self.assertNotIn('Quality Gate: OK',r.stdout)
        self.assertFalse(any(p=='/api/qualitygates/project_status' for p,_ in self.calls))

    def test_success_is_correlated_to_analysis_and_token_not_in_argv(self):
        r,folder=self.invoke(self.repo())
        self.assertEqual(r.returncode,0,r.stderr)
        result=json.loads((folder/'result.json').read_text());self.assertEqual(result['analysis_id'],'analysis-fixture')
        gate=[p for endpoint,p in self.calls if endpoint=='/api/qualitygates/project_status']
        self.assertEqual(gate,[{'analysisId':['analysis-fixture']}])
        self.assertNotIn('synthetic-token',r.stdout+r.stderr+(folder/'arguments.json').read_text())

    def test_red_gate_is_advisory_after_successful_analysis(self):
        self.mode='red_gate';r,_=self.invoke(self.repo())
        self.assertEqual(r.returncode,0,r.stderr);self.assertIn('Quality Gate: ERROR',r.stdout)

    def test_private_metrics_use_read_access_without_giving_admin_to_scanner(self):
        self.mode='needs_reader';root=self.repo()
        write_env(root/'.env.sonar-local', {'SONAR_LOCAL_PORT':str(self.port),token_variable(root.name):'synthetic-token','SONAR_LOCAL_ADMIN_PASSWORD':'synthetic-admin'})
        r,folder=self.invoke(root)
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertNotIn('synthetic-admin',r.stdout+r.stderr+(folder/'arguments.json').read_text())

    def test_scanner_does_not_inherit_local_credentials(self):
        root=self.repo()
        with patch.dict(os.environ, {'SONAR_LOCAL_ADMIN_PASSWORD':'synthetic-admin','SONAR_LOCAL_ADMIN_PENDING':'synthetic-pending','SONAR_LOCAL_DB_PASSWORD':'synthetic-db','SONAR_LOCAL_READ_TOKEN_V2_00':'synthetic-reader'}):
            r,folder=self.invoke(root)
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertEqual(json.loads((folder/'local-env-names.json').read_text()),[])

    def test_authenticated_clients_reject_redirects(self):
        host=f'http://127.0.0.1:{self.port}'
        with self.assertRaisesRegex(scan.ScanError,'HTTP 302'):
            scan.api(host,'/redirect',('admin','synthetic-admin'))
        with self.assertRaisesRegex(RuntimeError,'HTTP 302'):
            bootstrap.make_client(host)('/redirect',auth=bootstrap.basic('synthetic-admin'))
        self.assertFalse(any(endpoint=='/redirect-target' for endpoint,_ in self.calls))

    def test_operational_failures_do_not_claim_success(self):
        for mode in ['auth_error','no_language','timeout','ce_failed','stale','empty','missing_metadata']:
            with self.subTest(mode=mode):
                self.mode=mode;r,_=self.invoke(self.repo(mode))
                self.assertNotEqual(r.returncode,0);self.assertNotIn('Quality Gate: OK',r.stdout)

    def test_two_scans_use_isolated_current_coverage(self):
        roots=[self.repo('alpha',True),self.repo('beta',True)]
        with ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(self.invoke,roots))
        paths=[]
        for result,folder in results:
            self.assertEqual(result.returncode,0,result.stderr)
            args=json.loads((folder/'arguments.json').read_text());cov=Path(args['sonar.coverageReportPaths'])
            self.assertEqual(cov.parent,folder);self.assertIn('covered="true"',cov.read_text());paths.append(cov)
            self.assertIn('100.0%',result.stdout)
        self.assertNotEqual(*paths)

    def test_ambiguous_build_is_reported_without_coverage(self):
        r,folder=self.invoke(self.repo(package=True),'ambiguous')
        self.assertEqual(r.returncode,0,r.stderr);self.assertIn('ambíguos',r.stdout)
        self.assertNotIn('sonar.coverageReportPaths',json.loads((folder/'arguments.json').read_text()))

    def test_explicit_xcresult_imports_coverage_without_rerunning_swift(self):
        root=self.repo(package=True);bundle=self.base/'result.xcresult';bundle.mkdir()
        self.exe('swift','raise SystemExit("must not run")')
        self.exe('xcrun',"""import json,pathlib,sys
assert sys.argv[1:5]==['xccov','view','--archive','--json']
assert pathlib.Path(sys.argv[5]).name=='result.xcresult'
print(json.dumps({str(pathlib.Path.cwd()/'Sources/App.swift'):[{'line':1,'isExecutable':True,'executionCount':1}]}))
""")
        r,folder=self.invoke(root,extra=['--xcresult',str(bundle)])
        self.assertEqual(r.returncode,0,r.stderr);self.assertIn('100.0%',r.stdout)
        args=json.loads((folder/'arguments.json').read_text())
        self.assertTrue(Path(args['sonar.coverageReportPaths']).is_file())
        self.assertFalse((folder/'swift-build').exists())

    def test_invalid_explicit_xcresult_fails_before_scanner(self):
        root=self.repo();missing=self.base/'missing.xcresult'
        r,folder=self.invoke(root,extra=['--xcresult',str(missing)])
        self.assertNotEqual(r.returncode,0);self.assertIsNotNone(folder)
        self.assertFalse((folder/'arguments.json').exists())
        bundle=self.base/'invalid.xcresult';bundle.mkdir();self.exe('xcrun',"print('not JSON')")
        r,folder=self.invoke(root,extra=['--xcresult',str(bundle)])
        self.assertNotEqual(r.returncode,0);self.assertFalse((folder/'arguments.json').exists())

    def test_custom_port_is_forwarded_to_compose(self):
        artifacts=self.base/'logs';artifacts.mkdir();calls=[]
        def invoke(args,target,log,env): calls.append(env['SONAR_LOCAL_PORT']);return 0
        with patch.object(scan,'api',side_effect=[scan.ScanError('down'),{'status':'UP'}]),patch.object(scan,'command',invoke):
            scan.ensure_server('http://127.0.0.1:9201',self.base/'env',9201,artifacts,0.1)
        self.assertEqual(calls,['9201'])
        with patch.dict(os.environ,{'SONAR_LOCAL_PORT':'9300'}):
            self.assertEqual(resolve_port(9201,{'SONAR_LOCAL_PORT':'9400'}),9201)
            self.assertEqual(resolve_port(None,{'SONAR_LOCAL_PORT':'9400'}),9300)

    def test_invalid_coverage_is_not_published(self):
        def response(value):
            return [{'analyses':[{'key':'current'}]}, {'component':{'measures':[
                {'metric':'ncloc','value':'1'}, {'metric':'ncloc_language_distribution','value':'swift=1'},
                {'metric':'coverage','value':value}]}}, {'analyses':[{'key':'current'}]}]
        for value in ['not-a-number','NaN','Infinity','-1','101',True]:
            with self.subTest(value=value),patch.object(scan,'api',side_effect=response(value)):
                with self.assertRaises(scan.ScanError): scan.current_metrics('local','fixture','key','current',{'swift'},True)

if __name__=='__main__':unittest.main()
