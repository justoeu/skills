import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { initRun } from '~/Developer/harness/skills/make-me-happy/scripts/run-meta.mjs';
import { prepareNativeReport, bindNativeReport, tickNativeReport, stopNativeReport } from '~/Developer/harness/skills/make-me-happy/scripts/report-native.mjs';
import { reportWatchStatus } from '~/Developer/harness/skills/make-me-happy/scripts/report-watch-state.mjs';
const root=fs.mkdtempSync('/tmp/mmh-native-review-');
fs.writeFileSync(path.join(root,'spec.md'),'RF-1 fixture');
const {dir}=initRun(root,{spec:'spec.md'});
const state=prepareNativeReport(dir,{kind:'schedule',provider:'fixture only',now:new Date(Date.now()-900000)});
bindNativeReport(dir,state.token,'fixture-job');
assert.equal(reportWatchStatus(dir).stale,true);
tickNativeReport(dir,state.token);
const freshness={state_stale:reportWatchStatus(dir).stale,html_warns_no_native_cycle:fs.readFileSync(path.join(dir,'report.html'),'utf8').includes('Sem ciclo nativo confirmado no intervalo esperado'),last_success_at:reportWatchStatus(dir).last_success_at};
assert.equal(freshness.state_stale,false);assert.equal(freshness.html_warns_no_native_cycle,true);
const paused=path.join(root,'paused'),release=path.join(root,'release');
const preload=path.join(root,'pause-stop.mjs');
fs.writeFileSync(preload,`import fs from 'node:fs';\nconst original=fs.rmSync;let paused=false;\nfs.rmSync=function(target,options){const result=original.call(this,target,options);if(!paused && String(target)===${JSON.stringify(path.join(dir,'.writer-lock'))}){const state=JSON.parse(fs.readFileSync(${JSON.stringify(path.join(dir,'report-watch.json'))},'utf8'));if(state.status==='stopping'){paused=true;fs.writeFileSync(${JSON.stringify(paused)},'ready');const deadline=Date.now()+10000;while(!fs.existsSync(${JSON.stringify(release)})){if(Date.now()>deadline)throw Error('barrier timeout');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}}}return result;};\n`);
const child=spawn(process.execPath,['--import',preload,'~/Developer/harness/skills/make-me-happy/scripts/report-native.mjs','stop','--dir',dir,'--token',state.token],{stdio:['ignore','pipe','pipe']});
let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
const exited=new Promise(resolve=>child.on('exit',(code,signal)=>resolve({code,signal})));
try {
 const deadline=Date.now()+5000;while(!fs.existsSync(paused)){if(Date.now()>deadline)throw Error('child barrier missing');await delay(10);}
 const second=stopNativeReport(dir,state.token);assert.equal(second.status,'stopped');
 fs.writeFileSync(release,'go');const first=await exited;const final=reportWatchStatus(dir);
 const race={second_stop:second.status,first_stop:first,first_error:stderr.trim(),final_status:final.status,last_error:final.last_error,html_auto_refresh_false:fs.readFileSync(path.join(dir,'report.html'),'utf8').includes('data-auto-refresh="false"')};
 assert.equal(first.code,1);assert.equal(final.status,'failed');
 const evidence={root,dir,token:state.token,freshness,race};fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
} finally { if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL'); }
