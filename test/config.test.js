import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, isConfigured, normalizeConfig, parseHost } from '../src/config.js';

test('the address typed by the user becomes the base URL of the Solar API', () => {
  assert.deepEqual(parseHost('192.0.2.10'), { baseUrl: 'http://192.0.2.10', valid: true });
  assert.equal(parseHost(' 192.0.2.10:8080 ').baseUrl, 'http://192.0.2.10:8080');
  assert.equal(parseHost('http://fronius.local/solar_api/').baseUrl, 'http://fronius.local');
  assert.equal(parseHost('https://192.0.2.10').baseUrl, 'https://192.0.2.10');
  assert.deepEqual(parseHost(''), { baseUrl: '', valid: true });
  assert.deepEqual(parseHost('ftp://192.0.2.10'), { baseUrl: '', valid: false });
  assert.deepEqual(parseHost('http://'), { baseUrl: '', valid: false });
});

test('credentials in the address are dropped (the API has none, logs must not show them)', () => {
  assert.equal(parseHost('http://admin:secret@192.0.2.10').baseUrl, 'http://192.0.2.10');
});

test('the defaults give an unconfigured integration polling every 15 s, in French', () => {
  const config = normalizeConfig(DEFAULT_CONFIG);
  assert.equal(isConfigured(config), false);
  assert.equal(config.pollIntervalMs, 15000);
  assert.equal(config.language, 'fr');
  assert.equal(config.batteryFullLevel, 100);
  assert.equal(config.batteryEmptyLevel, 5);
});

test('values out of the form are brought back to what the form offers', () => {
  const config = normalizeConfig({
    host: '192.0.2.10',
    poll_interval: '7',
    language: 'it',
    battery_full_level: 150,
    battery_empty_level: '20',
  });
  assert.equal(isConfigured(config), true);
  assert.equal(config.pollIntervalMs, 15000);
  assert.equal(config.language, 'fr');
  assert.equal(config.batteryFullLevel, 100);
  assert.equal(config.batteryEmptyLevel, 20);
  assert.equal(normalizeConfig({ poll_interval: '60' }).pollIntervalMs, 60000);
});

test('an "empty" level too close to the "full" one keeps a 10-point gap', () => {
  const config = normalizeConfig({ battery_full_level: 55, battery_empty_level: 50 });
  assert.equal(config.batteryEmptyLevel, 45);
});
