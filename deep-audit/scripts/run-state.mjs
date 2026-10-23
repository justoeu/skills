#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { cliArg } from './lib-findings.mjs';
import { acquireLock, recoverLock, metaFor, readJson, writeJson, snapshot, completeStage, safeId, findingHash } from './pack-state.mjs';

const command = process.argv[2], dir = path.resolve(cliArg('dir', '.'));
try {
  if (command === 'recover-lock') { recoverLock(dir); console.log('lock abandonado arquivado; tente novamente'); }
  else {
    const release = acquireLock(dir);
    try {
      if (command === 'snapshot') console.log(JSON.stringify(snapshot(dir)));
      else if (command === 'complete') {
        completeStage(dir, cliArg('stage'), cliArg('snapshot'), cliArg('artifacts', '').split(',').filter(Boolean));
        console.log('etapa concluída');
      } else if (command === 'fail') {
        const meta = metaFor(dir), stage = cliArg('stage');
        if (!meta.expected_stages.includes(stage) || !cliArg('reason')) throw new Error('etapa válida e motivo obrigatórios');
        meta.stages[stage] = { status: 'failed', reason: cliArg('reason'), at: new Date().toISOString() };
        writeJson(path.join(dir, 'run-meta.json'), meta);
      } else if (command === 'metadata') {
        const meta = metaFor(dir);
        for (const key of ['app', 'version']) if (cliArg(key)) meta[key] = cliArg(key);
        writeJson(path.join(dir, 'run-meta.json'), meta);
      } else if (command === 'review-start') {
        const id = safeId(cliArg('id')); const finding = readJson(path.join(dir, 'FINDINGS.json')).find(f => f.id === id);
        if (!finding) throw new Error('achado desconhecido');
        const context = { ...snapshot(dir), id, finding_hash: findingHash(finding), round_id: randomUUID() };
        const base = path.join(dir, 'reviews', 'rounds', id, context.round_id);
        writeJson(path.join(base, 'context.json'), context);
        writeJson(path.join(dir, 'reviews', `${id}.json`), { ...context, verdict: 'pending', panel_source: 'vote-files', voters: 0 });
        writeJson(path.join(dir, 'reviews', `${id}-context.json`), context);
        console.log(JSON.stringify(context));
      } else throw new Error('uso: run-state snapshot|complete|fail|metadata|review-start|recover-lock --dir PACK');
    } finally { release(); }
  }
} catch (e) { console.error(`run-state: ${e.message}`); process.exitCode = 2; }
