import fs from 'node:fs';
import path from 'node:path';
import { readJson, readHashed, hash, fileHash, metaFor, sourceState, findingHash, safeId, artifactPath } from './pack-state.mjs';
export const REVIEW_LENSES = ['CORRECTNESS', 'QUALITY', 'SCOPE'];
const AGENTS = { CORRECTNESS: 'Nêmesis', QUALITY: 'Hígia', SCOPE: 'Jano' };
export function reviewContext(dir, finding) {
  const context = readJson(path.join(dir, 'reviews', `${safeId(finding.id)}-context.json`));
  const meta = metaFor(dir);
  if (context.run_id !== meta.run_id || context.source_hash !== sourceState(meta, dir).source_hash || context.finding_hash !== findingHash(finding)) throw new Error('revisão antiga ou de outro achado/conteúdo; rode review-start novamente');
  return context;
}
export function tallyReview(dir, finding) {
  const problems = [], votes = [], inputs = []; let context = {};
  try { context = reviewContext(dir, finding); } catch (e) { problems.push(e.message); }
  for (const lens of REVIEW_LENSES) {
    try {
      const relative = `reviews/votes/${safeId(finding.id)}-${lens}.json`, p = artifactPath(dir, relative), input = readHashed(p), raw = input.doc;
      inputs.push({ path: relative, hash: input.digest });
      const verdict = String(raw.verdict || '').toUpperCase().replace(/Ç/g, 'C').replace(/Ã/g, 'A');
      if (!['APROVA', 'MUDANCAS', 'BLOQUEIA'].includes(verdict) || !String(raw.reasoning || '').trim() || raw.lens !== lens) throw new Error('voto sem lente/veredito/justificativa válido');
      if (hash(raw.context) !== hash(context)) throw new Error('voto não corresponde ao contexto/diff desta rodada');
      if (verdict !== 'APROVA' && (!Array.isArray(raw.required_changes) || !raw.required_changes.length)) throw new Error('mudanças necessárias ausentes');
      if (lens === 'CORRECTNESS' && verdict === 'APROVA') {
        if (raw.test_reversal_checked !== true) throw new Error('CORRECTNESS não executou reversão');
        const proofFile = `reviews/rounds/${finding.id}/${context.round_id}/proof.json`, proofPath = artifactPath(dir, proofFile), proof = readJson(proofPath);
        if (hash(proof.context) !== hash(context) || proof.runner !== 'reversal-proof-v2' || !proof.command || proof.green_exit !== 0 || proof.reverted_exit === 0 || !Number.isInteger(proof.reverted_exit) || proof.restored_exit !== 0) throw new Error('prova red/green/reversão ausente ou inválida');
        if (!proof.logs || Object.keys(proof.logs).length !== 3) throw new Error('logs da prova ausentes');
        for (const [relative, digest] of Object.entries(proof.logs)) if (fileHash(artifactPath(dir, relative)) !== digest) throw new Error('log da prova mudou');
        inputs.push({ path: proofFile, hash: fileHash(proofPath) });
        for (const [relative, digest] of Object.entries(proof.logs)) inputs.push({ path: relative, hash: digest });
      }
      votes.push({ ...raw, verdict, agent: AGENTS[lens], required_changes: raw.required_changes || [], new_findings: raw.new_findings || [], unrelated_files: raw.unrelated_files || [] });
    } catch (e) { problems.push(`${lens}: ${e.message}`); }
  }
  for (const input of inputs) { try { if (fileHash(artifactPath(dir, input.path)) !== input.hash) problems.push('evidência mudou durante apuração'); } catch (e) { problems.push(e.message); } }
  const verdict = problems.length ? 'invalid' : votes.some(v => v.verdict === 'BLOQUEIA') ? 'rejected' : votes.some(v => v.verdict === 'MUDANCAS') ? 'changes_requested' : 'approved';
  return { ...context, id: finding.id, verdict, votes, inputs, problems, panel_source: 'vote-files', voters: votes.length,
    test_reversal_checked: votes.find(v => v.lens === 'CORRECTNESS')?.test_reversal_checked === true,
    required_changes: votes.flatMap(v => v.required_changes.map(c => `[${v.lens}] ${c}`)),
    new_findings: votes.flatMap(v => v.new_findings), unrelated_files: [...new Set(votes.flatMap(v => v.unrelated_files))] };
}
export function approval(dir, finding) {
  const stored = readJson(path.join(dir, 'reviews', `${safeId(finding.id)}.json`));
  const current = tallyReview(dir, finding);
  if (stored.verdict !== 'approved' || current.verdict !== 'approved' || stored.round_id !== current.round_id || hash(stored.inputs) !== hash(current.inputs)) throw new Error(`aprovação ausente/inválida/antiga: ${current.problems.join('; ')}`);
  return stored;
}
