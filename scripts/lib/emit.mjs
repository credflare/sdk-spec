import { camel, pascal, screaming } from './model.mjs';
import { formatNumber } from './path.mjs';

const header = (prefix, version, hash) => [
  `${prefix} GENERATED FILE, DO NOT EDIT.`,
  `${prefix} Source: credflare sdk-spec ${version} (${hash}). Regenerate with scripts/generate.mjs.`,
];

const dblText = (v) => {
  const s = formatNumber(v);
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
};

const quoteJson = (s) => JSON.stringify(s);

const languages = {
  dart: {
    type(t) {
      if (t === 'String') return 'String';
      if (t === 'Int' || t === 'Color') return 'int';
      if (t === 'Double') return 'double';
      if (t === 'Bool') return 'bool';
      if (t.list) return `List<${this.type(t.list)}>`;
      if (t.map) return `Map<${this.type(t.map[0])}, ${this.type(t.map[1])}>`;
      if (t.opt) return `${this.type(t.opt)}?`;
      if (t.struct) return t.struct;
      throw new Error(`type ${JSON.stringify(t)}`);
    },
    str: (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '\\$').replace(/\n/g, '\\n')}'`,
    color: (v) => `0x${v.toString(16).toUpperCase()}`,
    list: (items, ind) => (items.length ? `[\n${items.map((i) => `${ind}  ${i},`).join('\n')}\n${ind}]` : '[]'),
    map: (entries, ind) => (entries.length ? `{\n${entries.map(([k, v]) => `${ind}  ${k}: ${v},`).join('\n')}\n${ind}}` : '{}'),
    struct: (name, fields, ind) => `${name}(\n${fields.map(([k, v]) => `${ind}  ${k}: ${v},`).join('\n')}\n${ind})`,
    nil: 'null',
  },
  swift: {
    type(t) {
      if (t === 'String') return 'String';
      if (t === 'Int') return 'Int';
      if (t === 'Color') return 'UInt32';
      if (t === 'Double') return 'Double';
      if (t === 'Bool') return 'Bool';
      if (t.list) return `[${this.type(t.list)}]`;
      if (t.map) return `[${this.type(t.map[0])}: ${this.type(t.map[1])}]`;
      if (t.opt) return `${this.type(t.opt)}?`;
      if (t.struct) return t.struct;
      throw new Error(`type ${JSON.stringify(t)}`);
    },
    str: (s) => quoteJson(s).replace(/\\u([0-9a-f]{4})/gi, '\\u{$1}'),
    color: (v) => `0x${v.toString(16).toUpperCase()}`,
    list: (items, ind) => (items.length ? `[\n${items.map((i) => `${ind}    ${i},`).join('\n')}\n${ind}]` : '[]'),
    map: (entries, ind) => (entries.length ? `[\n${entries.map(([k, v]) => `${ind}    ${k}: ${v},`).join('\n')}\n${ind}]` : '[:]'),
    struct: (name, fields, ind) => `${name}(\n${fields.map(([k, v]) => `${ind}    ${k}: ${v}`).join(',\n')}\n${ind})`,
    nil: 'nil',
  },
  kotlin: {
    type(t) {
      if (t === 'String') return 'String';
      if (t === 'Int') return 'Int';
      if (t === 'Color') return 'Long';
      if (t === 'Double') return 'Double';
      if (t === 'Bool') return 'Boolean';
      if (t.list) return `List<${this.type(t.list)}>`;
      if (t.map) return `Map<${this.type(t.map[0])}, ${this.type(t.map[1])}>`;
      if (t.opt) return `${this.type(t.opt)}?`;
      if (t.struct) return t.struct;
      throw new Error(`type ${JSON.stringify(t)}`);
    },
    str: (s) => quoteJson(s).replace(/\$/g, '\\$'),
    color: (v) => `0x${v.toString(16).toUpperCase()}`,
    list: (items, ind) => (items.length ? `listOf(\n${items.map((i) => `${ind}    ${i},`).join('\n')}\n${ind})` : 'emptyList()'),
    map: (entries, ind) => (entries.length ? `mapOf(\n${entries.map(([k, v]) => `${ind}    ${k} to ${v},`).join('\n')}\n${ind})` : 'emptyMap()'),
    struct: (name, fields, ind) => `${name}(\n${fields.map(([k, v]) => `${ind}    ${k} = ${v},`).join('\n')}\n${ind})`,
    nil: 'null',
  },
};

function value(lang, v, ind) {
  const L = languages[lang];
  switch (v.k) {
    case 'str': return L.str(v.v);
    case 'int': return String(v.v);
    case 'dbl': return dblText(v.v);
    case 'bool': return String(v.v);
    case 'null': return L.nil;
    case 'color': return L.color(v.v);
    case 'list': return L.list(v.items.map((i) => value(lang, i, `${ind}${lang === 'dart' ? '  ' : '    '}`)), ind);
    case 'map': {
      const inner = `${ind}${lang === 'dart' ? '  ' : '    '}`;
      return L.map(v.entries.map(([k, x]) => [value(lang, k, inner), value(lang, x, inner)]), ind);
    }
    case 'struct': {
      const inner = `${ind}${lang === 'dart' ? '  ' : '    '}`;
      return L.struct(v.name, Object.entries(v.fields).map(([k, x]) => [k, value(lang, x, inner)]), ind);
    }
    default: throw new Error(`value ${v.k}`);
  }
}

const isPrimitive = (t) => typeof t === 'string';

function emitDart(model) {
  const L = languages.dart;
  const out = [...header('//', model.version, model.hash), '// ignore_for_file: type=lint', ''];
  out.push(`const String credflareSpecVersion = '${model.version}';`);
  out.push(`const String credflareSpecHash = '${model.hash}';`, '');
  for (const s of model.structs) {
    if (s.doc) out.push(`/// ${s.doc}`);
    out.push(`final class ${s.name} {`);
    for (const [f, t] of s.fields) out.push(`  final ${L.type(t)} ${f};`);
    out.push(`  const ${s.name}({${s.fields.map(([f, t]) => (t.opt ? `this.${f}` : `required this.${f}`)).join(', ')}});`);
    out.push('}', '');
  }
  for (const ns of model.namespaces) {
    const cls = `Spec${pascal(ns.name)}`;
    out.push(`abstract final class ${cls} {`);
    for (const m of ns.members) {
      const name = camel(m.name);
      if (m.ref) {
        out.push(`  static const ${L.type(m.type)} ${name} = {`);
        for (const r of m.ref) out.push(`    ${L.str(r)}: ${camel(r)},`);
        out.push('  };');
      } else {
        out.push(`  static const ${L.type(m.type)} ${name} = ${value('dart', m.value, '  ')};`);
      }
    }
    out.push('}', '');
  }
  return out.join('\n');
}

function emitSwift(model) {
  const L = languages.swift;
  const out = [...header('//', model.version, model.hash), ''];
  for (const s of model.structs) {
    if (s.doc) out.push(`/// ${s.doc}`);
    out.push(`public struct ${s.name}: Equatable, Sendable {`);
    for (const [f, t] of s.fields) out.push(`    public let ${f}: ${L.type(t)}`);
    out.push('}', '');
  }
  out.push('public enum CredflareSpec {');
  out.push(`    public static let version = ${L.str(model.version)}`);
  out.push(`    public static let hash = ${L.str(model.hash)}`);
  for (const ns of model.namespaces) {
    out.push('', `    public enum ${pascal(ns.name)} {`);
    for (const m of ns.members) {
      const name = camel(m.name);
      if (m.ref) {
        out.push(`        public static let ${name}: ${L.type(m.type)} = [`);
        for (const r of m.ref) out.push(`            ${L.str(r)}: ${camel(r)},`);
        out.push('        ]');
      } else {
        out.push(`        public static let ${name}: ${L.type(m.type)} = ${value('swift', m.value, '        ')}`);
      }
    }
    out.push('    }');
  }
  out.push('}', '');
  return out.join('\n');
}

function emitKotlin(model, pkg) {
  const L = languages.kotlin;
  const out = [...header('//', model.version, model.hash), `@file:Suppress("unused", "MemberVisibilityCanBePrivate")`, '', `package ${pkg}`, ''];
  for (const s of model.structs) {
    if (s.doc) out.push(`/** ${s.doc} */`);
    out.push(`data class ${s.name}(`);
    for (const [f, t] of s.fields) out.push(`    val ${f}: ${L.type(t)}${t.opt ? ' = null' : ''},`);
    out.push(')', '');
  }
  out.push('object CredflareSpec {');
  out.push(`    const val VERSION: String = ${L.str(model.version)}`);
  out.push(`    const val HASH: String = ${L.str(model.hash)}`);
  for (const ns of model.namespaces) {
    out.push('', `    object ${pascal(ns.name)} {`);
    for (const m of ns.members) {
      const name = screaming(m.name);
      if (m.ref) {
        out.push(`        val ${name}: ${L.type(m.type)} = mapOf(`);
        for (const r of m.ref) out.push(`            ${L.str(r)} to ${screaming(r)},`);
        out.push('        )');
      } else if (isPrimitive(m.type) && m.type !== 'Color') {
        out.push(`        const val ${name}: ${L.type(m.type)} = ${value('kotlin', m.value, '        ')}`);
      } else {
        out.push(`        val ${name}: ${L.type(m.type)} = ${value('kotlin', m.value, '        ')}`);
      }
    }
    out.push('    }');
  }
  out.push('}', '');
  return out.join('\n');
}

function emitTs(spec) {
  const icons = Object.fromEntries(Object.entries(spec.icons).map(([name, icon]) => [name, {
    viewBox: icon.view_box,
    strokeWidth: icon.stroke_width,
    paths: icon.paths.map((p) => ({
      d: p.d,
      stroke: p.stroke,
      fill: p.fill,
      strokeWidth: p.stroke_width,
      strokeOpacity: p.stroke_opacity,
      fillOpacity: p.fill_opacity,
    })),
  }]));
  const svgs = Object.fromEntries(Object.entries(spec.icons).map(([name, icon]) => [name, icon.svg]));
  const copy = Object.fromEntries(Object.entries(spec.copy).map(([locale, c]) => [locale, c.strings]));
  const j = (v) => JSON.stringify(v, null, 2);
  return [
    ...header('//', spec.version, spec.hash),
    '/* eslint-disable */',
    '',
    `export const specVersion = ${j(spec.version)} as const;`,
    `export const specHash = ${j(spec.hash)} as const;`,
    '',
    `export const liveness = ${j(spec.liveness)} as const;`,
    '',
    `export const location = ${j(spec.location)} as const;`,
    '',
    `export const settings = ${j(spec.settings)} as const;`,
    '',
    `export const copy = ${j(copy)} as const;`,
    '',
    `export const copyPlaceholders = ${j(spec.copy.en.placeholders)} as const;`,
    '',
    `export const errorCodes = ${j(spec.errors.codes)} as const;`,
    '',
    `export const tokens = ${j(spec.tokens)} as const;`,
    '',
    'export interface SpecIconPath {',
    '  readonly d: string;',
    '  readonly stroke: boolean;',
    '  readonly fill: boolean;',
    '  readonly strokeWidth: number;',
    '  readonly strokeOpacity: number;',
    '  readonly fillOpacity: number;',
    '}',
    '',
    'export interface SpecIcon {',
    '  readonly viewBox: number;',
    '  readonly strokeWidth: number;',
    '  readonly paths: readonly SpecIconPath[];',
    '}',
    '',
    `export const icons = ${j(icons)} as const satisfies Record<string, SpecIcon>;`,
    '',
    `export const iconSvgs: Record<IconName, string> = ${j(svgs)};`,
    '',
    'export type IconName = keyof typeof icons;',
    'export type Locale = keyof typeof copy;',
    'export type CopyKey = keyof (typeof copy)["en"];',
    'export type ErrorCode = keyof typeof errorCodes;',
    'export type GestureName = keyof (typeof liveness)["gestures"];',
    'export type LivenessProvider = keyof (typeof liveness)["thresholds"];',
    'export type ThresholdKey = keyof (typeof liveness)["thresholds"]["default"];',
    '',
  ].join('\n');
}

export function emit(target, spec, model, options = {}) {
  switch (target) {
    case 'ts': return emitTs(spec);
    case 'dart': return emitDart(model);
    case 'swift': return emitSwift(model);
    case 'kotlin': return emitKotlin(model, options.package ?? 'net.credflare.sdk');
    default: throw new Error(`Unknown target "${target}". Use ts, dart, swift or kotlin.`);
  }
}

export const defaultFileNames = {
  ts: 'spec.generated.ts',
  dart: 'spec.generated.dart',
  swift: 'Spec.generated.swift',
  kotlin: 'Spec.generated.kt',
};
