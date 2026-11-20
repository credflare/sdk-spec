// Builds a language neutral model of the spec that the Dart, Swift and Kotlin emitters render.
// Types: 'String' | 'Int' | 'Double' | 'Bool' | 'Color' | {list} | {map: [k, v]} | {opt} | {struct}
// Values: {k: 'str'|'int'|'dbl'|'bool'|'color'|'null'|'list'|'map'|'struct', ...}

export const camel = (s) => s.replace(/[._]([a-z0-9])/g, (_, c) => c.toUpperCase());
export const screaming = (s) => s.replace(/\./g, '_').toUpperCase();
export const pascal = (s) => camel(s).replace(/^[a-z]/, (c) => c.toUpperCase());

const str = (v) => ({ k: 'str', v });
const int = (v) => ({ k: 'int', v });
const dbl = (v) => ({ k: 'dbl', v });
const list = (of, items) => ({ k: 'list', of, items });
const map = (key, val, entries) => ({ k: 'map', key, val, entries });
const struct = (name, fields) => ({ k: 'struct', name, fields });

function leaf(value) {
  if (typeof value === 'string') return { type: 'String', value: str(value) };
  if (typeof value === 'boolean') return { type: 'Bool', value: { k: 'bool', v: value } };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { type: 'Int', value: int(value) } : { type: 'Double', value: dbl(value) };
  }
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
    return { type: { list: 'String' }, value: list('String', value.map(str)) };
  }
  if (Array.isArray(value) && value.every((v) => Number.isInteger(v))) {
    return { type: { list: 'Int' }, value: list('Int', value.map(int)) };
  }
  return null;
}

function flatten(obj, prefix = '', skip = []) {
  const members = [];
  for (const [key, value] of Object.entries(obj)) {
    if (skip.includes(key)) continue;
    const name = prefix ? `${prefix}_${key}` : key;
    const l = leaf(value);
    if (l) members.push({ name, ...l });
    else if (value && typeof value === 'object' && !Array.isArray(value)) members.push(...flatten(value, name));
    else throw new Error(`Cannot emit ${name}`);
  }
  return members;
}

export const structs = [
  {
    name: 'SpecGestureStep',
    doc: 'One step of a gesture. value and holdFrames name a threshold key.',
    fields: [
      ['signal', 'String'],
      ['op', 'String'],
      ['value', 'String'],
      ['holdFrames', { opt: 'String' }],
    ],
  },
  {
    name: 'SpecSetting',
    doc: 'One setting in the requirement settings schema. path uses dots, with [] for list items. defaultJson is the JSON encoded default.',
    fields: [
      ['path', 'String'],
      ['type', 'String'],
      ['optional', 'Bool'],
      ['min', { opt: 'Double' }],
      ['max', { opt: 'Double' }],
      ['options', { list: 'String' }],
      ['defaultJson', { opt: 'String' }],
    ],
  },
  {
    name: 'SpecPalette',
    fields: [],
  },
  {
    name: 'SpecTextStyle',
    fields: [
      ['size', 'Double'],
      ['lineHeight', 'Double'],
      ['weight', 'Int'],
    ],
  },
  {
    name: 'SpecIconPath',
    doc: 'Absolute path data using only M, L, C and Z, with values in viewBox units.',
    fields: [
      ['d', 'String'],
      ['stroke', 'Bool'],
      ['fill', 'Bool'],
      ['strokeWidth', 'Double'],
      ['strokeOpacity', 'Double'],
      ['fillOpacity', 'Double'],
    ],
  },
  {
    name: 'SpecIcon',
    fields: [
      ['viewBox', 'Double'],
      ['strokeWidth', 'Double'],
      ['paths', { list: { struct: 'SpecIconPath' } }],
    ],
  },
];

export function settingsSchema(settings) {
  const rows = [];
  const walk = (path, field) => {
    rows.push({
      path,
      type: field.type,
      optional: field.optional === true,
      min: field.min,
      max: field.max,
      options: field.of ?? [],
      defaultJson: 'default' in field ? JSON.stringify(field.default) : undefined,
    });
    if (field.type === 'object') for (const [k, f] of Object.entries(field.fields)) walk(`${path}.${k}`, f);
    if (field.type === 'list') for (const [k, f] of Object.entries(field.item)) walk(`${path}[].${k}`, f);
  };
  for (const [requirement, fields] of Object.entries(settings)) {
    if (requirement === 'version') continue;
    for (const [k, f] of Object.entries(fields)) walk(`${requirement}.${k}`, f);
  }
  return rows;
}

function settingDefaults(settings) {
  const members = [];
  for (const [requirement, fields] of Object.entries(settings)) {
    if (requirement === 'version') continue;
    for (const [k, f] of Object.entries(fields)) {
      const l = f.default === undefined || f.default === null ? null : leaf(f.default);
      if (l) members.push({ name: `${requirement}_${k}_default`, ...l });
    }
  }
  return members;
}

const colorValue = (hex) => ({ k: 'color', v: 0xff000000 + parseInt(hex.slice(1), 16) });

export function buildModel(spec) {
  const { liveness, location, settings, tokens, copy, icons } = spec;
  const palette = structs.find((s) => s.name === 'SpecPalette');
  palette.fields = Object.keys(tokens.color.light).map((k) => [camel(k), 'Color']);

  const thresholdType = { map: ['String', { map: ['String', 'Double'] }] };
  const stepRef = (v) => (v === undefined ? { k: 'null' } : str(String(v)));
  const gestureType = { map: ['String', { list: { struct: 'SpecGestureStep' } }] };

  const livenessNs = {
    name: 'liveness',
    members: [
      ...flatten(liveness, '', ['thresholds', 'gestures']),
      { name: 'gesture_names', type: { list: 'String' }, value: list('String', Object.keys(liveness.gestures).map(str)) },
      {
        name: 'thresholds',
        type: thresholdType,
        value: map('String', { map: ['String', 'Double'] }, Object.entries(liveness.thresholds).map(([provider, values]) => [
          str(provider),
          map('String', 'Double', Object.entries(values).map(([k, v]) => [str(k), dbl(v)])),
        ])),
      },
      {
        name: 'gestures',
        type: gestureType,
        value: map('String', { list: { struct: 'SpecGestureStep' } }, Object.entries(liveness.gestures).map(([g, steps]) => [
          str(g),
          list({ struct: 'SpecGestureStep' }, steps.map((s) => struct('SpecGestureStep', {
            signal: str(s.signal),
            op: str(s.op),
            value: str(String(s.value)),
            holdFrames: stepRef(s.hold_frames),
          }))),
        ])),
      },
    ],
  };

  const copyNs = {
    name: 'copy',
    members: [
      {
        name: 'locales',
        type: { list: 'String' },
        value: list('String', Object.keys(copy).map(str)),
      },
      ...Object.entries(copy).map(([locale, c]) => ({
        name: locale.replace(/-/g, '_').toLowerCase(),
        type: { map: ['String', 'String'] },
        value: map('String', 'String', Object.entries(c.strings).map(([k, v]) => [str(k), str(v)])),
      })),
    ],
  };

  const copyKeyNs = {
    name: 'copy_key',
    members: Object.keys(copy.en.strings).map((k) => ({ name: k.replace(/\./g, '_'), type: 'String', value: str(k) })),
  };

  const textStyles = Object.entries(tokens.type).map(([name, t]) => ({
    name: `type_${name}`,
    type: { struct: 'SpecTextStyle' },
    value: struct('SpecTextStyle', { size: dbl(t.size), lineHeight: dbl(t.line_height), weight: int(t.weight) }),
  }));
  const paletteValue = (mode) => struct('SpecPalette', Object.fromEntries(Object.entries(tokens.color[mode]).map(([k, v]) => [camel(k), colorValue(v)])));
  const tokensNs = {
    name: 'tokens',
    members: [
      { name: 'light', type: { struct: 'SpecPalette' }, value: paletteValue('light') },
      { name: 'dark', type: { struct: 'SpecPalette' }, value: paletteValue('dark') },
      ...flatten({ font: tokens.font, text_align: tokens.text_align }),
      ...textStyles,
      ...flatten({ spacing: tokens.spacing, radius: tokens.radius, size: tokens.size }),
    ],
  };

  const iconValue = (icon) => struct('SpecIcon', {
    viewBox: dbl(icon.view_box),
    strokeWidth: dbl(icon.stroke_width),
    paths: list({ struct: 'SpecIconPath' }, icon.paths.map((p) => struct('SpecIconPath', {
      d: str(p.d),
      stroke: { k: 'bool', v: p.stroke },
      fill: { k: 'bool', v: p.fill },
      strokeWidth: dbl(p.stroke_width),
      strokeOpacity: dbl(p.stroke_opacity),
      fillOpacity: dbl(p.fill_opacity),
    }))),
  });
  const iconsNs = {
    name: 'icons',
    members: [
      ...Object.entries(icons).map(([name, icon]) => ({ name, type: { struct: 'SpecIcon' }, value: iconValue(icon) })),
      {
        name: 'all',
        type: { map: ['String', { struct: 'SpecIcon' }] },
        ref: Object.keys(icons),
      },
    ],
  };

  return {
    version: spec.version,
    hash: spec.hash,
    structs,
    namespaces: [
      livenessNs,
      { name: 'location', members: flatten(location) },
      {
        name: 'settings',
        members: [
          { name: 'version', type: 'Int', value: int(settings.version) },
          ...settingDefaults(settings),
          {
            name: 'schema',
            type: { list: { struct: 'SpecSetting' } },
            value: list({ struct: 'SpecSetting' }, settingsSchema(settings).map((r) => struct('SpecSetting', {
              path: str(r.path),
              type: str(r.type),
              optional: { k: 'bool', v: r.optional },
              min: r.min === undefined ? { k: 'null' } : dbl(r.min),
              max: r.max === undefined ? { k: 'null' } : dbl(r.max),
              options: list('String', r.options.map(str)),
              defaultJson: r.defaultJson === undefined ? { k: 'null' } : str(r.defaultJson),
            }))),
          },
        ],
      },
      copyNs,
      copyKeyNs,
      tokensNs,
      iconsNs,
    ],
  };
}
