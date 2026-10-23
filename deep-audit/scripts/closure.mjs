import { coverageErrors, metaFor, sourceState, findingHash } from './pack-state.mjs';
import { approval } from './review-evidence.mjs';
import { normalizeStatus, normalizeSeverity } from './lib-findings.mjs';
export function closureErrors(dir, findings, auditOnly = false) {
  const errors = coverageErrors(dir);
  if (auditOnly) return errors;
  let source;
  try { source = sourceState(metaFor(dir), dir).source_hash; } catch (e) { errors.push(e.message); }
  for (const f of findings) {
    const status = normalizeStatus(f.status);
    if (status === 'open' && (['HIGH', 'CRITICAL'].includes(normalizeSeverity(f.severity)) || f.blocks_pr)) errors.push(`${f.id}: aberto e bloqueante`);
    if (status === 'resolved') {
      try {
        // Waivers remain visible debt, never equivalent to independent approval.
        if (f.review?.waived) throw new Error(`revisão dispensada: ${f.review.waived_reason}; gate permanece pendente`);
        const r = approval(dir, f);
        if (f.review?.round_id !== r.round_id) throw new Error('desfecho não corresponde à aprovação atual');
      } catch (e) { errors.push(`${f.id}: ${e.message}`); }
    }
    if (['refuted', 'accepted'].includes(status) && (f.disposition_evidence?.source_hash !== source || f.disposition_evidence?.finding_hash !== findingHash(f))) errors.push(`${f.id}: desfecho sem evidência atual do conteúdo`);
  }
  return errors;
}
