import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, TARGETS, generate } from './generate.mjs';
import { validateCopy, validateErrors, validateRejections } from './lib/load.mjs';
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
  const listed = [...section.matchAll(/^\| `((?:location|liveness|email|phone)\.[a-z_]+)` \|/gm)].map((m) => m[1]);
  assert.deepEqual(listed, Object.keys(codes));
});

test('every rejection code has exactly one real backend 422 fixture', () => {
  const { codes } = JSON.parse(readFileSync(join(ROOT, 'spec/errors.json'), 'utf8'));
  const dir = join(ROOT, 'fixtures/rejections');
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.json')).sort(), Object.keys(codes).map((c) => `${c}.json`).sort());
  for (const code of Object.keys(codes)) {
    const body = JSON.parse(readFileSync(join(dir, `${code}.json`), 'utf8'));
    assert.equal(body.code, code);
    assert.equal(body.success, false);
    assert.equal(typeof body.message, 'string');
  }
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

test('every rejection code has applicant copy and an action in every target', () => {
  const { codes } = JSON.parse(readFileSync(join(ROOT, 'spec/errors.json'), 'utf8'));
  const rejections = JSON.parse(readFileSync(join(ROOT, 'spec/rejections.json'), 'utf8'));
  assert.deepEqual(Object.keys(rejections.codes), Object.keys(codes));
  for (const target of TARGETS) {
    const output = generate(target);
    for (const entry of Object.values(rejections.codes)) {
      for (const key of [entry.title, entry.message]) assert.ok(output.includes(`"${key}"`) || output.includes(`'${key}'`), `${target} is missing ${key}`);
    }
  }
});

test('rejection validation catches missing copy, unknown actions and code drift', () => {
  const strings = { 'rejection.help': 'Help', 'rejection.requested_by': 'By', 'rejection.action.retry': 'Try again', 'x.title': 'T', 'x.message': 'M' };
  const rejections = { requested_by: 'rejection.requested_by', help: 'rejection.help', actions: { retry: { label: 'rejection.action.retry' } }, codes: {
    'location.stale': { title: 'x.title', message: 'x.missing', action: 'retry' },
    'location.mock': { title: 'x.title', message: 'x.message', action: 'dance' },
  } };
  const problems = validateRejections(rejections, { codes: { 'location.stale': '', 'location.mock': '', 'location.accuracy': '' } }, strings).join('\n');
  assert.match(problems, /location.stale: message copy key x.missing does not exist/);
  assert.match(problems, /location.mock: unknown action dance/);
  assert.match(problems, /same order/);
});

test('contact code fixtures match the contact code rules', () => {
  const { contact_codes: rules } = JSON.parse(readFileSync(join(ROOT, 'spec/requirements.json'), 'utf8'));
  for (const name of ['email-code-request', 'phone-code-request']) {
    const { data } = JSON.parse(readFileSync(join(ROOT, `fixtures/${name}.json`), 'utf8'));
    assert.ok(data.channel in rules.channels);
    assert.equal(Date.parse(data.expires_at) - Date.parse(data.resend_available_at), (rules.ttl_minutes * 60 - rules.resend_seconds) * 1000);
    assert.equal(data.sends_remaining, rules.max_sends - 1);
  }
});

test('a session refresh after a submit shows the requirement the workflow added', () => {
  const { refresh } = JSON.parse(readFileSync(join(ROOT, 'spec/requirements.json'), 'utf8'));
  const outstanding = (session) => refresh.open_statuses.includes(session.data.status)
    && refresh.outstanding.some((path) => (path.split('.').reduce((v, k) => v?.[k], session.data) ?? []).length > 0);
  const before = JSON.parse(readFileSync(join(ROOT, 'fixtures/questionnaire-session.json'), 'utf8'));
  const after = JSON.parse(readFileSync(join(ROOT, 'fixtures/requirement-added-session.json'), 'utf8'));
  assert.deepEqual(before.data.profile.verification_requirements.map((r) => r.verification_type), ['email_verification']);
  assert.deepEqual(after.data.profile.verification_requirements.map((r) => r.verification_type), ['phone_verification']);
  assert.ok(outstanding(after));
});
