#!/usr/bin/env node
/** --audit-gate proves detection coverage; --gate also proves dispositions and fixes. */
import path from 'node:path';
import { cliArg, cliFlag, auditLabel, counts, LENSES, SEVERITIES } from './lib-findings.mjs';
import { readJson, writeJson, findingsArray, acquireLock, stableId } from './pack-state.mjs';
import { closureErrors } from './closure.mjs';
const dir = cliArg('dir'); let release;
try {
  if (!dir) throw new Error('--dir obrigatório');
  release = acquireLock(dir);
  const file = path.join(dir, 'FINDINGS.json'), findings = findingsArray(readJson(file)), errors = [], ids = new Set();
  for (const f of findings) {
    if (!f.id || ids.has(f.id)) errors.push('ID ausente/duplicado'); ids.add(f.id);
    if (f.id !== stableId(f)) errors.push(`${f.id}: identidade incompatível; reconsolide/migre explicitamente`);
    if (!f.agent || !LENSES.includes(f.lens) || !SEVERITIES.includes(f.severity)) errors.push(`${f.id}: schema inválido`);
    errors.push(...auditLabel(f, { fix: cliFlag('fix') }).errors);
  }
  if (cliFlag('gate') || cliFlag('audit-gate')) errors.push(...closureErrors(dir, findings, cliFlag('audit-gate') && !cliFlag('gate')));
  if (cliFlag('fix')) writeJson(file, findings);
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 2; }
  else console.log(JSON.stringify({ status: 'ok', gate: cliFlag('gate') ? 'closure' : cliFlag('audit-gate') ? 'audit' : 'schema', counts: counts(findings) }));
} catch (e) { console.error(`lint-findings: ${e.message}`); process.exitCode = 2; }
finally { release?.(); }
