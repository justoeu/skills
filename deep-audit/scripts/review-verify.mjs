#!/usr/bin/env node
/** Tally current immutable review round. A failed attempt invalidates old approval. */
import fs from 'node:fs';
import path from 'node:path';
import { cliArg, cliFlag } from './lib-findings.mjs';
import { acquireLock, readJson, writeJson, safeId, metaFor, hash } from './pack-state.mjs';
import { tallyReview, REVIEW_LENSES } from './review-evidence.mjs';
export { REVIEW_LENSES };
const dir = cliArg('dir');
try {
  if (!dir || (!cliArg('id') && !cliFlag('all'))) throw new Error('uso: --dir PACK --id ID | --all');
  const release = acquireLock(dir);
  try {
    metaFor(dir);
    const findings = readJson(path.join(dir, 'FINDINGS.json'));
    const ids = cliArg('id') ? [safeId(cliArg('id'))] : findings.filter(f => fs.existsSync(path.join(dir, 'reviews', `${f.id}-context.json`))).map(f => f.id);
    if (!ids.length) throw new Error('nenhuma revisão iniciada');
    for (const id of ids) {
      const f = findings.find(f => f.id === id); if (!f) throw new Error('achado desconhecido');
      const tally = tallyReview(dir, f);
      const currentPath = path.join(dir, 'reviews', `${id}.json`);
      const prior = fs.existsSync(currentPath) ? readJson(currentPath) : null;
      if (prior && prior.round_id === tally.round_id && prior.verdict === tally.verdict && hash(prior.inputs) === hash(tally.inputs) && hash(prior.problems) === hash(tally.problems)) {
        if (prior.verdict !== 'approved') process.exitCode = prior.verdict === 'invalid' ? 2 : (process.exitCode || 3);
        console.log(`${id}: ${prior.verdict} (tentativa já apurada)`); continue;
      }
      const attemptId = hash({ id, context: tally.round_id, inputs: tally.inputs, verdict: tally.verdict, problems: tally.problems });
      const attemptPath = path.join(dir, 'reviews', 'attempts', id, `${attemptId}.json`);
      const result = fs.existsSync(attemptPath) ? readJson(attemptPath) : { ...tally, reviewed_at: new Date().toISOString(), attempt_id: attemptId };
      if (!fs.existsSync(attemptPath)) writeJson(attemptPath, result);
      // Persist invalid outcomes too. Never leave an old approved summary usable.
      writeJson(path.join(dir, 'reviews', `${id}.json`), result);
      if (result.verdict !== 'approved') process.exitCode = result.verdict === 'invalid' ? 2 : (process.exitCode || 3);
      console.log(`${id}: ${result.verdict}${result.problems.length ? ': ' + result.problems.join('; ') : ''}`);
    }
    const all = [];
    const attemptRoot = path.join(dir, 'reviews', 'attempts');
    if (fs.existsSync(attemptRoot)) for (const id of fs.readdirSync(attemptRoot)) for (const file of fs.readdirSync(path.join(attemptRoot, id))) all.push(readJson(path.join(attemptRoot, id, file)));
    all.sort((a, b) => a.reviewed_at.localeCompare(b.reviewed_at));
    const byId = {};
    for (const a of all) { byId[a.id] ||= { attempts: 0, first_pass: a.verdict === 'approved' }; byId[a.id].attempts++; byId[a.id].verdict = a.verdict; }
    writeJson(path.join(dir, 'reviews', 'summary.json'), { generated_at: new Date().toISOString(), panel_source: 'vote-files', lenses: REVIEW_LENSES, reviewed: Object.keys(byId).length, attempts: all.length, approved: Object.values(byId).filter(x => x.verdict === 'approved').length, first_pass: Object.values(byId).filter(x => x.first_pass).length, by_id: byId });
  } finally { release(); }
} catch (e) { console.error(`review-verify: ${e.message}`); process.exitCode = 2; }
