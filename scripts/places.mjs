export const EARTH_RADIUS_M = 6371008.8;

const rad = (deg) => (deg * Math.PI) / 180;

export function haversineM(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function placeSatisfied(distance, accuracy, radius, rule, confidence) {
  if (radius === 0) return rule === 'within' ? distance <= accuracy : distance > accuracy;
  if (rule === 'within') {
    return confidence === 'strict' ? distance + accuracy <= radius : distance - accuracy <= radius;
  }
  return confidence === 'strict' ? distance - accuracy > radius : distance + accuracy > radius;
}

export function evaluatePlaces(fix, reference) {
  if (!reference || !reference.places?.length) return { outcome: 'not_configured', accuracy: fix.accuracy ?? null };
  if (typeof fix.accuracy !== 'number' || !(fix.accuracy >= 0)) throw new Error('accuracy is required');
  const rule = reference.rule ?? 'within';
  const match = reference.match ?? 'any';
  const confidence = reference.confidence ?? 'strict';
  const results = reference.places.map((p) => {
    const distance = haversineM(fix.latitude, fix.longitude, p.latitude, p.longitude);
    return { id: p.id, distance_m: distance, ok: placeSatisfied(distance, fix.accuracy, p.radius_m, rule, confidence) };
  });
  const matched = match === 'all' ? results.every((r) => r.ok) : results.some((r) => r.ok);
  const nearest = results.reduce((a, b) => (b.distance_m < a.distance_m ? b : a));
  return {
    outcome: matched ? 'matched' : 'not_matched',
    nearest: { id: nearest.id, distance_m: Math.round(nearest.distance_m * 10) / 10 },
    accuracy: fix.accuracy,
  };
}
