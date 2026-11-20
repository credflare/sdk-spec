const TOKEN = /([MmLlHhVvCcSsQqAaZz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)|([\s,]+)|(.)/g;

function tokenize(d) {
  const out = [];
  for (const m of d.matchAll(TOKEN)) {
    if (m[1]) out.push(m[1]);
    else if (m[2]) out.push(Number(m[2]));
    else if (m[4]) throw new Error(`Unexpected character "${m[4]}" in path data: ${d}`);
  }
  return out;
}

function arcToCubics(x1, y1, rx, ry, phiDeg, largeArc, sweep, x2, y2) {
  if (x1 === x2 && y1 === y2) return [];
  if (rx === 0 || ry === 0) return null;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const num = Math.max(0, rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p);
  let coef = Math.sqrt(num / (rx2 * y1p * y1p + ry2 * x1p * x1p));
  if (largeArc === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;
  const theta1 = angle(1, 0, ux, uy);
  let delta = angle(ux, uy, vx, vy);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  else if (sweep && delta < 0) delta += 2 * Math.PI;
  const segments = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / segments;
  const k = (4 / 3) * Math.tan(step / 4);
  const point = (t) => [
    cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
    cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
  ];
  const tangent = (t) => [
    -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin,
    -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos,
  ];
  const curves = [];
  for (let i = 0; i < segments; i++) {
    const a = theta1 + i * step;
    const b = a + step;
    const p1 = point(a);
    const p2 = i === segments - 1 ? [x2, y2] : point(b);
    const t1 = tangent(a);
    const t2 = tangent(b);
    curves.push([p1[0] + k * t1[0], p1[1] + k * t1[1], p2[0] - k * t2[0], p2[1] - k * t2[1], p2[0], p2[1]]);
  }
  return curves;
}

export function normalizePath(d) {
  const tokens = tokenize(d);
  const out = [];
  let i = 0;
  let cmd = null;
  let x = 0, y = 0, sx = 0, sy = 0;
  let lastCtrl = null;
  const num = () => {
    const v = tokens[i++];
    if (typeof v !== 'number') throw new Error(`Expected a number in path data: ${d}`);
    return v;
  };
  const flag = () => {
    const v = num();
    if (v !== 0 && v !== 1) throw new Error(`Arc flags must be 0 or 1, separated by spaces: ${d}`);
    return v;
  };
  while (i < tokens.length) {
    if (typeof tokens[i] === 'string') cmd = tokens[i++];
    else if (cmd === null) throw new Error(`Path data must start with a command: ${d}`);
    else if (cmd === 'M') cmd = 'L';
    else if (cmd === 'm') cmd = 'l';
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M':
        x = ox + num(); y = oy + num(); sx = x; sy = y;
        out.push(['M', x, y]); lastCtrl = null; break;
      case 'L':
        x = ox + num(); y = oy + num();
        out.push(['L', x, y]); lastCtrl = null; break;
      case 'H':
        x = ox + num(); out.push(['L', x, y]); lastCtrl = null; break;
      case 'V':
        y = oy + num(); out.push(['L', x, y]); lastCtrl = null; break;
      case 'C': {
        const c = [ox + num(), oy + num(), ox + num(), oy + num(), ox + num(), oy + num()];
        out.push(['C', ...c]); lastCtrl = [c[2], c[3]]; x = c[4]; y = c[5]; break;
      }
      case 'S': {
        const c1 = lastCtrl ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
        const c = [ox + num(), oy + num(), ox + num(), oy + num()];
        out.push(['C', c1[0], c1[1], ...c]); lastCtrl = [c[0], c[1]]; x = c[2]; y = c[3]; break;
      }
      case 'Q': {
        const q = [ox + num(), oy + num(), ox + num(), oy + num()];
        out.push(['C', x + (2 / 3) * (q[0] - x), y + (2 / 3) * (q[1] - y), q[2] + (2 / 3) * (q[0] - q[2]), q[3] + (2 / 3) * (q[1] - q[3]), q[2], q[3]]);
        lastCtrl = null; x = q[2]; y = q[3]; break;
      }
      case 'A': {
        const rx = num(), ry = num(), rot = num(), la = flag(), sw = flag();
        const ex = ox + num(), ey = oy + num();
        const curves = arcToCubics(x, y, rx, ry, rot, la, sw, ex, ey);
        if (curves === null) out.push(['L', ex, ey]);
        else for (const c of curves) out.push(['C', ...c]);
        x = ex; y = ey; lastCtrl = null; break;
      }
      case 'Z':
        out.push(['Z']); x = sx; y = sy; lastCtrl = null; cmd = null; break;
      default:
        throw new Error(`Unsupported path command "${cmd}" in: ${d}`);
    }
  }
  return out;
}

export function formatNumber(n) {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}

export function serializePath(segments) {
  return segments.map(([c, ...n]) => [c, ...n.map(formatNumber)].join(' ')).join(' ');
}
