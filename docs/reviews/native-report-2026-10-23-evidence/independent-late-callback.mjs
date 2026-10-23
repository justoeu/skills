import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { initRun } from '~/Developer/harness/skills/make-me-happy/scripts/run-meta.mjs';
import { prepareNativeReport, bindNativeReport, tickNativeReport, stopNativeReport } from '~/Developer/harness/skills/make-me-happy/scripts/report-native.mjs';
import { watchReport, reportWatchStatus } from '~/Developer/harness/skills/make-me-happy/scripts/report-watch.mjs';
import { readJson, writeJson, artifactIdentity, captureEvidence, sameEvidence } from '~/Developer/harness/skills/make-me-happy/scripts/state-io.mjs';
const root=fs.mkdtempSync('/tmp/mmh-native-late-');fs.writeFileSync(path.join(root,'spec.md'),'fixture');
const {dir}=initRun(root,{spec:'spec.md'});writeJson(path.join(dir,'TASKS.json'),{tasks:[{id:'T-001',version:1,status:'IN_PROGRESS',title:'fixture'}]});
const initialIdentity=artifactIdentity(dir),initialEvidence=captureEvidence(dir),initialTasks=readJson(path.join(dir,'TASKS.json'));
const native=prepareNativeReport(dir,{kind:'subtask',provider:'fixture only'});
assert.equal(tickNativeReport(dir,native.token).waiting_for_binding,true);
await assert.rejects(watchReport(dir),/already running/);
bindNativeReport(dir,native.token,'fixture-child');tickNativeReport(dir,native.token);
const probe=path.join(dir,'probe');fs.mkdirSync(probe);
const paused=path.join(probe,'paused'),release=path.join(probe,'release'),preload=path.join(probe,'pause-tick.mjs');
fs.writeFileSync(preload,`import fs from 'node:fs';\nconst original=fs.renameSync;let paused=false;\nfs.renameSync=function(from,to){if(!paused&&String(to)===${JSON.stringify(path.join(dir,'.writer-lock'))}){paused=true;fs.writeFileSync(${JSON.stringify(paused)},'ready');const deadline=Date.now()+10000;while(!fs.existsSync(${JSON.stringify(release)})){if(Date.now()>deadline)throw Error('barrier timeout');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}}return original.call(this,from,to);};\n`);
const child=spawn(process.execPath,['--import',preload,'~/Developer/harness/skills/make-me-happy/scripts/report-native.mjs','tick','--dir',dir,'--token',native.token],{stdio:['ignore','pipe','pipe']});
let stderr='';child.stderr.on('data',x=>stderr+=x);const exited=new Promise(resolve=>child.on('exit',(code,signal)=>resolve({code,signal})));
const controller=new AbortController();let nodeRun;
try {
 const deadline=Date.now()+5000;while(!fs.existsSync(paused)){if(Date.now()>deadline)throw Error('barrier missing');await delay(10);}
 stopNativeReport(dir,native.token);
 let readyResolve;const ready=new Promise(r=>readyResolve=r);nodeRun=watchReport(dir,{signal:controller.signal,onCycle:readyResolve});await ready;
 const before=fs.readFileSync(path.join(dir,'report.html'),'utf8'),stateBefore=reportWatchStatus(dir);
 fs.writeFileSync(release,'go');const delayed=await exited;
 assert.equal(delayed.code,1);assert.equal(fs.readFileSync(path.join(dir,'report.html'),'utf8'),before);assert.deepEqual(reportWatchStatus(dir),stateBefore);
 assert.equal(artifactIdentity(dir),initialIdentity);assert.ok(sameEvidence(captureEvidence(dir),initialEvidence));assert.deepEqual(readJson(path.join(dir,'TASKS.json')),initialTasks);
 assert.equal(stateBefore.backend,'node');assert.notEqual(stateBefore.token,native.token);
 const evidence={root,dir,delayed,stderr:stderr.trim(),native_token:native.token,node_token:stateBefore.token,html_unchanged:true,state_unchanged:true,task_state_unchanged:true,evidence_unchanged:true};
 fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
} finally {controller.abort();if(nodeRun)await nodeRun;if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
