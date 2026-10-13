// -----------------------------------------------------------------------------
// Shared pieces of the device blueprints.
//
// Every feature is a read-only measurement: Fronius exposes nothing to drive
// through the Solar API, and this integration drives nothing (an inverter or
// a battery is not something a scene should switch by mistake).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { pick } from '../i18n.js';

// The container refreshes the devices itself (src/poller.js). The devices
// still ask the core to poll them once a minute: onPoll is the fallback if
// the container's timer ever stalls (GladysAssistant/Gladys#3198).
export const CORE_POLL_FREQUENCY = DEVICE_POLL_FREQUENCIES.EVERY_MINUTES;

// Display bounds (the core never applies them to the values). A power that
// can be negative gets symmetric bounds, so a gauge puts zero in the middle.
export const KIND = {
  power: { unit: U.WATT, min: 0, max: 100000 },
  signedPower: { unit: U.WATT, min: -100000, max: 100000 },
  acVoltage: { unit: U.VOLT, min: 0, max: 500 },
  dcVoltage: { unit: U.VOLT, min: 0, max: 1500 },
  current: { unit: U.AMPERE, min: 0, max: 500 },
  dayEnergy: { unit: U.KILOWATT_HOUR, min: 0, max: 10000 },
  index: { unit: U.KILOWATT_HOUR, min: 0, max: 1000000000 },
  storedEnergy: { unit: U.KILOWATT_HOUR, min: 0, max: 1000 },
  percent: { unit: U.PERCENT, min: 0, max: 100 },
  temperature: { unit: U.CELSIUS, min: -40, max: 100 },
  text: { min: 0, max: 0 },
};

/**
 * One read-only feature.
 * @param {{ feature: (key: string) => string }} ids
 * @param {string} key the stable feature key (part of the external id: never renamed)
 * @param {Record<string, string>} name multi-language name
 * @param {string} language the language of the names (config)
 * @param {[string, string]} couple [category, type]
 * @param {object} kind one of KIND
 */
export function feature(ids, key, name, language, [category, type], kind) {
  return {
    name: pick(name, language),
    external_id: ids.feature(key),
    category,
    type,
    ...(kind.unit ? { unit: kind.unit } : {}),
    min: kind.min,
    max: kind.max,
    read_only: true,
    has_feedback: false,
    keep_history: kind !== KIND.text,
  };
}

export const COUPLES = {
  productionPower: [C.ENERGY_PRODUCTION_SENSOR, T.ENERGY_PRODUCTION_SENSOR.POWER],
  productionToday: [C.ENERGY_PRODUCTION_SENSOR, T.ENERGY_PRODUCTION_SENSOR.DAILY_PRODUCTION],
  productionIndex: [C.ENERGY_PRODUCTION_SENSOR, T.ENERGY_PRODUCTION_SENSOR.INDEX],
  homePower: [C.HOME_OUTPUT_SENSOR, T.HOME_OUTPUT_SENSOR.POWER],
  gridImportPower: [C.GRID_SENSOR, T.GRID_SENSOR.INPUT_POWER],
  gridExportPower: [C.GRID_SENSOR, T.GRID_SENSOR.OUTPUT_POWER],
  gridPower: [C.GRID_SENSOR, T.GRID_SENSOR.POWER],
  gridExportIndex: [C.GRID_SENSOR, T.GRID_SENSOR.OUTPUT_INDEX],
  // The one consumption index: the energy taken from the grid, what the
  // supplier bills. The core derives its 30-minute consumption and its cost
  // from it (ENERGY_INDEX_FEATURE_TYPES), which feeds the Energy screens.
  gridImportIndex: [C.ENERGY_SENSOR, T.ENERGY_SENSOR.INDEX],
  power: [C.ENERGY_SENSOR, T.ENERGY_SENSOR.POWER],
  voltage: [C.ENERGY_SENSOR, T.ENERGY_SENSOR.VOLTAGE],
  current: [C.ENERGY_SENSOR, T.ENERGY_SENSOR.CURRENT],
  batteryCharge: [C.BATTERY_STORAGE, T.BATTERY_STORAGE.CHARGE_POWER],
  batteryDischarge: [C.BATTERY_STORAGE, T.BATTERY_STORAGE.DISCHARGE_POWER],
  batteryLevel: [C.BATTERY_STORAGE, T.BATTERY_STORAGE.BATTERY_LEVEL],
  batteryEnergy: [C.BATTERY_STORAGE, T.BATTERY_STORAGE.BATTERY_ENERGY_REMAINING],
  temperature: [C.DEVICE_TEMPERATURE_SENSOR, T.SENSOR.DECIMAL],
  text: [C.TEXT, T.TEXT.TEXT],
};

/** A device as Gladys wants it. */
export function device({ name, externalId, features }) {
  return {
    name,
    external_id: externalId,
    should_poll: true,
    poll_frequency: CORE_POLL_FREQUENCY,
    features,
  };
}

/** Round to a number of decimals (the values move less, fewer states are sent). */
export function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** A numeric state, or nothing when the value is unknown. */
export function numericState(list, externalId, value, digits) {
  if (value !== null && value !== undefined && Number.isFinite(value)) {
    list.push({ device_feature_external_id: externalId, state: round(value, digits) });
  }
}

/** A text state, or nothing when the text is empty (Gladys ignores those). */
export function textState(list, externalId, text) {
  if (typeof text === 'string' && text.trim() !== '') {
    list.push({ device_feature_external_id: externalId, text });
  }
}

/** Wh → kWh, null kept. */
export const kwh = (wh) => (wh === null || wh === undefined ? null : wh / 1000);

/** The positive part of a signed power (null kept). */
export const positive = (value) => (value === null ? null : Math.max(value, 0));
