// -----------------------------------------------------------------------------
// Scene triggers: one event per transition, none on the first reading, the
// dusk codes of a Symo are not faults, hysteresis on the battery levels.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './helpers/world.js';
import { isInFault } from '../src/devices/inverter.js';

const MINUTE = 60 * 1000;

/** Move one minute on (inverters and batteries are read once a minute) and run a cycle. */
async function nextMinute(world) {
  world.clock.advance(MINUTE);
  await world.app.cycle();
}

const events = (world, key) => world.gladys.fake.sceneEvents.filter((event) => event.key === key);

test('fault: status 10 or a GEN24 state saying so; the dusk codes are not faults', () => {
  assert.equal(isInFault({ statusCode: 10, errorCode: 102, inverterState: null }), true);
  assert.equal(isInFault({ statusCode: 7, errorCode: 0, inverterState: 'Failure' }), true);
  assert.equal(isInFault({ statusCode: 3, errorCode: 307, inverterState: null }), false);
  assert.equal(isInFault({ statusCode: 7, errorCode: 567, inverterState: 'Running' }), false);
  assert.equal(isInFault(null), false);
});

test('an inverter going into fault fires inverter_error once, with its error code', async () => {
  const world = await createWorld({ system: 'symo' });
  await nextMinute(world);
  assert.equal(events(world, 'inverter_error').length, 0);

  const status = world.fronius.answers['inverter:1'].Body.Data.DeviceStatus;
  status.StatusCode = 10;
  status.ErrorCode = 102;
  await nextMinute(world);
  await nextMinute(world); // still in fault: no second event
  assert.deepEqual(events(world, 'inverter_error'), [
    {
      key: 'inverter_error',
      data: {
        device: 'ext:test-integration:inverter:1234567',
        inverter: 'Symo 20',
        error_code: 102,
      },
    },
  ]);
  assert.equal(world.state('inverter:', 'state'), 'Erreur');
  assert.equal(world.state('inverter:', 'error_code'), 'Code 102');
  await world.app.stop();
});

test('an inverter flapping between fault and restart fires at most once in 10 minutes', async () => {
  const world = await createWorld({ system: 'symo' });
  const status = world.fronius.answers['inverter:1'].Body.Data.DeviceStatus;
  for (let i = 0; i < 6; i += 1) {
    status.StatusCode = i % 2 === 0 ? 10 : 7;
    await nextMinute(world);
  }
  assert.equal(events(world, 'inverter_error').length, 1);
  world.clock.advance(10 * MINUTE);
  status.StatusCode = 7;
  await nextMinute(world);
  status.StatusCode = 10;
  await nextMinute(world);
  assert.equal(events(world, 'inverter_error').length, 2);
  await world.app.stop();
});

test('an inverter already in fault at start-up fires nothing (no transition seen)', async () => {
  const world = await createWorld({
    system: 'symo',
    before: (fronius) => {
      fronius.answers['inverter:1'].Body.Data.DeviceStatus.StatusCode = 10;
    },
  });
  await nextMinute(world);
  assert.equal(events(world, 'inverter_error').length, 0);
  await world.app.stop();
});

test('battery full and empty fire once, with a 5-point hysteresis', async () => {
  const world = await createWorld({
    system: 'gen24_storage',
    config: { battery_full_level: 100, battery_empty_level: 5 },
  });
  const controller = world.fronius.answers.storages.Body.Data['0'].Controller;
  const levels = [50, 99.6, 100, 98, 99.7, 94, 100, 30, 5, 4, 7, 5, 11, 5];
  for (const level of levels) {
    controller.StateOfCharge_Relative = level;
    await nextMinute(world);
  }
  // full at 99.6 (rounded 100), re-armed at 94, full again at 100;
  // empty at 5, not at 5 again after 7, re-armed at 11, empty again at 5.
  assert.deepEqual(
    events(world, 'battery_full').map((event) => event.data.level),
    [99.6, 100],
  );
  assert.deepEqual(
    events(world, 'battery_empty').map((event) => event.data.level),
    [5, 5],
  );
  assert.deepEqual(events(world, 'battery_full')[0].data, {
    device: 'ext:test-integration:battery:P030T020Z2000000001',
    battery: 'BYD Battery-Box Premium HV',
    level: 99.6,
  });
  await world.app.stop();
});

test('the battery thresholds come from the configuration', async () => {
  const world = await createWorld({
    system: 'gen24_storage',
    config: { battery_full_level: 90, battery_empty_level: 20 },
  });
  const controller = world.fronius.answers.storages.Body.Data['0'].Controller;
  for (const level of [50, 90, 20]) {
    controller.StateOfCharge_Relative = level;
    await nextMinute(world);
  }
  assert.equal(events(world, 'battery_full').length, 1);
  assert.equal(events(world, 'battery_empty').length, 1);
  await world.app.stop();
});
