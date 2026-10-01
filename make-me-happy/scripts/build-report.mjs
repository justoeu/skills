#!/usr/bin/env node
/**
 * Interactive HTML closeout for make-me-happy.
 *
 *   node build-report.mjs --dir docs/impl/make-me-happy/<run> [--out path/report.html]
 *
 * Self-contained single file (inline CSS/JS/SVG). Missing pack files render as
 * explicit empty states; schema drift is printed as warnings (never fatal).
 * Schemas: references/pack-schemas.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadPack } from './report/load-pack.mjs';
import { renderReport } from './report/render.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}

export function buildReport(dir, { out, now } = {}) {
  const abs = path.resolve(dir);
  const pack = loadPack(abs, { now });
  const html = renderReport(pack);
  const dest = path.resolve(out || path.join(abs, 'report.html'));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, html);
  return { path: dest, warnings: pack.warnings, html };
}

if (path.basename(process.argv[1] || '') === 'build-report.mjs') {
  const dir = arg('dir', '.');
  if (!fs.existsSync(dir)) {
    console.error(`pack dir not found: ${dir}`);
    process.exit(2);
  }
  const { path: dest, warnings } = buildReport(dir, { out: arg('out', '') || undefined });
  for (const w of warnings) console.error(`WARN ${w.file}: ${w.msg}`);
  console.log(dest);
}
