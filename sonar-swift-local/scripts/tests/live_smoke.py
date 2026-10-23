#!/usr/bin/env python3
"""Opt-in smoke: disposable Docker project, real scanner, legacy-volume upgrade.

Run explicitly with --image <locally available sonar-apple image>.
Never touches the normal Compose project or its volumes. --coverage exercises
real SwiftPM tests, LLVM coverage and its import into both Sonar analyses.
"""
import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import uuid
import xml.etree.ElementTree as ET

SCRIPTS=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(SCRIPTS)); sys.dont_write_bytecode=True


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image',required=True)
    parser.add_argument('--postgres-image',default='postgres:17-alpine')
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--coverage',action='store_true',help='Require real SwiftPM coverage, including uncovered lines')
    parser.add_argument('--developer-dir',type=Path,help='Xcode Developer directory for this test only')
    args=parser.parse_args()
    identity='skill-sonar-test-'+uuid.uuid4().hex[:10]
    work=Path(tempfile.mkdtemp(prefix=identity+'-')).resolve()
    logs=work/'logs';logs.mkdir(); repo=work/'app';repo.mkdir()
    envfile=repo/'.env.sonar-local'
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    environment={**os.environ,'PYTHONDONTWRITEBYTECODE':'1','SONAR_LOCAL_PORT':str(port)}
    if args.developer_dir: environment['DEVELOPER_DIR']=str(args.developer_dir.resolve())
    images=[identity+':one',identity+':two']
    compose_base=['docker','compose','-p',identity,'--env-file',str(envfile),'-f',str(SCRIPTS.parent/'assets/compose.yaml')]
    records=[]
    def command(name,argv,cwd=None,timeout=360):
        r=subprocess.run(argv,cwd=cwd,env=environment,capture_output=True,text=True,timeout=timeout)
        (logs/(name+'.log')).write_text(r.stdout+r.stderr)
        records.append({'step':name,'exit':r.returncode})
        print(f'{name}: exit {r.returncode}',flush=True)
        if r.returncode: raise RuntimeError(name+' falhou; log '+str(logs/(name+'.log')))
        return r.stdout
    old=work/'old.json';new=work/'new.json'
    old.write_text(json.dumps({'services':{'postgres':{'image':args.postgres_image},'sonarqube':{'image':images[0],'volumes':['legacy_extensions:/opt/sonarqube/extensions']}},'volumes':{'legacy_extensions':{}}}))
    new.write_text(json.dumps({'services':{'postgres':{'image':args.postgres_image},'sonarqube':{'image':images[1]}}}))
    current=new
    coverage_proofs=[]
    def check_coverage(output):
        folder=next((line.removeprefix('Artefatos: ') for line in output.splitlines() if line.startswith('Artefatos: ')),None)
        if not folder: raise RuntimeError('Scan não informou artefatos para conferir cobertura.')
        folder=Path(folder)
        result=json.loads((folder/'result.json').read_text())
        xml=ET.parse(folder/'coverage.xml').getroot()
        lines=[line for file in xml.findall('file') if file.attrib['path'].startswith('Sources/') for line in file.findall('lineToCover')]
        covered=sum(line.attrib['covered']=='true' for line in lines)
        if not 0 < covered < len(lines): raise RuntimeError('Fixture precisa medir linhas cobertas e não cobertas.')
        expected=100*covered/len(lines)
        measured=result.get('coverage')
        if measured is None or abs(float(measured)-expected)>0.11:
            raise RuntimeError(f'Cobertura Sonar {measured} não corresponde ao LLVM {expected:.2f}%.')
        coverage_proofs.append({'analysis_id':result['analysis_id'],'lines':len(lines),'covered':covered,'expected_percent':round(expected,4),'sonar_percent':float(measured)})
    try:
        (repo/'Sources').mkdir();(repo/'Sources/App.swift').write_text('''import Foundation
public enum FixtureMath {
    public static func twice(_ value: Int) -> Int {
        return value * 2
    }
}
''')
        toolchain=None
        if args.coverage:
            toolchain=command('swift-version',['xcrun','swift','--version']).strip()
            command('xcode-version',['xcodebuild','-version'])
            (repo/'Package.swift').write_text('''// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "CoverageFixture", products: [.library(name: "FixtureMath", targets: ["FixtureMath"])], targets: [.target(name: "FixtureMath", path: "Sources"), .testTarget(name: "FixtureMathTests", dependencies: ["FixtureMath"], path: "Tests")])
''')
            (repo/'Sources/App.swift').write_text('''public enum FixtureMath {
    public static func twice(_ value: Int) -> Int {
        return value * 2
    }
    public static func sign(_ value: Int) -> Int {
        if value > 0 {
            return 1
        }
        if value < 0 {
            return -1
        }
        return 0
    }
}
''')
            (repo/'Tests').mkdir()
            (repo/'Tests/FixtureMathTests.swift').write_text('''import XCTest
@testable import FixtureMath
final class FixtureMathTests: XCTestCase {
    func testTwice() { XCTAssertEqual(FixtureMath.twice(3), 6) }
    func testPositive() { XCTAssertEqual(FixtureMath.sign(2), 1) }
}
''')
        (repo/'.gitignore').write_text('.env.sonar-local*\n.scannerwork/\n')
        for n,gitargs in enumerate([['init','-b','main'],['config','user.name','Skill Fixture'],['config','user.email','fixture@example.invalid'],['add','.'],['commit','-m','fixture']]):
            command('git-'+str(n),['git',*gitargs],repo)
        command('bootstrap-db',[sys.executable,str(SCRIPTS/'bootstrap.py'),'--project-key','harness-smoke','--env-file',str(envfile),'--port',str(port)])
        for idx,image in enumerate(images):
            (work/'.dockerignore').write_text('*\n!Dockerfile\n')
            (work/'Dockerfile').write_text('FROM '+args.image+'\nUSER root\nRUN printf '+str(idx+1)+' > /opt/sonarqube/extensions/skill-upgrade-marker\nUSER 1000\n')
            command('image-'+str(idx+1),['docker','build','--pull=false','-t',image,str(work)])
        current=old
        command('start-legacy',compose_base+['-f',str(old),'up','-d','--no-build','--wait','--wait-timeout','240'])
        command('bootstrap-project',[sys.executable,str(SCRIPTS/'bootstrap.py'),'--project-key','harness-smoke','--env-file',str(envfile)])
        command('bootstrap-idempotent',[sys.executable,str(SCRIPTS/'bootstrap.py'),'--project-key','harness-smoke','--env-file',str(envfile)])
        scan_args=['bash',str(SCRIPTS/'scan.sh'),str(repo),'--key','harness-smoke','--keep-artifacts']
        first=command('scan-before-upgrade',scan_args)
        if args.coverage: check_coverage(first)
        current=new
        command('upgrade',compose_base+['-f',str(new),'up','-d','--no-build','--force-recreate','--renew-anon-volumes','--wait','--wait-timeout','240'])
        marker=command('marker',compose_base+['-f',str(new),'exec','-T','sonarqube','cat','/opt/sonarqube/extensions/skill-upgrade-marker']).strip()
        if marker!='2': raise RuntimeError('Volume antigo ocultou conteúdo da imagem nova.')
        second=command('scan-after-upgrade',scan_args)
        if args.coverage:
            check_coverage(second)
            if coverage_proofs[0]['analysis_id']==coverage_proofs[1]['analysis_id']: raise RuntimeError('Upgrade reutilizou identidade de análise anterior.')
        plugin=command('plugin-checksum',compose_base+['-f',str(new),'exec','-T','sonarqube','sh','-c','sha256sum /opt/sonarqube/extensions/plugins/sonar-apple-plugin-*.jar']).strip()
        proof={'status':'passed','steps':records,'image_base':args.image,'plugin_checksum':plugin,'upgrade_marker':marker,'before':first,'after':second,'toolchain':toolchain,'coverage':coverage_proofs,'limits':['Cobertura SwiftPM real via LLVM; não usa .xcresult de um projeto Xcode.' if args.coverage else 'Sem Package.swift/Xcode: cobertura real não exercitada.','Imagem derivada usa o mesmo plugin; upgrade prova visibilidade de conteúdo e persistência de dados, não compatibilidade de uma nova versão do plugin.']}
        args.output.write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n')
        print('Evidência: '+str(args.output),flush=True)
    except Exception as error:
        args.output.write_text(json.dumps({'status':'failed','steps':records,'error':str(error),'logs':str(logs)},ensure_ascii=False,indent=2)+'\n')
        print(str(error),file=sys.stderr); return 1
    finally:
        # Only resources under this newly generated test project are removed.
        diagnostic=subprocess.run(compose_base+['-f',str(current),'logs','--no-color','--tail','180'],env=environment,capture_output=True,text=True,timeout=30)
        (logs/'containers.log').write_text(diagnostic.stdout+diagnostic.stderr)
        subprocess.run(compose_base+['-f',str(current),'down','-v','--remove-orphans'],env=environment,capture_output=True,timeout=120)
        subprocess.run(['docker','volume','rm',identity+'_legacy_extensions'],capture_output=True,timeout=30)
        for image in images: subprocess.run(['docker','image','rm',image],capture_output=True,timeout=30)
        print('Logs locais preservados em '+str(logs),flush=True)
    return 0


if __name__=='__main__':sys.exit(main())
