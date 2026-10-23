import contextlib, hashlib, io, json, subprocess, sys, xml.etree.ElementTree as ET
from pathlib import Path
from unittest.mock import patch
sys.dont_write_bytecode=True
scripts=Path('~/Developer/harness/skills/sonar-swift-local/scripts')
sys.path.insert(0,str(scripts));import scan
summary=json.loads(Path('/tmp/sonar-xcresult-forward-current.json').read_text())
root=Path(summary['root']);package=Path(summary['package']);bundle=Path(summary['bundle'])

def digest_tree(path):
    digest=hashlib.sha256()
    for file in sorted(p for p in path.rglob('*') if p.is_file()):
        digest.update(str(file.relative_to(path)).encode());digest.update(file.read_bytes())
    return digest.hexdigest()

before=digest_tree(bundle)
artifacts=root/'conversion';artifacts.mkdir(exist_ok=True)
actual_run=subprocess.run;calls=[]
def tracked_run(args,*a,**kw):
    calls.append([str(v) for v in args]);return actual_run(args,*a,**kw)
output=io.StringIO()
with patch.object(scan.subprocess,'run',tracked_run),contextlib.redirect_stdout(output):
    xml_path=scan.coverage(package,artifacts,bundle)
assert len(calls)==2 and calls[0][0:3]==['xcrun','xccov','view'] and calls[1][1].endswith('xccov-to-sonar.py'),calls
assert before==digest_tree(bundle),'bundle mutated'
assert not (artifacts/'swift-build').exists()
raw=json.loads((artifacts/'xccov.json').read_text())
expected={}
for filename,lines in raw.items():
    absolute=Path(filename).resolve()
    if not absolute.is_relative_to(package):continue
    rel=str(absolute.relative_to(package));target=expected.setdefault(rel,{})
    for row in lines:
        if row['isExecutable']:target[row['line']]=target.get(row['line'],False) or row['executionCount']>0
expected={name:lines for name,lines in expected.items() if lines}
xml=ET.parse(xml_path).getroot()
observed={f.attrib['path']:{int(row.attrib['lineNumber']):row.attrib['covered']=='true' for row in f} for f in xml}
assert observed==expected,(observed,expected)
source=package/'Sources'/'ParcelPricing'/'DeliveryQuote.swift'
source_rows=next(rows for name,rows in raw.items() if Path(name).resolve()==source)
hits={row['line']:row['executionCount'] for row in source_rows if row['isExecutable']}
source_xml=observed[str(source.relative_to(package))];markers={}
for number,line in enumerate(source.read_text().splitlines(),1):
    if '// ' not in line:continue
    marker=line.split('// ',1)[1];should_hit=marker in {'MEMBER','BULK','SEASON_DEFAULT'}
    assert (hits[number]>0)==should_hit,(marker,hits[number]);assert source_xml[number]==should_hit
    markers[marker]={'line':number,'hits':hits[number],'covered':source_xml[number]}
invalids=[]
(root/'fake-file.xcresult').write_text('synthetic invalid bundle')
(root/'wrong-extension').mkdir(exist_ok=True);(root/'empty.xcresult').mkdir(exist_ok=True)
outsider=root/'UnrelatedCheckout';outsider.mkdir(exist_ok=True)
for name,target,invalid in [('missing',package,root/'missing.xcresult'),('file',package,root/'fake-file.xcresult'),('wrong_extension',package,root/'wrong-extension'),('empty_bundle',package,root/'empty.xcresult'),('other_checkout',outsider,bundle)]:
    folder=root/('invalid-'+name);folder.mkdir(exist_ok=True)
    try: scan.coverage(target,folder,invalid)
    except scan.ScanError as error:
        assert not (folder/'coverage.xml').exists() or '<coverage' not in (folder/'coverage.xml').read_text()
        invalids.append({'case':name,'rejected':True,'message':str(error)})
    else:raise AssertionError('accepted '+name)
# A malformed standalone report must not emit a partial document.
invalid_json=root/'invalid-xccov.json'
invalid_json.write_text(json.dumps({str(source):[{'line':7,'isExecutable':True,'executionCount':1},{'line':10,'isExecutable':True,'executionCount':-1}]}))
r=actual_run([sys.executable,str(scripts/'xccov-to-sonar.py'),str(invalid_json),str(package)],capture_output=True,text=True)
assert r.returncode!=0 and '<coverage' not in r.stdout
report=actual_run(['xcrun','xccov','view','--report','--json',str(bundle)],capture_output=True,text=True,check=True)
(root/'xccov-report.json').write_text(report.stdout)
summary.update({'source_executable_lines':len(hits),'source_covered_lines':sum(x>0 for x in hits.values()),'xml_matches_xccov':True,'xml_files':sorted(observed),'markers':markers,'bundle_unchanged':before==digest_tree(bundle),'coverage_subprocesses':calls,'invalid_cases':invalids,'malformed_json_rejected_without_partial_xml':True,'helper_stdout':output.getvalue()})
(root/'verification-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
Path('/tmp/sonar-xcresult-forward-current.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
