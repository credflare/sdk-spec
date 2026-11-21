# Credflare SDK spec

The single source of truth for how the Credflare applicant SDKs and the web applicant page behave and look: liveness rules, location rules, requirement settings, applicant copy, design tokens and icons. Each SDK generates a constants file from this repo and checks in CI that its copy has not drifted.

| Path | What it holds |
| --- | --- |
| `CONTRACT.md` | The API contract shared by the backend, the web page and the SDKs |
| `ENGINE.md` | The gesture engine and reference place algorithms every SDK implements |
| `spec/liveness.json` | Gesture rules, thresholds per face provider, timing and position limits |
| `spec/location.json` | Location timing and retry limits |
| `spec/settings.json` | Requirement settings schema with defaults |
| `spec/errors.json` | Stable codes for capture rejections, with their meaning |
| `spec/copy/en.json` | Every applicant facing string, keyed by dotted group |
| `spec/tokens.json` | Light and dark palettes, type scale, spacing, radius, sizes |
| `icons/` | 24 by 24 stroke icons and a 64 by 64 receipt illustration |
| `fixtures/liveness-traces/` | Synthetic face sample traces with expected outcomes |
| `fixtures/` (other files) | Backend response fixtures |
| `scripts/` | Generator, reference engine, reference place check and tests |

Requires Node 20 or newer. There are no dependencies to install.

## Generated files

Each SDK keeps its generated file at a fixed path and never edits it by hand.

| SDK | Target | File |
| --- | --- | --- |
| javascript-sdk | `ts` | `src/spec.generated.ts` |
| react-native-sdk | none | Imports the constants from the JavaScript SDK |
| flutter-sdk | `dart` | `lib/src/spec.generated.dart` |
| swift-sdk | `swift` | `Sources/CredflareSDK/Spec.generated.swift` |
| kotlin-sdk | `kotlin` | `sdk/src/main/kotlin/net/credflare/sdk/Spec.generated.kt` |

With this repo checked out next to the SDKs:

```bash
node ../sdk-spec/scripts/generate.mjs --target ts     --out src/spec.generated.ts
node ../sdk-spec/scripts/generate.mjs --target dart   --out lib/src/spec.generated.dart
node ../sdk-spec/scripts/generate.mjs --target swift  --out Sources/CredflareSDK/Spec.generated.swift
node ../sdk-spec/scripts/generate.mjs --target kotlin --out sdk/src/main/kotlin/net/credflare/sdk/Spec.generated.kt
```

Other options:

```bash
node scripts/generate.mjs --help
node scripts/generate.mjs --target swift                 # print to stdout
node scripts/generate.mjs --target kotlin --package com.example --out Spec.generated.kt
npm run generate                                         # all targets into build/
```

Every file starts with a "generated, do not edit" header that names the spec version (`package.json`) and a hash of the inputs.

### What each target contains

- Liveness, location and settings values. TypeScript gets the JSON as typed `as const` objects. Dart, Swift and Kotlin get named constants, a `thresholds` map, a `gestures` map of steps and a `settings.schema` list that describes every setting, including nested objects and list items (`location_verification.reference.places[].radius_m`).
- Copy as a map per locale plus a key constant for every string (`SpecCopyKey.introTitle`, `CredflareSpec.CopyKey.introTitle`, `CredflareSpec.CopyKey.INTRO_TITLE`).
- Tokens: palettes as ARGB numbers, text styles, spacing, radius and sizes. All applicant screen text is centred (`text_align`).
- Icons: for each icon its view box, stroke width and paths. Path data is normalized to absolute `M`, `L`, `C` and `Z` commands only, with arcs converted to cubic curves, so a small parser draws them on any platform (Flutter `Path`, SwiftUI `Path`, Android `PathParser.createPathFromPathData`). Each path says whether it is stroked or filled and its opacity, so the two tone illustration renders with a single tint colour. TypeScript also gets the original SVG markup in `iconSvgs`.

## Copy rules

`spec/copy/en.json` is validated on every generation:

- Keys are dotted snake case with a group, for example `liveness.gesture.turn_left`.
- Placeholders use braces and must be listed in `placeholders`: `{verifier}`, `{document}`, `{side}`, `{source}`, `{current}`, `{total}`, `{count}`, `{types}`, `{size}`, `{meters}`, `{place}`, `{places}`.
- No en or em dashes and no hyphen used as punctuation.
- No claims of being verified or approved, of proving anything, of liveness or of deepfake detection. Receipts say "received".
- Other locales must have exactly the same keys as `en`.

When the verifier's name is unknown, substitute `common.verifier_fallback`. Strings place `{verifier}` mid sentence so the fallback reads naturally.

## Drift check in SDK CI

Run the generator in check mode. It exits with 1 and prints the first differing line when the committed file is out of date.

```bash
git clone --depth 1 <sdk-spec repository> ../sdk-spec
node ../sdk-spec/scripts/generate.mjs --target swift --out Sources/CredflareSDK/Spec.generated.swift --check
```

Each SDK should also replay `fixtures/liveness-traces/*.json` through its own engine in its unit tests and assert the `expect` field, as described in ENGINE.md.

## Location reference places

Clients never receive the coordinates of reference places, only the rule and the place labels. The server makes the decision; `scripts/places.mjs` documents the exact formula the server applies and is tested in `scripts/test-places.mjs`.

## Tests

```bash
npm test
```

Runs the trace replay, the reference place tests and the generator tests (determinism, check mode and copy validation).
