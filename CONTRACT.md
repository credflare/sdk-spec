# Applicant capture contract

This is the shared definition that the backend, the web applicant page and all five SDKs implement. The values in `spec/*.json` are the source of truth. Platform constants are generated from them by `scripts/generate.mjs`.

## Requirement settings

`profile.verification_requirements[]` in the public and session responses carries `settings`. The backend fills in any setting the profile leaves out using the defaults in `spec/settings.json`, so clients always receive complete settings.

Email and phone requirements carry `"settings": null`.

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
| `ip_country` | Compares the country of the request IP with the country of the coordinates, using local copies of the DB-IP IP to Country Lite database and the Natural Earth country boundaries. `reject` returns `422` on a mismatch; `flag` stores a review flag; `off` skips the check. The result is stored as `not_checked` with a reason when the datasets are missing, the IP is private or CGNAT, the point is at sea, or the point is within 10 km of another country and the IP country is one of those countries. |

## Rejection codes

Every `422` from a capture rule carries a stable `code` at the top level of the error body, next to `message` and `errors`. Clients match on `code` and show the copy from `spec/rejections.json` (see Rejection screens); `message` is for people and may change. Other validation errors have no `code`.

```json
{ "success": false, "message": "The location fix is too old. Share your current location again.", "errors": [], "code": "location.stale" }
```

| Code | When |
| --- | --- |
| `location.accuracy` | `accuracy` is missing or larger than `max_accuracy_m` |
| `location.stale` | `fix_time` is missing, older than `max_age_s` plus `clock_skew_s`, or in the future |
| `location.mock` | `is_mock` is true and `mock_location` is `reject` |
| `location.ip_country` | The IP country does not match and `ip_country` is `reject` |
| `location.reference_not_matched` | The place rule failed and `on_mismatch` is `reject` |
| `liveness.challenge_invalid` | The challenge is unknown, belongs to another case or was replaced |
| `liveness.challenge_expired` | The challenge expired |
| `liveness.challenge_used` | The challenge was already used |
| `liveness.gesture_mismatch` | A gesture frame is missing, extra, out of order or for a gesture the challenge does not include |
| `liveness.frame_out_of_window` | A file was uploaded before the challenge was issued or after it expired |
| `liveness.not_camera` | Evidence was not uploaded with `capture_source=camera` for this challenge |
| `liveness.video_missing` | `record_video` is on and no video for this challenge was sent |
| `liveness.video_too_long` | The video is longer than `max_video_seconds` plus one second |
| `liveness.video_unreadable` | The server cannot read the video duration |
| `email.not_configured` | No email sender serves this environment |
| `email.resend_too_soon` | A code was sent to this case less than `resend_seconds` ago |
| `email.send_limit` | `max_sends` codes were sent for this case within `send_window_hours` |
| `email.code_missing` | No unused code was requested for this case |
| `email.code_expired` | The code is older than `ttl_minutes` |
| `email.code_invalid` | The code does not match |
| `email.too_many_attempts` | `max_attempts` wrong codes were entered; a new code is needed |
| `phone.not_configured` | No SMS sender serves this environment |
| `phone.resend_too_soon` | A code was sent to this case less than `resend_seconds` ago |
| `phone.send_limit` | `max_sends` codes were sent for this case within `send_window_hours` |
| `phone.code_missing` | No unused code was requested for this case |
| `phone.code_expired` | The code is older than `ttl_minutes` |
| `phone.code_invalid` | The code does not match |
| `phone.too_many_attempts` | `max_attempts` wrong codes were entered; a new code is needed |

The codes are defined in `spec/errors.json` and generated into every SDK; this table must list the same codes in the same order (`npm test` checks it).

## Rejection screens

`spec/rejections.json` maps every code to the copy an SDK shows, so no SDK keeps its own map:

```json
"location.reference_not_matched": { "title": "rejection.location_reference.title", "message": "location.place.rejected",
                                    "action": "retry",
                                    "place_message_within": "location.place.not_matched_within",
                                    "place_message_outside": "location.place.not_matched_outside" }
```

- `title` and `message` are copy keys. Fill `{verifier}` with `requester.name` from the session, or `common.verifier_fallback` when `requester` is null.
- `place_message_within` and `place_message_outside` replace `message` when the location requirement has reference places, chosen by `settings.reference.rule`. Fill `{place}` with the place labels joined by a comma and a space.
- `action` says what the main button does. Its label is `actions.<action>.label`.

| Action | Button does |
| --- | --- |
| `retry` | Stays on the step and captures again with the same settings |
| `restart` | Starts the step from the beginning, which asks for a new challenge |
| `reenter_code` | Clears the code field so the applicant types the code again |
| `new_code` | Requests a new code for the same email address or phone number |
| `wait` | Keeps the code screen and enables sending a new code at `resend_available_at` from the rejection (or from the last code request when the rejection has none) |
| `leave` | Nothing can be done in the app now; shows the help line and lets the applicant leave |

When the applicant leaves from a `leave` screen, the flow ends with a host action required result that carries the rejection `code` (for example `phone.not_configured`), never with a cancelled result. The host app uses the code to tell the applicant what to do next, such as confirming the number another way or trying again tomorrow after `send_limit`.

Every rejection screen also shows who asked for the evidence and where to get help. `rejection.requested_by` names the requester. The help line depends on `requester` in the session (`fixtures/help-contact-session.json`):

| Session has | Help line | Fill |
| --- | --- | --- |
| `requester.help_email` | `help_email` (`rejection.help_email`) | `{verifier}`, and `{help_email}` as a `mailto:` link |
| only `requester.help_url` | `help_url` (`rejection.help_url`) | `{help_url}` as a link that opens outside the flow |
| neither, or `requester` is null | `help` (`rejection.help`) | `{verifier}` |

`help_email` and `help_url` are always present on `requester` and are null when the requester stored no contact. `help_url` is always an `http` or `https` URL.

A `422` without a `code`, or with a code the SDK does not know, shows the server `message` with the `retry` action.

## Email and phone confirmation

`email_verification` and `phone_verification` ask the applicant to confirm an address or number with a code. Their `settings` are `null`; the limits are fixed and listed in `spec/requirements.json` under `contact_codes`.

| Step | Session route | Hosted route |
| --- | --- | --- |
| Send a code | `POST /sdk/sessions/{session}/{channel}-codes` | `POST /client/verifications/{id}/{channel}-codes` |
| Confirm it | `POST /sdk/sessions/{session}/{channel}-codes/confirm` | `POST /client/verifications/{id}/{channel}-codes/confirm` |

`channel` is `email` or `phone`. Send `{"email": "..."}` (at most 254 characters) or `{"phone": "..."}`. The server removes spaces, brackets, dots and dashes from a phone number (`phone_strip`), then needs the international format (`phone_pattern`, for example `+237650000001`).

`202` response (`fixtures/email-code-request.json`, `fixtures/phone-code-request.json`):

```json
{ "data": { "channel": "email", "destination": "J*******@example.test", "expires_at": "ISO-8601",
            "resend_available_at": "ISO-8601", "sends_remaining": 4 } }
```

Confirm with `{"code": "123456"}` (`code_length` digits). The `201` response (`fixtures/email-code-confirm.json`) carries the submission `id` and the check output. A malformed address, number or code is an ordinary `422` validation error with `errors.<field>` and no `code`.

- A code expires after `ttl_minutes`. `max_attempts` wrong codes burn it.
- A new code can be sent `resend_seconds` after the last one, at most `max_sends` within `send_window_hours`. Use `resend_available_at` and `sends_remaining` from the last `202` to drive the resend button.
- `not_configured` means the requirement cannot be finished in this environment; the SDK shows the rejection screen with the `leave` action.
- A `resend_too_soon` rejection carries `resend_available_at` next to `code` (`fixtures/rejections/email.resend_too_soon.json`). Count down to it before enabling the resend button again.
- Asking for a code to a different address or number is refused with `resend_too_soon` while the code sent to the earlier one is still inside its resend wait. Show `email.change_after` or `phone.change_after` with the countdown to `resend_available_at`, then allow the new destination.

## Continue on a phone

The JS SDK and the hosted web page can offer `handoff.action` so the applicant finishes on a phone. Other SDKs do not offer it.

| Step | Session route | Hosted route |
| --- | --- | --- |
| Create a link | `POST /sdk/sessions/{session}/handoff` | `POST /client/verifications/{id}/handoff` |
| Redeem it on the phone | `POST /verification-handoffs/redeem` | the same |

Creating a link returns `201` (`fixtures/handoff.json`):

```json
{ "data": { "handoff_url": "{hosted}/verify/handoff#token={64 hex}", "expires_at": "ISO-8601" } }
```

- Show `handoff_url` as a QR code with `handoff.title` and `handoff.body` (`{minutes}` is the whole minutes until `expires_at`). When `expires_at` passes, show `handoff.expired` and offer `handoff.new_code`, which creates a new link. Never log the link.
- The token is in the URL fragment, so it never reaches a server log. The hosted page reads it, removes it from the address bar and sends `{"token": "..."}` to the redeem route.
- Redeeming returns `201` with a session descriptor (`session_id`, `token`, `api_base_url`, `expires_at`; `fixtures/handoff-redeem.json`) for the same case, environment and outstanding requirements. The page then uses the session routes.
- A token works once, for ten minutes, and the new session ends no later than the session that created the link. A used, expired or unknown token, or one whose session was revoked, returns `401` (`fixtures/handoff-redeem-used.json`): show `handoff.link_invalid`. A closed case returns `409`.
- The device that created the link keeps its own session. After the applicant finishes on the phone, re-fetch the session (see After a submit) to show the receipt.

## Questionnaire

`profile.form_schema` lists the questions still to answer, or is `null`. Each question has `key`, `label`, `type` and `required`, plus `options` for choice types, `min` and `max` for numbers, and an optional `show_if`. `fixtures/questionnaire-session.json` has one of each new type.

| `type` | Answer the client sends |
| --- | --- |
| `text`, `textarea` | A string of at most 5000 characters |
| `number` | A JSON number, or a string matching `number_pattern`, within `min` and `max` |
| `date` | A real calendar date as `YYYY-MM-DD` |
| `email` | An email address of at most 254 characters |
| `phone`, `tel` | A string matching `questions.phone_pattern` after trimming |
| `select`, `single_select` | One of `options` |
| `multi_select` | A list of distinct `options` |
| `country` | An ISO 3166 alpha 2 code in upper case |
| `consent` | `true` or `false`; a required consent must be `true` |
| `founders` | `{"includes_applicant": bool, "names": [string]}` |

Submit the answers with `{"type": "form_submission", "fields": {"<key>": value}}` on the session `submit` route. An empty answer (`null`, `""` or `[]`) skips the type check. A required question that is shown and left empty fails with `422`.

- `fields` may be `{}` when every shown question is optional and the applicant leaves them all empty. The submit is accepted and those questions leave `form_schema`, the same as when an optional answer is given. Leaving out `fields` or sending `null` fails with `422` and `errors.fields`.
- To clear an earlier answer to a question that is asked again, send its key with `null`. The new value replaces the earlier one; leaving the key out keeps the earlier answer.

### show_if

```json
"show_if": { "match": "all", "conditions": [ { "path": "form.employment", "op": "equals", "value": "Employed" } ] }
```

- `match` is `all` (the default) or `any`. There are 1 to 10 conditions.
- `path` is `form.<key>` of a question asked earlier in the list.
- A question with no `show_if`, or with no conditions, is always shown.
- Evaluate against every answer given so far, including answers sent earlier in the case. A hidden question is not required. Do not send an answer for a hidden question: the server rejects it with `422` and `errors.fields.<key>` (`fixtures/questionnaire-hidden-answer.json`).
- `profile.form_answers` holds the earlier answers of the case that a `show_if` of an outstanding question reads, keyed by question key, and is `{}` when there are none. It never holds other answers. Seed the answer map with it before evaluating `show_if`, so a question revealed by an earlier answer is shown after a refresh (`fixtures/questionnaire-earlier-answers-session.json`). Do not send those keys again unless the applicant is asked them again; a key also listed in `form_schema` is asked again, and the earlier answer is its starting value.

An answer is **missing** when its key is absent or its value is `null`. Missing answers make every operator false except `is_empty`, which is true. The negated operators are false too: `not_equals`, `not_contains` and `not_in` never match a missing answer.

| `op` | `value` | True when |
| --- | --- | --- |
| `equals` | One value | The answer equals `value`. Lists compare item by item in order. When either side is a boolean, both are read as booleans (`true`, `1`, `yes`, `on` and `false`, `0`, `no`, `off`, `""`); other text is neither. Numbers and numeric strings compare as numbers. Anything else compares as text, case sensitive. |
| `not_equals` | One value | The answer is present and `equals` is false |
| `gt`, `gte`, `lt`, `lte` | One value | Both sides are numbers or numeric strings, or both are dates (`YYYY-MM-DD` with an optional time and offset, UTC when no offset), and the comparison holds. Anything else is false. |
| `contains` | One value | For a list answer, an item `equals` the value. For a text answer, the value is a non empty text or number found in it, ignoring case. |
| `not_contains` | One value | The answer is present and `contains` is false |
| `in` | A list of up to 100 values | The answer is not a list and `equals` one of them |
| `not_in` | A list of up to 100 values | The answer is present and `in` is false. A list answer is never `in`, so it is always `not_in`. |
| `is_empty` | None | The answer is missing, `""` or `[]`. `false` and `0` are not empty. |
| `is_not_empty` | None | `is_empty` is false |
| `regex` | A pattern of at most 200 characters | The answer is not a list and the pattern matches part of it, case sensitive, with Unicode on. An invalid pattern is false. |
| `fuzzy_match` | `{"text": "...", "min_score": 0 to 100}` | Both are lower cased, trimmed and have runs of whitespace collapsed, and their similarity is at least `min_score` (80 when absent). Similarity is twice the length of the common substrings (the longest common run, then recursively the parts on each side of it) divided by the total length, as a percentage, counted in UTF-8 bytes. |

`scripts/conditions.mjs` is the reference evaluator. `fixtures/show-if-cases.json` holds the server's result for each case; every SDK should replay it in its unit tests.

## After a submit

A workflow can add requirements while the case is open, for example a phone check when the applicant answers that they live in Germany. The session `GET` always returns what is still outstanding, so the SDK never decides from its own list.

After every call listed in `refresh.after` (a `submit`, or a code confirmation), the SDK fetches the session again:

1. If `status` is in `refresh.open_statuses` and any list in `refresh.outstanding` is non empty, continue with the next outstanding step.
2. Otherwise show the receipt.
3. If the fetch returns `409`, the case is closed (completed, rejected or expired) and accepts nothing more: show the receipt. The body has no `code` (`fixtures/session-closed.json`):

```json
{ "success": false, "message": "This verification no longer accepts submissions.", "errors": [] }
```

If the fetch fails in any other way, show `errors.refresh_failed` with `common.try_again`; never show the receipt in its place. `fixtures/questionnaire-session.json` and `fixtures/requirement-added-session.json` are the session before and after a form submission that added a phone requirement.

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

**Applicant view.** The applicant never sees the reference coordinates. `verification_requirements[].settings.reference` in public and session responses only includes `rule`, `match` and the place labels, so the app can say "Share your location at Head office".

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
