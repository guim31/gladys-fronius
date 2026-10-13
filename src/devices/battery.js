// -----------------------------------------------------------------------------
// One device per battery (BYD Battery-Box, Fronius Solar Battery, Reserva...),
// from GetStorageRealtimeData (Scope=System).
//
// Its charge and discharge power are on the system device (power flow): the
// storage endpoint reports DC values that a GEN24 leaves at 0. The usable
// capacity (`Capacity_Maximum`) gives the stored energy; it has no feature of
// its own (Gladys has no "capacity" type) and shows in the widget.
// -----------------------------------------------------------------------------

import { DEVICE_NAMES, FEATURE_NAMES, pick } from '../i18n.js';
import { COUPLES, KIND, device, feature, numericState } from './helpers.js';

export const BATTERY_TYPE = 'battery';

export const BATTERY_FEATURES = {
  level: 'level',
  temperature: 'temperature',
  storedEnergy: 'stored_energy',
};

export const batteryIds = (gladys, storage) => gladys.externalIds(BATTERY_TYPE, storage.platformId);

export function buildBattery(gladys, storage, config) {
  const ids = batteryIds(gladys, storage);
  const { language } = config;
  const F = BATTERY_FEATURES;
  return device({
    name: storage.model ?? pick(DEVICE_NAMES.battery(storage.index), language),
    externalId: ids.device,
    features: [
      feature(
        ids,
        F.level,
        FEATURE_NAMES.batteryLevel,
        language,
        COUPLES.batteryLevel,
        KIND.percent,
      ),
      feature(
        ids,
        F.storedEnergy,
        FEATURE_NAMES.batteryEnergy,
        language,
        COUPLES.batteryEnergy,
        KIND.storedEnergy,
      ),
      feature(
        ids,
        F.temperature,
        FEATURE_NAMES.batteryTemperature,
        language,
        COUPLES.temperature,
        KIND.temperature,
      ),
    ],
  });
}

/** kWh stored, from the state of charge and the usable capacity. */
export function storedEnergyKwh(reading) {
  if (!reading || reading.soc === null || !reading.capacity) {
    return null;
  }
  return ((reading.soc / 100) * reading.capacity) / 1000;
}

/**
 * @param {object} ctx
 * @param {object|undefined} ctx.reading the battery's last reading
 */
export function batteryStates(gladys, storage, { reading }) {
  if (!reading) {
    return [];
  }
  const ids = batteryIds(gladys, storage);
  const F = BATTERY_FEATURES;
  const states = [];
  numericState(states, ids.feature(F.level), reading.soc, 1);
  numericState(states, ids.feature(F.storedEnergy), storedEnergyKwh(reading), 2);
  numericState(states, ids.feature(F.temperature), reading.temperature, 1);
  return states;
}
