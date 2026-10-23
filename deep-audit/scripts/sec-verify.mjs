#!/usr/bin/env node
/** Three independent vote files per candidate. Invalid evidence never becomes a clean scan. */
import fs from 'node:fs';
import path from 'node:path';
import { cliArg } from './lib-findings.mjs';
import { acquireLock, readJson, readHashed, writeJson, metaFor, readSnapshot, stageErrors, hash, fileHash, stableId, safeId, artifactPath } from './pack-state.mjs';
const LENSES = ['REACHABILITY', 'IMPACT', 'DEFENSES'];
const candidatesPath = cliArg('candidates'), outPath = cliArg('out');
const dir = path.resolve(cliArg('dir', outPath ? path.dirname(outPath) : '.'));
let release;
try {
  release = acquireLock(dir);
  const meta = metaFor(dir), snapshot = readSnapshot(dir, cliArg('snapshot'));
  const coverageOut = cliArg('coverage-out', path.join(dir, 'sec-deep', 'coverage.json'));
  const inputs = [], problems = stageErrors(dir, ['security_inventory', 'security_hunters']);
  function input(file) {
    const relative = path.relative(dir, path.resolve(file)); const p = artifactPath(dir, relative);
    const input = readHashed(p); inputs.push({ path: relative, hash: input.digest }); return input.doc;
  }
  const doc = input(candidatesPath), list = doc.candidates;
  if (!Array.isArray(list)) throw new Error('candidates.json exige candidates:[]');
  const seen = new Set(), verified = [], dropped = [], pending = [];
  for (const candidate of list) {
    const id = safeId(candidate.temp_id || candidate.id || candidate.candidate_id);
    if (seen.has(id)) throw new Error('candidate id duplicado'); seen.add(id);
    const expected = { run_id: meta.run_id, source_hash: snapshot.source_hash, candidate_hash: hash(candidate) };
    const votes = []; let invalid = false;
    for (const lens of LENSES) {
      try {
        const vote = input(path.join(cliArg('votes-dir', path.join(dir, 'sec-deep', 'votes')), `${id}-${lens}.json`));
        if (!['TRUE_POSITIVE', 'FALSE_POSITIVE'].includes(vote.verdict) || !String(vote.reasoning || '').trim() || vote.lens !== lens || hash(vote.context) !== hash(expected)) throw new Error('voto inválido/antigo ou sem justificativa/contexto');
        votes.push(vote);
      } catch (e) { invalid = true; problems.push(`${id}-${lens}: ${e.message}`); }
    }
    if (invalid) { pending.push({ ...candidate, status: 'unverified' }); continue; }
    const trueVotes = votes.filter(v => v.verdict === 'TRUE_POSITIVE').length;
    if (trueVotes < 2) { dropped.push({ temp_id: id, reason: 'below-quorum', votes }); continue; }
    const f = { ...candidate, agent: cliArg('agent', 'Cérbero'), lens: 'security', domain: 'security', status: 'open', confidence: trueVotes === 3 ? (candidate.confidence || 'medium') : 'medium', verification: 'panel', panel: { true: trueVotes, false: 3 - trueVotes, voters: 3 }, panel_detail: Object.fromEntries(votes.map(v => [v.lens, v])), candidate_id: id, candidate_hash: hash(candidate) };
    f.id = stableId(f); verified.push(f);
  }
  for (const input of inputs) if (fileHash(artifactPath(dir, input.path)) !== input.hash) problems.push('evidência mudou durante apuração');
  const coverage = { schema_version: 2, run_id: meta.run_id, source_hash: snapshot.source_hash, snapshot_id: snapshot.snapshot_id, verification_status: problems.length ? 'unverified' : 'verified', panel_source: 'vote-files', candidates_in: list.length, panel_reviewed_findings: list.length - pending.length, candidates_deduped_out: verified.length, panel_quorum_findings: verified.length, panel_dropped: dropped.length, dropped_sample: dropped, pending_candidates: pending, problems, inputs };
  writeJson(coverageOut, coverage);
  if (problems.length) { console.error(problems.join('\n')); process.exitCode = 2; }
  else { writeJson(outPath, verified); console.log(`sec-verify: ${verified.length}/${list.length}; verified`); }
} catch (e) {
  // Keep findings intact, invalidate any earlier coverage even on parse/setup errors.
  if (release) writeJson(cliArg('coverage-out', path.join(dir, 'sec-deep', 'coverage.json')), { verification_status: 'unverified', panel_source: 'vote-files', problems: [e.message] });
  console.error(`sec-verify: ${e.message}`); process.exitCode = 2;
} finally { release?.(); }
