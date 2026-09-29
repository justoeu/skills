#!/usr/bin/env python3
"""Atlas Docs — build.

Valida app-model.json, apura cobertura/score de forma determinística,
mascara segredos por defesa de profundidade e injeta o modelo no template,
produzindo um index.html standalone (file:// friendly).

Uso:
  atlas_build.py MODEL.json --template TEMPLATE.html -o index.html
  atlas_build.py MODEL.json --check-only
"""
import argparse
import json
import math
import re
import sys

REQUIRED = {
    "app": ["name", "commit"],
    "identity": [],
    "flows": [],
}
FLOW_STEP_POINTS = {
    "payload": 25, "src": 20, "calls": 15, "errs": 15, "does": 15, "touches": 10,
}
SECRET_KEY_RE = re.compile(
    r"(?i)^(password|passwd|pwd|secret|secrets|token|api_key|apikey|private_key"
    r"|authorization|auth|credential|credentials|client_secret|access_key)$"
)
SECRET_VAL_RE = re.compile(
    r"(?i)(password|passwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*([^\s\"'{][^\s\"'}]*)"
)
MASK = "****"


def die(msg):
    print(f"ERRO: {msg}", file=sys.stderr)
    sys.exit(1)


def warn(msg):
    print(f"aviso: {msg}", file=sys.stderr)


# ---------------------------------------------------------------- masking
def mask_string(key, value):
    if SECRET_KEY_RE.match(key or "") and value and MASK not in value:
        return MASK
    return SECRET_VAL_RE.sub(lambda m: m.group(1) + ": " + MASK, value)


def walk_mask(obj, key=None):
    if isinstance(obj, dict):
        return {k: walk_mask(v, k) for k, v in obj.items()}
    if isinstance(obj, list):
        return [walk_mask(v, key) for v in obj]
    if isinstance(obj, str):
        return mask_string(key, obj)
    return obj


# ---------------------------------------------------------------- scoring
SECRET_NAME_RE = re.compile(r"(?i)(key|secret|token|passwd|password|credential|private)")


def mask_env(model):
    """Força SEGREDO/**** em variável cujo nome denuncia credencial."""
    for v in (model.get("env") or {}).get("vars") or []:
        if not isinstance(v, dict):
            continue
        if v.get("secret") or SECRET_NAME_RE.search(str(v.get("name", ""))):
            v["secret"] = True
            if v.get("value") not in (None, "", MASK):
                v["value"] = MASK
            if v.get("default") not in (None, "", MASK):
                v["default"] = MASK


def pct(x):
    return int(round(x))


def step_completeness(step):
    total = 0
    for field, pts in FLOW_STEP_POINTS.items():
        v = step.get(field)
        if field in ("calls", "errs", "touches"):
            if isinstance(v, list) and v:
                total += pts
        elif v:
            total += pts
    return total


def flow_coverage(flow):
    steps = flow.get("steps") or []
    if not steps:
        return None
    if isinstance(flow.get("cov"), int) and flow.get("cov") >= 0:
        return flow["cov"]
    return pct(sum(step_completeness(s) for s in steps) / len(steps))


def fill_flow_coverage(model):
    for f in model.get("flows") or []:
        cov = flow_coverage(f)
        if cov is not None:
            f["cov"] = cov
        else:
            f["cov"] = f.get("cov", 0)


def env_score(model):
    """% de variáveis com descrição e uso mapeado (fluxo ou arquivo)."""
    vars_ = (model.get("env") or {}).get("vars") or []
    if not vars_:
        return None
    good = sum(1 for v in vars_
               if isinstance(v, dict) and v.get("desc") and (v.get("flows") or v.get("used")))
    return pct(100 * good / len(vars_))


def compute_score(model):
    flows = model.get("flows") or []
    doc = pct(sum(f["cov"] for f in flows) / len(flows)) if flows else 0
    data = model.get("data") or {}
    contracts = model.get("contracts") or {}
    model_comp = 0
    if (data.get("model") or []):
        model_comp += 40
    if (data.get("ddl") or {}).get("sql"):
        model_comp += 30
    if (contracts.get("endpoints") or []):
        model_comp += 30
    env = env_score(model)
    gates = (model.get("quality") or {}).get("gates") or []
    gate_vals = {"pass": 100, "warn": 60, "fail": 0}
    gate_scores = [gate_vals[g["status"]] for g in gates
                   if isinstance(g, dict) and g.get("status") in gate_vals]
    breakdown = [
        {"k": "Cobertura dos fluxos", "v": doc, "weight": "45%", "prov": "code"},
        {"k": "Modelo & contratos", "v": model_comp, "weight": "20%", "prov": "code"},
    ]
    if env is not None:
        breakdown.append({"k": "Variáveis de ambiente", "v": env, "weight": "10%", "prov": "code"})
    else:
        breakdown.append({"k": "Variáveis de ambiente", "v": None, "weight": "10%", "prov": "external"})
    if gate_scores:
        gates_score = pct(sum(gate_scores) / len(gate_scores))
        breakdown.append({"k": "Quality gates", "v": gates_score, "weight": "25%", "prov": "code"})
    else:
        gates_score = None
        breakdown.append({"k": "Quality gates", "v": None, "weight": "25%", "prov": "external"})
    # buckets ausentes ficam como lacuna visível e NÃO derrubam a nota: renormaliza
    buckets = [(0.45, doc), (0.20, model_comp)]
    if env is not None:
        buckets.append((0.10, env))
    if gates_score is not None:
        buckets.append((0.25, gates_score))
    overall = pct(sum(w * v for w, v in buckets) / sum(w for w, _ in buckets))
    grade = "A" if overall >= 90 else "B" if overall >= 75 else "C" if overall >= 60 else "D" if overall >= 40 else "F"
    return {"overall": overall, "grade": grade, "breakdown": breakdown}


# ---------------------------------------------------------------- validate
def validate_entrypoints(model):
    """Régua de exaustividade: cada entrypoint termina mapeado ou trivial."""
    eps = model.get("entrypoints") or []
    flow_ids = {f.get("id") for f in model.get("flows") or []}
    errors, warnings = [], []
    for i, e in enumerate(eps):
        ref = e.get("ref", f"#{i}")
        st = e.get("status")
        if st == "nao-mapeado":
            errors.append(
                f"entrypoints[{i}] '{ref}' está nao-mapeado — scan deep não fecha: "
                "documente o fluxo (status mapeado + flow) ou justifique como trivial"
            )
        elif st == "mapeado":
            if e.get("flow") not in flow_ids:
                errors.append(f"entrypoints[{i}] '{ref}' aponta para fluxo inexistente '{e.get('flow')}'")
        elif st == "trivial":
            if not e.get("note"):
                warnings.append(f"entrypoints[{i}] '{ref}' trivial sem note explicando por quê")
        else:
            errors.append(
                f"entrypoints[{i}] '{ref}' status inválido '{st}' (use mapeado | trivial | nao-mapeado)"
            )
    return errors, warnings


def validate(model):
    errors, warnings = [], []
    if not isinstance(model, dict):
        die("raiz do modelo precisa ser objeto")
    if model.get("schema") != "atlas-docs/1":
        warnings.append('campo schema deveria ser "atlas-docs/1"')
    for section, fields in REQUIRED.items():
        v = model.get(section)
        if section in ("app",) and not isinstance(v, dict):
            errors.append("seção app ausente")
            continue
        if isinstance(v, dict):
            for f in fields:
                if not v.get(f):
                    errors.append(f"app.{f} ausente")
    if not model.get("flows"):
        warnings.append("nenhum fluxo extraído — dashboard fica vazio na página Fluxos")
    elif not model.get("entrypoints"):
        warnings.append(
            "sem inventário de entrypoints — a régua de exaustividade (TODOS os fluxos) "
            "fica sem prova; liste cada rota/consumer/cron/webhook e marque mapeado|trivial"
        )
    for i, f in enumerate(model.get("flows") or []):
        if not f.get("id"):
            errors.append(f"flows[{i}] sem id")
        fid = f.get("id", i)
        if not (f.get("steps") or []):
            warnings.append(f"fluxo '{fid}' sem steps")
        brief = f.get("brief") if isinstance(f.get("brief"), dict) else {}
        missing = []
        if not (brief.get("what") or f.get("resumo")):
            missing.append("what")
        if not brief.get("does"):
            missing.append("does")
        if not (isinstance(brief.get("happy"), list) and brief.get("happy")):
            missing.append("happy")
        if not (isinstance(brief.get("unhappy"), list) and brief.get("unhappy")):
            missing.append("unhappy")
        if missing:
            warnings.append(
                f"fluxo '{fid}' brief incompleto ({', '.join(missing)}) — "
                "o card do topo precisa de what, does, happy, unhappy"
            )
        d = f.get("diagram")
        if d:
            ids = {n.get("id") for n in d.get("nodes") or []}
            if not ids:
                warnings.append(f"fluxo '{f['id']}' tem diagram sem nodes")
            for j, e in enumerate(d.get("edges") or []):
                if e.get("from") not in ids or e.get("to") not in ids:
                    errors.append(
                        f"fluxo '{f['id']}' diagram.edges[{j}] referencia nó inexistente ({e.get('from')}→{e.get('to')})"
                    )
    return errors, warnings


# ---------------------------------------------------------------- inject
def inject(template_html, model):
    payload = json.dumps(model, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    marker = '<script id="atlas-data" type="application/json">@@ATLAS_DATA@@</script>'
    if marker not in template_html:
        marker_re = re.compile(
            r'(<script id="atlas-data" type="application/json">).*?(</script>)', re.S
        )
        if not marker_re.search(template_html):
            die("template sem island <script id=\"atlas-data\"> — use o template da skill")
        return marker_re.sub(lambda m: m.group(1) + payload + m.group(2), template_html, count=1)
    return template_html.replace(marker, '<script id="atlas-data" type="application/json">' + payload + "</script>", 1)


def main():
    ap = argparse.ArgumentParser(description="Atlas Docs build")
    ap.add_argument("model", help="caminho do app-model.json")
    ap.add_argument("--template", help="caminho do template.html da skill")
    ap.add_argument("-o", "--out", help="saída index.html (default: ao lado do model)")
    ap.add_argument("--check-only", action="store_true", help="só valida e apura, não escreve HTML")
    args = ap.parse_args()

    try:
        with open(args.model, encoding="utf-8") as fh:
            model = json.load(fh)
    except OSError as e:
        die(f"não consegui ler {args.model}: {e}")
    except json.JSONDecodeError as e:
        die(f"JSON inválido em {args.model}: {e}")

    model = walk_mask(model)
    mask_env(model)
    fill_flow_coverage(model)
    errors, warnings = validate(model)
    ep_errors, ep_warnings = validate_entrypoints(model)
    errors += ep_errors
    warnings += ep_warnings
    for w in warnings:
        warn(w)
    if errors:
        for e in errors:
            print(f"ERRO: {e}", file=sys.stderr)
        die("modelo inválido — corrija antes do build")

    model["score"] = compute_score(model)

    eps = model.get("entrypoints") or []
    ep_summary = ""
    if eps:
        n_map = sum(1 for e in eps if e.get("status") == "mapeado")
        n_tri = sum(1 for e in eps if e.get("status") == "trivial")
        ep_summary = f" · entrypoints: {n_map} mapeados · {n_tri} triviais"

    cov = (model.get("history") or {}).get("coverage")
    today = (model.get("app") or {}).get("generatedAt", "")[:10]
    if isinstance(cov, list):
        if not cov or str(cov[-1].get("day")) != today:
            cov.append({"day": today or "hoje", "v": model["score"]["overall"]})
            model.setdefault("history", {})["coverage"] = cov

    scans = (model.get("history") or {}).get("scans") or []
    if scans and isinstance(scans[0], dict):
        prev = scans[0].pop("__prevOverall", None)
        if prev is not None and scans[0].get("delta") in ("…", "±?", "—"):
            d = model["score"]["overall"] - int(prev)
            scans[0]["delta"] = f"{d:+d}%"
            scans[0]["deltaKind"] = "ok" if d >= 0 else "bad"

    with open(args.model, "w", encoding="utf-8") as fh:
        json.dump(model, fh, ensure_ascii=False, indent=1)
        fh.write("\n")

    print(f"score {model['score']['overall']} ({model['score']['grade']}) · "
          f"{len(model.get('flows') or [])} fluxos{ep_summary} · cov: "
          + ", ".join(f"{f['id']}={f['cov']}%" for f in model.get("flows") or []))

    if args.check_only:
        return

    if not args.template:
        die("informe --template (assets/template.html da skill)")
    try:
        with open(args.template, encoding="utf-8") as fh:
            template = fh.read()
    except OSError as e:
        die(f"não consegui ler o template: {e}")

    if args.out:
        out = args.out
    else:
        base = args.model.rsplit("/", 1)
        out = (base[0].rstrip("/") + "/index.html") if len(base) == 2 else "index.html"
    html = inject(template, model)
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(html)
    print(f"ok → {out} ({len(html)//1024} KB)")


if __name__ == "__main__":
    main()
