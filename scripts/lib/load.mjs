import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { normalizePath, serializePath } from './path.mjs';
import { settingsSchema } from './model.mjs';

const KEY = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const PLACEHOLDER = /\{([a-z_]+)\}/g;
const BANNED = [
  [/[–—]/, 'en or em dash'],
  [/ - |--/, 'dash used as punctuation'],
  [/\bverified\b/i, '"verified"'],
  [/\bapprov/i, '"approved"'],
  [/\bliveness\b/i, '"liveness"'],
  [/\bdeep ?fake/i, '"deepfake"'],
  [/\bprove|\bproof/i, 'a proof claim'],
  [/\bauthentic/i, 'an authenticity claim'],
];

const read = (root, path) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');

export function validateCopy(copy, reference) {
  const problems = [];
  const allowed = new Set(Object.keys((reference ?? copy).placeholders ?? {}));
  const keys = Object.keys(copy.strings ?? {});
  if (!keys.length) problems.push('copy has no strings');
  for (const key of keys) {
    const value = copy.strings[key];
    if (!KEY.test(key)) problems.push(`${key}: key must be dotted snake_case with a group`);
    if (typeof value !== 'string' || !value.trim()) problems.push(`${key}: value must be a non empty string`);
    else {
      for (const [re, label] of BANNED) if (re.test(value)) problems.push(`${key}: contains ${label}`);
      for (const [, name] of value.matchAll(PLACEHOLDER)) {
        if (!allowed.has(name)) problems.push(`${key}: unknown placeholder {${name}}`);
      }
      if (/[{}]/.test(value.replace(PLACEHOLDER, ''))) problems.push(`${key}: unbalanced braces`);
    }
  }
  if (reference && reference !== copy) {
    const want = new Set(Object.keys(reference.strings));
    for (const key of want) if (!(key in copy.strings)) problems.push(`${copy.locale}: missing ${key}`);
    for (const key of keys) if (!want.has(key)) problems.push(`${copy.locale}: extra key ${key}`);
  }
  return problems;
}

function validateSpec(spec) {
  const problems = [];
  const { liveness, settings, tokens } = spec;
  const base = liveness.thresholds.default;
  for (const [provider, values] of Object.entries(liveness.thresholds)) {
    for (const key of Object.keys(values)) {
      if (!(key in base)) problems.push(`liveness.thresholds.${provider}.${key} has no default`);
    }
  }
  const ops = new Set(['gt', 'lt', 'lt_neg', 'abs_lt']);
  const signals = new Set(['eye_open', 'smile', 'yaw', 'pitch']);
  for (const [gesture, steps] of Object.entries(liveness.gestures)) {
    steps.forEach((step, i) => {
      const at = `liveness.gestures.${gesture}[${i}]`;
      if (!ops.has(step.op)) problems.push(`${at}: unknown op ${step.op}`);
      if (!signals.has(step.signal)) problems.push(`${at}: unknown signal ${step.signal}`);
      for (const field of ['value', 'hold_frames']) {
        const v = step[field];
        if (typeof v === 'string' && !(v in base)) problems.push(`${at}: ${field} "${v}" is not a threshold`);
      }
    });
  }
  const offered = settings.facial_verification.gestures.of;
  for (const g of offered) if (!(g in liveness.gestures)) problems.push(`settings gesture ${g} has no liveness rule`);
  for (const g of Object.keys(liveness.gestures)) if (!offered.includes(g)) problems.push(`liveness gesture ${g} is not offered in settings`);
  for (const g of offered) {
    if (!(`liveness.gesture.${g}` in spec.copy.en.strings)) problems.push(`copy is missing liveness.gesture.${g}`);
  }
  const settingTypes = new Set(['set', 'enum', 'int', 'number', 'bool', 'string', 'object', 'list']);
  for (const row of settingsSchema(settings)) {
    if (!settingTypes.has(row.type)) problems.push(`settings ${row.path}: unknown type ${row.type}`);
    if ((row.type === 'set' || row.type === 'enum') && !row.options.length) problems.push(`settings ${row.path}: ${row.type} needs "of"`);
  }
  const hex = /^#[0-9A-F]{6}$/;
  const lightKeys = Object.keys(tokens.color.light).join();
  if (Object.keys(tokens.color.dark).join() !== lightKeys) problems.push('tokens light and dark palettes differ in keys');
  for (const mode of ['light', 'dark']) {
    for (const [k, v] of Object.entries(tokens.color[mode])) if (!hex.test(v)) problems.push(`tokens.color.${mode}.${k} must be #RRGGBB upper case`);
  }
  return problems;
}

const ATTR = /([a-zA-Z-]+)="([^"]*)"/g;
const attrs = (s) => Object.fromEntries([...s.matchAll(ATTR)].map((m) => [m[1], m[2]]));

export function parseIcon(name, svg) {
  const root = svg.match(/<svg\b([^>]*)>/);
  if (!root) throw new Error(`icons/${name}.svg: no <svg> element`);
  const r = attrs(root[1]);
  const vb = (r.viewBox ?? '').split(/\s+/).map(Number);
  if (vb.length !== 4 || vb[0] !== 0 || vb[1] !== 0 || vb[2] !== vb[3]) throw new Error(`icons/${name}.svg: viewBox must be "0 0 N N"`);
  if (r.fill !== 'none' || r.stroke !== 'currentColor') throw new Error(`icons/${name}.svg: root must set fill="none" stroke="currentColor"`);
  if (r['stroke-linecap'] !== 'round' || r['stroke-linejoin'] !== 'round') throw new Error(`icons/${name}.svg: caps and joins must be round`);
  const strokeWidth = Number(r['stroke-width']);
  const body = svg.slice(root.index + root[0].length).replace(/<\/svg>\s*$/, '');
  const leftover = body.replace(/<path\b[^>]*\/>/g, '').trim();
  if (leftover) throw new Error(`icons/${name}.svg: only self closing <path/> elements are allowed`);
  const paths = [...body.matchAll(/<path\b([^>]*)\/>/g)].map((m) => {
    const a = attrs(m[1]);
    const known = new Set(['d', 'fill', 'stroke', 'fill-opacity', 'stroke-opacity', 'stroke-width']);
    for (const k of Object.keys(a)) if (!known.has(k)) throw new Error(`icons/${name}.svg: unsupported attribute ${k}`);
    for (const k of ['fill', 'stroke']) {
      if (a[k] !== undefined && a[k] !== 'none' && a[k] !== 'currentColor') throw new Error(`icons/${name}.svg: ${k} must be none or currentColor`);
    }
    return {
      d: serializePath(normalizePath(a.d)),
      stroke: a.stroke !== 'none',
      fill: a.fill === 'currentColor',
      stroke_width: a['stroke-width'] !== undefined ? Number(a['stroke-width']) : strokeWidth,
      stroke_opacity: a['stroke-opacity'] !== undefined ? Number(a['stroke-opacity']) : 1,
      fill_opacity: a['fill-opacity'] !== undefined ? Number(a['fill-opacity']) : 1,
    };
  });
  if (!paths.length) throw new Error(`icons/${name}.svg: no paths`);
  const minified = svg.replace(/\n\s*/g, '').replace(/\s*\/>/g, '/>').trim();
  return { view_box: vb[2], stroke_width: strokeWidth, paths, svg: minified };
}

export function loadSpec(root) {
  const inputs = [];
  const json = (path) => {
    const text = read(root, path);
    inputs.push([path, text]);
    return JSON.parse(text);
  };
  const pkg = JSON.parse(read(root, 'package.json'));
  const liveness = json('spec/liveness.json');
  const location = json('spec/location.json');
  const settings = json('spec/settings.json');
  const tokens = json('spec/tokens.json');
  const copy = {};
  for (const file of readdirSync(join(root, 'spec/copy')).filter((f) => f.endsWith('.json')).sort()) {
    const data = json(`spec/copy/${file}`);
    copy[data.locale] = data;
  }
  if (!copy.en) throw new Error('spec/copy/en.json is required');
  const icons = {};
  for (const file of readdirSync(join(root, 'icons')).filter((f) => f.endsWith('.svg')).sort()) {
    const name = file.slice(0, -4);
    if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error(`icons/${file}: name must be snake_case`);
    const text = read(root, `icons/${file}`);
    inputs.push([`icons/${file}`, text]);
    icons[name] = parseIcon(name, text);
  }
  const spec = { version: pkg.version, liveness, location, settings, tokens, copy, icons };
  const problems = [
    ...validateSpec(spec),
    ...Object.values(copy).flatMap((c) => validateCopy(c, copy.en).map((p) => `spec/copy/${c.locale}.json ${p}`)),
  ];
  if (problems.length) throw new Error(`Spec is invalid:\n  ${problems.join('\n  ')}`);
  const hash = createHash('sha256');
  for (const [path, text] of inputs.sort((a, b) => (a[0] < b[0] ? -1 : 1))) hash.update(`${path}\0${text}\0`);
  spec.hash = hash.digest('hex').slice(0, 12);
  spec.inputs = inputs.map(([p]) => relative('.', p));
  return spec;
}
