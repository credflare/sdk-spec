import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, TARGETS, generate } from './generate.mjs';
import { validateCopy, validateErrors } from './lib/load.mjs';
import { normalizePath, serializePath } from './lib/path.mjs';

const cli = join(ROOT, 'scripts/generate.mjs');

for (const target of TARGETS) {
  test(`${target} output is stamped and deterministic`, () => {
    const a = generate(target);
    assert.equal(a, generate(target));
    assert.match(a.split('\n')[0], /GENERATED FILE, DO NOT EDIT/);
    assert.match(a.split('\n')[1], /sdk-spec \d+\.\d+\.\d+ \([0-9a-f]{12}\)/);
  });

  test(`${target} --check passes on fresh output and fails on drift`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'sdk-spec-'));
    const file = join(dir, `out.${target}`);
    execFileSync('node', [cli, '--target', target, '--out', file]);
    assert.equal(spawnSync('node', [cli, '--target', target, '--out', file, '--check']).status, 0);
    writeFileSync(file, readFileSync(file, 'utf8').replace('Verify your identity', 'Verify you'));
    const drift = spawnSync('node', [cli, '--target', target, '--out', file, '--check'], { encoding: 'utf8' });
    assert.equal(drift.status, 1);
    assert.match(drift.stderr, /out of date/);
  });
}

test('copy validation rejects banned wording and unknown placeholders', () => {
  const copy = { locale: 'en', placeholders: { verifier: '' }, strings: {
    'receipt.title': 'Identity verified',
    'receipt.body': 'Sent — thanks',
    'receipt.other': 'Hi {name}',
    'Bad.Key': 'x',
  } };
  const problems = validateCopy(copy).join('\n');
  assert.match(problems, /receipt.title: contains "verified"/);
  assert.match(problems, /receipt.body: contains en or em dash/);
  assert.match(problems, /unknown placeholder \{name\}/);
  assert.match(problems, /Bad.Key: key must be dotted snake_case/);
});

test('every target exposes every rejection code', () => {
  const { codes } = JSON.parse(readFileSync(join(ROOT, 'spec/errors.json'), 'utf8'));
  for (const target of TARGETS) {
    const output = generate(target);
    for (const code of Object.keys(codes)) assert.ok(output.includes(`"${code}"`) || output.includes(`'${code}'`), `${target} is missing ${code}`);
  }
});

test('CONTRACT.md lists exactly the rejection codes in spec/errors.json', () => {
  const { codes } = JSON.parse(readFileSync(join(ROOT, 'spec/errors.json'), 'utf8'));
  const section = readFileSync(join(ROOT, 'CONTRACT.md'), 'utf8').split('## Rejection codes')[1].split('\n## ')[0];
  const listed = [...section.matchAll(/^\| `((?:location|liveness)\.[a-z_]+)` \|/gm)].map((m) => m[1]);
  assert.deepEqual(listed, Object.keys(codes));
});

test('error validation rejects malformed codes and meanings', () => {
  const problems = validateErrors({ codes: { 'Location.Bad': 'x', 'document.blurry': 'Blurry', 'liveness.ok': '', 'liveness.dash': 'Too long -- retry' } }).join('\n');
  assert.match(problems, /Location.Bad: code must be/);
  assert.match(problems, /document.blurry: code must be/);
  assert.match(problems, /liveness.ok: meaning must be a non empty string/);
  assert.match(problems, /liveness.dash: meaning contains a dash/);
  assert.match(validateErrors({ codes: {} }).join(), /no codes/);
});

test('icon paths normalize to absolute M L C Z', () => {
  const d = serializePath(normalizePath('M14.25 10 A2.25 2.25 0 1 1 9.75 10 A2.25 2.25 0 1 1 14.25 10 Z m1 1 h2 v2'));
  assert.match(d, /^[MLCZ0-9 .-]+$/);
  assert.ok(d.startsWith('M 14.25 10 C 14.25 11.243 13.243 12.25 12 12.25'));
  assert.equal(d.match(/C/g).length, 4);
  assert.ok(d.endsWith('Z M 15.25 11 L 17.25 11 L 17.25 13'));
});
