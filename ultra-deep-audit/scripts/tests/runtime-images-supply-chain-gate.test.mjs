import nodeTest from "node:test";
import {
  integrationRoot,
  createIntegrationProject,
} from "./project-integration-fixture.mjs";
const test = (name, fn) =>
  nodeTest(
    name,
    {
      skip:
        !integrationRoot &&
        "project integration not run; set ULTRA_PROJECT_ROOT explicitly",
    },
    fn,
  );
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const project = createIntegrationProject();
const REPO_ROOT = project?.root || "/nonexistent-ultra-integration";
const GATE = path.join(
  REPO_ROOT,
  "scripts",
  "runtime-images-supply-chain-gate.sh",
);
const DIGEST = `sha256:${"a".repeat(64)}`;
const LOCAL_ROLES = ["postgres", "redis", "flyway"];
const PLATFORMS = ["linux/amd64", "linux/arm64"];
const IMAGE_COUNT = 5;
const localTags = integrationRoot
  ? Object.fromEntries(
      LOCAL_ROLES.map((role) => {
        const all = [
          "docker-compose.yml",
          "docker-compose.services.yml",
          "docker-compose.app.yml",
        ]
          .map((file) => fs.readFileSync(path.join(REPO_ROOT, file), "utf8"))
          .join("\n");
        const declared = all.match(
          new RegExp(`appgp/${role}-runtime:[A-Za-z0-9._-]+`),
        );
        // Redis may be supplied solely by release env. Its checked-in runtime pin is part of the project gate contract.
        const value =
          declared?.[0] ||
          (role === "redis" ? "appgp/redis-runtime:8.10.1-r1" : null);
        assert.ok(value, `missing declared local runtime: ${role}`);
        return [role, value];
      }),
    )
  : {};
const postgresLocal = localTags.postgres,
  redisLocal = localTags.redis,
  flywayLocal = localTags.flyway;

function writeCompose(dir, images) {
  const compose = path.join(dir, "compose.yml");
  fs.writeFileSync(
    compose,
    `services:\n${images.map((image, index) => `  svc${index}:\n    image: ${image}`).join("\n")}\n`,
  );
  return compose;
}

function runGate(compose, env = {}) {
  return spawnSync("bash", [GATE], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 20000,
    env: {
      ...project.env,
      RUNTIME_IMAGE_COMPOSE_FILES: compose,
      RUNTIME_IMAGE_PLATFORMS: PLATFORMS.join(","),
      ...env,
    },
  });
}

function writeExecutable(file, source) {
  fs.writeFileSync(file, source);
  fs.chmodSync(file, 0o755);
}

function writeToolStubs(fixture) {
  const dockerLog = path.join(fixture, "docker.log");
  const trivyLog = path.join(fixture, "trivy.log");
  const docker = path.join(fixture, "docker");
  const trivy = path.join(fixture, "trivy-stub.sh");
  writeExecutable(
    docker,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$DOCKER_STUB_LOG"
metadata=''
tag=''
prev=''
for arg in "$@"; do
  if [ "$prev" = '--metadata-file' ]; then metadata="$arg"; fi
  if [ "$prev" = '--tag' ]; then tag="$arg"; fi
  prev="$arg"
done
if [ -n "$metadata" ]; then
  digest=$(node -e 'process.stdout.write(require("node:crypto").createHash("sha256").update(process.argv[1]).digest("hex"))' "$tag")
  mkdir -p "$(dirname "$metadata")"
  printf '{"containerimage.digest":"sha256:%s"}\\n' "$digest" > "$metadata"
fi
`,
  );
  writeExecutable(
    trivy,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$TRIVY_STUB_LOG"
out=''
prev=''
for arg in "$@"; do
  if [ "$prev" = '--output' ]; then out="$arg"; fi
  prev="$arg"
done
if [ -n "$out" ]; then mkdir -p "$(dirname "$out")"; printf '{"bomFormat":"CycloneDX"}\\n' > "$out"; fi
`,
  );
  return { docker, dockerLog, trivy, trivyLog };
}

test("runtime image gate rejects a required image without immutable digest", () => {
  const fixture = fs.mkdtempSync(
    path.join(os.tmpdir(), "runtime-images-digest-"),
  );
  try {
    const compose = writeCompose(fixture, [
      "postgres:18.6",
      `rabbitmq:4.3.4-management@${DIGEST}`,
      `redis:8.10.1-alpine@${DIGEST}`,
      `cgr.dev/chainguard/minio:latest@${DIGEST}`,
      `flyway/flyway:13.9.0@${DIGEST}`,
    ]);
    const result = runGate(compose);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /digest/i);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("runtime image gate rejects an incomplete required image set", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-images-set-"));
  try {
    const compose = writeCompose(fixture, [
      `postgres:18.6@${DIGEST}`,
      `rabbitmq:4.3.4-management@${DIGEST}`,
      `cgr.dev/chainguard/minio:latest@${DIGEST}`,
      `flyway/flyway:13.9.0@${DIGEST}`,
    ]);
    const result = runGate(compose);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /redis/i);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("runtime image gate resolves release env references to the checked-in runtime images", () => {
  const fixture = fs.mkdtempSync(
    path.join(os.tmpdir(), "runtime-images-release-env-"),
  );
  try {
    const compose = writeCompose(fixture, [
      "${POSTGRES_RUNTIME_IMAGE:?required}",
      `rabbitmq:4.3.4-management@${DIGEST}`,
      "${REDIS_RUNTIME_IMAGE:?required}",
      `cgr.dev/chainguard/minio:latest@${DIGEST}`,
      "${FLYWAY_RUNTIME_IMAGE:?required}",
    ]);
    const tools = writeToolStubs(fixture);
    const result = runGate(compose, {
      DOCKER_BIN: tools.docker,
      PATH: `${fixture}:${project.env.PATH}`,
      DOCKER_STUB_LOG: tools.dockerLog,
      TRIVY_BIN: tools.trivy,
      TRIVY_STUB_LOG: tools.trivyLog,
      RUNTIME_IMAGE_SBOM_DIR: path.join(fixture, "sbom"),
    });

    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    const builds = fs.readFileSync(tools.dockerLog, "utf8").trim().split("\n");
    assert.equal(
      builds.filter((line) =>
        line.includes("infra/postgres-runtime/Dockerfile"),
      ).length,
      2,
    );
    assert.equal(
      builds.filter((line) => line.includes("infra/redis-runtime/Dockerfile"))
        .length,
      2,
    );
    assert.equal(
      builds.filter((line) => line.includes("infra/flyway-runtime/Dockerfile"))
        .length,
      PLATFORMS.length,
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

for (const runtime of ["POSTGRES", "REDIS", "FLYWAY"]) {
  for (const invalidReference of [
    `\${${runtime}_RUNTIME_IMAGE:-attacker.example/runtime:latest}`,
    `\${${runtime}_RUNTIME_IMAGE:+attacker.example/runtime:latest}`,
    `\${${runtime}_RUNTIME_IMAGE}`,
  ]) {
    test(`runtime image gate rejects unsupported Compose interpolation ${invalidReference}`, () => {
      const fixture = fs.mkdtempSync(
        path.join(os.tmpdir(), "runtime-images-invalid-env-"),
      );
      try {
        const compose = writeCompose(fixture, [
          runtime === "POSTGRES"
            ? invalidReference
            : "${POSTGRES_RUNTIME_IMAGE:?required}",
          `rabbitmq:4.3.4-management@${DIGEST}`,
          runtime === "REDIS"
            ? invalidReference
            : "${REDIS_RUNTIME_IMAGE:?required}",
          `cgr.dev/chainguard/minio:latest@${DIGEST}`,
          runtime === "FLYWAY"
            ? invalidReference
            : "${FLYWAY_RUNTIME_IMAGE:?required}",
        ]);
        const tools = writeToolStubs(fixture);
        const result = runGate(compose, {
          DOCKER_BIN: tools.docker,
          PATH: `${fixture}:${project.env.PATH}`,
          DOCKER_STUB_LOG: tools.dockerLog,
          TRIVY_BIN: tools.trivy,
          TRIVY_STUB_LOG: tools.trivyLog,
          RUNTIME_IMAGE_SBOM_DIR: path.join(fixture, "sbom"),
        });

        assert.notEqual(result.status, 0);
        assert.match(
          `${result.stdout}${result.stderr}`,
          new RegExp(runtime, "i"),
        );
        assert.equal(
          fs.existsSync(tools.dockerLog),
          false,
          "tools must not run for an invalid image reference",
        );
      } finally {
        fs.rmSync(fixture, { recursive: true, force: true });
      }
    });
  }
}

test("runtime image gate accepts the checked-in development and deployment compose files", () => {
  const fixture = fs.mkdtempSync(
    path.join(os.tmpdir(), "runtime-images-repository-compose-"),
  );
  try {
    const tools = writeToolStubs(fixture);
    const composeFiles = [
      path.join(REPO_ROOT, "docker-compose.yml"),
      path.join(REPO_ROOT, "docker-compose.services.yml"),
    ].join(" ");
    const result = runGate(composeFiles, {
      DOCKER_BIN: tools.docker,
      PATH: `${fixture}:${project.env.PATH}`,
      DOCKER_STUB_LOG: tools.dockerLog,
      TRIVY_BIN: tools.trivy,
      TRIVY_STUB_LOG: tools.trivyLog,
      RUNTIME_IMAGE_SBOM_DIR: path.join(fixture, "sbom"),
    });

    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    const builds = fs.readFileSync(tools.dockerLog, "utf8").trim().split("\n");
    assert.equal(
      builds.length,
      LOCAL_ROLES.length * PLATFORMS.length,
      "PostgreSQL, Redis and Flyway must each build on both platforms",
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("runtime image gate scans five images on two platforms and emits ten CycloneDX SBOMs", () => {
  const fixture = fs.mkdtempSync(
    path.join(os.tmpdir(), "runtime-images-green-"),
  );
  try {
    const compose = writeCompose(fixture, [
      `postgres:18.6@${DIGEST}`,
      `rabbitmq:4.3.4-management@${DIGEST}`,
      `redis:8.10.1-alpine@${DIGEST}`,
      `cgr.dev/chainguard/minio:latest@${DIGEST}`,
      `flyway/flyway:13.9.0@${DIGEST}`,
      `postgres:18.6@${DIGEST}`,
    ]);
    const log = path.join(fixture, "trivy.log");
    const trivy = path.join(fixture, "trivy-stub.sh");
    fs.writeFileSync(
      trivy,
      `#!/usr/bin/env bash\nset -euo pipefail\nprintf '%s\\n' "$*" >> "$TRIVY_STUB_LOG"\nout=''\nprev=''\nfor arg in "$@"; do\n  if [ "$prev" = '--output' ]; then out="$arg"; fi\n  prev="$arg"\ndone\nif [ -n "$out" ]; then mkdir -p "$(dirname "$out")"; printf '{"bomFormat":"CycloneDX"}\\n' > "$out"; fi\n`,
    );
    fs.chmodSync(trivy, 0o755);
    const out = path.join(fixture, "sbom");
    const result = runGate(compose, {
      TRIVY_BIN: trivy,
      TRIVY_STUB_LOG: log,
      RUNTIME_IMAGE_SBOM_DIR: out,
    });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    const calls = fs.readFileSync(log, "utf8").trim().split("\n");
    assert.equal(
      calls.filter((line) => line.includes("--severity HIGH,CRITICAL")).length,
      IMAGE_COUNT * PLATFORMS.length,
    );
    assert.equal(
      calls.filter((line) => line.includes("--format cyclonedx")).length,
      IMAGE_COUNT * PLATFORMS.length,
    );
    assert.equal(
      fs.readdirSync(out).filter((name) => name.endsWith(".cdx.json")).length,
      IMAGE_COUNT * PLATFORMS.length,
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("runtime image gate preserves all CycloneDX SBOMs before propagating a Trivy vulnerability failure", () => {
  const fixture = fs.mkdtempSync(
    path.join(os.tmpdir(), "runtime-images-fail-"),
  );
  try {
    const compose = writeCompose(fixture, [
      `postgres:18.6@${DIGEST}`,
      `rabbitmq:4.3.4-management@${DIGEST}`,
      `redis:8.10.1-alpine@${DIGEST}`,
      `cgr.dev/chainguard/minio:latest@${DIGEST}`,
      `flyway/flyway:13.9.0@${DIGEST}`,
    ]);
    const log = path.join(fixture, "trivy.log");
    const trivy = path.join(fixture, "trivy-fail.sh");
    fs.writeFileSync(
      trivy,
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$TRIVY_STUB_LOG"
out=''
prev=''
for arg in "$@"; do
  if [ "$prev" = '--output' ]; then out="$arg"; fi
  prev="$arg"
done
if [ -n "$out" ]; then mkdir -p "$(dirname "$out")"; printf '{"bomFormat":"CycloneDX"}\\n' > "$out"; fi
[[ "$*" == *rabbitmq* && "$*" == *"--severity HIGH,CRITICAL"* ]] && exit 1
exit 0
`,
    );
    fs.chmodSync(trivy, 0o755);
    const out = path.join(fixture, "sbom");
    const result = runGate(compose, {
      TRIVY_BIN: trivy,
      TRIVY_STUB_LOG: log,
      RUNTIME_IMAGE_SBOM_DIR: out,
    });
    assert.notEqual(result.status, 0);
    const calls = fs.readFileSync(log, "utf8").trim().split("\n");
    assert.equal(
      calls.filter((line) => line.includes("--format cyclonedx")).length,
      IMAGE_COUNT * PLATFORMS.length,
    );
    assert.equal(
      fs.readdirSync(out).filter((name) => name.endsWith(".cdx.json")).length,
      IMAGE_COUNT * PLATFORMS.length,
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("runtime image gate executes all three checked-in Dockerfiles for both local platforms", () => {
  const fixture = fs.mkdtempSync(
    path.join(os.tmpdir(), "runtime-images-local-build-"),
  );
  try {
    const compose = writeCompose(fixture, [
      postgresLocal,
      `rabbitmq:4.3.4-management@${DIGEST}`,
      redisLocal,
      `cgr.dev/chainguard/minio:latest@${DIGEST}`,
      flywayLocal,
    ]);
    const tools = writeToolStubs(fixture);
    const result = runGate(compose, {
      DOCKER_BIN: tools.docker,
      PATH: `${fixture}:${project.env.PATH}`,
      DOCKER_STUB_LOG: tools.dockerLog,
      TRIVY_BIN: tools.trivy,
      TRIVY_STUB_LOG: tools.trivyLog,
      RUNTIME_IMAGE_SBOM_DIR: path.join(fixture, "sbom"),
    });

    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    const builds = fs.readFileSync(tools.dockerLog, "utf8").trim().split("\n");
    assert.equal(builds.length, LOCAL_ROLES.length * PLATFORMS.length);
    for (const dockerfile of [
      "infra/postgres-runtime/Dockerfile",
      "infra/redis-runtime/Dockerfile",
      "infra/flyway-runtime/Dockerfile",
    ]) {
      assert.equal(
        builds.filter((line) => line.includes(dockerfile)).length,
        2,
        dockerfile,
      );
    }
    assert.ok(
      builds.some((line) => line.includes("--platform linux/amd64 --load")),
    );
    assert.ok(
      builds.some((line) => line.includes("--platform linux/arm64 --load")),
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("release mode publishes each local runtime once and scans the published multiarch digest", () => {
  const fixture = fs.mkdtempSync(
    path.join(os.tmpdir(), "runtime-images-publish-"),
  );
  try {
    const compose = writeCompose(fixture, [
      postgresLocal,
      `rabbitmq:4.3.4-management@${DIGEST}`,
      redisLocal,
      `cgr.dev/chainguard/minio:latest@${DIGEST}`,
      flywayLocal,
    ]);
    const tools = writeToolStubs(fixture);
    const envFile = path.join(fixture, "runtime-images.env");
    const result = runGate(compose, {
      DOCKER_BIN: tools.docker,
      PATH: `${fixture}:${project.env.PATH}`,
      DOCKER_STUB_LOG: tools.dockerLog,
      TRIVY_BIN: tools.trivy,
      TRIVY_STUB_LOG: tools.trivyLog,
      RUNTIME_IMAGE_SBOM_DIR: path.join(fixture, "sbom"),
      RUNTIME_IMAGE_PUBLISH_REGISTRY: "registry.example.test/prontyx",
      RUNTIME_IMAGE_PUBLISH_TAG: "commit-sha",
      RUNTIME_IMAGE_ENV_FILE: envFile,
    });

    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    const builds = fs.readFileSync(tools.dockerLog, "utf8").trim().split("\n");
    assert.equal(
      builds.length,
      LOCAL_ROLES.length,
      "one multiarch push per checked-in runtime",
    );
    assert.ok(
      builds.every((line) =>
        line.includes("--platform linux/amd64,linux/arm64"),
      ),
    );
    assert.ok(builds.every((line) => line.includes("--push")));
    assert.ok(builds.every((line) => line.includes("--sbom=true")));
    assert.ok(builds.every((line) => line.includes("--provenance=mode=max")));

    const published = fs.readFileSync(envFile, "utf8").trim().split("\n");
    assert.equal(published.length, LOCAL_ROLES.length);
    assert.ok(
      published.every((line) => !line.match(/=[^@]+:[^@]+$/)),
      "deployment artifact must contain digest refs, never mutable tags",
    );
    assert.ok(
      published.some((line) =>
        /^POSTGRES_RUNTIME_IMAGE=registry\.example\.test\/prontyx\/app-gp-postgres-runtime@sha256:[a-f0-9]{64}$/.test(
          line,
        ),
      ),
    );
    assert.ok(
      published.some((line) =>
        /^REDIS_RUNTIME_IMAGE=registry\.example\.test\/prontyx\/app-gp-redis-runtime@sha256:[a-f0-9]{64}$/.test(
          line,
        ),
      ),
    );

    assert.ok(
      published.some((line) =>
        /^FLYWAY_RUNTIME_IMAGE=registry\.example\.test\/prontyx\/app-gp-flyway-runtime@sha256:[a-f0-9]{64}$/.test(
          line,
        ),
      ),
    );
    const scans = fs.readFileSync(tools.trivyLog, "utf8").trim().split("\n");
    for (const name of LOCAL_ROLES.map((role) => `app-gp-${role}-runtime`)) {
      const digestScans = scans.filter((line) =>
        line.includes(`/${name}@sha256:`),
      );
      assert.equal(
        digestScans.length,
        4,
        `${name}: SBOM + vuln on two platforms`,
      );
      assert.ok(digestScans.every((line) => !line.includes(":commit-sha")));
    }
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("publish mode exposes runtime-images.env only after every vulnerability scan passes", () => {
  const fixture = fs.mkdtempSync(
    path.join(os.tmpdir(), "runtime-images-atomic-env-"),
  );
  try {
    const compose = writeCompose(fixture, [
      postgresLocal,
      `rabbitmq:4.3.4-management@${DIGEST}`,
      redisLocal,
      `cgr.dev/chainguard/minio:latest@${DIGEST}`,
      flywayLocal,
    ]);
    const tools = writeToolStubs(fixture);
    writeExecutable(
      tools.trivy,
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$TRIVY_STUB_LOG"
out=''
prev=''
for arg in "$@"; do
  if [ "$prev" = '--output' ]; then out="$arg"; fi
  prev="$arg"
done
if [ -n "$out" ]; then mkdir -p "$(dirname "$out")"; printf '{"bomFormat":"CycloneDX"}\\n' > "$out"; fi
[[ "$*" == *rabbitmq* && "$*" == *"--severity HIGH,CRITICAL"* ]] && exit 1
exit 0
`,
    );
    const envFile = path.join(fixture, "runtime-images.env");
    fs.writeFileSync(envFile, "STALE_RUNTIME_IMAGE=must-not-survive\n");

    const result = runGate(compose, {
      DOCKER_BIN: tools.docker,
      PATH: `${fixture}:${project.env.PATH}`,
      DOCKER_STUB_LOG: tools.dockerLog,
      TRIVY_BIN: tools.trivy,
      TRIVY_STUB_LOG: tools.trivyLog,
      RUNTIME_IMAGE_SBOM_DIR: path.join(fixture, "sbom"),
      RUNTIME_IMAGE_PUBLISH_REGISTRY: "registry.example.test/prontyx",
      RUNTIME_IMAGE_PUBLISH_TAG: "commit-sha",
      RUNTIME_IMAGE_ENV_FILE: envFile,
    });

    assert.notEqual(result.status, 0);
    assert.equal(
      fs.existsSync(envFile),
      false,
      "failed publish scan must not expose a stale or partially generated deploy artifact",
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

for (const failure of ["missing-compose", "invalid-digest"]) {
  test(`publish preflight ${failure} invalidates stale runtime-images.env before tools run`, () => {
    const fixture = fs.mkdtempSync(
      path.join(os.tmpdir(), "runtime-images-preflight-"),
    );
    try {
      const tools = writeToolStubs(fixture);
      const compose =
        failure === "missing-compose"
          ? path.join(fixture, "missing.yml")
          : writeCompose(fixture, [
              "postgres:18.6",
              `rabbitmq:4.3.4-management@${DIGEST}`,
              redisLocal,
              `cgr.dev/chainguard/minio:latest@${DIGEST}`,
              flywayLocal,
            ]);
      const envFile = path.join(fixture, "runtime-images.env");
      fs.writeFileSync(envFile, "STALE_RUNTIME_IMAGE=must-not-survive\n");
      const result = runGate(compose, {
        DOCKER_BIN: tools.docker,
        TRIVY_BIN: tools.trivy,
        PATH: `${fixture}:${project.env.PATH}`,
        DOCKER_STUB_LOG: tools.dockerLog,
        TRIVY_STUB_LOG: tools.trivyLog,
        RUNTIME_IMAGE_SBOM_DIR: path.join(fixture, "sbom"),
        RUNTIME_IMAGE_PUBLISH_REGISTRY: "registry.example.test/prontyx",
        RUNTIME_IMAGE_PUBLISH_TAG: "probe",
        RUNTIME_IMAGE_ENV_FILE: envFile,
      });
      assert.notEqual(result.status, 0);
      assert.match(
        `${result.stdout}${result.stderr}`,
        failure === "missing-compose"
          ? /missing compose file/
          : /immutable.*digest/,
      );
      assert.equal(
        fs.existsSync(tools.dockerLog),
        false,
        "preflight must not run Docker",
      );
      assert.equal(
        fs.existsSync(tools.trivyLog),
        false,
        "preflight must not run Trivy",
      );
      assert.equal(
        fs.existsSync(envFile),
        false,
        "failed preflight must not leave a deploy artifact from an earlier attempt",
      );
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });
}
