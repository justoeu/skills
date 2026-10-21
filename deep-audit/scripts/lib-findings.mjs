/**
 * lib-findings.mjs — schema canônico do deep-audit (ultra-deep).
 *
 * Fonte única da verdade para: lentes, agentes, severidade, DESFECHO
 * (open | resolved | refuted | accepted) e as regras que o código — não o
 * modelo — precisa garantir:
 *
 *   1. `resolved` exige o teste red→green que prova a correção.
 *   2. `accepted` exige os 4 campos (o quê · consequência · reabre-se-quando ·
 *      quem ratificou) e um subtipo válido.
 *   3. HIGH/CRITICAL nunca podem ser `accepted`.
 *   4. `refuted` exige a evidência que derruba a premissa.
 *
 * `refuted` (não existe defeito) e `accepted` (existe, risco assumido) são
 * contados separadamente em todo lugar. Somá-los é mentir sobre a postura de
 * risco do projeto.
 */

export const LENSES = [
  'architecture',
  'quality',
  'complexity',
  'duplication',
  'verbosity',
  'best_practices',
  'security',
  'performance',
  'nplus1',
  'race',
  'memleak',
  'backpressure',
  'tests',
  'deps',
  'classic_bugs',
];

export const LENS_LABEL = {
  architecture: 'Arquitetura',
  quality: 'Qualidade',
  complexity: 'Complexidade',
  duplication: 'Duplicação',
  verbosity: 'Verbosidade',
  best_practices: 'Boas práticas',
  security: 'Segurança',
  performance: 'Performance',
  nplus1: 'N+1',
  race: 'Race',
  memleak: 'Memory leak',
  backpressure: 'Backpressure',
  tests: 'Testes',
  deps: 'Dependências',
  classic_bugs: 'Bugs clássicos',
};

export const LENS_PREFIX = {
  architecture: 'ARCH',
  quality: 'CQ',
  complexity: 'CPX',
  duplication: 'DUP',
  verbosity: 'VERB',
  best_practices: 'BEST',
  security: 'SEC',
  performance: 'PERF',
  nplus1: 'N1',
  race: 'RACE',
  memleak: 'LEAK',
  backpressure: 'BP',
  tests: 'TEST',
  deps: 'DEP',
  classic_bugs: 'BUG',
};

/** Roster: nome do agente → { code, lens, emoji, color, blurb } */
export const AGENTS = {
  Atlas: { code: 'ATL', lens: 'architecture', emoji: '🏛️', color: '#6366f1', blurb: 'Arquitetura limpa / camadas' },
  Aurora: { code: 'AUR', lens: 'quality', emoji: '🌅', color: '#84cc16', blurb: 'Dirty code / erro engolido / código morto' },
  Dédalo: { code: 'DED', lens: 'complexity', emoji: '🌀', color: '#10b981', blurb: 'Complexidade ciclomática / cognitiva' },
  Eco: { code: 'ECO', lens: 'duplication', emoji: '🪞', color: '#f43f5e', blurb: 'Código duplicado / clones divergentes' },
  Lacônio: { code: 'LAC', lens: 'verbosity', emoji: '✂️', color: '#71717a', blurb: 'Verbosidade / cerimônia / boilerplate' },
  Atena: { code: 'ATE', lens: 'best_practices', emoji: '🦉', color: '#3b82f6', blurb: 'Boas práticas / idiomas / patterns por linguagem' },
  Cérbero: { code: 'CER', lens: 'security', emoji: '🛡️', color: '#ef4444', blurb: 'Segurança / authz (fast | deep panel)' },
  Fluxo: { code: 'FLU', lens: 'performance', emoji: '⚡', color: '#f59e0b', blurb: 'Hot paths / I/O / re-render' },
  Enxame: { code: 'ENX', lens: 'nplus1', emoji: '🐝', color: '#eab308', blurb: 'N+1 backend e frontend' },
  Cronos: { code: 'CRO', lens: 'race', emoji: '⏱️', color: '#8b5cf6', blurb: 'Race conditions / CAS / PBT' },
  Fantasma: { code: 'FAN', lens: 'memleak', emoji: '👻', color: '#06b6d4', blurb: 'Memory leaks / retenção' },
  Represa: { code: 'REP', lens: 'backpressure', emoji: '🚧', color: '#0ea5e9', blurb: 'Backpressure / exaustão de recursos' },
  Argus: { code: 'ARG', lens: 'tests', emoji: '👁️', color: '#14b8a6', blurb: 'Qualidade de testes / falso-verde' },
  Prisma: { code: 'PRI', lens: 'deps', emoji: '💎', color: '#ec4899', blurb: 'Deps / CVE / latest stable' },
  Artemis: { code: 'ART', lens: 'classic_bugs', emoji: '🏹', color: '#f97316', blurb: 'Caça-bugs / correção clássica' },
  Cético: { code: 'CET', lens: 'quality', emoji: '🧐', color: '#94a3b8', blurb: 'Verificação adversarial' },
  Maestro: { code: 'MAE', lens: 'quality', emoji: '🎼', color: '#a855f7', blurb: 'Orquestração / consolidação' },
};

/** Aliases (roster em inglês da skill de origem e ids de subagente). */
export const AGENT_ALIAS = {
  Sentinel: 'Cérbero',
  sentinel: 'Cérbero',
  'cerbero-seguranca': 'Cérbero',
  Cerbero: 'Cérbero',
  Nexus: 'Fluxo',
  'fluxo-performance': 'Fluxo',
  'enxame-nplus1': 'Enxame',
  Hermes: 'Cronos',
  'cronos-race': 'Cronos',
  Hydra: 'Fantasma',
  'fantasma-memleak': 'Fantasma',
  'represa-backpressure': 'Represa',
  Forge: 'Aurora',
  'aurora-qualidade': 'Aurora',
  Prism: 'Prisma',
  'prisma-dependencias': 'Prisma',
  'argus-testes': 'Argus',
  'atlas-arquitetura': 'Atlas',
  'artemis-caca-bugs': 'Artemis',
  Oracle: 'Maestro',
  'maestro-deep-audit': 'Maestro',
  'cetico-verificador': 'Cético',
  Cetico: 'Cético',
  'dedalo-complexidade': 'Dédalo',
  Dedalo: 'Dédalo',
  'eco-duplicacao': 'Eco',
  'laconio-verbosidade': 'Lacônio',
  Laconio: 'Lacônio',
  'atena-boas-praticas': 'Atena',
};

export const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
export const SEV_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
export const SEV_COLOR = {
  CRITICAL: '#7f1d1d',
  HIGH: '#dc2626',
  MEDIUM: '#d97706',
  LOW: '#64748b',
  INFO: '#475569',
};

export const CONFIDENCES = ['low', 'medium', 'high'];
export const CONF_RANK = { low: 1, medium: 2, high: 3 };

/** Desfechos — ortogonais à severidade. */
export const STATUSES = ['open', 'resolved', 'refuted', 'accepted'];
export const STATUS_LABEL = {
  open: 'aberto',
  resolved: 'resolvido',
  refuted: 'refutado',
  accepted: 'aceito',
};
export const STATUS_COLOR = {
  open: '#ca8a04',
  resolved: '#16a34a',
  refuted: '#0891b2',
  accepted: '#7c3aed',
};

export const ACCEPT_TYPES = [
  'trade-off',
  'intencional',
  'fora-do-modelo-de-ameaca',
  'sem-correcao-disponivel',
  'divida-cosmetica',
];

export function normalizeAgent(name) {
  const raw = String(name || '').trim();
  if (!raw) return 'Maestro';
  if (AGENTS[raw]) return raw;
  if (AGENT_ALIAS[raw]) return AGENT_ALIAS[raw];
  const lower = raw.toLowerCase();
  for (const key of Object.keys(AGENTS)) {
    if (key.toLowerCase() === lower) return key;
  }
  for (const [alias, target] of Object.entries(AGENT_ALIAS)) {
    if (alias.toLowerCase() === lower) return target;
  }
  return raw; // agente desconhecido: preserva o nome, não inventa
}

export function normalizeLens(f) {
  const raw = String(f.lens || f.domain || '').toLowerCase().replace(/[\s-]+/g, '_');
  const direct = {
    architecture: 'architecture',
    arquitetura: 'architecture',
    code_quality: 'quality',
    quality: 'quality',
    qualidade: 'quality',
    complexity: 'complexity',
    complexidade: 'complexity',
    cyclomatic_complexity: 'complexity',
    cognitive_complexity: 'complexity',
    duplication: 'duplication',
    duplicacao: 'duplication',
    duplicate_code: 'duplication',
    dup: 'duplication',
    clones: 'duplication',
    verbosity: 'verbosity',
    verbosidade: 'verbosity',
    verbose_code: 'verbosity',
    ceremony: 'verbosity',
    best_practices: 'best_practices',
    boas_praticas: 'best_practices',
    idioms: 'best_practices',
    idiomatic: 'best_practices',
    design_patterns: 'best_practices',
    clean_code: 'best_practices',
    clean_arch: 'best_practices',
    security: 'security',
    seguranca: 'security',
    performance: 'performance',
    n1_performance: 'performance',
    n1: 'nplus1',
    nplus1: 'nplus1',
    n_plus_1: 'nplus1',
    race: 'race',
    resources: 'memleak',
    leak: 'memleak',
    memleak: 'memleak',
    memory_leak: 'memleak',
    backpressure: 'backpressure',
    test_quality: 'tests',
    tests: 'tests',
    testes: 'tests',
    deps: 'deps',
    dependencies: 'deps',
    deps_best_practices: 'deps',
    classic_bug: 'classic_bugs',
    classic_bugs: 'classic_bugs',
  };
  if (direct[raw]) return direct[raw];
  const agent = normalizeAgent(f.agent);
  return AGENTS[agent]?.lens || 'quality';
}

export function normalizeSeverity(s) {
  const u = String(s || 'MEDIUM').toUpperCase();
  return SEVERITIES.includes(u) ? u : 'MEDIUM';
}

export function normalizeConfidence(c) {
  const l = String(c || 'medium').toLowerCase();
  return CONFIDENCES.includes(l) ? l : 'medium';
}

/** Aceita OPEN/DONE (schema legado) e open/resolved/refuted/accepted. */
export function normalizeStatus(s) {
  const l = String(s || 'open').toLowerCase();
  const map = {
    open: 'open',
    aberto: 'open',
    todo: 'open',
    done: 'resolved',
    resolved: 'resolved',
    resolvido: 'resolved',
    fixed: 'resolved',
    refuted: 'refuted',
    refutado: 'refuted',
    'false-positive': 'refuted',
    false_positive: 'refuted',
    accepted: 'accepted',
    aceito: 'accepted',
    wontfix: 'accepted',
  };
  return map[l] || 'open';
}

export function idPrefix(f) {
  const lens = normalizeLens(f);
  const agent = normalizeAgent(f.agent);
  const code = AGENTS[agent]?.code || 'XXX';
  return `${LENS_PREFIX[lens] || 'F'}-${code}`;
}

export function dedupeKey(f) {
  const file = String(f.path || f.file || '').replace(/\\/g, '/');
  const line = Number(f.line) || 0;
  const lens = normalizeLens(f);
  const cat = String(f.category || f.classic_pattern || f.package || f.title || '')
    .toLowerCase()
    .slice(0, 80);
  return `${file}::${line}::${lens}::${cat}`;
}

export function prioOf(f) {
  const sev = normalizeSeverity(f.severity);
  const conf = normalizeConfidence(f.confidence);
  if (sev === 'CRITICAL' || (sev === 'HIGH' && conf === 'high')) return 'P0';
  if (sev === 'HIGH') return 'P1';
  if (sev === 'MEDIUM') return 'P2';
  return 'P3';
}

/** Achado ainda cobra ação? (aberto = sim; os outros 3 são desfechos fechados) */
export function isOpen(f) {
  return normalizeStatus(f.status) === 'open';
}

export function nonEmpty(v) {
  return typeof v === 'string' ? v.trim().length > 0 : v != null && v !== '';
}

/**
 * Auditoria de rótulo — a regra que o modelo não pode driblar.
 * Retorna { errors: [...], demoted: bool }; com `fix`, rebaixa o rótulo
 * inválido para `open` em vez de deixar passar como fechado.
 */
export function auditLabel(f, { fix = false } = {}) {
  const errors = [];
  const status = normalizeStatus(f.status);
  const sev = normalizeSeverity(f.severity);
  let demoted = false;

  const demote = (reason) => {
    errors.push(reason);
    if (fix) {
      f.status = 'open';
      f.label_audit = [...(f.label_audit || []), reason];
      demoted = true;
    }
  };

  if (status === 'resolved') {
    const test = f.resolved_test || f.test_red_green?.name;
    if (!nonEmpty(test) || String(test).trim().toUpperCase() === 'TBD') {
      demote(`${f.id}: 'resolvido' sem o teste que prova (red→green). Use --done ID --test "Suite#caso".`);
    }
  }

  if (status === 'refuted') {
    if (!nonEmpty(f.refuted_by)) {
      demote(`${f.id}: 'refutado' sem a evidência que derruba a premissa. Use --refute ID --evidence "...".`);
    }
  }

  if (status === 'accepted') {
    const a = f.accept || {};
    const missing = [];
    if (!nonEmpty(a.what)) missing.push('what (o que exatamente se aceita)');
    if (!nonEmpty(a.consequence)) missing.push('consequence (dano se a premissa cair)');
    if (!nonEmpty(a.reopen_if)) missing.push('reopen_if (gatilho que reabre)');
    if (!nonEmpty(a.ratified_by)) missing.push('ratified_by (quem ratificou)');
    if (missing.length) {
      demote(`${f.id}: 'aceito' incompleto — falta ${missing.join(', ')}. Sem os 4 campos é 'aberto', não 'aceito'.`);
    } else if (!ACCEPT_TYPES.includes(String(a.type || ''))) {
      demote(`${f.id}: 'aceito' com subtipo inválido "${a.type || ''}" (use ${ACCEPT_TYPES.join(' | ')}).`);
    } else if (sev === 'HIGH' || sev === 'CRITICAL') {
      demote(`${f.id}: ${sev} não é aceitável por design — reclassifique com evidência ou corrija.`);
    }
  }

  return { errors, demoted };
}

/** Normaliza um achado cru de agente para o schema canônico (in-place-safe). */
export function normalizeFinding(raw) {
  const f = { ...raw };
  f.agent = normalizeAgent(f.agent);
  f.lens = normalizeLens(f);
  f.domain = f.domain || f.lens;
  f.severity = normalizeSeverity(f.severity);
  f.confidence = normalizeConfidence(f.confidence);
  f.status = normalizeStatus(f.status);
  f.title = String(f.title || 'Achado sem título').trim();
  f.path = String(f.path || f.file || '').replace(/\\/g, '/');
  if (f.line != null && f.line !== '') f.line = Number(f.line) || null;
  f.evidence = f.evidence || f.description || '';
  f.impact = f.impact || '';
  f.fix = f.fix || '';
  if (!f.test_red_green || typeof f.test_red_green !== 'object') {
    f.test_red_green = { name: 'TBD', assert_before: 'reproduz o defeito', assert_after: 'defeito eliminado' };
  }
  if (Array.isArray(f.preconditions) === false && f.preconditions != null) {
    f.preconditions = [String(f.preconditions)];
  }
  delete f.file;
  delete f._src;
  return f;
}

export function counts(findings) {
  const out = {
    total: findings.length,
    open: 0,
    resolved: 0,
    refuted: 0,
    accepted: 0,
    blocks: 0,
    bySeverity: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 },
    byLens: {},
    byAgent: {},
    openHigh: 0,
  };
  for (const f of findings) {
    const st = normalizeStatus(f.status);
    out[st]++;
    const sev = normalizeSeverity(f.severity);
    out.bySeverity[sev]++;
    const lens = normalizeLens(f);
    out.byLens[lens] = (out.byLens[lens] || 0) + 1;
    const agent = normalizeAgent(f.agent);
    out.byAgent[agent] = (out.byAgent[agent] || 0) + 1;
    if (f.blocks_pr && st === 'open') out.blocks++;
    if (st === 'open' && (sev === 'HIGH' || sev === 'CRITICAL')) out.openHigh++;
  }
  return out;
}

export function nowStamp() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
}

export function cliArg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}

export function cliFlag(name) {
  return process.argv.includes(`--${name}`);
}
