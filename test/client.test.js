// -----------------------------------------------------------------------------
// The Solar API client: status codes, redirects (GEN24 http → https), one
// request at a time, the LNRequestTimeout retry. The transport is a stub,
// except for the last test, which runs httpGet against a server on the
// loopback interface (no network).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { API_PATHS, FroniusError, createClient, httpGet } from '../src/fronius/client.js';
import { apiError } from './helpers/fakeFronius.js';

const ok = (body) => ({ status: 200, body: JSON.stringify(body) });
const OK_BODY = { Body: { Data: { x: 1 } }, Head: { Status: { Code: 0 } } };

test('a Solar API answer is returned whole', async () => {
  const seen = [];
  const client = createClient({
    baseUrl: 'http://192.0.2.10',
    get: async (url) => {
      seen.push(url);
      return ok(OK_BODY);
    },
  });
  assert.deepEqual(await client.get(API_PATHS.powerFlow), OK_BODY);
  assert.deepEqual(seen, ['http://192.0.2.10/solar_api/v1/GetPowerFlowRealtimeData.fcgi']);
});

test('a status code other than 0 is an API error; 11 and 255 mean "not supported"', async () => {
  for (const [code, notSupported] of [
    [11, true],
    [255, true],
    [12, false],
  ]) {
    const client = createClient({ baseUrl: 'http://x', get: async () => ok(apiError(code, 'r')) });
    const err = await client.get('/p').catch((e) => e);
    assert.ok(err instanceof FroniusError);
    assert.equal(err.apiCode, code);
    assert.equal(err.notSupported, notSupported, `code ${code}`);
  }
  const missing = createClient({
    baseUrl: 'http://x',
    get: async () => ({ status: 404, body: '' }),
  });
  assert.equal((await missing.get('/p').catch((e) => e)).notSupported, true);
});

test('an answer that is not the Solar API is said so', async () => {
  const html = createClient({
    baseUrl: 'http://x',
    get: async () => ({ status: 200, body: '<html></html>' }),
  });
  assert.match((await html.get('/p').catch((e) => e)).message, /not JSON/);
  const other = createClient({ baseUrl: 'http://x', get: async () => ok({ hello: 1 }) });
  assert.equal((await other.get('/p').catch((e) => e)).kind, 'format');
});

test('a redirect is followed, to https as a GEN24 does', async () => {
  const seen = [];
  const client = createClient({
    baseUrl: 'http://192.0.2.10',
    get: async (url) => {
      seen.push(url);
      return url.startsWith('http://')
        ? { status: 301, location: url.replace('http://', 'https://') }
        : ok(OK_BODY);
    },
  });
  await client.get(API_PATHS.meters);
  assert.deepEqual(seen, [
    'http://192.0.2.10/solar_api/v1/GetMeterRealtimeData.cgi?Scope=System',
    'https://192.0.2.10/solar_api/v1/GetMeterRealtimeData.cgi?Scope=System',
  ]);
  const loop = createClient({
    baseUrl: 'http://x',
    get: async () => ({ status: 302, location: '/' }),
  });
  assert.match((await loop.get('/').catch((e) => e)).message, /too many redirects/);
});

test('LNRequestTimeout (8) is retried once', async () => {
  let calls = 0;
  const client = createClient({
    baseUrl: 'http://x',
    get: async () => {
      calls += 1;
      return calls === 1 ? ok(apiError(8, 'LNRequestTimeout')) : ok(OK_BODY);
    },
  });
  assert.deepEqual(await client.get('/p'), OK_BODY);
  assert.equal(calls, 2);
});

test('requests are sent one at a time', async () => {
  let active = 0;
  let maxActive = 0;
  const client = createClient({
    baseUrl: 'http://x',
    get: async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return ok(OK_BODY);
    },
  });
  await Promise.all([client.get('/a'), client.get('/b').catch(() => {}), client.get('/c')]);
  assert.equal(maxActive, 1);
});

test('a network error becomes a FroniusError without the address', async () => {
  const client = createClient({
    baseUrl: 'http://192.0.2.10',
    get: async () => {
      const err = new Error('connect EHOSTUNREACH 192.0.2.10:80');
      err.code = 'EHOSTUNREACH';
      throw err;
    },
  });
  const err = await client.get('/p').catch((e) => e);
  assert.equal(err.kind, 'network');
  assert.equal(err.message, 'EHOSTUNREACH');
});

test('httpGet: a real request on the loopback interface, and its timeout', async (t) => {
  const server = http.createServer((req, res) => {
    if (req.url === '/slow') {
      return; // never answers
    }
    if (req.url === '/moved') {
      res.writeHead(302, { location: '/solar_api/v1/GetPowerFlowRealtimeData.fcgi' });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(OK_BODY));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const client = createClient({ baseUrl: base });
  assert.deepEqual(await client.get('/moved'), OK_BODY);

  const err = await httpGet(`${base}/slow`, { timeoutMs: 50 }).catch((e) => e);
  assert.equal(err.kind, 'timeout');
});
