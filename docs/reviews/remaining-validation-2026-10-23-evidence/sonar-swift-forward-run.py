from pathlib import Path
import contextlib, io, json, subprocess, sys, tempfile, xml.etree.ElementTree as ET
sys.dont_write_bytecode = True
sys.path.insert(0, '~/Developer/harness/skills/sonar-swift-local/scripts')
import scan
root=Path(tempfile.mkdtemp(prefix='sonar-swift-forward-',dir='/tmp')).resolve()
package=root/'ParcelPricing'
(package/'Sources'/'ParcelPricing').mkdir(parents=True)
(package/'Tests'/'ParcelPricingTests').mkdir(parents=True)
(package/'Package.swift').write_text('''// swift-tools-version: 6.0
import PackageDescription
let package = Package(
    name: "ParcelPricing",
    platforms: [.macOS(.v13)],
    products: [.library(name: "ParcelPricing", targets: ["ParcelPricing"])],
    targets: [
        .target(name: "ParcelPricing"),
        .testTarget(name: "ParcelPricingTests", dependencies: ["ParcelPricing"])
    ]
)
''')
source=package/'Sources'/'ParcelPricing'/'DeliveryQuote.swift'
source.write_text('''public enum DeliveryQuote {
    public static func fee(items: Int, member: Bool) -> Int {
        if items <= 0 {
            return 0 // EMPTY_UNTESTED
        }
        if member {
            return 1 // MEMBER_TESTED
        }
        if items >= 4 {
            return 9 // BULK_UNTESTED
        }
        return 4 // STANDARD_TESTED
    }

    public static func seasonalCredit(month: Int) -> Int {
        if month == 12 {
            return 3 // SEASON_UNTESTED
        }
        return 0 // SEASON_DEFAULT_UNTESTED
    }
}
''')
(package/'Tests'/'ParcelPricingTests'/'DeliveryQuoteTests.swift').write_text('''import Testing
@testable import ParcelPricing

@Test func memberDeliveryHasReducedFee() {
    #expect(DeliveryQuote.fee(items: 2, member: true) == 1)
}

@Test func smallStandardDeliveryHasRegularFee() {
    #expect(DeliveryQuote.fee(items: 2, member: false) == 4)
}
''')
artifacts=root/'artifacts';artifacts.mkdir()
output=io.StringIO()
with contextlib.redirect_stdout(output): result=scan.coverage(package,artifacts)
(root/'coverage-helper.stdout').write_text(output.getvalue())
summary={'root':str(root),'package':str(package),'artifacts':str(artifacts),'coverage_result':str(result) if result else None,'helper_stdout':output.getvalue()}
(root/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
Path('/tmp/sonar-swift-forward-current.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2),flush=True)
if result is None: sys.exit(1)
# Parse raw compiler LCOV independently; no production parser imported here.
records={};current=None
for row in (artifacts/'coverage.lcov').read_text().splitlines():
    if row.startswith('SF:'):current=row[3:];records.setdefault(current,{})
    elif row.startswith('DA:'):
        line,count=map(int,row[3:].split(',')[:2]);records[current][line]=records[current].get(line,0)+count
    elif row=='end_of_record':current=None
xml=ET.parse(result).getroot()
xml_records={element.attrib['path']:{int(line.attrib['lineNumber']):line.attrib['covered']=='true' for line in element} for element in xml}
expected={}
for path,lines in records.items():
    absolute=Path(path).resolve()
    if absolute.is_relative_to(package):
        key=str(absolute.relative_to(package));combined=expected.setdefault(key,{})
        for line,hits in lines.items():combined[line]=combined.get(line,False) or hits>0
assert xml_records==expected,(xml_records,expected)
relative=str(source.relative_to(package));source_lcov=records[str(source)];source_xml=xml_records[relative]
markers={}
for number,text in enumerate(source.read_text().splitlines(),1):
    if '// ' not in text:continue
    marker=text.split('// ',1)[1];expected_hit=marker.endswith('_TESTED')
    assert (source_lcov[number]>0)==expected_hit,(marker,number,source_lcov[number])
    assert source_xml[number]==expected_hit,(marker,number,source_xml[number])
    markers[marker]={'line':number,'lcov_hits':source_lcov[number],'xml_covered':source_xml[number]}
profiles=list((artifacts/'swift-build').rglob('default.profdata'))
bundles=list((artifacts/'swift-build').rglob('*PackageTests.xctest'))
binary=bundles[0]/'Contents'/'MacOS'/bundles[0].stem
report=subprocess.run(['xcrun','llvm-cov','report',str(binary),'-instr-profile='+str(profiles[0]),str(source)],capture_output=True,text=True,check=True)
(artifacts/'llvm-cov-report.txt').write_text(report.stdout+report.stderr)
summary.update({'markers':markers,'xml_records_match_lcov':True,'source_executable_lines':len(source_lcov),'source_covered_lines':sum(v>0 for v in source_lcov.values()),'xml_files':sorted(xml_records),'profiles':len(profiles),'test_bundles':len(bundles)})
(root/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
Path('/tmp/sonar-swift-forward-current.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2),flush=True)
print(report.stdout)
