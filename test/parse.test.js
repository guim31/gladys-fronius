// -----------------------------------------------------------------------------
// Parsers of the Solar API v1, on real answers (test/fixtures/fronius/, from
// Home Assistant's `fronius` tests): Datamanager with a Symo, a Primo pair
// with an S0 meter, a GEN24 with and without battery.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeEntities,
  meterLocationKind,
  parseInverterInfo,
  parseInverterRealtime,
  parseLoggerInfo,
  parseMeters,
  parsePowerFlow,
  parseStorages,
} from '../src/fronius/parse.js';
import { fixture } from './helpers/fakeFronius.js';

test('custom names are decoded from their HTML character references', () => {
  assert.equal(decodeEntities('&#83;&#121;&#109;&#111;&#32;&#50;&#48;'), 'Symo 20');
  assert.equal(decodeEntities('&#x50;rimo &amp; co'), 'Primo & co');
  assert.equal(decodeEntities('Gen24 Storage'), 'Gen24 Storage');
  assert.equal(decodeEntities(undefined), '');
});

test('the logger identifies a Datamanager; a GEN24 has none', () => {
  assert.deepEqual(parseLoggerInfo(fixture('symo', 'GetLoggerInfo')), {
    uniqueId: '123.4567890',
    productId: 'fronius-datamanager-card',
    softwareVersion: '3.18.7-1',
  });
  assert.equal(parseLoggerInfo(fixture('gen24', 'GetLoggerInfo')), null);
});

test('the inverters are listed with their serial and decoded name', () => {
  const primo = parseInverterInfo(fixture('primo_s0', 'GetInverterInfo'));
  assert.deepEqual(
    primo.map(({ id, uniqueId, name }) => ({ id, uniqueId, name })),
    [
      { id: '1', uniqueId: '123456', name: 'Primo 5.0-1' },
      { id: '2', uniqueId: '234567', name: 'Primo 3.0-1' },
    ],
  );
});

test('the power flow keeps the API signs', () => {
  const symo = parsePowerFlow(fixture('symo', 'GetPowerFlowRealtimeData'));
  assert.equal(symo.pv, 1111);
  assert.equal(symo.grid, 1703.74); // importing
  assert.equal(symo.load, -2814.74); // the house consumes
  assert.equal(symo.battery, null); // no battery
  assert.equal(symo.energyDay, 1101.7000732421875);
  assert.equal(symo.energyTotal, 44188000);

  const night = parsePowerFlow(fixture('symo', 'GetPowerFlowRealtimeData_night'));
  assert.equal(night.pv, null);
  assert.equal(night.selfConsumption, null);

  const gen24 = parsePowerFlow(fixture('gen24_storage', 'GetPowerFlowRealtimeData'));
  assert.equal(gen24.energyDay, null, 'a GEN24 does not count the day');
  assert.equal(gen24.battery, 0.15907810628414154);
  assert.equal(gen24.batteryMode, 'suspended');
  assert.equal(gen24.inverters[0].soc, 4.6);
});

test('an inverter asleep has no AC values, which is not an error', () => {
  const day = parseInverterRealtime(fixture('symo', 'GetInverterRealtimeData_Device_1'));
  assert.equal(day.acPower, 1190);
  assert.equal(day.statusCode, 7);
  assert.deepEqual(day.dcVoltages, [518, null, null, null]);

  const night = parseInverterRealtime(fixture('symo', 'GetInverterRealtimeData_Device_1_night'));
  assert.equal(night.acPower, null);
  assert.equal(night.acVoltage, null);
  assert.equal(night.statusCode, 3);
  assert.equal(night.errorCode, 307);
  assert.equal(night.energyTotal, 44186900);

  const gen24 = parseInverterRealtime(fixture('gen24', 'GetInverterRealtimeData_Device_1'));
  assert.equal(gen24.energyDay, null);
  assert.equal(gen24.dcVoltages.filter((v) => v !== null).length, 2, 'two MPPT inputs');
});

test('meters: location, phases and absolute counters', () => {
  const [grid] = parseMeters(fixture('symo', 'GetMeterRealtimeData'));
  assert.equal(grid.locationKind, 'grid');
  assert.equal(grid.serial, '12345678');
  assert.equal(grid.energyPlus, 15303334);
  assert.equal(grid.energyMinus, 35623065);
  assert.deepEqual(grid.phases[2], { power: 2311.22, voltage: 231 });

  const [s0] = parseMeters(fixture('primo_s0', 'GetMeterRealtimeData'));
  assert.equal(s0.locationKind, 'load');
  assert.equal(s0.serial, null, '"n.a." is no serial');
  assert.equal(s0.energyPlus, null);

  assert.equal(meterLocationKind(300), 'subload');
  assert.equal(meterLocationKind(3), 'generator');
  assert.equal(meterLocationKind(null), 'unknown');
});

test('newer GEN24 firmwares name some meter fields SMARTMETER_*', () => {
  const [meter] = parseMeters({
    Body: {
      Data: {
        0: {
          Meter_Location_Current: 0,
          SMARTMETER_ENERGYACTIVE_CONSUMED_SUM_F64: 1000,
          SMARTMETER_ENERGYACTIVE_PRODUCED_SUM_F64: 2000,
          SMARTMETER_POWERACTIVE_01_F64: 120,
        },
      },
    },
  });
  assert.equal(meter.energyPlus, 1000);
  assert.equal(meter.energyMinus, 2000);
  assert.equal(meter.phases[0].power, 120);
});

test('batteries: charge level, capacity, trimmed serial', () => {
  const [battery] = parseStorages(fixture('gen24_storage', 'GetStorageRealtimeData'));
  assert.equal(battery.serial, 'P030T020Z2000000001');
  assert.equal(battery.model, 'BYD Battery-Box Premium HV');
  assert.equal(battery.soc, 4.6);
  assert.equal(battery.capacity, 16588);
  assert.equal(battery.temperature, 21.5);
  assert.deepEqual(parseStorages(fixture('gen24', 'GetStorageRealtimeData')), []);
  assert.deepEqual(parseStorages(fixture('symo', 'GetStorageRealtimeData')), []);
});
