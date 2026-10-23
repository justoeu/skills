import json, os, shutil, subprocess, tempfile
from pathlib import Path
root=Path(tempfile.mkdtemp(prefix='sonar-xcresult-forward-',dir='/tmp')).resolve()
package=root/'ParcelPricing';original=Path('/private/tmp/sonar-swift-forward-03wtgr0n/ParcelPricing')
package.mkdir();shutil.copy2(original/'Package.swift',package/'Package.swift');shutil.copytree(original/'Sources',package/'Sources')
source=package/'Sources'/'ParcelPricing'/'DeliveryQuote.swift'
source.write_text(source.read_text().replace('_UNTESTED','').replace('_TESTED',''))
testdir=package/'Tests'/'ParcelPricingTests';testdir.mkdir(parents=True)
(testdir/'DeliveryQuoteTests.swift').write_text('''import Testing
@testable import ParcelPricing

@Test func memberDeliveryHasReducedFee() {
    #expect(DeliveryQuote.fee(items: 2, member: true) == 1)
}

@Test func bulkDeliveryHasTierFee() {
    #expect(DeliveryQuote.fee(items: 5, member: false) == 9)
}

@Test func ordinaryMonthHasNoCredit() {
    #expect(DeliveryQuote.seasonalCredit(month: 6) == 0)
}
''')
bundle=root/'Results.xcresult'
args=['xcodebuild','-scheme','ParcelPricing','-destination','platform=macOS','-derivedDataPath',str(root/'DerivedData'),'-enableCodeCoverage','YES','-resultBundlePath',str(bundle),'-disableAutomaticPackageResolution','-skipPackageUpdates','-parallel-testing-enabled','NO','CODE_SIGNING_ALLOWED=NO','test']
with (root/'xcodebuild.log').open('w') as stream:
    result=subprocess.run(args,cwd=package,stdout=stream,stderr=subprocess.STDOUT)
summary={'root':str(root),'package':str(package),'bundle':str(bundle),'command':args,'returncode':result.returncode}
Path('/tmp/sonar-xcresult-forward-current.json').write_text(json.dumps(summary,indent=2)+'\n')
(root/'build-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2),flush=True)
raise SystemExit(result.returncode)
