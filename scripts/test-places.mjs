import test from 'node:test';
import assert from 'node:assert/strict';
import { EARTH_RADIUS_M, evaluatePlaces, haversineM } from './places.mjs';

const hq = { id: 'hq', label: 'Head office', latitude: 4.0511, longitude: 9.7679 };
const northOf = (place, metres) => ({
  latitude: place.latitude + (metres / EARTH_RADIUS_M) * (180 / Math.PI),
  longitude: place.longitude,
});
const fix = (place, metres, accuracy) => ({ ...northOf(place, metres), accuracy });
const ref = (places, extra = {}) => ({ places, rule: 'within', match: 'any', confidence: 'strict', on_mismatch: 'reject', ...extra });

test('haversine matches one degree of arc and is symmetric', () => {
  assert.ok(Math.abs(haversineM(0, 0, 0, 1) - (EARTH_RADIUS_M * Math.PI) / 180) < 1e-6);
  assert.ok(Math.abs(haversineM(4.05, 9.76, 3.86, 11.5) - haversineM(3.86, 11.5, 4.05, 9.76)) < 1e-6);
  assert.ok(Math.abs(haversineM(hq.latitude, hq.longitude, northOf(hq, 100).latitude, hq.longitude) - 100) < 1e-6);
});

test('radius 0 means the place falls inside the fix accuracy circle', () => {
  const places = [{ ...hq, radius_m: 0 }];
  assert.equal(evaluatePlaces(fix(hq, 8, 12), ref(places)).outcome, 'matched');
  assert.equal(evaluatePlaces(fix(hq, 8, 12), ref(places, { confidence: 'lenient' })).outcome, 'matched');
  assert.equal(evaluatePlaces(fix(hq, 15, 12), ref(places)).outcome, 'not_matched');
});

test('radius 10 m: strict needs the whole circle inside, lenient needs overlap', () => {
  const places = [{ ...hq, radius_m: 10 }];
  assert.equal(evaluatePlaces(fix(hq, 6, 3), ref(places)).outcome, 'matched');
  assert.equal(evaluatePlaces(fix(hq, 8, 5), ref(places)).outcome, 'not_matched');
  assert.equal(evaluatePlaces(fix(hq, 8, 5), ref(places, { confidence: 'lenient' })).outcome, 'matched');
  assert.equal(evaluatePlaces(fix(hq, 20, 5), ref(places, { confidence: 'lenient' })).outcome, 'not_matched');
});

test('radius 100 m', () => {
  const places = [{ ...hq, radius_m: 100 }];
  const r = evaluatePlaces(fix(hq, 60, 30), ref(places));
  assert.equal(r.outcome, 'matched');
  assert.equal(r.nearest.id, 'hq');
  assert.equal(r.nearest.distance_m, 60);
  assert.equal(r.accuracy, 30);
  assert.equal(evaluatePlaces(fix(hq, 80, 30), ref(places)).outcome, 'not_matched');
  assert.equal(evaluatePlaces(fix(hq, 120, 30), ref(places, { confidence: 'lenient' })).outcome, 'matched');
});

test('outside mirrors strict and lenient', () => {
  const places = [{ ...hq, radius_m: 100 }];
  const outside = (c) => ref(places, { rule: 'outside', confidence: c });
  assert.equal(evaluatePlaces(fix(hq, 150, 20), outside('strict')).outcome, 'matched');
  assert.equal(evaluatePlaces(fix(hq, 110, 20), outside('strict')).outcome, 'not_matched');
  assert.equal(evaluatePlaces(fix(hq, 90, 20), outside('lenient')).outcome, 'matched');
  assert.equal(evaluatePlaces(fix(hq, 70, 20), outside('lenient')).outcome, 'not_matched');
});

test('match any versus all', () => {
  const site = { id: 'site', label: 'Depot', ...northOf(hq, 500), radius_m: 100 };
  const places = [{ ...hq, radius_m: 100 }, site];
  const nearHq = fix(hq, 20, 10);
  assert.equal(evaluatePlaces(nearHq, ref(places)).outcome, 'matched');
  assert.equal(evaluatePlaces(nearHq, ref(places, { match: 'all' })).outcome, 'not_matched');
  const far = fix(hq, 5000, 10);
  assert.equal(evaluatePlaces(far, ref(places, { rule: 'outside', match: 'all' })).outcome, 'matched');
  assert.equal(evaluatePlaces(nearHq, ref(places, { rule: 'outside', match: 'all' })).outcome, 'not_matched');
  assert.equal(evaluatePlaces(nearHq, ref(places, { rule: 'outside', match: 'any' })).outcome, 'matched');
});

test('no reference places is not_configured', () => {
  assert.equal(evaluatePlaces(fix(hq, 0, 5), null).outcome, 'not_configured');
  assert.equal(evaluatePlaces(fix(hq, 0, 5), ref([])).outcome, 'not_configured');
});
