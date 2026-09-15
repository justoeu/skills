#!/usr/bin/env node
/**
 * measure-quality.mjs — code-based hotspots for Daedalus / Echo / Laconic
 *
 *   node measure-quality.mjs --root . [--out quality-metrics.json]
 *     [--scope file1,file2]   # optional subset (delta paths)
 *     [--top 40]
 *     [--max-depth 32]        # directory recursion cap
 *     [--strict]              # exit non-zero if the traversal was incomplete
 *
 * Heuristic (not a full language parser):
 *  - CC ≈ 1 + decision keywords / operators in function-ish blocks
 *  - nesting max from brace/indent approximation
 *  - T1 clones via normalized line shingles (8-line windows)
 *
 * Output feeds agents; agents still verify path:line by reading source.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}

const root = path.resolve(arg('root', '.'));
const outPath = arg('out', '');
const scopeArg = arg('scope', '');
const topN = Number(arg('top', '40')) || 40;
// TOOL-ORC-002: the cap used to be a hardcoded 8, which silently swallowed
// backend/src/main/java/com/appgp/backend/<layer>/<pkg>/ (depth 9) — i.e. the whole
// Java side of a Spring repo — and reported nothing about it.
const maxDepth = Math.max(1, Number(arg('max-depth', '32')) || 32);
const strict = process.argv.includes('--strict');

/** Ledger of everything the walk refused to enter. Never let a skip be silent. */
const traversal = {
  max_depth: maxDepth,
  deepest_dir_depth: 0,
  truncated_dirs: [],
  skipped_dirs: [],
  unreadable_dirs: [],
};

const SKIP_DIR = new Set([
  'node_modules', '.git', 'vendor', '.build', 'build', 'dist', 'target',
  'coverage', '__pycache__', '.gradle', '.idea', 'Pods', 'DerivedData',
  'graphify-out', 'Docs', 'docs', '.venv', 'venv', 'bin', 'obj',
]);

const EXT = new Set([
  '.swift', '.go', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.java', '.kt', '.kts', '.py', '.rs', '.cs', '.rb', '.php',
  '.scala', '.m', '.mm',
]);

const DECISION_RE =
  /\b(if|else\s+if|elif|else\s*if|for|while|do|switch|case|catch|rescue|when|guard|unless|elseif)\b|(\?[^:]*:)|(\&\&|\|\|)/g;

const FN_START_RE =
  /^\s*(?:(?:public|private|internal|protected|open|override|static|final|async|export|default|fun|func|fn|function|def|void|int|string|bool|class|struct|actor)\s+)*[\w$<>\[\],\s]+\s+([\w$]+)\s*\([^;]*$|^\s*(?:export\s+)?(?:async\s+)?function\s+([\w$]+)|^\s*(?:export\s+)?const\s+([\w$]+)\s*=\s*(?:async\s*)?\(|^\s*func\s+([\w$]+)|^\s*fun\s+([\w$]+)|^\s*def\s+([\w$]+)|^\s*fn\s+([\w$]+)/;

function walk(dir, files, depth = 0) {
  if (depth > traversal.deepest_dir_depth) traversal.deepest_dir_depth = depth;
  if (depth > maxDepth) {
    traversal.truncated_dirs.push(rel(dir));
    return;
  }
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    traversal.unreadable_dirs.push({ path: rel(dir), error: String(e.code || e.message || e) });
    return;
  }
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (SKIP_DIR.has(ent.name) || ent.name.startsWith('.')) {
      // Symlinked directories report isDirectory() === false, so they are never
      // traversed and the walk cannot cycle — the cap is a guardrail, not a filter.
      if (ent.isDirectory()) {
        traversal.skipped_dirs.push({
          path: rel(p),
          reason: SKIP_DIR.has(ent.name) ? 'skip-list' : 'dot-directory',
        });
      }
      continue;
    }
    if (ent.isDirectory()) walk(p, files, depth + 1);
    else if (EXT.has(path.extname(ent.name))) files.push(p);
  }
}

function rel(p) {
  return path.relative(root, p).split(path.sep).join('/');
}

const TEST_PATH_RE =
  /(^|\/)(test|tests|__tests__|spec|__mocks__)\//i;
const TEST_FILE_RE = /(Test|Tests|IT|ITCase|TestCase)\.[a-z]+$|\.(test|spec)\.[a-z]+$/;

/** Test sources are measured too, but flagged so Daedalus/Laconic can rank production first. */
function isTestPath(fileRel) {
  return TEST_PATH_RE.test(fileRel) || TEST_FILE_RE.test(fileRel);
}

function normalizeLine(s) {
  return s
    .replace(/\/\/.*$/, '')
    .replace(/#.*$/, '')
    .replace(/\/\*.*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function countDecisions(text) {
  let n = 0;
  const re = new RegExp(DECISION_RE.source, 'g');
  let m;
  while ((m = re.exec(text)) !== null) n++;
  return n;
}

function maxNesting(lines) {
  let depth = 0;
  let max = 0;
  for (const line of lines) {
    const open = (line.match(/\{/g) || []).length;
    const close = (line.match(/\}/g) || []).length;
    depth += open;
    if (depth > max) max = depth;
    depth -= close;
    if (depth < 0) depth = 0;
  }
  // brace depth is absolute; nesting of interest is relative to function ≈ max-1
  return Math.max(0, max);
}

function extractFunctions(content, fileRel) {
  const lines = content.split(/\r?\n/);
  const fns = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(FN_START_RE);
    if (!m) {
      i++;
      continue;
    }
    const name =
      m[1] || m[2] || m[3] || m[4] || m[5] || m[6] || m[7] || 'anonymous';
    const start = i;
    let depth = 0;
    let started = false;
    let end = i;
    // Python: indent block
    if (fileRel.endsWith('.py')) {
      const baseIndent = (line.match(/^(\s*)/) || ['', ''])[1].length;
      end = i + 1;
      while (end < lines.length) {
        const L = lines[end];
        if (L.trim() === '') {
          end++;
          continue;
        }
        const ind = (L.match(/^(\s*)/) || ['', ''])[1].length;
        if (ind <= baseIndent && L.trim() !== '') break;
        end++;
      }
      end = Math.max(start + 1, end);
    } else {
      for (let j = i; j < lines.length; j++) {
        const L = lines[j];
        for (const ch of L) {
          if (ch === '{') {
            depth++;
            started = true;
          } else if (ch === '}') {
            depth--;
          }
        }
        end = j + 1;
        if (started && depth <= 0) break;
        // no-brace one-liner
        if (!started && j > i && /;\s*$/.test(L) && !L.includes('{')) {
          end = j + 1;
          break;
        }
      }
    }
    const bodyLines = lines.slice(start, end);
    const body = bodyLines.join('\n');
    const decisions = countDecisions(body);
    const cc = 1 + decisions;
    const loc = bodyLines.filter((l) => l.trim() && !/^\s*(\/\/|#|\/\*|\*)/.test(l)).length;
    const nesting = maxNesting(bodyLines);
    fns.push({
      path: fileRel,
      line: start + 1,
      symbol: name,
      cyclomatic: cc,
      cognitive_est: cc + Math.max(0, nesting - 1),
      nesting,
      loc,
      test_file: isTestPath(fileRel),
    });
    i = Math.max(i + 1, end);
  }
  return fns;
}

function shingles(content, fileRel) {
  const lines = content.split(/\r?\n/).map(normalizeLine);
  const out = [];
  const WIN = 8;
  for (let i = 0; i <= lines.length - WIN; i++) {
    const slice = lines.slice(i, i + WIN);
    if (slice.some((l) => l.length < 8)) continue;
    if (slice.filter((l) => l.length > 0).length < WIN - 1) continue;
    // skip brace-only / import heavy
    if (slice.every((l) => /^import |^using |^package |^from |^\{$|^\}$/.test(l) || !l))
      continue;
    const key = slice.join('\n');
    // Semgrep 965108856: Non-security fingerprint for local duplicate-code grouping; not an authenticity check.
    // nosemgrep: javascript.node-stdlib.cryptography.crypto-weak-algorithm.crypto-weak-algorithm
    const hash = crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
    out.push({ hash, path: fileRel, line: i + 1, preview: slice[0].slice(0, 80) });
  }
  return out;
}

// collect files
let files = [];
if (scopeArg) {
  for (const s of scopeArg.split(',').map((x) => x.trim()).filter(Boolean)) {
    const p = path.isAbsolute(s) ? s : path.join(root, s);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) files.push(p);
  }
} else {
  walk(root, files);
}

const functions = [];
const shingleMap = new Map(); // hash -> [{path,line,preview}]
const longFunctions = [];

for (const fp of files) {
  let content;
  try {
    content = fs.readFileSync(fp, 'utf8');
  } catch {
    continue;
  }
  if (content.length > 1_500_000) continue;
  const fileRel = rel(fp);
  const fns = extractFunctions(content, fileRel);
  for (const f of fns) {
    functions.push(f);
    if (f.loc >= 80 || f.cyclomatic >= 15) longFunctions.push(f);
  }
  for (const sh of shingles(content, fileRel)) {
    if (!shingleMap.has(sh.hash)) shingleMap.set(sh.hash, []);
    shingleMap.get(sh.hash).push(sh);
  }
}

functions.sort((a, b) => b.cyclomatic - a.cyclomatic || b.loc - a.loc);
const hotspots = functions.filter((f) => f.cyclomatic >= 12 || f.nesting >= 4).slice(0, topN);

const clones = [];
for (const [, locs] of shingleMap) {
  if (locs.length < 2) continue;
  // distinct files or far lines
  const uniq = [];
  for (const L of locs) {
    if (!uniq.some((u) => u.path === L.path && Math.abs(u.line - L.line) < 8)) {
      uniq.push(L);
    }
  }
  if (uniq.length < 2) continue;
  if (uniq.every((u) => u.path === uniq[0].path) && uniq.length < 2) continue;
  clones.push({
    clone_type: 'T1_heuristic',
    occurrences: uniq.slice(0, 8).map((u) => ({
      path: u.path,
      line: u.line,
      preview: u.preview,
    })),
  });
}
// limit clones
clones.sort((a, b) => b.occurrences.length - a.occurrences.length);
const clonesOut = clones.slice(0, topN);

const verbosity_candidates = functions
  .filter((f) => f.loc >= 60 && f.cyclomatic < 12)
  .sort((a, b) => b.loc - a.loc)
  .slice(0, topN);

const result = {
  generated_at: new Date().toISOString(),
  root,
  files_scanned: files.length,
  traversal: { ...traversal, complete: traversal.truncated_dirs.length === 0 && traversal.unreadable_dirs.length === 0 },
  thresholds: {
    cc_medium: 15,
    cc_high: 20,
    nesting_flag: 4,
    loc_god: 80,
    clone_window_lines: 8,
  },
  hotspots,
  long_low_cc: verbosity_candidates,
  clones: clonesOut,
  stats: {
    functions_found: functions.length,
    hotspots: hotspots.length,
    clone_groups: clonesOut.length,
    verbosity_candidates: verbosity_candidates.length,
  },
};

// Report the traversal before anything else: metrics measured over part of the tree
// are worse than no metrics, because they read as coverage.
if (!scopeArg) {
  console.error(
    `measure-quality: traversal depth=${traversal.deepest_dir_depth}/${maxDepth}, ` +
      `${traversal.skipped_dirs.length} dirs skipped by skip-list/dot-rule`,
  );
  for (const d of traversal.unreadable_dirs) {
    console.error(`measure-quality: WARN: unreadable directory ${d.path} (${d.error})`);
  }
  if (traversal.truncated_dirs.length) {
    console.error(
      `measure-quality: ERROR: metrics are INCOMPLETE — ${traversal.truncated_dirs.length} ` +
        `directories were not entered at --max-depth=${maxDepth}: ` +
        traversal.truncated_dirs.slice(0, 5).join(', ') +
        (traversal.truncated_dirs.length > 5 ? ', …' : '') +
        ' — raise --max-depth',
    );
  }
}

const text = JSON.stringify(result, null, 2) + '\n';
if (outPath) {
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, text);
  console.error(
    `measure-quality: ${files.length} files → ${hotspots.length} CC hotspots, ${clonesOut.length} clone groups → ${outPath}`,
  );
} else {
  process.stdout.write(text);
}

if (strict && !result.traversal.complete) {
  console.error('measure-quality: --strict: refusing to report metrics over an incomplete traversal');
  process.exit(2);
}
