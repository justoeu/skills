#!/usr/bin/env python3
"""Atlas Docs — merge incremental.

Faz o merge determinístico de um scan novo (extraído pelo agente) sobre o
app-model.json existente, preserva histórico e registra a varredura.

Uso:
  atlas_merge.py OLD.json SCAN.json --mode delta|full \
      --commit abc1234 --when "14/09 09:41" --title "resumo do scan" \
      [--detail "..."] [-o merged.json]

Se OLD.json não existe, o scan vira a base (primeiro scan).
O scan pode trazer "__changelog": [{"tag": "NOVO|BREAK|DDL|DOC", "body": "..."}],
que é movido para o topo de history.changelog.
"""
import argparse
import copy
import datetime
import json
import sys

MASK = "****"

# listas do modelo → chave natural de upsert
LIST_KEYS = {
    ("flows",): "id",
    ("entrypoints",): ("kind", "ref"),
    ("contracts", "endpoints"): ("m", "path"),
    ("thirdParty",): "name",
    ("deps",): "name",
    ("data", "model"): "name",
    ("data", "tables"): "name",
    ("env", "vars"): "name",
    ("events", "topics"): ("topic", "group"),
    ("events", "catalog"): "name",
    ("architecture", "containers"): "name",
    ("architecture", "compose"): "name",
    ("architecture", "adrs"): "id",
    ("architecture", "libs"): "group",
    ("ops", "slos"): "name",
    ("ops", "owners"): "area",
}
LIB_ITEM_KEY = "name"
VALID_TAGS = {"NOVO", "BREAK", "DDL", "DOC", "REMOVE"}


def die(msg):
    print(f"ERRO: {msg}", file=sys.stderr)
    sys.exit(1)


def load(path, required):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        if required:
            die(f"arquivo não encontrado: {path}")
        return None
    except json.JSONDecodeError as e:
        die(f"JSON inválido em {path}: {e}")


def key_of(item, key):
    if isinstance(key, tuple):
        return tuple(str(item.get(k, "")) for k in key)
    return str(item.get(key, ""))


def upsert_list(old, new, key, full_mode):
    if full_mode:
        return copy.deepcopy(new)
    merged = copy.deepcopy(old)
    index = {key_of(i, key): i for i in merged}
    for item in new:
        k = key_of(item, key)
        if k in index:
            merged[merged.index(index[k])] = copy.deepcopy(item)
        else:
            merged.append(copy.deepcopy(item))
            index[k] = item
    return merged


def merge_dicts(old, new, full_mode, path=()):
    result = copy.deepcopy(old)
    for k, v in new.items():
        if k.startswith("__"):
            continue
        lk = None
        for keys, key in LIST_KEYS.items():
            if path == keys[: len(path)] and len(keys) == len(path) + 1 and keys[-1] == k:
                lk = key
                break
        if lk is not None and isinstance(v, list):
            result[k] = upsert_list(result.get(k) or [], v, lk, full_mode)
        elif isinstance(v, dict) and isinstance(result.get(k), dict):
            result[k] = merge_dicts(result[k], v, full_mode, path + (k,))
        elif v is not None:
            result[k] = copy.deepcopy(v)
    return result


def merge_libs(old, new):
    # grupos por nome; dentro do grupo, items por nome (upsert sempre)
    merged = copy.deepcopy(old)
    index = {g.get("group", ""): g for g in merged}
    for g in new:
        name = g.get("group", "")
        if name not in index:
            merged.append(copy.deepcopy(g))
            index[name] = merged[-1]
            continue
        target = index[name]
        items = target.get("items") or []
        idx = {i.get(LIB_ITEM_KEY, ""): i for i in items}
        for item in g.get("items") or []:
            idx[item.get(LIB_ITEM_KEY, "")] = copy.deepcopy(item)
        target["items"] = list(idx.values())
    return merged


def main():
    ap = argparse.ArgumentParser(description="Atlas Docs merge incremental")
    ap.add_argument("old", help="app-model.json existente (pode não existir no 1º scan)")
    ap.add_argument("scan", help="scan-model.json novo")
    ap.add_argument("--mode", choices=["delta", "full"], default="delta")
    ap.add_argument("--commit")
    ap.add_argument("--when")
    ap.add_argument("--title", default="varredura")
    ap.add_argument("--detail", default="")
    ap.add_argument("-o", "--out")
    args = ap.parse_args()

    old = load(args.old, required=False)
    scan = load(args.scan, required=True)
    if not isinstance(scan, dict):
        die("scan precisa ser objeto JSON")
    full_mode = args.mode == "full"

    if old is None:
        merged = copy.deepcopy(scan)
        merged.pop("__changelog", None)
        merged.setdefault("app", {})
        merged["app"]["commitPrev"] = None
        hist = merged.setdefault("history", {})
        hist.setdefault("scans", [])
        hist["scans"].insert(0, {
            "commit": args.commit or merged["app"].get("commit", "—"),
            "when": args.when or datetime.datetime.now().strftime("%d/%m %H:%M"),
            "title": args.title,
            "detail": args.detail,
            "delta": "—",
            "deltaKind": "ok",
        })
    else:
        prev_overall = (old.get("score") or {}).get("overall")
        merged = merge_dicts(old, scan, full_mode)
        # libs têm semântica própria (grupo + item)
        arch = merged.setdefault("architecture", {})
        arch["libs"] = merge_libs(
            (old.get("architecture") or {}).get("libs") or [],
            (scan.get("architecture") or {}).get("libs") or [],
        )
        merged.setdefault("app", {})
        merged["app"]["commitPrev"] = old.get("app", {}).get("commit")
        if args.commit:
            merged["app"]["commit"] = args.commit
        if args.when:
            merged["app"]["generatedAt"] = datetime.datetime.now().isoformat(timespec="seconds")

        hist = merged.setdefault("history", {})
        scans = hist.setdefault("scans", [])
        old_commit = old.get("app", {}).get("commit")
        scans.insert(0, {
            "commit": args.commit or old_commit or "—",
            "when": args.when or datetime.datetime.now().strftime("%d/%m %H:%M"),
            "title": args.title,
            "detail": args.detail,
            "delta": "…" if prev_overall is not None else "—",
            "deltaKind": "ok",
            "__prevOverall": prev_overall,  # atlas_build apura o delta real e remove isto
        })

        chg_entries = scan.get("__changelog") or []
        if chg_entries:
            hist.setdefault("changelog", [])
            for c in chg_entries:
                tag = str(c.get("tag", "DOC")).upper()
                if tag not in VALID_TAGS:
                    die(f"tag de changelog inválida: {tag} (use {sorted(VALID_TAGS)})")
                hist["changelog"].insert(0, {"tag": tag, "body": c.get("body", "")})

    out = args.out or args.old
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(merged, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    print(f"merge ok → {out} · {args.mode} · {len(merged.get('flows') or [])} fluxos")
    print("rode atlas_build.py para apurar score e gerar o index.html "
          "(o delta do scan mais recente é atualizado lá)")


if __name__ == "__main__":
    main()
