import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
const testArgs = ['--test', '--test-reporter=tap', 'test/cart.test.mjs'];
const testCmd = [process.execPath, ...testArgs].map(quote).join(' ');

test('real Node/Git workflow closes two task modes, preserves history and starts a distinct run', { timeout: 120_000 }, (t) => {
  const root = fs.realpathSync(fs.mkdtempSync('/tmp/mmh-forward-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT; // Fixture suites are independent Node test runs.
  const write = (file, body) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body, null, 2) + '\n');
  };
  const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
  const run = (exe, args, { cwd = root, fails = false } = {}) => {
    const result = spawnSync(exe, args.map(String), { cwd, env: childEnv, encoding: 'utf8', timeout: 30_000 });
    const output = (result.stdout || '') + (result.stderr || '');
    if (fails) assert.notEqual(result.status, 0, `Expected failure: ${exe} ${args.join(' ')}\n${output}`);
    else assert.equal(result.status, 0, `${exe} ${args.join(' ')}\n${output}`);
    return output;
  };
  const helper = (script, args, options) => run(process.execPath, [path.join(scripts, script), ...args], options);
  const git = (args, cwd = root) => run('git', args, { cwd }).trim();
  const product = (rel, body) => write(path.join(root, rel), body);
  const baseline = 'export function subtotal(items) {\n  return items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);\n}\n';
  const finalCode = baseline + '\nexport function total(items) {\n  const amount = subtotal(items);\n  return items.length === 0 || amount >= 10000 ? amount : amount + 1500;\n}\n';
  const oldTests = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as cart from '../src/cart.mjs';
test('empty subtotal remains zero', () => assert.equal(cart.subtotal([]), 0));
test('subtotal multiplies quantities', () => assert.equal(cart.subtotal([{ priceCents: 250, quantity: 3 }]), 750));
test('subtotal does not mutate items', () => assert.equal(cart.subtotal(Object.freeze([Object.freeze({ priceCents: 100, quantity: 2 })])), 200));
`;
  const newTests = `test('empty total is zero', () => assert.equal(cart.total([]), 0));
test('below shipping threshold', () => assert.equal(cart.total([{ priceCents: 9999, quantity: 1 }]), 11499));
test('at shipping threshold', () => assert.equal(cart.total([{ priceCents: 5000, quantity: 2 }]), 10000));
test('above shipping threshold', () => assert.equal(cart.total([{ priceCents: 10001, quantity: 1 }]), 10001));
`;
  git(['init', '-b', 'feature/cart']);
  git(['config', 'user.name', 'Workflow fixture']);
  git(['config', 'user.email', 'fixture@example.invalid']);
  product('.gitignore', 'coverage/\n');
  product('package.json', { name: 'cart', private: true, type: 'module' });
  product('AGENTS.md', 'Use Node built-ins and integer cents. Validate with Node tests and coverage. No project tracking checklist.\n');
  product('src/cart.mjs', baseline);
  product('test/cart.test.mjs', oldTests);
  product('README.md', '# Cart\n\nsubtotal(items) sums integer cents.\n');
  product('docs/cart-spec.md', '# Cart total\nRF-1: For valid rows with nonnegative integer priceCents and positive integer quantity, total adds 1500 cents shipping below 10000; shipping is free at or above 10000. Empty cart returns zero. Preserve subtotal.\nRF-2: Document total with a runnable example. No new dependencies or other API.\n');
  git(['add', '.']);
  git(['commit', '-m', 'test fixture baseline']);
  assert.match(run(process.execPath, testArgs), /# pass 3\b/);

  const initArgs = ['init', '--root', root, '--spec', path.join(root, 'docs/cart-spec.md'), '--kind', 'feature', '--worktree', '2', '--ui-drive', 'fast', '--test-cmd', testCmd];
  const first = JSON.parse(helper('run-meta.mjs', initArgs));
  const out = first.dir;
  const pack = (rel, body) => write(path.join(out, rel), body);
  pack('hooks/arch-map.json', { source: 'manual', style: 'Pure Node ES module', layers: [{ name: 'src/cart.mjs', group: 'domain' }], libs: [] });
  pack('TASKS.json', { kind: 'feature', spec: first.meta.spec, tasks: [
    { id: 'T-001', title: 'Cart total', kind: 'feature', worktree: 1, status: 'OPEN', version: 0, validation: 'red-green', tests_added: 0, red_green: false, depends_on: [], refs: ['RF-1'], acceptance: ['Empty=0; 9999=>11499; 10000=>10000; 10001=>10001'] },
    { id: 'T-002', title: 'Runnable documentation', kind: 'docs', worktree: 2, status: 'OPEN', version: 0, validation: 'check', validation_reason: 'Documentation-only example checked by execution', tests_added: 0, depends_on: ['T-001'], refs: ['RF-2'], acceptance: ['Example prints 2500'] },
  ] });
  pack('payloads.json', []);
  pack('spec-summary.md', '# Cart total\nShipping boundary plus runnable module example; preserve subtotal. No UI.\n');
  pack('flow.mmd', 'flowchart LR\n  A["T-001 total"] --> B["T-002 docs"]\n');
  helper('run-meta.mjs', ['sync', '--dir', out]);
  const wt = (action, extra = [], options) => helper('worktrees.mjs', [action, '--root', root, '--out', out, '--test-cmd', testCmd, ...extra], options);
  wt('add', ['--count', '2', '--into', 'feature/cart']);
  assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /\.worktrees\//);
  git(['add', '.gitignore']);
  git(['commit', '-m', 'chore: ignore temporary worktrees']);
  wt('add', ['--count', '2', '--into', 'feature/cart']);
  const [slice1, slice2] = read(path.join(out, 'worktrees.json')).slices;
  assert.match(wt('sync', ['--index', '2'], { fails: true }), /has not been integrated/);
  const task = (id, version, patch) => {
    const result = path.join(out, 'results', `${id}-${version}.json`);
    write(result, { id, expected_version: version, patch });
    helper('run-meta.mjs', ['task', '--dir', out, '--result', result]);
    return result;
  };
  task('T-001', 0, { status: 'IN_PROGRESS' });
  write(path.join(slice1.dir, 'src/cart.mjs'), baseline + '\nexport function total(items) { return subtotal(items); }\n');
  write(path.join(slice1.dir, 'test/cart.test.mjs'), oldTests + newTests);
  const red = run(process.execPath, testArgs, { cwd: slice1.dir, fails: true });
  assert.match(red, /9999 !== 11499/);
  write(path.join(slice1.dir, 'src/cart.mjs'), finalCode);
  assert.match(run(process.execPath, testArgs, { cwd: slice1.dir }), /# pass 7\b/);
  write(path.join(slice1.dir, 'src/cart.mjs'), finalCode.replace('amount + 1500', 'amount'));
  assert.match(run(process.execPath, testArgs, { cwd: slice1.dir, fails: true }), /9999 !== 11499/);
  write(path.join(slice1.dir, 'src/cart.mjs'), finalCode);
  run(process.execPath, testArgs, { cwd: slice1.dir });
  git(['add', 'src/cart.mjs', 'test/cart.test.mjs'], slice1.dir);
  git(['commit', '-m', 'feat: cart shipping total'], slice1.dir);
  task('T-001', 1, { status: 'DONE', tests_added: 4, red_green: true, immutability: true,
    red: { command: testCmd, output_excerpt: '9999 !== 11499' }, green: { command: testCmd, output_excerpt: '# pass 7; # fail 0' },
    reversal: { done: true, output_excerpt: 'Removing shipping reproduces 9999 !== 11499' },
    tests: ['empty total is zero', 'below shipping threshold', 'at shipping threshold', 'above shipping threshold'],
    files: ['src/cart.mjs', 'test/cart.test.mjs'], commits: [{ sha: git(['rev-parse', 'HEAD'], slice1.dir) }] });
  wt('merge', ['--index', '1']);
  assert.equal(JSON.parse(helper('resume.mjs', ['--root', root])).next_step, 'implement');
  helper('run-meta.mjs', ['sync', '--dir', out]);
  wt('sync', ['--index', '2']);
  task('T-002', 0, { status: 'IN_PROGRESS' });
  const example = "import { total } from './src/cart.mjs'; console.log(total([{ priceCents: 500, quantity: 2 }]));";
  write(path.join(slice2.dir, 'README.md'), `# Cart\n\nsubtotal(items) sums integer cents.\n\ntotal(items) adds 1500 cents shipping below 10000, offers free shipping from 10000, and returns zero for an empty cart.\n\n\`\`\`js\n${example} // 2500\n\`\`\`\n`);
  assert.equal(run(process.execPath, ['--input-type=module', '-e', example], { cwd: slice2.dir }).trim(), '2500');
  git(['add', 'README.md'], slice2.dir);
  git(['commit', '-m', 'docs: cart shipping example'], slice2.dir);
  const docsResult = task('T-002', 1, { status: 'DONE', checks: [{ command: `${process.execPath} --input-type=module -e ${quote(example)}`, output_excerpt: '2500', ok: true }],
    files: ['README.md'], commits: [{ sha: git(['rev-parse', 'HEAD'], slice2.dir) }] });
  wt('merge', ['--index', '2']);
  wt('merge', ['--index', '2']);
  assert.match(helper('run-meta.mjs', ['task', '--dir', out, '--result', docsResult], { fails: true }), /stale task result/);

  helper('run-meta.mjs', ['snapshot', '--dir', out]);
  const finalTests = run(process.execPath, testArgs);
  assert.match(finalTests, /# pass 7\b/);
  const coverage = run(process.execPath, ['--experimental-test-coverage', ...testArgs]);
  assert.match(coverage, /cart\.mjs\s*\|\s*100(?:\.00)?\s*\|\s*100(?:\.00)?\s*\|\s*100(?:\.00)?/);
  const contractArgs = ['--test', '--test-reporter=tap', '--test-name-pattern=subtotal', 'test/cart.test.mjs'];
  assert.match(run(process.execPath, contractArgs), /# pass 3\b/);
  pack('tests.json', { cmd: testCmd, ok: true, total: 7, passed: 7, failed: 0, log: finalTests });
  pack('coverage.json', { pct: 100, floor: 90, tool: 'node --experimental-test-coverage', scope: 'src/cart.mjs', modules: [{ name: 'src/cart.mjs', pct: 100 }] });
  pack('immutability.json', { green: true, command: [process.execPath, ...contractArgs].map(quote).join(' '),
    tests: ['empty subtotal remains zero', 'subtotal multiplies quantities', 'subtotal does not mutate items'], tasks_covered: ['T-001'] });
  const stamp = (file) => helper('run-meta.mjs', ['stamp', '--dir', out, '--file', file]);
  for (const file of ['tests.json', 'coverage.json', 'immutability.json']) stamp(file);
  helper('hooks.mjs', ['diff-facts', '--repo-root', root, '--base', first.meta.base, '--dir', out]);
  helper('ui-acceptance.mjs', ['scope', '--root', root, '--base', first.meta.base, '--dir', out]);
  assert.equal(read(path.join(out, 'hooks/ui-scope.json')).ui_touched, false, 'Pure Node domain code and tests have no UI');
  helper('hooks.mjs', ['deps-freshness', '--repo-root', root, '--dir', out, '--mode', 'new']);
  assert.equal(read(path.join(out, 'hooks/deps-freshness.json')).registry, 'not-needed');

  // Deterministic read-only review of this known fixture's actual final diff.
  assert.equal(fs.readFileSync(path.join(root, 'src/cart.mjs'), 'utf8'), finalCode);
  assert.deepEqual(git(['diff', '--name-only', first.meta.base, 'HEAD']).split('\n'), ['.gitignore', 'README.md', 'src/cart.mjs', 'test/cart.test.mjs']);
  assert.deepEqual(read(path.join(root, 'package.json')), { name: 'cart', private: true, type: 'module' });
  const axes = {
    standards: 'Final diff preserves ES modules, integer cents and Node built-ins required by AGENTS.md.',
    spec: 'Exact product code and boundary tests match RF-1; executed README example matches RF-2. No unrelated files or dependencies.',
    correctness: 'T-001 has behavioral RED, GREEN and reversal; T-002 has a checked runnable example. Existing subtotal contracts and integrated 7-test suite pass with 100% product coverage.',
  };
  for (const [axis, summary] of Object.entries(axes)) {
    pack(`reviews/${axis}.json`, { axis, verdict: 'APPROVE', summary, findings: [] });
    pack(`reviews/${axis}.md`, `${summary}\n\nVERDICT: APPROVE\n`);
    stamp(`reviews/${axis}.json`);
  }
  for (const hook of ['arch-alignment', 'reinvention', 'security', 'performance', 'overengineering']) {
    pack(`hooks/${hook}.json`, { hook, verdict: 'APPROVE', summary: 'Reviewed exact final diff: existing pure module, requested domain arithmetic, one traversal, no IO, new dependencies or structural additions.', findings: [] });
    stamp(`hooks/${hook}.json`);
  }
  pack('hooks/ui-acceptance.json', { hook: 'ui-acceptance', verdict: 'SKIP', summary: 'Verified domain-only Node fixture; no UI files, frameworks or contracts.', findings: [] });
  stamp('hooks/ui-acceptance.json');
  helper('hooks.mjs', ['verdict', '--dir', out]);
  pack('project-gates.json', { gates: [{ name: 'Node tests and coverage', source: 'AGENTS.md', status: 'DONE', evidence: 'Integrated Node suite: 7/7; src/cart.mjs coverage: 100%' }] });
  pack('tracking.json', { files: [], reason: 'Repository has no delivery checklist; cart-spec.md contains requirements only, verified by reviews/spec.json.' });
  stamp('project-gates.json');
  stamp('tracking.json');
  wt('remove');
  wt('verify-clean');
  const score = JSON.parse(helper('score.mjs', ['--dir', out]));
  assert.equal(score.score, 10);
  assert.equal(score.closable, true);
  helper('run-meta.mjs', ['close', '--dir', out]);
  assert.doesNotMatch(helper('build-report.mjs', ['--dir', out]), /WARN/);
  const html = fs.readFileSync(path.join(out, 'report.html'), 'utf8');
  assert.match(html, /Checks ✓/);
  assert.match(html, /2500/);
  assert.doesNotMatch(html, /R→G ✗|DONE sem evidência RED/);
  const history = JSON.parse(helper('resume.mjs', ['--root', root], { fails: true }));
  assert.equal(history.resumable, false);
  assert.equal(history.next_step, 'closed');
  assert.equal(history.pack, null);
  assert.equal(history.historical_pack.dir, out);
  assert.equal(history.historical_pack.report, path.join(out, 'report.html'));

  // Persist only this run's artifacts, as prescribed for starting another run.
  git(['add', '--', path.relative(root, out)]);
  git(['commit', '-m', 'docs: persist completed implementation pack']);
  assert.equal(git(['status', '--porcelain']), '');
  assert.equal(JSON.parse(helper('resume.mjs', ['--root', root], { fails: true })).historical_pack.dir, out);
  const secondArgs = [...initArgs];
  secondArgs[secondArgs.indexOf('--worktree') + 1] = '1';
  const second = JSON.parse(helper('run-meta.mjs', secondArgs));
  assert.notEqual(second.dir, out);
  assert.notEqual(second.meta.run_id, first.meta.run_id);
  assert.notEqual(second.meta.worktree_prefix, first.meta.worktree_prefix);
  assert.equal(fs.existsSync(path.join(second.dir, 'reviews/spec.json')), false);
  write(path.join(second.dir, 'hooks/arch-map.json'), { source: 'manual', style: 'Pure Node ES module; final code inspected above', layers: [{ name: 'src/cart.mjs', group: 'domain' }] });
  write(path.join(second.dir, 'TASKS.json'), { kind: 'feature', spec: second.meta.spec, tasks: [
    { id: 'T-003', title: 'Document empty-cart example', kind: 'docs', worktree: 1, status: 'OPEN', version: 0, validation: 'check',
      validation_reason: 'Execute the documented empty-cart example', depends_on: [], refs: ['RF-2'], acceptance: ['Example prints zero'] },
  ] });
  write(path.join(second.dir, 'payloads.json'), []);
  write(path.join(second.dir, 'flow.mmd'), 'flowchart LR\n A["T-003 empty-cart documentation"]\n');
  write(path.join(second.dir, 'spec-summary.md'), '# Additional documentation\nRF-2: document an empty-cart example.\n');
  helper('run-meta.mjs', ['sync', '--dir', second.dir]);
  helper('worktrees.mjs', ['add', '--root', root, '--out', second.dir, '--count', '1', '--into', 'feature/cart', '--test-cmd', testCmd]);
  const resumed = JSON.parse(helper('resume.mjs', ['--root', root]));
  assert.equal(resumed.pack, second.dir);
  assert.equal(resumed.resumable, true);
  assert.equal(resumed.next_step, 'implement');
  assert.equal(resumed.historical_pack.dir, out);
  assert.equal(read(path.join(out, 'run-meta.json')).status, 'closed');
});
