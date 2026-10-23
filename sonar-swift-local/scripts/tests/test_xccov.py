import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

SCRIPTS = Path(__file__).resolve().parents[1]


class XccovTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        (self.root/'Sources').mkdir()
        self.source = self.root/'Sources/App.swift'; self.source.write_text('func f() {}\n')

    def convert(self, data):
        report = self.root/'xccov.json'; report.write_text(json.dumps(data))
        return subprocess.run([sys.executable, str(SCRIPTS/'xccov-to-sonar.py'), str(report), str(self.root)], capture_output=True, text=True)

    def test_aliases_aggregate_and_preserve_uncovered_lines(self):
        alias = self.root/'alias'; alias.symlink_to(self.root/'Sources', target_is_directory=True)
        r = self.convert({str(self.source): [{'line':1,'isExecutable':True,'executionCount':0},{'line':2,'isExecutable':True,'executionCount':0},{'line':3,'isExecutable':False}], str(alias/'App.swift'):[{'line':1,'isExecutable':True,'executionCount':2}]})
        self.assertEqual(r.returncode,0,r.stderr)
        files=ET.fromstring(r.stdout).findall('file'); self.assertEqual(len(files),1)
        self.assertEqual(files[0].attrib['path'],'Sources/App.swift')
        self.assertEqual([x.attrib for x in files[0]],[{'lineNumber':'1','covered':'true'},{'lineNumber':'2','covered':'false'}])

    def test_external_and_empty_reports_do_not_claim_measurement(self):
        for data in [{}, {'/outside/App.swift':[{'line':1,'isExecutable':True,'executionCount':1}]}, {str(self.source):[{'line':1,'isExecutable':False}]}]:
            with self.subTest(data=data):
                r=self.convert(data);self.assertNotEqual(r.returncode,0);self.assertNotIn('<coverage',r.stdout)

    def test_invalid_schema_or_counts_do_not_publish_partial_report(self):
        valid={'line':1,'isExecutable':True,'executionCount':1}
        for row in [{'line':2,'isExecutable':True,'executionCount':-1},{'line':2,'isExecutable':True,'executionCount':True},{'line':False,'isExecutable':True,'executionCount':1},{'line':2,'isExecutable':'true','executionCount':1}]:
            with self.subTest(row=row):
                r=self.convert({str(self.source):[valid,row]});self.assertNotEqual(r.returncode,0);self.assertNotIn('<coverage',r.stdout)
        for value in [[], {str(self.source):{}}, {str(self.source):[None]}]:
            r=self.convert(value);self.assertNotEqual(r.returncode,0);self.assertNotIn('<coverage',r.stdout)


if __name__ == '__main__': unittest.main()
