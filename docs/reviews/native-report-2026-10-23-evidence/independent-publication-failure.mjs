import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { initRun } from '~/Developer/harness/skills/make-me-happy/scripts/run-meta.mjs';
import { buildReport } from '~/Developer/harness/skills/make-me-happy/scripts/build-report.mjs';
import { prepareNativeReport, bindNativeReport, tickNativeReport, stopNativeReport } from '~/Developer/harness/skills/make-me-happy/scripts/report-native.mjs';
import { reportWatchStatus } from '~/Developer/harness/skills/make-me-happy/scripts/report-watch-state.mjs';
const root=fs.mkdtempSync('/tmp/mmh-native-publish-failure-');fs.writeFileSync(path.join(root,'spec.md'),'fixture');
const {dir}=initRun(root,{spec:'spec.md'}), old=new Date(Date.now()-900000), file=path.join(dir,'report.html');
const state=prepareNativeReport(dir,{kind:'schedule',provider:'fixture only',now:old});bindNativeReport(dir,state.token,'fixture-job');tickNativeReport(dir,state.token,{now:old});
buildReport(dir);const previous=fs.readFileSync(file,'utf8');assert.match(previous,/Sem ciclo nativo confirmado/);
const originalRename=fs.renameSync;
fs.renameSync=function(from,to){if(path.resolve(String(to))===file){const error=Error('fixture publication EIO');error.code='EIO';throw error;}return originalRename.call(this,from,to);};
let failedTick,failedStop;
try {
 assert.throws(()=>tickNativeReport(dir,state.token),/fixture publication EIO/);
 failedTick=reportWatchStatus(dir);assert.equal(failedTick.last_success_at,old.toISOString());assert.equal(failedTick.stale,true);assert.equal(failedTick.failures,1);assert.equal(fs.readFileSync(file,'utf8'),previous);
 assert.throws(()=>stopNativeReport(dir,state.token),/fixture publication EIO/);
 failedStop=reportWatchStatus(dir);assert.equal(failedStop.status,'failed');assert.equal(failedStop.last_success_at,old.toISOString());assert.equal(fs.readFileSync(file,'utf8'),previous);
} finally {fs.renameSync=originalRename;}
const stopped=stopNativeReport(dir,state.token);assert.equal(stopped.status,'stopped');assert.equal(stopped.last_error,null);assert.match(fs.readFileSync(file,'utf8'),/data-auto-refresh="false"/);
const evidence={root,dir,old_success_at:old.toISOString(),failed_tick_preserved_heartbeat:failedTick.last_success_at===old.toISOString(),failed_tick_stale:failedTick.stale,failed_stop_status:failedStop.status,failed_stop_error:failedStop.last_error,previous_html_preserved_during_both_failures:true,repaired_stop:stopped.status};fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
