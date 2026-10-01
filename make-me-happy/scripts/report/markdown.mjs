/**
 * Small, safe markdown → HTML renderer for the report (no dependencies).
 * Everything is escaped first; only a fixed set of constructs becomes markup.
 * Supports headings (with ids for a TOC), paragraphs, ul/ol (one nesting level
 * by indentation), blockquote, hr, fenced code, GFM tables, inline code, bold,
 * italic, strike and links (http/https/relative/# only).
 */

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function slugify(text, used) {
  let base = String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'secao';
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}

function safeHref(url) {
  const u = url.trim();
  if (/^(https?:|mailto:)/i.test(u)) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return null; // javascript:, data:, …
  return u;
}

export function inline(text) {
  const codes = [];
  let s = String(text ?? '').replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) => {
    const h = safeHref(href.replace(/&amp;/g, '&'));
    return h == null ? label : `<a href="${esc(h)}" rel="noopener">${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[\s(])_([^_\s][^_]*)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`);
  return s;
}

function splitRow(line) {
  let l = line.trim();
  if (l.startsWith('|')) l = l.slice(1);
  if (l.endsWith('|') && !l.endsWith('\\|')) l = l.slice(0, -1);
  const cells = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < l.length; i++) {
    const ch = l[i];
    if (ch === '`') inCode = !inCode;
    if (ch === '\\' && l[i + 1] === '|') { cur += '|'; i++; continue; }
    if (ch === '|' && !inCode) { cells.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const listRe = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

/**
 * @returns {{ html: string, toc: Array<{level:number,id:string,text:string}> }}
 */
export function renderMarkdown(src, { idPrefix = '', headingOffset = 0 } = {}) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const toc = [];
  const used = new Set();
  let i = 0;
  let para = [];

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join(' '))}</p>`);
      para = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*(```+|~~~+)\s*([\w+-]*)/);
    if (fence) {
      flushPara();
      const marker = fence[1];
      const lang = fence[2] || '';
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(marker)) buf.push(lines[i++]);
      i++;
      const cls = lang ? ` class="lang-${esc(lang)}"` : '';
      out.push(`<pre class="code"${cls}><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      flushPara();
      const level = Math.min(6, h[1].length + headingOffset);
      const text = h[2];
      const id = idPrefix + slugify(text, used);
      toc.push({ level: h[1].length, id, text: text.replace(/[`*_]/g, '') });
      out.push(`<h${level} id="${esc(id)}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushPara();
      out.push('<hr/>');
      i++;
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flushPara();
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') rows.push(splitRow(lines[i++]));
      out.push(`<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${
        rows.map((r) => `<tr>${head.map((_, k) => `<td>${inline(r[k] ?? '')}</td>`).join('')}</tr>`).join('')
      }</tbody></table></div>`);
      continue;
    }
    if (/^\s*>/.test(line)) {
      flushPara();
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'), { idPrefix: `${idPrefix}q${i}-` }).html}</blockquote>`);
      continue;
    }
    const li = line.match(listRe);
    if (li) {
      flushPara();
      const ordered = /\d/.test(li[2]);
      const baseIndent = li[1].length;
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(listRe);
        if (m && m[1].length <= baseIndent + 1) {
          items.push({ text: m[3], sub: [] });
          i++;
        } else if (m && items.length) {
          items[items.length - 1].sub.push({ text: m[3], ordered: /\d/.test(m[2]) });
          i++;
        } else if (lines[i].trim() !== '' && /^\s{2,}\S/.test(lines[i]) && items.length) {
          const last = items[items.length - 1];
          if (last.sub.length) last.sub[last.sub.length - 1].text += ` ${lines[i].trim()}`;
          else last.text += ` ${lines[i].trim()}`;
          i++;
        } else break;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((it) => {
        const sub = it.sub.length
          ? `<${it.sub[0].ordered ? 'ol' : 'ul'}>${it.sub.map((s) => `<li>${inline(s.text)}</li>`).join('')}</${it.sub[0].ordered ? 'ol' : 'ul'}>`
          : '';
        const task = it.text.match(/^\[([ xX])\]\s+(.*)$/);
        const body = task
          ? `<span class="check ${task[1] === ' ' ? '' : 'on'}" aria-hidden="true"></span>${inline(task[2])}`
          : inline(it.text);
        return `<li>${body}${sub}</li>`;
      }).join('')}</${tag}>`);
      continue;
    }
    if (line.trim() === '') {
      flushPara();
      i++;
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flushPara();
  return { html: out.join('\n'), toc };
}
