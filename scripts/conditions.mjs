// Reference show_if evaluator. It matches the server's condition engine; the server
// checks every submitted answer again, so a client that disagrees gets a 422.

export const OPERATORS = ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'contains', 'not_contains', 'in', 'not_in', 'is_empty', 'is_not_empty', 'regex', 'fuzzy_match'];

const DATE = /^\d{4}-\d{2}-\d{2}([T ][0-9:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;
const NUMERIC = /^[ \t\n\r\v\f]*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?[ \t\n\r\v\f]*$/;
const MAX_PATTERN = 200;

const isList = (v) => Array.isArray(v);
const isMap = (v) => v !== null && typeof v === 'object';
const isScalar = (v) => ['string', 'number', 'boolean'].includes(typeof v);
const isNumeric = (v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && NUMERIC.test(v));

// PHP string conversion: true is "1", false and null are "".
const text = (v) => (v === true ? '1' : v === false || v === null || v === undefined ? '' : String(v));

// PHP FILTER_VALIDATE_BOOLEAN with FILTER_NULL_ON_FAILURE.
function boolean(v) {
  if (typeof v === 'boolean') return v;
  if (isMap(v)) return null;
  const s = text(v).trim().toLowerCase();
  if (['1', 'true', 'on', 'yes'].includes(s)) return true;
  if (['0', 'false', 'off', 'no', ''].includes(s)) return false;
  return null;
}

// PHP 8 loose comparison (==), used only for list and object answers.
function loose(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) {
    const other = a ?? b;
    if (other === null || other === undefined) return true;
    if (isMap(other)) return Object.keys(other).length === 0;
    return boolean(other) === false && (typeof other !== 'string' || other === '');
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') return Boolean(truthy(a)) === Boolean(truthy(b));
  if (isMap(a) || isMap(b)) {
    if (!isMap(a) || !isMap(b)) return false;
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    return ka.every((k) => Object.hasOwn(b, k) && loose(a[k], b[k]));
  }
  if (isNumeric(a) && isNumeric(b)) return Number(a) === Number(b);
  return text(a) === text(b);
}

const truthy = (v) => (isMap(v) ? Object.keys(v).length > 0 : !(v === 0 || v === '' || v === '0' || v === false));

function equals(actual, expected) {
  if (isMap(actual) || isMap(expected)) return loose(actual, expected);
  if (typeof actual === 'boolean' || typeof expected === 'boolean') return boolean(actual) === boolean(expected);
  if (isNumeric(actual) && isNumeric(expected)) return Number(actual) === Number(expected);
  return text(actual) === text(expected);
}

function time(s) {
  let iso = s.replace(' ', 'T');
  if (!/T/.test(iso)) iso += 'T00:00:00';
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(iso)) iso += 'Z';
  iso = iso.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

function compare(actual, expected) {
  if (isNumeric(actual) && isNumeric(expected)) return Math.sign(Number(actual) - Number(expected));
  if (typeof actual === 'string' && typeof expected === 'string' && DATE.test(actual) && DATE.test(expected)) {
    const a = time(actual);
    const b = time(expected);
    return a === null || b === null ? null : Math.sign(a - b);
  }
  return null;
}

const within = (needle, haystack) => Object.values(haystack).some((c) => !isMap(c) && !isMap(needle) && equals(needle, c));

function contains(actual, expected) {
  if (isMap(actual)) return within(expected, actual);
  if (isScalar(actual) && isScalar(expected) && text(expected) !== '') {
    return text(actual).toLowerCase().includes(text(expected).toLowerCase());
  }
  return false;
}

function regex(actual, pattern) {
  if (!isScalar(actual) || typeof pattern !== 'string' || pattern.length > MAX_PATTERN) return false;
  try {
    return new RegExp(pattern, 'u').test(text(actual));
  } catch {
    return false;
  }
}

// PHP similar_text on UTF-8 bytes: the longest common run, then both sides of it, recursively.
function common(a, b) {
  let max = 0;
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let l = 0;
      while (i + l < a.length && j + l < b.length && a[i + l] === b[j + l]) l++;
      if (l > max) [max, p1, p2] = [l, i, j];
    }
  }
  if (!max) return 0;
  return max + common(a.subarray(0, p1), b.subarray(0, p2)) + common(a.subarray(p1 + max), b.subarray(p2 + max));
}

export function similarity(a, b) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  return x.length + y.length === 0 ? 0 : (common(x, y) * 2 * 100) / (x.length + y.length);
}

function fuzzy(actual, expected) {
  if (!isScalar(actual) || !isMap(expected) || isList(expected) || !isScalar(expected.text)) return false;
  const normalize = (v) => text(v).toLowerCase().trim().replace(/\s+/g, ' ');
  return similarity(normalize(actual), normalize(expected.text)) >= Number(expected.min_score ?? 80);
}

export function resolve(path, context) {
  let value = context;
  for (const segment of path.split('.')) {
    if (!isMap(value) || !Object.hasOwn(value, segment)) return [false, null];
    value = value[segment];
  }
  return [true, value];
}

export function test(condition, context) {
  const [exists, actual] = resolve(condition.path, context);
  const expected = condition.value ?? null;
  const missing = !exists || actual === null;
  const empty = missing || actual === '' || (isList(actual) && actual.length === 0);
  switch (condition.op) {
    case 'is_empty': return empty;
    case 'is_not_empty': return !empty;
  }
  if (missing) return false;
  const cmp = () => compare(actual, expected);
  switch (condition.op) {
    case 'equals': return equals(actual, expected);
    case 'not_equals': return !equals(actual, expected);
    case 'gt': { const c = cmp(); return c !== null && c > 0; }
    case 'gte': { const c = cmp(); return c !== null && c >= 0; }
    case 'lt': { const c = cmp(); return c !== null && c < 0; }
    case 'lte': { const c = cmp(); return c !== null && c <= 0; }
    case 'contains': return contains(actual, expected);
    case 'not_contains': return !contains(actual, expected);
    case 'in': return isList(expected) && within(actual, expected);
    case 'not_in': return isList(expected) && !within(actual, expected);
    case 'regex': return regex(actual, expected);
    case 'fuzzy_match': return fuzzy(actual, expected);
    default: return false;
  }
}

export function matches(showIf, context) {
  const results = showIf.conditions.map((c) => test(c, context));
  return (showIf.match ?? 'all') === 'any' ? results.includes(true) : !results.includes(false);
}

// A question is shown when it has no show_if or its conditions match the answers given so far.
export function visible(question, answers) {
  const showIf = question.show_if;
  if (!showIf || !showIf.conditions?.length) return true;
  return matches(showIf, { form: answers });
}
