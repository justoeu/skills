#!/usr/bin/env python3
"""Read-only inventory since app.commit, including staged, dirty and untracked files.

Prints {mode: full, reason: ...} when a trustworthy Git baseline is unavailable.
Never runs hooks, fetches or modifies the repository.
"""
import argparse
import json
import re
import subprocess


def inventory(model, repo):
    def git(*args):
        return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True)

    base = (model.get("app") or {}).get("commit")
    head = git("rev-parse", "--verify", "HEAD")
    fallback = {"mode": "full", "base": base, "head": head.stdout.strip() or None,
                "files": [], "reason": "base documentada ausente, indisponível ou fora da história de HEAD"}
    if head.returncode or not isinstance(base, str) or not re.fullmatch(r"[0-9a-fA-F]{7,64}", base):
        return fallback
    commit = git("rev-parse", "--verify", base + "^{commit}")
    if commit.returncode or git("merge-base", "--is-ancestor", commit.stdout.strip(), "HEAD").returncode:
        return fallback
    diff = git("diff", "--no-ext-diff", "--no-renames", "--name-status", "-z", commit.stdout.strip(), "--")
    untracked = git("ls-files", "--others", "--exclude-standard", "-z")
    if diff.returncode or untracked.returncode:
        return {**fallback, "reason": "Git não conseguiu inventariar worktree"}
    tokens = diff.stdout.rstrip("\0").split("\0") if diff.stdout else []
    files = [{"status": tokens[i], "path": tokens[i + 1]} for i in range(0, len(tokens), 2)]
    files.extend({"status": "?", "path": name} for name in untracked.stdout.split("\0") if name)
    return {"mode": "delta", "base": base, "head": head.stdout.strip(), "files": files}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model")
    parser.add_argument("--repo", default=".")
    args = parser.parse_args()
    try:
        with open(args.model, encoding="utf-8") as stream:
            model = json.load(stream)
        result = inventory(model, args.repo)
    except (OSError, ValueError, TypeError, AttributeError) as error:
        result = {"mode": "full", "files": [], "reason": "modelo/Git indisponível: " + type(error).__name__}
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
