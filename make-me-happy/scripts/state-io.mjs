/** Shared persistence and evidence identity. No workflow decisions here. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
export function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, data);
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}
export function writeJson(file, data) {
  atomicWrite(file, JSON.stringify(data, null, 2) + '\n');
}
export function withPackLock(dir, fn) {
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, '.writer-lock');
  const token = randomUUID(),
    ownerName = `owner-${process.pid}-${token}.json`;
  const prepared = `${lock}-${process.pid}-${token}`;
  // Publish a complete directory atomically. The unique owner filename also
  // makes stale recovery safe when several processes observe the same dead PID:
  // they can unlink only that dead owner's file, never a successor's ownership.
  fs.mkdirSync(prepared);
  try {
    writeJson(path.join(prepared, ownerName), { pid: process.pid, token });
    try {
      fs.renameSync(prepared, lock);
    } catch (e) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(e.code)) throw e;
      const owners = fs.readdirSync(lock).filter((f) => /^owner(?:-.*)?\.json$/.test(f));
      const name = owners.length === 1 ? owners[0] : null;
      const owner = name && readJson(path.join(lock, name));
      let alive = true;
      if (Number.isInteger(owner?.pid) && owner.pid > 1) {
        try {
          process.kill(owner.pid, 0);
        } catch (err) {
          alive = err.code !== 'ESRCH';
        }
      }
      if (alive) throw new Error(`pack writer busy: ${lock}; retry after the current writer finishes`);
      fs.rmSync(path.join(lock, name), { force: true });
      try {
        fs.renameSync(prepared, lock);
      } catch {
        throw new Error(`pack writer busy: ${lock}; another writer acquired it, retry`);
      }
    }
    try {
      return fn();
    } finally {
      if (fs.existsSync(path.join(lock, ownerName))) fs.rmSync(lock, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(prepared, { recursive: true, force: true });
  }
}
export function findRoot(dir) {
  let cur = path.resolve(dir);
  while (true) {
    if (fs.existsSync(path.join(cur, '.git'))) return cur;
    const up = path.dirname(cur);
    if (up === cur) return null;
    cur = up;
  }
}
const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
export function digest(value) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
const excluded = (file) =>
  /(^|\/)(\.git|\.worktrees|node_modules|\.venv|venv)(\/|$)/.test(file) ||
  file === 'docs/impl/make-me-happy' ||
  file.startsWith('docs/impl/make-me-happy/');

export function sourceRevision(root, outDir) {
  if (!root || !fs.existsSync(root))
    throw new Error('repository root is unavailable; set run-meta.repo_root');
  root = path.resolve(root);
  const r = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  let files = [];
  if (r.status === 0) files = r.stdout.split('\0').filter(Boolean);
  else {
    const walk = (rel = '') => {
      for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
        const p = rel ? `${rel}/${e.name}` : e.name;
        if (excluded(p) || (outDir && path.resolve(root, p) === path.resolve(outDir))) continue;
        if (e.isDirectory()) walk(p);
        else files.push(p);
      }
    };
    walk();
  }
  const hash = createHash('sha256');
  for (const file of [...new Set(files)].sort()) {
    const full = path.resolve(root, file);
    if (
      excluded(file) ||
      (outDir && (full === path.resolve(outDir) || full.startsWith(path.resolve(outDir) + path.sep)))
    )
      continue;
    hash.update(file + '\0');
    if (!fs.existsSync(full) && !fs.lstatSync(path.dirname(full), { throwIfNoEntry: false })) {
      hash.update('deleted\0');
      continue;
    }
    const stat = fs.lstatSync(full, { throwIfNoEntry: false });
    if (!stat) {
      hash.update('deleted\0');
      continue;
    }
    if (stat.isSymbolicLink()) hash.update('link\0' + fs.readlinkSync(full));
    else if (stat.isFile()) {
      hash.update(String(stat.mode & 0o111) + '\0');
      hash.update(fs.readFileSync(full));
    } else if (stat.isDirectory()) {
      // Gitlinks must not silently inherit stale evidence.
      const sub = spawnSync('git', ['status', '--porcelain'], { cwd: full, encoding: 'utf8' });
      const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: full, encoding: 'utf8' });
      hash.update(`gitlink:${head.stdout}:${sub.stdout}`);
    }
    hash.update('\0');
  }
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  return { head: head.status === 0 ? head.stdout.trim() : null, source_hash: hash.digest('hex') };
}
export function captureEvidence(dir) {
  const meta = readJson(path.join(dir, 'run-meta.json'), {});
  if (!meta.run_id) throw new Error('run_id missing; initialize/adopt this pack with run-meta.mjs');
  const tasks = readJson(path.join(dir, 'TASKS.json'), {}).tasks || [];
  const root = meta.repo_root || findRoot(dir);
  const specPath = meta.spec ? path.resolve(root, meta.spec) : null;
  const input = {
    tasks: tasks.map((t) =>
      Object.fromEntries(
        [
          'id',
          'title',
          'kind',
          'validation',
          'validation_reason',
          'refs',
          'depends_on',
          'acceptance',
          'worktree',
          'structural',
          'status',
          'tests_added',
          'red_green',
          'red',
          'green',
          'before',
          'after',
          'checks',
        ]
          .filter((k) => k in t)
          .map((k) => [k, t[k]]),
      ),
    ),
    payloads: readJson(path.join(dir, 'payloads.json')),
    arch: readJson(path.join(dir, 'hooks/arch-map.json')),
    spec: specPath ? { path: specPath, content: fs.readFileSync(specPath, 'utf8') } : null,
    ui_drive: meta.ui_drive,
    coverage_floor: meta.coverage_floor,
    test_cmd: meta.test_cmd,
  };
  return {
    run_id: meta.run_id,
    ...sourceRevision(root, dir),
    input_hash: digest(input),
    at: new Date().toISOString(),
  };
}
export function sameEvidence(a, b) {
  return (
    !!a && !!b && a.run_id === b.run_id && a.source_hash === b.source_hash && a.input_hash === b.input_hash
  );
}
export function attachEvidence(dir, doc, started) {
  const current = captureEvidence(dir);
  if (!sameEvidence(started, current))
    throw new Error('source or validation inputs changed during verification; rerun it');
  const { evidence: ignored, ...result } = doc;
  return { ...result, evidence: { ...current, result_hash: digest(result) } };
}
export function validEvidence(doc, current) {
  if (!doc || !sameEvidence(doc.evidence, current)) return false;
  const { evidence, ...result } = doc;
  return evidence.result_hash === digest(result);
}

// A closed run is historical. Later product changes do not reopen it, but editing
// its evidence invalidates the seal. A live close always verifies the current tree.
export function artifactIdentity(dir) {
  const names = [
    'TASKS.json',
    'payloads.json',
    'worktrees.json',
    'tests.json',
    'coverage.json',
    'immutability.json',
    'project-gates.json',
    'tracking.json',
  ];
  for (const folder of ['reviews', 'hooks']) {
    const p = path.join(dir, folder);
    if (fs.existsSync(p))
      for (const f of fs.readdirSync(p).sort())
        if (f.endsWith('.json') && f !== 'verdict.json') names.push(`${folder}/${f}`);
  }
  const meta = readJson(path.join(dir, 'run-meta.json'), {});
  return digest({
    config: Object.fromEntries(
      [
        'run_id',
        'repo_root',
        'spec',
        'spec_status',
        'ui_drive',
        'coverage_floor',
        'test_cmd',
        'worktree_prefix',
      ].map((k) => [k, meta[k]]),
    ),
    files: names.map((f) => [f, readJson(path.join(dir, f))]),
  });
}
export function validSeal(dir) {
  const meta = readJson(path.join(dir, 'run-meta.json'), {}),
    seal = readJson(path.join(dir, 'closure.json'));
  return meta.status === 'closed' &&
    seal?.run_id === meta.run_id &&
    seal?.artifact_hash === artifactIdentity(dir) &&
    seal?.closable === true
    ? seal
    : null;
}
