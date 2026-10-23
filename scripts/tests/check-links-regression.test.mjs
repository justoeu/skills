import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auditRoot, fixDrift, ensureSkill, runCheck } from '../check-links.mjs';

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'links-regression-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'canonical'), host = path.join(base, 'host');
  fs.mkdirSync(host);
  for (const name of ['alpha', 'beta', 'make-me-happy']) {
    fs.mkdirSync(path.join(repo, name), { recursive: true });
    fs.writeFileSync(path.join(repo, name, 'SKILL.md'), `canonical ${name}`);
  }
  return { base, repo, host };
}

test('TL-01: divergent bytes survive --fix in a retained backup', t => {
  const { repo, host } = fixture(t), entry = path.join(host, 'alpha');
  fs.mkdirSync(entry); fs.writeFileSync(path.join(entry, 'SKILL.md'), 'unique local editing');
  const r = fixDrift(host, 'alpha', repo);
  assert.equal(r.fixed, true);
  assert.equal(fs.realpathSync(entry), fs.realpathSync(path.join(repo, 'alpha')));
  assert.ok(r.backup, 'caller must be told where the preserved copy lives');
  assert.equal(fs.readFileSync(path.join(r.backup, 'SKILL.md'), 'utf8'), 'unique local editing');
  assert.ok(path.relative(host,r.backup).startsWith('..'), 'backup must be outside the skill discovery root');
  assert.deepEqual(fs.readdirSync(host),['alpha']);
});

test('TL-01: failed symlink creation restores original copy', t => {
  const { repo, host } = fixture(t), entry = path.join(host, 'alpha');
  fs.mkdirSync(entry); fs.writeFileSync(path.join(entry, 'SKILL.md'), 'must survive');
  const original = fs.symlinkSync;
  fs.symlinkSync = () => { throw Object.assign(new Error('simulated create failure'), {code:'EACCES'}); };
  let r;
  try { r = fixDrift(host, 'alpha', repo); } finally { fs.symlinkSync = original; }
  assert.equal(r.fixed, false);
  assert.equal(fs.readFileSync(path.join(entry, 'SKILL.md'), 'utf8'), 'must survive');
});

test('TL-01: symlink content in a copied skill is preserved without following it', t => {
  const { repo, host, base } = fixture(t), entry = path.join(host, 'alpha');
  const privateFile=path.join(base, 'local.txt'); fs.writeFileSync(privateFile, 'local target');
  fs.mkdirSync(entry); fs.symlinkSync(privateFile, path.join(entry, 'SKILL.md'));
  const r=fixDrift(host, 'alpha', repo);
  assert.equal(r.fixed,true);
  assert.equal(fs.readlinkSync(path.join(r.backup,'SKILL.md')), privateFile);
  assert.equal(fs.readFileSync(privateFile,'utf8'),'local target');
});

test('TL-02: another skill inside the same harness is rejected', t => {
  const { repo, host }=fixture(t);
  fs.symlinkSync(path.join(repo,'beta'),path.join(host,'alpha'));
  assert.equal(auditRoot(host,['alpha'],repo)[0].level,'WARN');
});

test('TL-02: aliases must point to the exact canonical skill', t => {
  const { repo, host }=fixture(t);
  fs.symlinkSync(path.join(repo,'beta'),path.join(host,'mmh'));
  assert.equal(runCheck({roots:[host],repo}).findings.find(x=>x.skill==='mmh')?.level,'WARN');
});

test('TL-03: dangling symlink diagnosed and ensure refuses safely', t => {
  const { repo, host, base }=fixture(t), entry=path.join(host,'alpha');
  fs.symlinkSync(path.join(base,'missing'),entry);
  assert.equal(auditRoot(host,['alpha'],repo)[0].level,'WARN');
  const r=ensureSkill(host,'alpha',repo);
  assert.equal(r.created,false); assert.ok(r.reason);
  assert.equal(fs.readlinkSync(entry),path.join(base,'missing'));
});

test('TL-03: legacy markdown does not crash or get overwritten by ensure', t => {
  const { repo, host }=fixture(t);
  fs.writeFileSync(path.join(host,'alpha.md'),'legacy content');
  const findings=auditRoot(host,['alpha','beta'],repo);
  assert.equal(findings.find(x=>x.skill==='alpha').level,'DRIFT');
  const r=ensureSkill(host,'alpha',repo);
  assert.equal(r.created,false); assert.ok(r.reason);
  assert.equal(fs.readFileSync(path.join(host,'alpha.md'),'utf8'),'legacy content');
  assert.equal(fs.existsSync(path.join(host,'alpha')),false);
});
