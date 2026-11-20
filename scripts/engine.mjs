export function resolveThresholds(liveness, provider) {
  return { ...liveness.thresholds.default, ...(liveness.thresholds[provider] ?? {}) };
}

const lookup = (thresholds, v) => (typeof v === 'number' ? v : thresholds[v]);

export function testStep(step, sample, thresholds) {
  const s = sample[step.signal];
  const v = lookup(thresholds, step.value);
  switch (step.op) {
    case 'gt': return s > v;
    case 'lt': return s < v;
    case 'lt_neg': return s < -v;
    case 'abs_lt': return Math.abs(s) < v;
    default: throw new Error(`Unknown op ${step.op}`);
  }
}

export function positionStatus(sample, position) {
  if (sample.faces === 0) return 'no_face';
  if (sample.faces > position.faces) return 'multiple_faces';
  const { x, y, w, h } = sample.box;
  const area = w * h;
  if (area < position.face_area_min) return 'too_small';
  if (area > position.face_area_max) return 'too_large';
  const dx = Math.abs(x + w / 2 - 0.5);
  const dy = Math.abs(y + h / 2 - 0.5);
  if (dx > position.center_tolerance || dy > position.center_tolerance) return 'off_center';
  return 'ok';
}

export const positionCopyKey = {
  no_face: 'liveness.position.no_face',
  multiple_faces: 'liveness.position.one_face',
  too_small: 'liveness.position.move_closer',
  too_large: 'liveness.position.move_further',
  off_center: 'liveness.position.center',
  ok: 'liveness.position.ready',
};

export function createPositionGate(liveness) {
  let start = null;
  let done = false;
  return {
    push(sample) {
      if (done) throw new Error('Position gate already finished');
      if (start === null) start = sample.t;
      if (sample.t - start >= liveness.gesture_timeout_ms) {
        done = true;
        return { state: 'timeout', status: positionStatus(sample, liveness.position) };
      }
      const status = positionStatus(sample, liveness.position);
      if (status === 'ok') {
        done = true;
        return { state: 'pass', status, t: sample.t };
      }
      return { state: 'running', status };
    },
  };
}

export function createGestureRun(liveness, gesture, provider = 'default') {
  const steps = liveness.gestures[gesture];
  if (!steps) throw new Error(`Unknown gesture ${gesture}`);
  const thresholds = resolveThresholds(liveness, provider);
  const resetMs = liveness.face_lost_reset_ms;
  let start = null;
  let prevT = null;
  let lostSince = null;
  let index = 0;
  let count = 0;
  let done = false;
  return {
    get step() { return index; },
    push(sample) {
      if (done) throw new Error('Gesture run already finished');
      if (start === null) start = sample.t;
      if (sample.t - start >= liveness.gesture_timeout_ms) {
        done = true;
        return { state: 'timeout', step: index };
      }
      const gap = prevT !== null && sample.t - prevT >= resetMs;
      prevT = sample.t;
      if (sample.faces !== 1) {
        count = 0;
        if (lostSince === null) lostSince = sample.t;
        if (sample.t - lostSince >= resetMs) index = 0;
        return { state: 'running', step: index, tracked: false };
      }
      if (gap || (lostSince !== null && sample.t - lostSince >= resetMs)) {
        index = 0;
        count = 0;
      }
      lostSince = null;
      const step = steps[index];
      if (testStep(step, sample, thresholds)) {
        count += 1;
        const hold = step.hold_frames === undefined ? 1 : lookup(thresholds, step.hold_frames);
        if (count >= hold) {
          index += 1;
          count = 0;
          if (index === steps.length) {
            done = true;
            return { state: 'pass', step: index, t: sample.t };
          }
        }
      } else {
        count = 0;
      }
      return { state: 'running', step: index, tracked: true };
    },
  };
}

export function runTrace(liveness, trace) {
  const run = trace.gesture === 'position'
    ? createPositionGate(liveness)
    : createGestureRun(liveness, trace.gesture, trace.provider ?? 'default');
  let last = null;
  for (const sample of trace.samples) {
    last = run.push(sample);
    if (last.state !== 'running') break;
  }
  const outcome = last && last.state !== 'running' ? last.state : 'fail';
  return { outcome, t: last?.t, status: last?.status, step: last?.step };
}
