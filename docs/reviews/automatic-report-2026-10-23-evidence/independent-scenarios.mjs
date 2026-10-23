import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { initRun, updateTask } from '~/Developer/harness/skills/make-me-happy/scripts/run-meta.mjs';
import { readJson, writeJson, captureEvidence, sameEvidence, artifactIdentity, withPackLock } from '~/Developer/harness/skills/make-me-happy/scripts/state-io.mjs';
import { writeTaskProgress } from '~/Developer/harness/skills/make-me-happy/scripts/task-progress.mjs';
import { buildReport } from '~/Developer/harness/skills/make-me-happy/scripts/build-report.mjs';
import { reportWatchStatus, stopReportWatch } from '~/Developer/harness/skills/make-me-happy/scripts/report-watch.mjs';
const source = '~/Developer/harness/skills/make-me-happy/scripts';
const root = fs.mkdtempSync('/tmp/mmh-report-watch-forward-');
const results = [];
const children = [];
function pass(name) { results.push({ name, ok: true }); console.log('PASS', name); }
function command(cmd, args) { const r=spawnSync(cmd,args,{cwd:root,encoding:'utf8'}); assert.equal(r.status,0,r.stderr); return r; }
async function until(fn, timeout=5000) { const end=Date.now()+timeout; while(Date.now()<end){if(fn())return;await delay(25);}throw Error('timeout'); }
const file = (dir,n) => path.join(dir,n);
const html = dir => fs.readFileSync(file(dir,'report.html'),'utf8');
function launch(dir) {
 const child=spawn(process.execPath,[`${source}/report-watch.mjs`,'start','--dir',dir,'--interval-seconds','1'],{stdio:['ignore','pipe','pipe']});
 children.push(child); child.lines=[];child.err='';let text='';child.stdout.on('data',x=>{text+=x;let i;while((i=text.indexOf('\n'))>=0){const row=text.slice(0,i);text=text.slice(i+1);if(row)child.lines.push(JSON.parse(row));}});child.stderr.on('data',x=>child.err+=x);return child;
}
try {
 command('git',['init','-q']);command('git',['config','user.email','fixture@example.invalid']);command('git',['config','user.name','Fixture']);
 fs.writeFileSync(path.join(root,'source.mjs'),'export const result = 1;\n');fs.writeFileSync(path.join(root,'spec.md'),'RF-1: expose result.\n');command('git',['add','.']);command('git',['commit','-qm','fixture']);
 const {dir}=initRun(root,{spec:'spec.md',kind:'feature'});
 writeJson(file(dir,'TASKS.json'),{tasks:[{id:'T-001',title:'Exponha o resultado',status:'IN_PROGRESS',version:1,validation:'red-green',refs:['RF-1']}]});
 const initialEvidence=captureEvidence(dir), identity=artifactIdentity(dir), tasksBefore=fs.readFileSync(file(dir,'TASKS.json'),'utf8');
 writeTaskProgress(dir,{id:'T-001',expected_version:1,summary:'Leitura concluída; validação pendente.',status:'DONE',checks:[{ok:true}],next:['Executar cenário real']});
 assert.equal(fs.readFileSync(file(dir,'TASKS.json'),'utf8'),tasksBefore);assert.equal(artifactIdentity(dir),identity);assert.ok(sameEvidence(initialEvidence,captureEvidence(dir)));assert.match(html(dir),/ainda não validado/);pass('progress and report leave task state and evidence identity unchanged');
 const a=launch(dir);await until(()=>a.lines.some(x=>x.ok)); const tokenA=reportWatchStatus(dir).token;
 const duplicate=spawnSync(process.execPath,[`${source}/report-watch.mjs`,'start','--dir',dir],{encoding:'utf8'});assert.equal(duplicate.status,1);assert.match(duplicate.stderr,/already running/);assert.equal(reportWatchStatus(dir).token,tokenA);pass('duplicate CLI start preserves existing lease');
 const taskDoc=readJson(file(dir,'TASKS.json'));taskDoc.tasks[0].notes='Periodic visible change';writeJson(file(dir,'TASKS.json'),taskDoc);await until(()=>html(dir).includes('Periodic visible change'));pass('real one-second timer observes latest canonical state');
 a.kill('SIGKILL');await until(()=>a.signalCode==='SIGKILL');assert.equal(reportWatchStatus(dir).running,false);
 const afterKill=readJson(file(dir,'TASKS.json'));afterKill.tasks[0].notes='Recovered after hard kill';writeJson(file(dir,'TASKS.json'),afterKill);
 await stopReportWatch(dir);assert.match(html(dir),/Recovered after hard kill/);assert.match(html(dir),/data-auto-refresh="false"/);pass('stop after SIGKILL flushes latest data and removes automatic refresh');
 const b=launch(dir);await until(()=>b.lines.some(x=>x.ok));assert.notEqual(reportWatchStatus(dir).token,tokenA);
 await stopReportWatch(dir);await until(()=>b.exitCode!==null);assert.equal(b.exitCode,0,b.err);assert.match(html(dir),/data-auto-refresh="false"/);pass('restart after SIGKILL and cooperative stop complete');
 const saved=html(dir);withPackLock(dir,()=>assert.throws(()=>buildReport(dir),/writer busy/));assert.equal(html(dir),saved);pass('busy writer prevents replacing report');
 fs.renameSync(file(dir,'report.html'),file(dir,'previous-report.html'));fs.mkdirSync(file(dir,'report.html'));
 const updated=updateTask(dir,{id:'T-001',expected_version:1,patch:{status:'BLOCKED',notes:'Saved despite presentation failure'}});assert.equal(updated.version,2);assert.equal(readJson(file(dir,'TASKS.json')).tasks[0].status,'BLOCKED');
 fs.rmdirSync(file(dir,'report.html'));buildReport(dir,{strict:true});assert.match(html(dir),/Saved despite presentation failure/);assert.doesNotMatch(html(dir),/Leitura concluída; validação pendente/);pass('failed presentation preserves versioned mutation; rebuild excludes older progress');
 const beforeCorruption=html(dir), knownGood=fs.readFileSync(file(dir,'TASKS.json'),'utf8');fs.writeFileSync(file(dir,'TASKS.json'),'{partial');assert.throws(()=>buildReport(dir,{strict:true}));assert.equal(html(dir),beforeCorruption);fs.writeFileSync(file(dir,'TASKS.json'),knownGood);pass('strict build preserves previous HTML on invalid canonical JSON');
 console.log(JSON.stringify({root,dir,results}));
 fs.writeFileSync(path.join(root,'results.json'),JSON.stringify({root,dir,results},null,2)+'\n');
} finally { for(const c of children)if(c.exitCode===null&&c.signalCode===null)c.kill('SIGKILL'); }
