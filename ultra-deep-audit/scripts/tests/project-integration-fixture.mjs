/** Opt-in project contracts run copied scripts only: never mutate the selected checkout. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after } from "node:test";

export const integrationRoot = process.env.ULTRA_PROJECT_ROOT;
export function projectFile(relative) {
  if (!integrationRoot) throw Error("ULTRA_PROJECT_ROOT is required");
  const candidates = /^(scripts|infra)\//.test(relative)
    ? [
        path.join(integrationRoot, "deployments", relative),
        path.join(integrationRoot, relative),
      ]
    : [path.join(integrationRoot, relative)];
  const found = candidates.find((file) => fs.existsSync(file));
  if (!found) throw Error(`project contract input missing: ${relative}`);
  return found;
}

export function createIntegrationProject() {
  if (!integrationRoot) return null;
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "ultra-project-contract-"),
  );
  const inheritedEnv = { ...process.env };
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_INDEX_FILE",
    "BASH_ENV",
    "ENV",
  ])
    delete inheritedEnv[key];
  const denied = path.join(root, "unexpected-tool.log");
  const guards = path.join(root, "guard-tools");
  fs.mkdirSync(guards);
  for (const name of [
    "docker",
    "docker-compose",
    "trivy",
    "mvn",
    "npm",
    "npx",
    "curl",
    "wget",
    "ssh",
    "scp",
    "kubectl",
    "aws",
    "gh",
  ]) {
    const p = path.join(guards, name);
    fs.writeFileSync(
      p,
      `#!/bin/sh\nprintf '%s\\n' '${name}' >> "$ULTRA_INTEGRATION_DENIED"\necho 'unexpected external tool denied: ${name}' >&2\nexit 97\n`,
    );
    fs.chmodSync(p, 0o755);
  }
  // Only plain code/config files needed by the exercised functions, no .env, credentials or app data.
  for (const relative of [
    "scripts/ci-local.sh",
    "scripts/runtime-images-supply-chain-gate.sh",
    "backend/pom.xml",
    "backend/.mvn/jvm.config",
    "docker-compose.yml",
    "docker-compose.services.yml",
    "docker-compose.app.yml",
    ".trivyignore",
    "infra/postgres-runtime/Dockerfile",
    "infra/redis-runtime/Dockerfile",
    "infra/flyway-runtime/Dockerfile",
  ]) {
    const from = projectFile(relative),
      to = path.join(root, relative);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    fs.chmodSync(to, fs.statSync(from).mode & 0o777);
  }
  // Avoid the script's Git-log fallback writing outside this fixture.
  const git = spawnSync(
    "git",
    ["-c", "core.hooksPath=/dev/null", "init", "-q", root],
    { encoding: "utf8", env: inheritedEnv },
  );
  assert.equal(git.status, 0, git.stderr);
  after(() => {
    try {
      assert.equal(
        fs.existsSync(denied),
        false,
        fs.existsSync(denied)
          ? fs.readFileSync(denied, "utf8")
          : "unexpected external tool",
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  return {
    root,
    env: {
      ...inheritedEnv,
      PATH: `${guards}:${process.env.PATH}`,
      ULTRA_INTEGRATION_DENIED: denied,
      DOCKER_BIN: path.join(guards, "docker"),
      TRIVY_BIN: path.join(guards, "trivy"),
      RUNTIME_IMAGE_PUBLISH_REGISTRY: "",
      RUNTIME_IMAGE_PUBLISH_TAG: "",
      RUNTIME_IMAGE_ENV_FILE: path.join(root, "runtime-images.env"),
    },
  };
}
