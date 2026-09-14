/**
 * Tests for the *instrument*, not for the dependencies it inventories.
 *
 * TOOL-PRI-108: check-deps-latest.mjs only ever looked at <dependency><version>, so a
 * CVE pin expressed as a Spring Boot BOM property override — <rabbit-amqp-client.version>,
 * <netty.version>, <jackson-bom.version> — was absent from the inventory with no signal.
 * Those are exactly the artifacts where security debt accumulates in BOM-managed apps.
 *
 * No network: only the pure pom parsers are exercised.
 *
 *   node --test scripts/tests/check-deps-latest.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const {
  parseMavenCoordsFromPom,
  parseMavenPropertyPins,
  toFindings,
  MAVEN_BOM_PROPERTY_COORDS,
  checkNpm,
  selectDockerLatestForPolicy,
  isReleaseManagedComposeImage,
} = await import(path.join(HERE, '..', 'check-deps-latest.mjs'));

const FIXTURE_POM = `<project>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>4.1.1</version>
  </parent>
  <properties>
    <java.version>25</java.version>
    <maven.compiler.source>25</maven.compiler.source>
    <!-- pin defensivo: fecha CVE-2026-69220 no ValueReader -->
    <rabbit-amqp-client.version>5.34.0</rabbit-amqp-client.version>
    <netty.version>4.2.16.Final</netty.version>
    <bouncycastle.version>1.85</bouncycastle.version>
    <totally-unknown-lib.version>9.9.9</totally-unknown-lib.version>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.bouncycastle</groupId>
      <artifactId>bcpkix-jdk18on</artifactId>
      <version>\${bouncycastle.version}</version>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.hibernate.orm.tooling</groupId>
        <artifactId>hibernate-enhance-maven-plugin</artifactId>
        <version>\${hibernate.version}</version>
      </plugin>
    </plugins>
  </build>
</project>
`;

test('the old <dependency>-only parser really does miss BOM property pins', () => {
  const names = parseMavenCoordsFromPom(FIXTURE_POM, 'pom.xml').map((r) => r.name);
  assert.ok(names.includes('org.bouncycastle:bcpkix-jdk18on'), 'sanity: explicit deps still parsed');
  assert.ok(
    !names.includes('com.rabbitmq:amqp-client'),
    'documents the blind spot this finding is about — the pin has no <dependency> element',
  );
});

test('property-only pins become inventory rows with real Maven coordinates', () => {
  const pins = parseMavenPropertyPins(FIXTURE_POM, 'pom.xml');
  const byProp = new Map(pins.map((p) => [p.property, p]));

  const rabbit = byProp.get('rabbit-amqp-client.version');
  assert.ok(rabbit, 'rabbit-amqp-client.version must be inventoried');
  assert.equal(rabbit.name, 'com.rabbitmq:amqp-client');
  assert.equal(rabbit.groupId, 'com.rabbitmq');
  assert.equal(rabbit.artifactId, 'amqp-client');
  assert.equal(rabbit.current, '5.34.0');
  assert.equal(rabbit.skipped, undefined, 'a mapped pin must be freshness-checked, not skipped');

  assert.equal(byProp.get('netty.version').current, '4.2.16.Final');
});

test('the rationale comment above a pin is carried into the record', () => {
  const rabbit = parseMavenPropertyPins(FIXTURE_POM, 'pom.xml').find(
    (p) => p.property === 'rabbit-amqp-client.version',
  );
  assert.match(rabbit.rationale, /CVE-2026-69220/);
});

test('a pin already backed by a <dependency> is not double-counted', () => {
  const props = parseMavenPropertyPins(FIXTURE_POM, 'pom.xml').map((p) => p.property);
  assert.ok(
    !props.includes('bouncycastle.version'),
    'bouncycastle.version is referenced by an explicit <dependency>, already covered',
  );
});

test('non-dependency properties are not turned into fake packages', () => {
  const props = parseMavenPropertyPins(FIXTURE_POM, 'pom.xml').map((p) => p.property);
  assert.ok(!props.includes('java.version'));
  assert.ok(!props.includes('maven.compiler.source'));
});

test('an unmappable pin is reported as skipped-with-reason, never dropped', () => {
  const unknown = parseMavenPropertyPins(FIXTURE_POM, 'pom.xml').find(
    (p) => p.property === 'totally-unknown-lib.version',
  );
  assert.ok(unknown, 'an unrecognised *.version pin must still surface');
  assert.equal(unknown.skipped, true);
  assert.match(unknown.reason, /coordinate/i);
});

test('an unresolvable ${property} in a <plugin> is skipped, not compared as a literal', () => {
  const hib = parseMavenCoordsFromPom(FIXTURE_POM, 'pom.xml').find(
    (r) => r.artifactId === 'hibernate-enhance-maven-plugin',
  );
  assert.ok(hib, 'the plugin row must still exist');
  assert.equal(hib.skipped, true, '${hibernate.version} resolves in the parent BOM, not here');
});

test('fixture BOM-property pins that map to coordinates are inventoried, not skipped', () => {
  const pins = parseMavenPropertyPins(FIXTURE_POM, 'pom.xml');
  const mapped = pins.filter((p) => !p.skipped).map((p) => p.property).sort();
  assert.deepEqual(mapped, ['netty.version', 'rabbit-amqp-client.version']);
  assert.ok(pins.find((p) => p.property === 'rabbit-amqp-client.version')?.rationale);
});

test('the coordinate table only holds group:artifact pairs', () => {
  for (const [prop, coord] of Object.entries(MAVEN_BOM_PROPERTY_COORDS)) {
    assert.match(coord, /^[\w.\-]+:[\w.\-]+$/, `${prop} maps to a malformed coordinate: ${coord}`);
  }
});

test('dependency findings use the lowercase lifecycle schema consumed by report generators', () => {
  const findings = toFindings([
    {
      ecosystem: 'maven',
      name: 'org.example:library',
      current: '1.0.0',
      latest_stable: '1.0.1',
      bump: 'patch',
      outdated: true,
      manifest: 'backend/pom.xml',
    },
    {
      ecosystem: 'docker',
      name: 'example/image',
      current: 'latest',
      latest_stable: '2.0.0',
      bump: 'major',
      outdated: true,
      floating_tag: true,
      manifest: 'docker-compose.yml',
    },
  ]);

  assert.equal(findings.length, 2, 'the fixture must exercise real dependency findings');
  assert.deepEqual(findings.map((finding) => finding.status), ['open', 'open']);
  assert.deepEqual(
    findings.map((finding) => finding.category),
    ['outdated_stable', 'docker_floating_tag'],
  );
  assert.ok(findings.every((finding) => finding.agent === 'Prism'));
});

test('Compose digest pins are immutable without claiming their contents are current', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-digest-'));
  try {
    const digest = `sha256:${'a'.repeat(64)}`;
    fs.writeFileSync(path.join(fixture, 'compose.yml'), `services:
  tagged:
    image: cgr.dev/chainguard/minio:latest@${digest}
  digest_only:
    image: cgr.dev/chainguard/redis@${digest}
  floating:
    image: example/floating:latest
  malformed:
    image: example/malformed:latest@sha256:abc
  empty_digest:
    image: example/empty:latest@
  extra_digest:
    image: example/extra:latest@${digest}@ignored
`);
    const result = spawnSync(process.execPath, [
      path.join(HERE, '..', 'check-deps-latest.mjs'), '--root', fixture,
    ], { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.runner_errors, []);
    assert.equal(report.packages.length, 6);
    const pinned = report.packages.filter((row) => row.registry === 'cgr.dev');
    assert.equal(pinned.length, 2, 'both tag+digest and digest-only refs remain inventoried');
    for (const row of pinned) {
      assert.equal(row.outdated, false, `${row.declared} is not a floating reference`);
      assert.equal(row.skipped, true, 'immutability does not verify release freshness');
      assert.match(row.reason, /digest/i);
      assert.notEqual(row.floating_tag, true);
    }
    const findings = toFindings(report.packages);
    assert.equal(findings.length, 4, 'missing or malformed digests cannot suppress floating findings');
    assert.ok(findings.every((finding) => finding.category === 'docker_floating_tag'));
    assert.equal(report.summary.checked, 4, 'unverified pinned contents are not counted as current');
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('MySQL LTS policy compares only the selected 8.4 release line', () => {
  const policy = { series: '8.4', track: 'lts', review_after: '2029-04-30' };
  const tags = ['8.4.10', '8.4.11', '9.7.2', '26.7', '26.7.0'];
  const selected = selectDockerLatestForPolicy(tags, '', '8.4.11', policy, new Date('2026-09-09'));

  assert.equal(selected.latest, '8.4.11');
  assert.equal(selected.policy_applied, true);
  assert.deepEqual(selected.cross_track_versions, ['9.7.2', '26.7', '26.7.0']);
});

test('MySQL LTS policy still detects a patch inside the selected line', () => {
  const policy = { series: '8.4', track: 'lts', review_after: '2029-04-30' };
  const selected = selectDockerLatestForPolicy(
    ['8.4.10', '8.4.11', '9.7.2', '26.7'], '', '8.4.10', policy, new Date('2026-09-09'),
  );

  assert.equal(selected.latest, '8.4.11');
});

test('Docker images without a release policy retain global stable-tag comparison', () => {
  const selected = selectDockerLatestForPolicy(
    ['8.4.11', '26.7'], '', '8.4.11', null, new Date('2026-09-09'),
  );

  assert.equal(selected.latest, '26.7');
  assert.equal(selected.policy_applied, false);
});

test('expired Docker release policy fails closed instead of hiding future upgrades', () => {
  assert.throws(
    () => selectDockerLatestForPolicy(
      ['8.4.11', '26.7'], '', '8.4.11',
      { series: '8.4', track: 'lts', review_after: '2026-09-08' },
      new Date('2026-09-09'),
    ),
    /expired/i,
  );
});

test('CLI exits nonzero when the release policy is expired', (t) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-policy-error-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  fs.writeFileSync(path.join(fixture, 'dependency-policy.json'), JSON.stringify({
    release_managed_images: [{
      image: 'acme/mysql-runtime',
      dockerfile: 'infra/mysql-runtime/Dockerfile',
      source_image: 'mysql',
    }],
    docker: {
      'docker.io/library/mysql': {
        track: 'lts', series: '8.4', review_after: '2026-09-08',
      },
    },
  }));
  const dockerfileDir = path.join(fixture, 'infra', 'mysql-runtime');
  fs.mkdirSync(dockerfileDir, { recursive: true });
  fs.writeFileSync(path.join(dockerfileDir, 'Dockerfile'),
    `FROM mysql:8.4.11@sha256:${'a'.repeat(64)}\n`);
  fs.writeFileSync(path.join(fixture, 'docker-compose.yml'), [
    'services:',
    '  mysql:',
    '    image: acme/mysql-runtime:8.4.11-r1',
    '',
  ].join('\n'));
  const out = path.join(fixture, 'deps.json');

  const result = spawnSync(process.execPath, [
    path.join(HERE, '..', 'check-deps-latest.mjs'), '--root', fixture, '--out', out,
  ], { encoding: 'utf8', timeout: 15_000 });

  assert.notEqual(result.status, 0, 'scanner errors must fail the CLI contract');
  const report = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(report.summary.errors, 1);
  assert.match(report.packages.find((row) => row.error)?.error || '', /expired/i);
});

test('APP_VERSION compose images are release-managed first-party artifacts', () => {
  assert.equal(
    isReleaseManagedComposeImage('${DOCKERHUB_USERNAME:-org}/my-app:${APP_VERSION:-1.0.0}'),
    true,
  );
  assert.equal(isReleaseManagedComposeImage('mysql:8.4.11@sha256:' + 'a'.repeat(64)), false);
  assert.equal(isReleaseManagedComposeImage('vendor/app:1.2.3'), false);
});

test('hardened runtime images are ordinary unless listed in dependency-policy', () => {
  assert.equal(isReleaseManagedComposeImage('acme/mysql-runtime:8.4.11-r1'), false);
  assert.equal(isReleaseManagedComposeImage('acme/redis-runtime:8.10.1-r1'), false);
});

test('npm aliases check the actual registry package and preserve the alias in upgrade commands', async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-alias-'));
  try {
    const manifest = path.join(fixture, 'package.json');
    fs.writeFileSync(manifest, JSON.stringify({ devDependencies: {
      typescript: 'npm:@typescript/typescript6@^6.0.2',
      '@typescript/native': 'npm:typescript@^7.0.2',
      plain: '^1.0.0',
    } }));
    fs.writeFileSync(path.join(fixture, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        'node_modules/typescript': { name: '@typescript/typescript6', version: '6.0.2' },
        'node_modules/@typescript/native': { name: 'typescript', version: '7.0.2' },
        'node_modules/plain': { version: '1.0.1' },
      },
    }));
    const requests = [];
    const versions = { '@typescript/typescript6': '6.0.3', typescript: '7.0.3', plain: '1.0.1' };
    const rows = await checkNpm([manifest], async (name) => {
      requests.push(name);
      return versions[name];
    });
    assert.deepEqual(requests.sort(), Object.keys(versions).sort());
    assert.equal(rows.length, 3, 'neither alias may disappear from the inventory');
    const byAlias = new Map(rows.map((row) => [row.name, row]));
    assert.equal(byAlias.get('typescript').current, '6.0.2');
    assert.equal(byAlias.get('typescript').latest_stable, '6.0.3');
    assert.equal(byAlias.get('@typescript/native').current, '7.0.2');
    assert.equal(byAlias.get('@typescript/native').latest_stable, '7.0.3');
    assert.equal(byAlias.get('plain').outdated, false, 'lockfile wins over the manifest lower bound');
    const findings = toFindings(rows);
    assert.equal(findings.length, 2);
    const hints = new Map(findings.map((finding) => [finding.package, finding.fix]));
    assert.match(hints.get('typescript'), /npm install typescript@npm:@typescript\/typescript6@6\.0\.3/);
    assert.match(hints.get('@typescript/native'), /npm install @typescript\/native@npm:typescript@7\.0\.3/);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('npm freshness respects the repository min-release-age before opening an update finding', async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-npm-maturity-'));
  try {
    const manifest = path.join(fixture, 'package.json');
    fs.writeFileSync(manifest, JSON.stringify({ devDependencies: { recent: '^1.0.0' } }));
    fs.writeFileSync(path.join(fixture, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { devDependencies: { recent: '^1.0.0' } },
        'node_modules/recent': { version: '1.0.0' },
      },
    }));
    fs.writeFileSync(path.join(fixture, '.npmrc'), 'min-release-age=7\n');

    const rows = await checkNpm([manifest], async (_name, minReleaseAgeDays) => {
      assert.equal(minReleaseAgeDays, 7);
      return {
        version: '1.0.0',
        registry_latest: '1.1.0',
        registry_latest_published_at: '2026-09-13T12:00:00.000Z',
        deferred_until: '2026-09-20T12:00:00.000Z',
      };
    });

    assert.equal(rows[0].outdated, false, 'an immature release is not actionable yet');
    assert.equal(rows[0].latest_stable, '1.0.0');
    assert.equal(rows[0].registry_latest, '1.1.0');
    assert.equal(rows[0].deferred_until, '2026-09-20T12:00:00.000Z');
    assert.equal(toFindings(rows).length, 0);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('the checked-in CLI includes its stack detector instead of silently returning an empty stack', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-stack-'));
  try {
    fs.writeFileSync(path.join(fixture, 'compose.yml'), 'services:\n  storage:\n    image: minio/minio:latest\n');
    const result = spawnSync(process.execPath, [
      path.join(HERE, '..', 'check-deps-latest.mjs'), '--root', fixture,
    ], { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.stack.ecosystems, ['docker']);
    assert.deepEqual(report.stack.frameworks, ['docker', 'minio']);
    assert.deepEqual(report.stack.manifests, [{ kind: 'docker-compose', path: 'compose.yml' }]);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
