import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { initRun } from '~/Developer/harness/skills/make-me-happy/scripts/run-meta.mjs';
import { watchReport, stopReportWatch, reportWatchStatus } from '~/Developer/harness/skills/make-me-happy/scripts/report-watch.mjs';
const root=fs.mkdtempSync('/tmp/mmh-stop-restart-failure-');
fs.writeFileSync(path.join(root,'spec.md'),'fixture');
const {dir}=initRun(root,{spec:'spec.md'});
const report=path.join(dir,'report.html');
let readyResolve; const ready=new Promise(r=>readyResolve=r);
const first=watchReport(dir,{wait:()=>delay(10),onCycle:readyResolve});
await ready;
const tokenFirst=reportWatchStatus(dir).token;
fs.renameSync(report,path.join(dir,'previous-report.html'));fs.mkdirSync(report);
let next=null, nextReadyResolve; const nextReady=new Promise(r=>nextReadyResolve=r);
const controller=new AbortController();
let originalFailure;
const transition=first.catch(error=>{
 originalFailure=error.message;
 fs.rmdirSync(report);
 next=watchReport(dir,{signal:controller.signal,onCycle:nextReadyResolve});
});
try {
 const started=Date.now();
 const stop=stopReportWatch(dir).then(value=>({ok:true,value}),error=>({ok:false,error:error.message}));
 await nextReady;
 const replacement=reportWatchStatus(dir);
 const result=await stop;
 const replacementStillRunning=reportWatchStatus(dir).running;
 const archive=JSON.parse(fs.readFileSync(path.join(dir,'report-watch-history',`${tokenFirst}.json`),'utf8'));
 assert.equal(result.ok,false);assert.match(result.error,/EISDIR/);assert.equal(result.error,originalFailure);
 assert.equal(archive.status,'failed');assert.equal(archive.last_error,originalFailure);assert.equal(archive.token,tokenFirst);assert.equal(archive.running,false);
 assert.notEqual(replacement.token,tokenFirst);assert.equal(replacementStillRunning,true);assert.ok(Date.now()-started<2000);
 const evidence={root,dir,originalFailure,first_token:tokenFirst,replacement_token:replacement.token,replacement_still_running:replacementStillRunning,elapsed_ms:Date.now()-started,archive,stop:result};
 fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
} finally {controller.abort();await transition;await next;}
