// -----------------------------------------------------------------------------
// What Gladys receives, system by system: the devices of the Discovery tab and
// their states, with the meaning of every value checked against the API.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, createClock } from './helpers/world.js';
import { apiError } from './helpers/fakeFronius.js';

const keysOf = (device) => device.features.map((feature) => feature.external_id.split(':').pop());
const couple = (device, key) => {
  const feature = device.features.find((f) => f.external_id.endsWith(`:${key}`));
  return `${feature.category}/${feature.type}`;
};

test('Datamanager + Symo + grid meter: one device each, with stable serial-based ids', async () => {
  const world = await createWorld({ system: 'symo' });
  const ids = world.gladys.fake.discoveredDevices.map((device) => device.external_id);
  assert.deepEqual(ids, [
    'ext:test-integration:system:123.4567890',
    'ext:test-integration:inverter:1234567',
    'ext:test-integration:meter:12345678',
  ]);
  const system = world.device('system:');
  assert.equal(system.name, 'Installation Fronius');
  assert.deepEqual(keysOf(system), [
    'pv_power',
    'home_power',
    'grid_import_power',
    'grid_export_power',
    'production_today',
    'production_total',
  ]);
  assert.equal(world.device('inverter:').name, 'Symo 20');
  await world.app.stop();
});

test('the flows are published positive, one feature per direction', async () => {
  const world = await createWorld({ system: 'symo' });
  // P_PV 1111, P_Load -2814.74, P_Grid +1703.74 (import)
  assert.equal(world.state('system:', 'pv_power'), 1111);
  assert.equal(world.state('system:', 'home_power'), 2815);
  assert.equal(world.state('system:', 'grid_import_power'), 1704);
  assert.equal(world.state('system:', 'grid_export_power'), 0);
  // E_Day 1101.7 Wh, E_Total 44188000 Wh
  assert.equal(world.state('system:', 'production_today'), 1.102);
  assert.equal(world.state('system:', 'production_total'), 44188);
  await world.app.stop();
});

test('exporting: the export feature carries the surplus, the import one is 0', async () => {
  const world = await createWorld({
    system: 'symo',
    before: (fronius) => {
      fronius.answers.powerFlow.Body.Data.Site.P_Grid = -2500.4;
    },
  });
  assert.equal(world.state('system:', 'grid_import_power'), 0);
  assert.equal(world.state('system:', 'grid_export_power'), 2500);
  await world.app.stop();
});

test('energy tracking: only the grid import counter is a consumption index', async () => {
  const world = await createWorld({ system: 'symo' });
  const meter = world.device('meter:');
  assert.equal(meter.name, 'Fronius Smart Meter 63A');
  assert.equal(couple(meter, 'import_index'), 'energy-sensor/index');
  assert.equal(couple(meter, 'export_index'), 'grid-sensor/output-index');
  assert.equal(couple(meter, 'power'), 'grid-sensor/power');
  assert.equal(
    couple(world.device('system:'), 'production_total'),
    'energy-production-sensor/index',
  );
  // Nothing else may be read by the core as a consumption.
  const consumptionTypes = new Set([
    'energy-sensor/index',
    'energy-sensor/energy',
    'switch/energy',
  ]);
  const consumption = world.gladys.fake.discoveredDevices
    .flatMap((device) => device.features)
    .filter((feature) => consumptionTypes.has(`${feature.category}/${feature.type}`));
  assert.deepEqual(
    consumption.map((feature) => feature.external_id),
    ['ext:test-integration:meter:12345678:import_index'],
  );
  // Absolute counters in kWh.
  assert.equal(world.state('meter:', 'import_index'), 15303.334);
  assert.equal(world.state('meter:', 'export_index'), 35623.065);
  assert.equal(
    meter.features.find((f) => f.external_id.endsWith(':import_index')).unit,
    'kilowatt-hour',
  );
  await world.app.stop();
});

test('a meter on the consumption path gives the house consumption, positive', async () => {
  const world = await createWorld({ system: 'primo_s0' });
  const meter = world.device('meter:');
  assert.equal(meter.external_id, 'ext:test-integration:meter:123.4567890-meter-0');
  assert.deepEqual(keysOf(meter), ['power']);
  assert.equal(couple(meter, 'power'), 'home-output-sensor/power');
  assert.equal(world.state('meter:', 'power'), 2217); // PowerReal_P_Sum -2216.75
  await world.app.stop();
});

test('two inverters: two devices, each with its own production of the day', async () => {
  const world = await createWorld({ system: 'primo_s0' });
  assert.equal(world.state('inverter:123456', 'production_today'), 22.504);
  assert.equal(world.state('inverter:234567', 'production_today'), 14.237);
  assert.equal(world.state('inverter:234567', 'ac_power'), 296);
  assert.equal(world.state('inverter:234567', 'state'), 'En production');
  assert.equal(world.state('inverter:234567', 'error_code'), 'Aucune erreur');
  await world.app.stop();
});

test('a system without meter has no house nor grid features', async () => {
  const world = await createWorld({
    system: 'symo',
    before: (fronius) => {
      const site = fronius.answers.powerFlow.Body.Data.Site;
      site.P_Grid = null;
      site.P_Load = null;
      site.Mode = 'produce-only';
      fronius.answers.meters = { Body: { Data: {} }, Head: { Status: { Code: 0 } } };
    },
  });
  assert.deepEqual(keysOf(world.device('system:')), [
    'pv_power',
    'production_today',
    'production_total',
  ]);
  assert.equal(world.device('meter:'), undefined);
  await world.app.stop();
});

test('GEN24: no logger, the inverter serial names the system; two DC inputs', async () => {
  const world = await createWorld({ system: 'gen24' });
  assert.equal(world.device('system:').external_id, 'ext:test-integration:system:12345678');
  assert.deepEqual(keysOf(world.device('inverter:')), [
    'ac_power',
    'ac_voltage',
    'ac_current',
    'dc_voltage_1',
    'dc_current_1',
    'dc_voltage_2',
    'dc_current_2',
    'production_today',
    'state',
    'error_code',
  ]);
  await world.app.stop();
});

test('GEN24: the production of the day is counted from the lifetime counter', async () => {
  // 5:00 in Paris, before sunrise: the counter is the baseline of the day.
  const clock = createClock(Date.parse('2026-06-21T03:00:00Z'));
  const world = await createWorld({
    system: 'gen24',
    clock,
    before: (fronius) => {
      fronius.answers.powerFlow.Body.Data.Site.P_PV = null;
    },
  });
  assert.equal(world.state('system:', 'production_today'), 0);
  // 3 hours later, 2.5 kWh more on the counter.
  const site = world.fronius.answers.powerFlow.Body.Data.Site;
  site.P_PV = 1500;
  site.E_Total += 2500;
  clock.advance(3 * 3600 * 1000);
  await world.app.cycle();
  assert.equal(world.state('system:', 'production_today'), 2.5);
  await world.app.stop();
});

test('GEN24 with battery: battery device and charge/discharge flows', async () => {
  const world = await createWorld({ system: 'gen24_storage' });
  const battery = world.device('battery:');
  assert.equal(battery.external_id, 'ext:test-integration:battery:P030T020Z2000000001');
  assert.equal(battery.name, 'BYD Battery-Box Premium HV');
  assert.deepEqual(keysOf(battery), ['level', 'stored_energy', 'temperature']);
  assert.equal(world.state('battery:', 'level'), 4.6);
  // 4.6 % of 16588 Wh
  assert.equal(world.state('battery:', 'stored_energy'), 0.76);
  assert.equal(world.state('battery:', 'temperature'), 21.5);
  assert.ok(keysOf(world.device('system:')).includes('battery_charge_power'));

  world.fronius.answers.powerFlow.Body.Data.Site.P_Akku = -1200;
  await world.app.cycle();
  assert.equal(world.state('system:', 'battery_charge_power'), 1200);
  assert.equal(world.state('system:', 'battery_discharge_power'), 0);
  world.fronius.answers.powerFlow.Body.Data.Site.P_Akku = 800;
  await world.app.cycle();
  assert.equal(world.state('system:', 'battery_charge_power'), 0);
  assert.equal(world.state('system:', 'battery_discharge_power'), 800);
  await world.app.stop();
});

test('at night: no production, an inverter asleep is "sleeping" with 0 W', async () => {
  const world = await createWorld({ system: 'symo' });
  world.fronius.answers.powerFlow.Body.Data.Site.P_PV = null;
  world.fronius.answers['inverter:1'] = apiError(12, 'Device not available');
  world.clock.advance(60 * 1000);
  await world.app.cycle();
  assert.equal(world.state('system:', 'pv_power'), 0);
  assert.equal(world.state('inverter:', 'ac_power'), 0);
  assert.equal(world.state('inverter:', 'state'), 'En sommeil');
  // The last AC voltage stays as it was: no fake 0 V.
  assert.equal(world.state('inverter:', 'ac_voltage'), 227.9);
  await world.app.stop();
});

test('at night a Symo answers its night values: startup state, code 307, no AC values', async () => {
  const world = await createWorld({ system: 'symo', night: true, config: { language: 'en' } });
  assert.equal(world.state('inverter:', 'ac_power'), 0);
  assert.equal(world.state('inverter:', 'state'), 'Starting');
  assert.equal(world.state('inverter:', 'error_code'), 'Code 307');
  assert.equal(world.state('inverter:', 'ac_voltage'), undefined);
  assert.equal(world.state('system:', 'production_today'), 10.828);
  await world.app.stop();
});

test('feature names follow the language of the configuration', async () => {
  const names = {};
  for (const language of ['en', 'fr', 'de', 'es']) {
    const world = await createWorld({ system: 'gen24_storage', config: { language } });
    names[language] = world.device('system:').features.map((feature) => feature.name);
    await world.app.stop();
  }
  assert.equal(names.en[0], 'Solar production');
  assert.equal(names.fr[0], 'Production solaire');
  assert.equal(names.de[0], 'Solarproduktion');
  assert.equal(names.es[0], 'Producción solar');
});

test('every device asks the core for a poll once a minute (fallback of the timer)', async () => {
  const world = await createWorld({ system: 'gen24_storage' });
  for (const device of world.gladys.fake.discoveredDevices) {
    assert.equal(device.should_poll, true);
    assert.equal(device.poll_frequency, 60000);
  }
  await world.app.stop();
});
