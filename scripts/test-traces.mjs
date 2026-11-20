import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './generate.mjs';
import { runTrace } from './engine.mjs';

const liveness = JSON.parse(readFileSync(join(ROOT, 'spec/liveness.json'), 'utf8'));
const dir = join(ROOT, 'fixtures/liveness-traces');
const traces = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  .map((file) => ({ file, trace: JSON.parse(readFileSync(join(dir, file), 'utf8')) }));

for (const { file, trace } of traces) {
  test(`trace ${file} ends with ${trace.expect}`, () => {
    const result = runTrace(liveness, trace);
    assert.equal(result.outcome, trace.expect);
    if (trace.expect_status) assert.equal(result.status, trace.expect_status);
  });
}

test('every trace is well formed', () => {
  const fields = ['t', 'faces', 'box', 'eye_open', 'smile', 'yaw', 'pitch'];
  for (const { file, trace } of traces) {
    assert.ok(['pass', 'fail', 'timeout'].includes(trace.expect), file);
    assert.ok(trace.gesture === 'position' || trace.gesture in liveness.gestures, file);
    assert.ok(trace.provider in liveness.thresholds, file);
    trace.samples.forEach((s, i) => {
      assert.deepEqual(Object.keys(s), fields, `${file} sample ${i}`);
      if (i) assert.equal(s.t - trace.samples[i - 1].t, liveness.sample_interval_ms, `${file} sample ${i}`);
    });
  }
});

test('every gesture has a passing trace and a failing or timeout trace', () => {
  for (const gesture of [...Object.keys(liveness.gestures), 'position']) {
    const own = traces.filter(({ trace }) => trace.gesture === gesture).map(({ trace }) => trace.expect);
    assert.ok(own.includes('pass'), `${gesture} has no passing trace`);
    assert.ok(own.some((e) => e !== 'pass'), `${gesture} has no failing trace`);
  }
});

test('face lost reset traces fail only because of the reset rule', () => {
  const noReset = { ...liveness, face_lost_reset_ms: Number.POSITIVE_INFINITY };
  const reset = traces.filter(({ file }) => file.includes('_reset_'));
  assert.ok(reset.length >= 3);
  for (const { file, trace } of reset) assert.equal(runTrace(noReset, trace).outcome, 'pass', file);
});

test('provider overrides change the outcome', () => {
  const pick = (name) => traces.find(({ file }) => file === name).trace;
  assert.equal(runTrace(liveness, { ...pick('smile_mediapipe_pass.json'), provider: 'default' }).outcome, 'fail');
  assert.equal(runTrace(liveness, { ...pick('smile_mlkit_fail.json'), provider: 'default' }).outcome, 'pass');
});
