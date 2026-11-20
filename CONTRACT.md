# Applicant capture contract

This is the shared definition that the backend, the web applicant page and all five SDKs implement. The values in `spec/*.json` are the source of truth. Platform constants are generated from them by `scripts/generate.mjs`.

## Requirement settings

`profile.verification_requirements[]` in the public and session responses carries `settings`. The backend fills in any setting the profile leaves out using the defaults in `spec/settings.json`, so clients always receive complete settings.

```json
{ "verification_type": "facial_verification",
  "settings": { "gestures": ["blink", "smile", "turn_left", "turn_right", "nod"], "gesture_count": 3,
                "record_video": true, "video_retention_days": 30 } }
{ "verification_type": "location_verification",
  "settings": { "max_accuracy_m": 100, "max_age_s": 60, "mock_location": "reject", "ip_country": "flag" } }
```

## Liveness challenge

The applicant cannot choose the gestures. The client asks the server for a challenge immediately before the liveness screen starts.

- Session route: `POST /sdk/sessions/{session}/liveness-challenges` with a bearer session token.
- Hosted route: `POST /client/verifications/{id}/liveness-challenges`.

`201` response:

```json
{ "data": { "challenge_id": "uuid", "gestures": ["smile", "turn_left", "blink"],
            "expires_at": "ISO-8601", "record_video": true, "max_video_seconds": 8 } }
```

- `gestures` holds `gesture_count` gestures drawn at random from `settings.gestures`, with no repeats. The client must run them in this order.
- A challenge expires after `spec/liveness.json` `challenge_ttl_s`.
- A challenge can be used for one facial submission only.
- Requesting a new challenge cancels any earlier unused challenge for the same case.

## Uploads

`POST .../uploads/biometrics` is multipart and needs an `X-Idempotency-Key` UUID header.

| `type` | Extra fields | File |
| --- | --- | --- |
| `gesture` | `challenge_id`, `gesture`, `capture_source=camera` | One JPEG frame, taken when the gesture completed |
| `liveness_video` | `challenge_id`, `capture_source=camera` | mp4, mov or webm, at most `max_video_seconds` long |
| `selfie` | `challenge_id`, `capture_source=camera` | A JPEG, PNG or WebP still |

## Facial submission

```json
{ "type": "facial_verification", "challenge_id": "uuid", "image_file_id": 1,
  "gesture_file_ids": [2, 3, 4], "video_file_id": 5,
  "metadata": { "provider": "vision|mlkit|mediapipe",
                "liveness_results": [{ "challenge": "smile", "completed": true, "timestamp": "ISO-8601" }],
                "face_detection": { "detected": true, "face_count": 1, "is_centered": true, "is_correct_size": true },
                "captured_at": "ISO-8601" } }
```

The server rejects the submission with `422` when any of these fails:
- The challenge is unknown, expired, already used, or belongs to another case.
- `gesture_file_ids` does not match the issued gestures one to one and in order.
- A gesture file was uploaded before the challenge was issued or after it expired.
- The selfie or a gesture frame was not uploaded with `capture_source=camera` for this challenge.
- `record_video` is on and `video_file_id` is missing.

What these checks prove: the camera recorded a server-chosen sequence within the time limit, and the reviewer gets the frames and the video as evidence. They do not prove a live person or detect deepfakes. The capabilities response says `"liveness": "challenge"` and `"deepfake_detection": false`.

## Location submission

```json
{ "type": "location_verification", "latitude": 0.0, "longitude": 0.0,
  "metadata": { "accuracy": 12.5, "altitude": null, "fix_time": "ISO-8601", "is_mock": false,
                "provider": "gps|network|fused|browser", "captured_at": "ISO-8601" } }
```

The server enforces each setting:

| Setting | Server action |
| --- | --- |
| `max_accuracy_m` | Rejects when `accuracy` is missing or larger than the limit |
| `max_age_s` | Rejects when `fix_time` is older than this compared with the server clock (with `spec/location.json` `clock_skew_s` allowed) |
| `mock_location` | `reject` returns `422` when `is_mock` is true; `flag` stores a review flag; `allow` ignores it. A client that cannot detect mock locations sends `is_mock: null`, which is never treated as a mock. |
| `ip_country` | Compares the country of the request IP with the country of the coordinates, using a local GeoLite2 database. `reject` returns `422` on a mismatch; `flag` stores a review flag; `off` skips the check. Without the database the result is stored as `not_checked`. |

## Reference places

A location requirement can do more than record where the applicant is. It can also check that the applicant is at, near, or away from known places.

```json
"reference": {
  "places": [ { "id": "hq", "label": "Head office", "latitude": 4.0511, "longitude": 9.7679, "radius_m": 50 } ],
  "rule": "within",
  "match": "any",
  "confidence": "strict",
  "on_mismatch": "reject"
}
```

| Field | Values | Meaning |
| --- | --- | --- |
| `places[].radius_m` | `0` and up | Size of the circle around the place. `0` means "at": the place must fall inside the fix's own accuracy circle. `10` or `100` mean within that many metres. |
| `rule` | `within`, `outside` | `within`: the applicant must be inside a place's circle. `outside`: the applicant must be outside the circles, for example away from a restricted site. |
| `match` | `any`, `all` | `any`: one place is enough. `all`: every place must satisfy the rule. Use `all` with `outside` to require being away from every listed place. |
| `confidence` | `strict`, `lenient` | How the fix's `accuracy` counts. `strict` means `distance + accuracy <= radius` (the whole uncertainty circle fits). `lenient` means `distance - accuracy <= radius` (the circles overlap). For `outside`, both are mirrored: `strict` needs `distance - accuracy > radius`, and `lenient` needs `distance + accuracy > radius`. |
| `on_mismatch` | `reject`, `flag` | `reject` returns `422`. `flag` accepts the submission and stores a review flag. |

Distances are great circle (haversine) distances in metres, using an Earth radius of 6371008.8 m. A radius of `0` ignores `confidence`: `within` passes when `distance <= accuracy`, and `outside` passes when `distance > accuracy`. Only the server decides; clients never receive the coordinates, so they cannot estimate a match.

**Places for each case.** A profile can define fixed places, for example the company's sites. A case can also bring its own places, for example the applicant's declared address or a delivery address. Pass them as `location_places` (same shape as `places`) when the case is created through `POST /client/verifications` or the dashboard. They replace the profile's places for that case only, and are frozen with the case like every other setting. The coordinates must be given directly; the server does not geocode addresses.

**Result.** The stored submission and the reviewer view include:
- `reference.outcome`: `matched`, `not_matched`, or `not_configured`
- the nearest place's `id` and `distance_m`
- the `accuracy` used

**Applicant view.** The applicant never sees the reference coordinates. `verification_requirements[].settings.reference` in public and session responses only includes `rule` and the place labels, so the app can say "Share your location at Head office".

## Face signals

Every face provider reports the same normalized sample for each processed frame:

| Field | Meaning |
| --- | --- |
| `t` | Milliseconds since the challenge started |
| `faces` | Number of faces in the frame |
| `box` | `{x, y, w, h}` of the face, as fractions of the frame (0 to 1), in the unmirrored camera image |
| `eye_open` | 0 (closed) to 1 (open), the average of both eyes |
| `smile` | 0 to 1 |
| `yaw` | Degrees. Positive when the person turns their head to **their own left** |
| `pitch` | Degrees. Positive when the person tilts their head **up** |

Each provider has to convert its native values to these conventions. Check the native sign convention against the platform's own documentation and against a real device; never assume it. The gesture engine runs only on these samples, so all platforms share the rules in `spec/liveness.json` and replay the traces in `fixtures/liveness-traces/`.
