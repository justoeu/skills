import base64, contextlib, importlib, io, json, os, sys, tempfile, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import urlsplit

sys.dont_write_bytecode = True
sys.path.insert(0, '~/Developer/harness/skills/sonar-swift-local/scripts')
import scan, bootstrap
from local_config import token_variable, write_env

root = Path(tempfile.mkdtemp(prefix='sonar-reader-final-'))
(root/'Sources').mkdir(); (root/'Sources'/'App.swift').write_text('let fixture = 1\n')
(root/'bin').mkdir()
scanner = root/'bin'/'sonar-scanner'
scanner.write_text('#!' + sys.executable + '\n' + '''import os, json, sys
from pathlib import Path
args = dict(x[2:].split('=',1) for x in sys.argv[1:] if x.startswith('-D'))
meta = Path(args['sonar.scanner.metadataFilePath'])
meta.write_text('projectKey=fixture\\nceTaskId=current-task\\n')
result = {'local_names':sorted(k for k in os.environ if k.startswith('SONAR_LOCAL_')), 'analysis_token_correct':os.environ.get('SONAR_TOKEN')=='SCAN_CANARY', 'benign_marker_preserved':os.environ.get('PROBE_BENIGN')=='present', 'secret_in_argv':any(x in ' '.join(sys.argv) for x in ['SCAN_CANARY','ADMIN_CANARY','READER_CANARY'])}
(meta.parent/'scanner-proof.json').write_text(json.dumps(result))
''')
scanner.chmod(0o700)
requests, proxy_hits, redirected_hits = [], [], []
mode = 'file_admin'

def encoded(value): return 'Basic ' + base64.b64encode(value.encode()).decode()
class Sink(BaseHTTPRequestHandler):
    def do_GET(self):
        redirected_hits.append(self.path); self.send_response(200); self.end_headers(); self.wfile.write(b'{}')
    def log_message(self,*args): pass
class Proxy(BaseHTTPRequestHandler):
    def do_GET(self):
        proxy_hits.append(self.path); self.send_response(502); self.end_headers()
    def log_message(self,*args): pass
class API(BaseHTTPRequestHandler):
    def do_GET(self):
        endpoint=urlsplit(self.path).path
        auth=self.headers.get('Authorization')
        requests.append({'endpoint':endpoint,'credential': 'admin' if auth==encoded('admin:ADMIN_CANARY') else 'reader' if auth==encoded('READER_CANARY:') else 'scan' if auth==encoded('SCAN_CANARY:') else 'none'})
        if endpoint.startswith('/redirect/'):
            code=int(endpoint.rsplit('/',1)[1]); self.send_response(code);self.send_header('Location',f'http://127.0.0.1:{sink.server_port}/landed');self.end_headers();return
        payload = {'status':'UP'}
        if endpoint=='/api/languages/list': payload={'languages':[{'key':'swift'}]}
        elif endpoint=='/api/ce/task': payload={'task':{'id':'current-task','componentKey':'fixture','status':'SUCCESS','analysisId':'current-analysis'}}
        elif endpoint=='/api/qualitygates/project_status': payload={'projectStatus':{'status':'OK'}}
        elif endpoint in ['/api/project_analyses/search','/api/measures/component']:
            required = encoded('READER_CANARY:') if mode=='explicit_reader' else encoded('admin:ADMIN_CANARY')
            if auth!=required: self.send_response(403);self.end_headers();return
            payload={'analyses':[{'key':'current-analysis'}]} if endpoint.endswith('/search') else {'component':{'measures':[{'metric':'ncloc','value':'1'},{'metric':'ncloc_language_distribution','value':'swift=1'}]}}
        self.send_response(200); self.send_header('Content-Type','application/json'); self.end_headers(); self.wfile.write(json.dumps(payload).encode())
    def log_message(self,*args): pass
servers=[]
for handler in [Sink, Proxy, API]:
    server=ThreadingHTTPServer(('127.0.0.1',0),handler);threading.Thread(target=server.serve_forever,daemon=True).start();servers.append(server)
sink, proxy, api_server = servers
host=f'http://127.0.0.1:{api_server.server_port}'
base_env={'PATH':str(root/'bin')+':/usr/bin:/bin','PROBE_BENIGN':'present','SONAR_TOKEN':'WRONG_INHERITED_TOKEN','PYTHONDONTWRITEBYTECODE':'1'}
results={'fixture':str(root),'runs':[]}
try:
    for mode in ['file_admin','explicit_reader','inherited_admin']:
        artifacts=root/mode; artifacts.mkdir(); env_file=root/(mode+'.env')
        values={token_variable('fixture'):'SCAN_CANARY','SONAR_LOCAL_ADMIN_PASSWORD':'ADMIN_CANARY','SONAR_LOCAL_PORT':str(api_server.server_port)}
        if mode=='explicit_reader': values[token_variable('fixture').replace('SONAR_LOCAL_TOKEN_V2_','SONAR_LOCAL_READ_TOKEN_V2_')]='READER_CANARY'
        write_env(env_file, values)
        inherited={}
        if mode=='inherited_admin': inherited={'SONAR_LOCAL_ADMIN_PASSWORD':'ADMIN_CANARY','SONAR_LOCAL_ADMIN_PENDING':'PENDING_CANARY','SONAR_LOCAL_DB_PASSWORD':'DB_CANARY','SONAR_LOCAL_READ_TOKEN_V2_00':'READER_CANARY','SONAR_LOCAL_TOKEN_V2_00':'OTHER_SCAN_CANARY'}
        start=len(requests);output=io.StringIO()
        args=SimpleNamespace(target=root,env_file=env_file,key='fixture',port=api_server.server_port,startup_timeout=1,timeout=1)
        with patch.dict(os.environ,{**base_env,**inherited},clear=True),contextlib.redirect_stdout(output): scan.run(args,artifacts)
        proof=json.loads((artifacts/'scanner-proof.json').read_text())
        assert proof=={'local_names':[], 'analysis_token_correct':True,'benign_marker_preserved':True,'secret_in_argv':False},proof
        assert 'CANARY' not in output.getvalue()
        calls=requests[start:];read_calls=[c for c in calls if c['endpoint'] in ['/api/project_analyses/search','/api/measures/component']]
        assert len(read_calls)==3 and all(c['credential']==('reader' if mode=='explicit_reader' else 'admin') for c in read_calls),calls
        assert all(c['credential']=='scan' for c in calls if c['endpoint'] in ['/api/languages/list','/api/ce/task','/api/qualitygates/project_status']),calls
        results['runs'].append({'mode':mode,'scanner':proof,'read_credential':read_calls[0]['credential'],'stdout_clean':True})
    results['redirects']=[]
    for status in [301,302,303,307,308]:
        for name,request in [('scan',lambda p:scan.api(host,p,('admin','ADMIN_CANARY'))),('bootstrap',lambda p:bootstrap.make_client(host)(p,auth=bootstrap.basic('ADMIN_CANARY')))]:
            try: request('/redirect/'+str(status))
            except (scan.ScanError,RuntimeError) as error:
                assert 'HTTP '+str(status) in str(error)
                assert 'CANARY' not in str(error)
                results['redirects'].append({'client':name,'status':status,'blocked':True})
            else: raise AssertionError((name,status,'redirect accepted'))
    assert redirected_hits==[],redirected_hits
    proxy_url=f'http://127.0.0.1:{proxy.server_port}'
    proxy_env={'http_proxy':proxy_url,'HTTP_PROXY':proxy_url,'https_proxy':proxy_url,'HTTPS_PROXY':proxy_url,'all_proxy':proxy_url,'ALL_PROXY':proxy_url,'no_proxy':'','NO_PROXY':''}
    with patch.dict(os.environ,proxy_env,clear=True):
        assert scan.api(host,'/api/system/status',('admin','ADMIN_CANARY'))['status']=='UP'
        assert bootstrap.make_client(host)('/api/system/status',auth=bootstrap.basic('ADMIN_CANARY'))['status']=='UP'
    assert proxy_hits==[],proxy_hits
    results['redirect_target_requests']=len(redirected_hits);results['proxy_requests']=len(proxy_hits);results['proxy_bypass_verified_for_both_clients']=True
finally:
    for server in servers: server.shutdown();server.server_close()
Path('/tmp/sonar-reader-final-results.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results,indent=2))
