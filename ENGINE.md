# Gesture engine

Every SDK runs the same engine on the normalized face samples described in CONTRACT.md ("Face signals"). The rules and numbers come from `spec/liveness.json`. `scripts/engine.mjs` is the reference implementation, and `scripts/test-traces.mjs` replays every file in `fixtures/liveness-traces/` against it. A platform implementation is correct when it produces the same outcome for every trace.

The engine checks that the camera saw a server chosen sequence of movements in time. It does not prove a live person and does not detect deepfakes. Never present its result to the applicant as a verification result.

## Inputs

- `liveness`: the parsed `spec/liveness.json` (generated constants on each platform).
- `gesture`: one name from the challenge's `gestures` list.
- `provider`: the face provider in use (`vision`, `mlkit`, `mediapipe`, or `default`).
- A stream of samples `{t, faces, box, eye_open, smile, yaw, pitch}`. `t` is in milliseconds and increases. When `faces` is 0, `box` and the signals are `null`.

## Thresholds

```
thresholds = liveness.thresholds.default, then overwrite each key present in liveness.thresholds[provider]
```

An unknown provider uses `default` only. A step's `value` and `hold_frames` are threshold key names. Look each one up in `thresholds`. A literal number is used as is.

## Step operators

`s` is `sample[step.signal]`, `v` is the resolved threshold.

| op | true when |
| --- | --- |
| `gt` | `s > v` |
| `lt` | `s < v` |
| `lt_neg` | `s < -v` |
| `abs_lt` | `abs(s) < v` |

All comparisons are strict. `hold` is the resolved `hold_frames`, or 1 when the step has none.

## Gesture run

State: `start = null`, `prevT = null`, `lostSince = null`, `index = 0`, `count = 0`.

For each sample, in this order:

1. If `start` is null, set `start = t`.
2. **Timeout.** If `t - start >= gesture_timeout_ms`, the run ends with `timeout`. The sample is not evaluated.
3. `gap = prevT != null and t - prevT >= face_lost_reset_ms`. Set `prevT = t`.
4. **Face lost.** A sample is tracked only when `faces == 1`. Zero faces and two or more faces both count as lost. For an untracked sample:
   - set `count = 0`;
   - if `lostSince` is null, set `lostSince = t`;
   - if `t - lostSince >= face_lost_reset_ms`, set `index = 0`;
   - stop processing this sample.
5. **Face back.** For a tracked sample, if `gap` is true, or `lostSince` is set and `t - lostSince >= face_lost_reset_ms`, set `index = 0` and `count = 0`. Then set `lostSince = null`.
6. **Step.** Evaluate `steps[index]` on the sample.
   - If true: `count += 1`. When `count >= hold`, set `index += 1` and `count = 0`. When `index == steps.length`, the run ends with `pass` at this sample. Capture this frame as the gesture frame for upload.
   - If false: `count = 0`.

At most one step advances per sample. The run never fails by itself: in production it ends with `pass` or `timeout`. A trace whose samples end while the run is still going has the outcome `fail`.

Consequences worth testing on each platform:

- A face lost for less than `face_lost_reset_ms` keeps progress, but clears a `hold_frames` count.
- A face lost for `face_lost_reset_ms` or longer restarts the gesture at its first step. The timeout keeps running from the original `start`.
- A turn or nod must come back to neutral (`abs_lt return`) while tracked. Coming back while the face is lost does not count.

## Challenge sequence

1. Run the position gate (below) until it passes.
2. Run one gesture run per challenge gesture, in the server's order. Each run starts its own timer at its first sample, which is the first sample after the previous run passed.
3. Any `timeout` ends the challenge. Show `liveness.timeout` and offer `liveness.retry`, which asks the server for a new challenge. Never reuse the old one.
4. The whole flow must finish before the challenge's `expires_at`. If it expires, show `liveness.expired`.

## Position gate

```
if faces == 0                    -> no_face
else if faces > position.faces   -> multiple_faces
else area = box.w * box.h
  if area < face_area_min        -> too_small
  else if area > face_area_max   -> too_large
  else if abs(box.x + box.w/2 - 0.5) > center_tolerance
       or abs(box.y + box.h/2 - 0.5) > center_tolerance -> off_center
  else                           -> ok
```

The gate passes on the first `ok` sample, and times out with the same `gesture_timeout_ms` rule as a gesture run. During gesture runs only the face count matters, because a head turn moves the box. Show the status as a hint:

| Status | Copy key |
| --- | --- |
| `no_face` | `liveness.position.no_face` |
| `multiple_faces` | `liveness.position.one_face` |
| `too_small` | `liveness.position.move_closer` |
| `too_large` | `liveness.position.move_further` |
| `off_center` | `liveness.position.center` |
| `ok` | `liveness.position.ready` |

`liveness.position.hold_still` and `liveness.position.more_light` are optional hints for platforms that can measure motion blur or brightness. They are not part of the face signals and never block the engine.

## Trace format

```json
{ "gesture": "turn_left", "provider": "default", "expect": "pass",
  "expect_status": "ok", "description": "...",
  "samples": [ {"t": 0, "faces": 1, "box": {"x": 0.29, "y": 0.21, "w": 0.42, "h": 0.52},
                "eye_open": 0.85, "smile": 0.08, "yaw": 1.2, "pitch": -0.4} ] }
```

- `gesture` is a gesture name, or `position` for the position gate.
- `expect` is `pass`, `fail` (samples ended first) or `timeout`.
- `expect_status` (position traces only) is the position status of the last sample processed.
- Samples are 66 ms apart (`sample_interval_ms`).

## Reference places

`scripts/places.mjs` implements the location reference check from CONTRACT.md ("Reference places"): haversine distance, `within` or `outside`, `strict` or `lenient`, `any` or `all`. A radius of `0` means the place must fall inside the fix's own accuracy circle (`distance <= accuracy`, or `distance > accuracy` for `outside`) for both confidence modes.

Clients only receive `rule` and the place labels, never the coordinates, so they cannot run this check themselves. The server decides. Clients may show `location.place.estimate_matched` only when the server provides an estimate, and must word any client side result as an estimate.
