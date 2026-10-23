"""Offline regression tests. All credentials and projects are disposable fixtures."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module
boot = load('bootstrap', 'bootstrap.py')


class BootstrapTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.env = Path(self.tmp.name) / 'local.env'
        boot.write_env(self.env, {'SONAR_LOCAL_DB_PASSWORD': 'fixture-db'})
        self.password = 'admin'; self.generated = []; self.auths = []

    def api(self, host):
        def request(path, data=None, auth=None):
            if path == '/api/authentication/validate':
                return {'valid': auth == boot.basic(self.password) or auth in self.auths}
            if path == '/api/users/change_password':
                if data['previousPassword'] != self.password: raise RuntimeError('API HTTP 401')
                self.password = data['password']; return {}
            if path.startswith('/api/projects/search'): return {'components': [{'key': 'fixture'}]}
            if path == '/api/user_tokens/search': return {'userTokens': []}
            if path == '/api/user_tokens/generate':
                self.generated.append(data['projectKey'])
                token = 'synthetic-' + data['projectKey']
                self.auths.append(boot.base64.b64encode((token + ':').encode()).decode())
                return {'token': token}
            raise AssertionError(path)
        return request

    def invoke(self, key='fixture'):
        with patch.object(boot, 'make_client', self.api), patch.object(sys, 'argv', ['bootstrap', '--project-key', key, '--env-file', str(self.env)]), contextlib.redirect_stdout(io.StringIO()):
            return boot.main()

    def test_recovers_password_changed_before_final_write(self):
        original = boot.write_env
        def interrupted(path, values):
            if 'SONAR_LOCAL_ADMIN_PASSWORD' in values and 'SONAR_LOCAL_ADMIN_PENDING' not in values:
                raise OSError('simulated persistence failure')
            return original(path, values)
        with patch.object(boot, 'write_env', interrupted):
            with self.assertRaises(OSError): self.invoke()
        self.assertNotEqual(self.password, 'admin')
        self.assertEqual(self.invoke(), 0)
        self.assertEqual(boot.read_env(self.env)['SONAR_LOCAL_ADMIN_PASSWORD'], self.password)

    def test_colliding_project_keys_generate_distinct_tokens(self):
        self.password = 'fixture-admin'
        boot.write_env(self.env, {'SONAR_LOCAL_DB_PASSWORD':'fixture-db','SONAR_LOCAL_ADMIN_PASSWORD':self.password,'SONAR_LOCAL_TOKEN_APP_A':'legacy-token'})
        self.invoke('app-a'); self.invoke('app.a')
        self.assertEqual(self.generated, ['app-a', 'app.a'])
        tokens = [v for k,v in boot.read_env(self.env).items() if k.startswith('SONAR_LOCAL_TOKEN_V2_')]
        self.assertEqual(len(tokens), 2)

    def test_retry_reuses_valid_token_and_creates_case_distinct_key(self):
        self.invoke('app-a'); self.invoke('app-a'); self.invoke('APP-A')
        self.assertEqual(self.generated, ['app-a', 'APP-A'])

    def test_failure_before_pending_write_does_not_change_remote_password(self):
        with patch.object(boot, 'write_env', side_effect=OSError('disk failure')):
            with self.assertRaises(OSError): self.invoke()
        self.assertEqual(self.password, 'admin')
        self.assertEqual(self.invoke(),0)

    def test_file_created_private_before_replace_and_old_survives_failure(self):
        target = self.env.parent / 'new.env'
        modes=[]; original=Path.write_text
        def observe(path, *args, **kwargs):
            result=original(path,*args,**kwargs)
            if path == target: modes.append(stat.S_IMODE(path.stat().st_mode))
            return result
        old=os.umask(0o022)
        try:
            with patch.object(Path, 'write_text', observe): boot.write_env(target, {'SECRET':'fixture'})
        finally: os.umask(old)
        self.assertTrue(all(mode == 0o600 for mode in modes), modes)
        self.assertEqual(stat.S_IMODE(target.stat().st_mode),0o600)
        with patch('os.replace', side_effect=OSError('simulated rename failure')):
            with self.assertRaises(OSError): boot.write_env(target, {'SECRET':'changed'})
        self.assertEqual(boot.read_env(target)['SECRET'],'fixture')

    def test_lock_serializes_real_process_updates(self):
        boot.write_env(self.env, {'COUNTER':'0'})
        code='''import sys,time
sys.path.insert(0,sys.argv[1])
from pathlib import Path
from local_config import config_lock,read_env,write_env
p=Path(sys.argv[2])
for _ in range(4):
 with config_lock(p):
  values=read_env(p);time.sleep(0.01)
  values['COUNTER']=str(int(values['COUNTER'])+1);write_env(p,values)
'''
        processes=[subprocess.Popen([sys.executable,'-B','-c',code,str(SCRIPTS),str(self.env)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True) for _ in range(2)]
        for process in processes:
            output,errors=process.communicate(timeout=10);self.assertEqual(process.returncode,0,errors)
        self.assertEqual(boot.read_env(self.env)['COUNTER'],'8')


class CoverageTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.base=Path(self.tmp.name).resolve(); (self.base/'Sources').mkdir()
        (self.base/'Sources/App.swift').write_text('let value = 1\n')

    def convert(self, sf=None, records='DA:1,3'):
        file=self.base/'input.lcov'
        file.write_text(f'SF:{sf or self.base / "Sources/App.swift"}\n{records}\nend_of_record\n')
        return subprocess.run([sys.executable,str(SCRIPTS/'lcov-to-sonar.py'),str(file),str(self.base)],capture_output=True,text=True)

    def test_checksum_and_duplicate_lines(self):
        r=self.convert(records='DA:1,3,checksum\nDA:1,0,checksum')
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertEqual(r.stdout.count('<lineToCover'),1)
        self.assertIn('covered="true"',r.stdout)

    def test_symlink_alias_is_normalized(self):
        alias=self.base/'alias'; alias.symlink_to(self.base/'Sources',target_is_directory=True)
        r=self.convert(sf=alias/'App.swift')
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertIn('path="Sources/App.swift"',r.stdout)

    def test_canonical_and_alias_records_merge_into_one_file(self):
        alias=self.base/'alias';alias.symlink_to(self.base/'Sources',target_is_directory=True)
        records='DA:1,3\nend_of_record\nSF:'+str(alias/'App.swift')+'\nDA:1,0'
        r=self.convert(records=records)
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertEqual(r.stdout.count('<file '),1)
        self.assertEqual(r.stdout.count('<lineToCover '),1)
        self.assertIn('covered="true"',r.stdout)

    def test_no_valid_lines_is_failure(self):
        r=self.convert(records='DA:bad,not-a-number')
        self.assertNotEqual(r.returncode,0)

    def test_external_file_still_rejected(self):
        r=self.convert(sf=self.base.parent/'outside.swift')
        self.assertNotEqual(r.returncode,0)

if __name__ == '__main__': unittest.main()
