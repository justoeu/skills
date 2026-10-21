#!/usr/bin/env node
/**
 * detect-stack.mjs — languages, frameworks, package managers, manifests
 *
 *   node detect-stack.mjs [--root .]
 */
import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}

const root = path.resolve(arg('root', '.'));

const SKIP = new Set([
  'node_modules',
  '.git',
  'vendor',
  '.build',
  'build',
  'dist',
  'target',
  'coverage',
  '__pycache__',
  '.gradle',
  '.idea',
  'Pods',
  'DerivedData',
]);

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function walk(dir, onFile, depth = 0) {
  if (depth > 5) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (SKIP.has(ent.name)) continue;
    const p = path.join(dir, nameOf(ent));
    if (ent.isDirectory()) walk(p, onFile, depth + 1);
    else onFile(ent.name, p);
  }
}
function nameOf(ent) {
  return ent.name;
}

function rel(p) {
  return path.relative(root, p) || path.basename(p);
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function readText(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

const languages = new Set();
const frameworks = new Set();
const package_managers = new Set();
const ecosystems = new Set();
const manifests = [];
const signals = [];

const EXT_LANG = {
  '.swift': 'swift',
  '.go': 'go',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.jsx': 'javascript',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.py': 'python',
  '.rs': 'rust',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.scala': 'scala',
  '.dart': 'dart',
};

const foundExt = new Set();

walk(root, (name, p) => {
  const ext = path.extname(name).toLowerCase();
  if (EXT_LANG[ext]) {
    languages.add(EXT_LANG[ext]);
    foundExt.add(ext);
  }

  const r = rel(p);

  if (name === 'package.json') {
    manifests.push({ kind: 'npm', path: r });
    ecosystems.add('npm');
    package_managers.add('npm');
    const pkg = readJson(p);
    if (!pkg) return;
    const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
    const has = (k) => Object.prototype.hasOwnProperty.call(deps, k);
    if (has('react') || has('react-dom')) frameworks.add('react');
    if (has('next')) frameworks.add('next');
    if (has('vue')) frameworks.add('vue');
    if (has('nuxt')) frameworks.add('nuxt');
    if (has('svelte') || has('@sveltejs/kit')) frameworks.add('svelte');
    if (has('express')) frameworks.add('express');
    if (has('fastify')) frameworks.add('fastify');
    if (has('vite') || has('@vitejs/plugin-react')) frameworks.add('vite');
    if (has('vitest')) frameworks.add('vitest');
    if (has('@angular/core')) frameworks.add('angular');
    if (has('@nestjs/core')) frameworks.add('nestjs');
    if (has('electron')) frameworks.add('electron');
    if (has('react-native')) frameworks.add('react-native');
    if (fs.existsSync(path.join(path.dirname(p), 'bun.lock')) || fs.existsSync(path.join(path.dirname(p), 'bun.lockb'))) {
      package_managers.add('bun');
    }
    if (fs.existsSync(path.join(path.dirname(p), 'pnpm-lock.yaml'))) package_managers.add('pnpm');
    if (fs.existsSync(path.join(path.dirname(p), 'yarn.lock'))) package_managers.add('yarn');
    if (fs.existsSync(path.join(path.dirname(p), 'package-lock.json'))) package_managers.add('npm');
    languages.add('javascript');
    if (fs.existsSync(path.join(path.dirname(p), 'tsconfig.json')) || has('typescript')) {
      languages.add('typescript');
    }
    signals.push(`node:${pkg.name || path.dirname(r) || 'app'}`);
  }

  if (name === 'go.mod') {
    manifests.push({ kind: 'go', path: r });
    ecosystems.add('go');
    package_managers.add('go-modules');
    languages.add('go');
  }

  if (name === 'pom.xml') {
    manifests.push({ kind: 'maven', path: r });
    ecosystems.add('maven');
    package_managers.add('maven');
    languages.add('java');
    const t = readText(p);
    if (/spring-boot|springframework/i.test(t)) frameworks.add('spring');
    if (/spring-boot/i.test(t)) frameworks.add('spring-boot');
    if (/quarkus/i.test(t)) frameworks.add('quarkus');
    if (/micronaut/i.test(t)) frameworks.add('micronaut');
    if (/\.kt|kotlin/i.test(t)) languages.add('kotlin');
  }

  if (name === 'build.gradle' || name === 'build.gradle.kts' || name === 'settings.gradle' || name === 'settings.gradle.kts') {
    if (name.startsWith('build.gradle')) {
      manifests.push({ kind: 'gradle', path: r });
    }
    ecosystems.add('gradle');
    package_managers.add('gradle');
    languages.add('java');
    const t = readText(p);
    if (/org\.jetbrains\.kotlin|kotlin\(/i.test(t)) languages.add('kotlin');
    if (/org\.springframework\.boot|springframework/i.test(t)) {
      frameworks.add('spring');
      frameworks.add('spring-boot');
    }
    if (/quarkus/i.test(t)) frameworks.add('quarkus');
    if (/com\.android\.application|com\.android\.library/i.test(t)) frameworks.add('android');
  }

  if (name === 'libs.versions.toml') {
    manifests.push({ kind: 'gradle-version-catalog', path: r });
    ecosystems.add('gradle');
    package_managers.add('gradle');
  }

  if (name === 'Package.swift') {
    manifests.push({ kind: 'spm', path: r });
    ecosystems.add('spm');
    package_managers.add('spm');
    languages.add('swift');
    frameworks.add('spm');
  }

  if (name === 'Package.resolved') {
    manifests.push({ kind: 'spm-resolved', path: r });
    ecosystems.add('spm');
  }

  if (name === 'Podfile') {
    manifests.push({ kind: 'cocoapods', path: r });
    ecosystems.add('cocoapods');
    package_managers.add('cocoapods');
    languages.add('swift');
    frameworks.add('cocoapods');
  }

  if (name === 'Cargo.toml') {
    manifests.push({ kind: 'cargo', path: r });
    ecosystems.add('cargo');
    package_managers.add('cargo');
    languages.add('rust');
  }

  if (name === 'pyproject.toml' || /^requirements.*\.txt$/i.test(name) || name === 'Pipfile' || name === 'setup.py') {
    manifests.push({ kind: name === 'pyproject.toml' ? 'pyproject' : 'pip', path: r });
    ecosystems.add('pypi');
    package_managers.add(name === 'Pipfile' ? 'pipenv' : 'pip');
    languages.add('python');
    const t = readText(p);
    if (/django/i.test(t)) frameworks.add('django');
    if (/fastapi/i.test(t)) frameworks.add('fastapi');
    if (/flask/i.test(t)) frameworks.add('flask');
  }

  if (name === 'composer.json') {
    manifests.push({ kind: 'composer', path: r });
    ecosystems.add('composer');
    package_managers.add('composer');
    languages.add('php');
    const pkg = readJson(p);
    const deps = { ...(pkg?.require || {}), ...(pkg?.['require-dev'] || {}) };
    if (deps['laravel/framework']) frameworks.add('laravel');
    if (deps['symfony/framework-bundle'] || Object.keys(deps).some((k) => k.startsWith('symfony/'))) {
      frameworks.add('symfony');
    }
  }

  if (name === 'Gemfile') {
    manifests.push({ kind: 'bundler', path: r });
    ecosystems.add('rubygems');
    package_managers.add('bundler');
    languages.add('ruby');
    const t = readText(p);
    if (/\brails\b/i.test(t)) frameworks.add('rails');
  }

  if (name === 'pubspec.yaml') {
    manifests.push({ kind: 'pub', path: r });
    ecosystems.add('pub');
    package_managers.add('pub');
    languages.add('dart');
    frameworks.add('flutter');
  }

  if (name.endsWith('.csproj') || name.endsWith('.fsproj') || name === 'packages.config') {
    manifests.push({ kind: 'nuget', path: r });
    ecosystems.add('nuget');
    package_managers.add('nuget');
    languages.add('csharp');
    const t = readText(p);
    if (/Microsoft\.AspNetCore|Microsoft\.NET\.Sdk\.Web/i.test(t)) frameworks.add('aspnetcore');
  }

  if (
    name === 'docker-compose.yml' ||
    name === 'docker-compose.yaml' ||
    name === 'compose.yml' ||
    name === 'compose.yaml' ||
    /^docker-compose\..+\.ya?ml$/i.test(name) ||
    /^compose\..+\.ya?ml$/i.test(name)
  ) {
    manifests.push({ kind: 'docker-compose', path: r });
    ecosystems.add('docker');
    package_managers.add('docker-compose');
    frameworks.add('docker');
    const t = readText(p);
    const images = [...t.matchAll(/^\s*image:\s*["']?([^"'\s#]+)/gm)].map((m) => m[1]);
    for (const img of images) {
      signals.push(`docker-image:${img}`);
      if (/postgres/i.test(img)) frameworks.add('postgres');
      if (/redis/i.test(img)) frameworks.add('redis');
      if (/minio/i.test(img)) frameworks.add('minio');
      if (/mongo/i.test(img)) frameworks.add('mongodb');
      if (/mysql|mariadb/i.test(img)) frameworks.add('mysql');
      if (/nginx/i.test(img)) frameworks.add('nginx');
      if (/rabbitmq/i.test(img)) frameworks.add('rabbitmq');
      if (/kafka/i.test(img)) frameworks.add('kafka');
      if (/elasticsearch|opensearch/i.test(img)) frameworks.add('elasticsearch');
    }
  }
  if (name === 'Dockerfile' || /^Dockerfile\./i.test(name)) {
    manifests.push({ kind: 'dockerfile', path: r });
    ecosystems.add('docker');
    frameworks.add('docker');
  }

  if (name === 'vite.config.ts' || name === 'vite.config.js' || name === 'vite.config.mts') {
    frameworks.add('vite');
    signals.push(`vite-config:${r}`);
  }
  if (name === 'next.config.js' || name === 'next.config.mjs' || name === 'next.config.ts') {
    frameworks.add('next');
  }
  if (name === 'angular.json') frameworks.add('angular');
  if (name === 'AndroidManifest.xml') {
    frameworks.add('android');
    languages.add('java');
  }
  if (name.endsWith('.xcodeproj') || name === 'project.pbxproj') {
    languages.add('swift');
    frameworks.add('xcode');
  }
});

// root-level quick signals
if (exists('Package.swift') && exists('Sources')) frameworks.add('swift-app');
if ([...frameworks].includes('spring-boot') || [...frameworks].includes('spring')) {
  languages.add('java');
}

const out = {
  root,
  languages: [...languages].sort(),
  frameworks: [...frameworks].sort(),
  package_managers: [...package_managers].sort(),
  ecosystems: [...ecosystems].sort(),
  manifests: manifests.sort((a, b) => a.path.localeCompare(b.path)),
  signals: [...new Set(signals)].sort(),
  catalog: 'catalogs/classic-bugs.md',
};

console.log(JSON.stringify(out, null, 2));
