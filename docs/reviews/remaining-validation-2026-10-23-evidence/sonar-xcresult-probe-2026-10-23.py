from pathlib import Path
import sys,os,json,subprocess,tempfile,socket,uuid,hashlib
sys.path.insert(0,'~/Developer/harness/skills/sonar-swift-local/scripts')
from local_config import read_env,token_variable
import scan
scripts=Path(scan.__file__).parent
fixture=json.loads(Path('/tmp/skills-swift-coverage-path.json').read_text())
repo=Path(fixture['repo']);bundle=Path(fixture['root'])/'Coverage.xcresult'
work=Path(tempfile.mkdtemp(prefix='sonar-xcresult-smoke-')).resolve();envfile=work/'env';project='skill-xcresult-'+uuid.uuid4().hex[:10];key='xcresult-smoke'
with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
env={**os.environ,'DEVELOPER_DIR':'/Applications/Xcode.app/Contents/Developer','SONAR_LOCAL_PORT':str(port),'PYTHONDONTWRITEBYTECODE':'1'}
override=work/'compose.json';override.write_text(json.dumps({'services':{'postgres':{'image':'postgres:17.11-alpine3.24'},'sonarqube':{'image':'sonarqube-swift:26.9.0.129388-apple0.5.1'}}}))
compose=['docker','compose','-p',project,'--env-file',str(envfile),'-f',str(scripts.parent/'assets/compose.yaml'),'-f',str(override)]
records=[];output=Path('/tmp/sonar-xcresult-live-2026-10-23.json');before=hashlib.sha256((repo/'Sources/FixtureMath/FixtureMath.swift').read_bytes()).hexdigest()
def run(name,args,cwd=None,environment=env):
 with (work/(name+'.log')).open('w') as log:r=subprocess.run(args,cwd=cwd,env=environment,stdout=log,stderr=subprocess.STDOUT,timeout=360)
 records.append({'step':name,'exit':r.returncode});print(name,r.returncode,flush=True)
 if r.returncode:raise RuntimeError(name+' failed; logs '+str(work))
try:
 run('bootstrap-db',[sys.executable,str(scripts/'bootstrap.py'),'--project-key',key,'--env-file',str(envfile)])
 run('start',compose+['up','-d','--no-build','--wait','--wait-timeout','240'])
 run('bootstrap-project',[sys.executable,str(scripts/'bootstrap.py'),'--project-key',key,'--env-file',str(envfile)])
 values=read_env(envfile);token=values[token_variable(key)];host=f'http://127.0.0.1:{port}'
 scanner_env={k:v for k,v in env.items() if not k.startswith('SONAR_LOCAL_')};scanner_env['SONAR_TOKEN']=token
 metadata=work/'report-task.txt'
 run('scanner',['bash',str(scripts/'scan.sh'),str(repo),'--key',key,'--env-file',str(envfile),'--xcresult',str(bundle),'--keep-artifacts'],repo,env)
 stdout=(work/'scanner.log').read_text()
 artifacts=Path(next(line.removeprefix('Artefatos: ') for line in stdout.splitlines() if line.startswith('Artefatos: ')))
 meta=dict(l.split('=',1) for l in (artifacts/'report-task.txt').read_text().splitlines() if '=' in l)
 analysis=scan.wait_analysis(host,token,meta['ceTaskId'],key,120)
 reader=('admin',values['SONAR_LOCAL_ADMIN_PASSWORD']);size,cov=scan.current_metrics(host,reader,key,analysis,{'swift'},True)
 expected=next(t['lineCoverage']*100 for t in json.loads((Path(fixture['root'])/'xccov-report.json').read_text())['targets'] if t['name']=='FixtureMath')
 if abs(float(cov)-expected)>0.11:raise RuntimeError('Imported coverage differs from xccov')
 if hashlib.sha256((repo/'Sources/FixtureMath/FixtureMath.swift').read_bytes()).hexdigest()!=before:raise RuntimeError('Source changed')
 proof={'status':'passed','analysis_id':analysis,'ncloc':size,'coverage':float(cov),'xccov_percent':expected,'steps':records,'source_sha256':before,'logs':str(work),'limit':'Real xcodebuild xcresult imported through canonicalized xccov Generic Coverage; minimal Swift package, not production iOS app.'}
 output.write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps(proof,indent=2))
except Exception as e:
 output.write_text(json.dumps({'status':'failed','error':str(e),'steps':records,'logs':str(work)},indent=2)+'\n');raise
finally:
 subprocess.run(compose+['down','-v','--remove-orphans'],env=env,capture_output=True,timeout=120)
