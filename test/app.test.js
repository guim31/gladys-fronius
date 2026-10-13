// -----------------------------------------------------------------------------
// The life of the integration: its own refresh timer (no onPoll needed), the
// onPoll fallback, reachability (status, badges, one log line per change),
// quiet logs, the inventory kept in /data, the action, the configuration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './helpers/world.js';
import { createMemoryStore } from '../src/store.js';
import { HEARTBEAT_MS } from '../src/app.js';
import { apiError } from './helpers/fakeFronius.js';

const settle = async () => {
  for (let i = 0; i < 50; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

test('the states refresh on the container timer, without any onPoll', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const world = await createWorld({
    system: 'symo',
    timers: true,
    config: { poll_interval: '10' },
  });
  const pvPower = `${world.device('system:').external_id}:pv_power`;
  assert.equal(world.gladys.fake.lastState(pvPower), 1111);
  const polls = world.gladys.fake.wsMessages.length;

  for (const [pv, expected] of [
    [2000, 2000],
    [2500.6, 2501],
  ]) {
    world.fronius.answers.powerFlow.Body.Data.Site.P_PV = pv;
    world.clock.advance(10000);
    t.mock.timers.tick(10000);
    await settle();
    assert.equal(world.gladys.fake.lastState(pvPower), expected);
  }
  // No onPoll was ever sent by the fake Gladys: the acks counted are ours.
  assert.ok(
    world.gladys.fake.requests.every((request) => request.path !== '/poll'),
    'no poll involved',
  );
  assert.ok(world.gladys.fake.wsMessages.length >= polls);
  await world.app.stop();
});

test('onPoll is a fallback: skipped while the timer is on time, a refresh when it is late', async () => {
  const world = await createWorld({ system: 'symo' });
  const system = world.device('system:');
  const before = world.fronius.count('powerFlow');
  world.clock.advance(5000);
  assert.deepEqual(await world.gladys.fake.poll(system), { success: true });
  assert.equal(world.fronius.count('powerFlow'), before, 'refreshed 5 s ago: skipped');
  world.clock.advance(20000);
  await world.gladys.fake.poll(system);
  assert.equal(world.fronius.count('powerFlow'), before + 1);
  await world.app.stop();
});

test('without any device added, the system is not read after the discovery', async () => {
  const world = await createWorld({ system: 'symo', create: false });
  const before = world.fronius.requests.length;
  world.clock.advance(60000);
  await world.app.cycle();
  await world.app.cycle();
  assert.equal(world.fronius.requests.length, before);
  assert.equal(world.gladys.fake.states.length, 0);
  await world.app.stop();
});

test('a device just added receives its states at once, from the last reading', async () => {
  const world = await createWorld({ system: 'symo', create: false });
  const before = world.fronius.requests.length;
  const [system] = world.gladys.fake.discoveredDevices;
  await world.gladys.fake.deviceCreated(system);
  assert.equal(world.fronius.requests.length, before, 'no request to the Datamanager');
  assert.equal(world.gladys.fake.lastState(`${system.external_id}:pv_power`), 1111);
  assert.ok(world.gladys.fake.widgetRefreshes.includes('energy_flow'));
  await world.app.stop();
});

test('only what changed is published, and an unchanged value again after the heartbeat', async (t) => {
  // The SDK dates the published values with Date.now().
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const world = await createWorld({ system: 'symo' });
  const count = () => world.gladys.fake.states.length;
  const start = count();
  world.clock.advance(15000);
  await world.app.cycle();
  assert.equal(count(), start, 'same readings: nothing sent');
  world.fronius.answers.powerFlow.Body.Data.Site.P_PV = 1500;
  world.clock.advance(15000);
  await world.app.cycle();
  assert.equal(count(), start + 1);
  world.clock.advance(HEARTBEAT_MS);
  t.mock.timers.tick(HEARTBEAT_MS);
  await world.app.cycle();
  assert.ok(count() > start + 5, 'every value sent again after the heartbeat');
  assert.ok(HEARTBEAT_MS <= 12 * 3600 * 1000);
  await world.app.stop();
});

test('a normal cycle writes nothing at info level or above', async () => {
  const world = await createWorld({ system: 'gen24_storage' });
  const before = world.logs.lines.filter((line) => line.level !== 'debug').length;
  for (let i = 0; i < 6; i += 1) {
    world.clock.advance(15000);
    await world.app.cycle();
  }
  await world.gladys.fake.widgetGet('energy_flow');
  await world.gladys.fake.poll(world.device('system:'));
  assert.equal(world.logs.lines.filter((line) => line.level !== 'debug').length, before);
  assert.ok(world.logs.at('debug').length > 0, 'the details are in debug');
  await world.app.stop();
});

test('the start writes one info line about the system found', async () => {
  const world = await createWorld({ system: 'symo' });
  assert.deepEqual(
    world.logs.lines.filter((line) => line.level !== 'debug').map((line) => line.text),
    [
      'Fronius system at http://192.0.2.10: Datamanager 123.4567890: 1 inverter(s), 1 meter(s), 0 battery(ies)',
    ],
  );
  await world.app.stop();
});

test('lost and back: one warning, one info line, the status and the badges follow', async () => {
  const world = await createWorld({ system: 'symo' });
  assert.equal(world.gladys.fake.connectionStatus.connected, true);
  world.fronius.goDown('EHOSTUNREACH');
  for (let i = 0; i < 5; i += 1) {
    world.clock.advance(15000);
    await world.app.cycle();
  }
  assert.equal(world.logs.at('warn').length, 1, 'one warning, not one per cycle');
  assert.match(world.logs.at('warn')[0].text, /unreachable.*EHOSTUNREACH/);
  const lost = world.gladys.fake.connectionStatus;
  assert.equal(lost.connected, false);
  assert.match(lost.message.fr, /ne répond pas \(EHOSTUNREACH\)/);
  assert.ok(world.gladys.fake.transports.some((entry) => entry.transport === 'unreachable'));

  world.fronius.comeBack();
  world.clock.advance(15000);
  await world.app.cycle();
  world.clock.advance(15000);
  await world.app.cycle();
  assert.deepEqual(
    world.logs
      .at('info')
      .slice(-1)
      .map((line) => line.text),
    ['Fronius system answers again'],
  );
  assert.equal(world.gladys.fake.connectionStatus.connected, true);
  const last = world.gladys.fake.transports.at(-1);
  assert.equal(last.transport, 'local');
  await world.app.stop();
});

test('a meter endpoint that fails keeps its last values and is said once', async () => {
  const world = await createWorld({ system: 'symo' });
  const err = new Error('connect ETIMEDOUT');
  err.code = 'ETIMEDOUT';
  world.fronius.answers.meters = err;
  for (let i = 0; i < 3; i += 1) {
    world.clock.advance(60000);
    await world.app.cycle();
  }
  assert.equal(world.logs.at('warn').length, 1);
  assert.equal(world.state('meter:', 'import_index'), 15303.334);
  assert.equal(world.gladys.fake.connectionStatus.connected, true, 'the system itself answers');
  await world.app.stop();
});

test('credentials typed in the address never reach the logs nor Gladys', async () => {
  const world = await createWorld({
    system: 'symo',
    config: { host: 'http://admin:s3cr3t-pw@192.0.2.10' },
  });
  world.fronius.goDown();
  world.clock.advance(15000);
  await world.app.cycle();
  await world.gladys.fake.action('test_connection');
  const everything = JSON.stringify([world.logs.lines, world.gladys.fake.requests]);
  assert.ok(!everything.includes('s3cr3t-pw'));
  assert.ok(!everything.includes('admin'));
  assert.ok(world.fronius.requests.every((url) => url.startsWith('http://192.0.2.10/')));
  await world.app.stop();
});

test('the inventory kept in /data publishes the devices even when the system is down', async () => {
  const store = createMemoryStore();
  const first = await createWorld({ system: 'gen24_storage', store });
  const expected = first.gladys.fake.discoveredDevices.map((device) => device.external_id);
  await first.app.stop();

  const second = await createWorld({
    system: 'gen24_storage',
    store,
    create: false,
    before: (fronius) => fronius.goDown(),
  });
  assert.deepEqual(
    second.gladys.fake.discoveredDevices.map((device) => device.external_id),
    expected,
  );
  assert.equal(second.gladys.fake.connectionStatus.connected, false);
  await second.app.stop();
});

test('hardware seen once is never removed; hardware added appears', async () => {
  const world = await createWorld({ system: 'gen24' });
  assert.equal(world.device('battery:'), undefined);
  // The meter misses an answer, a battery is installed.
  world.fronius.answers.meters = { Body: { Data: {} }, Head: { Status: { Code: 0 } } };
  world.fronius.answers.storages = structuredClone(
    (await import('./helpers/fakeFronius.js')).fixture('gen24_storage', 'GetStorageRealtimeData'),
  );
  world.clock.advance(60000);
  await world.app.cycle();
  assert.ok(world.device('battery:'), 'the battery appears in Discovery');
  assert.ok(world.device('meter:'), 'the meter stays');
  await world.app.stop();
});

test('the system is read whole again every 30 minutes', async () => {
  const world = await createWorld({ system: 'symo' });
  const before = world.fronius.count('inverterInfo');
  world.clock.advance(29 * 60000);
  await world.app.cycle();
  assert.equal(world.fronius.count('inverterInfo'), before);
  world.clock.advance(2 * 60000);
  await world.app.cycle();
  assert.equal(world.fronius.count('inverterInfo'), before + 1);
  await world.app.stop();
});

test('not configured, or an invalid address: said in the configuration screen', async () => {
  const empty = await createWorld({ config: { host: '' }, create: false });
  assert.equal(empty.gladys.fake.connectionStatus.connected, false);
  assert.match(empty.gladys.fake.connectionStatus.message.en, /Enter the IP address/);
  assert.equal(empty.fronius.requests.length, 0);
  await empty.app.stop();

  const invalid = await createWorld({ config: { host: 'ftp://192.0.2.10' }, create: false });
  assert.match(invalid.gladys.fake.connectionStatus.message.de, /ungültig/);
  await invalid.app.stop();
});

test('test_connection lists what was found, in four languages', async () => {
  const world = await createWorld({ system: 'primo_s0', create: false });
  const ack = await world.gladys.fake.action('test_connection');
  assert.equal(ack.success, true);
  assert.match(ack.data.fr ?? ack.data.message?.fr, /Onduleurs : 2, compteurs : 1, batteries : 0/);
  world.fronius.goDown('ECONNREFUSED');
  const down = await world.gladys.fake.action('test_connection');
  const message = down.data.en ?? down.data.message?.en;
  assert.match(message, /does not answer \(ECONNREFUSED\)/);
  assert.equal(world.logs.at('info').filter((l) => /Action/.test(l.text)).length, 2);
  await world.app.stop();
});

test('a new address: the new system is read and published', async () => {
  const world = await createWorld({ system: 'symo' });
  world.fronius.answers = (await import('./helpers/fakeFronius.js')).recordedAnswers('gen24');
  await world.gladys.fake.configUpdated({ host: '192.0.2.20' });
  assert.ok(world.fronius.requests.at(-1).startsWith('http://192.0.2.20/'));
  assert.ok(world.device('system:12345678'));
  await world.app.stop();
});

test('a Datamanager whose logger answer fails keeps its identity (external ids never change)', async () => {
  const world = await createWorld({ system: 'symo' });
  const before = world.gladys.fake.discoveredDevices.map((device) => device.external_id);
  // A glitch: the logger endpoint says "not supported" once.
  world.fronius.answers.logger = apiError(11, 'not supported');
  world.clock.advance(31 * 60000);
  await world.app.cycle();
  await world.gladys.fake.scanRequest();
  assert.deepEqual(
    world.gladys.fake.discoveredDevices.map((device) => device.external_id),
    before,
  );
  assert.ok(!JSON.stringify(world.gladys.fake.requests).includes('system:1234567"'));
  await world.app.stop();
});

test('a first discovery with a failing logger publishes nothing rather than a wrong identity', async () => {
  const err = new Error('socket hang up');
  err.code = 'ECONNRESET';
  const world = await createWorld({
    system: 'symo',
    create: false,
    before: (fronius) => {
      fronius.answers.logger = err;
    },
  });
  assert.deepEqual(world.gladys.fake.discoveredDevices, []);
  world.fronius.answers.logger = (await import('./helpers/fakeFronius.js')).fixture(
    'symo',
    'GetLoggerInfo',
  );
  world.clock.advance(15000);
  await world.app.cycle();
  assert.equal(world.device('system:').external_id, 'ext:test-integration:system:123.4567890');
  await world.app.stop();
});
