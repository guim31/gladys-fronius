// -----------------------------------------------------------------------------
// One device per inverter, from GetInverterRealtimeData (CommonInverterData).
//
// At night a Symo or a Primo goes to sleep: its AC values disappear, or the
// Datamanager answers "device not available". The AC power is then 0 W and
// the other AC values keep their last state. The state and the error code are
// texts in the language of the configuration: a status code alone (7, 3...)
// means nothing on a dashboard.
//
// No frequency feature: Gladys has no unit for hertz.
// -----------------------------------------------------------------------------

import { DEVICE_NAMES, ERROR_TEXTS, FEATURE_NAMES, INVERTER_STATES, pick } from '../i18n.js';
import { COUPLES, KIND, device, feature, kwh, numericState, textState } from './helpers.js';

export const INVERTER_TYPE = 'inverter';

export const INVERTER_FEATURES = {
  acPower: 'ac_power',
  acVoltage: 'ac_voltage',
  acCurrent: 'ac_current',
  dcVoltage: (input) => `dc_voltage_${input}`,
  dcCurrent: (input) => `dc_current_${input}`,
  productionToday: 'production_today',
  state: 'state',
  errorCode: 'error_code',
};

export const inverterIds = (gladys, inverter) =>
  gladys.externalIds(INVERTER_TYPE, inverter.platformId);

/** The state of an inverter, from its status code (null: asleep, no answer). */
export function inverterStateKey(reading) {
  if (!reading) {
    return 'sleeping';
  }
  const code = reading.statusCode;
  if (code === null) {
    return 'unknown';
  }
  if (code >= 0 && code <= 6) return 'startup';
  return (
    {
      7: 'running',
      8: 'standby',
      9: 'bootloading',
      10: 'error',
      11: 'idle',
      12: 'ready',
      13: 'sleeping',
    }[code] ?? 'unknown'
  );
}

/**
 * The inverter is in fault: status "error" (10), or a GEN24 state saying so.
 * The error codes a Symo shows at dusk (306, 307: PV voltage too low) come
 * with a "startup" status: they are not faults.
 */
export function isInFault(reading) {
  if (!reading) {
    return false;
  }
  return reading.statusCode === 10 || /error|fault|failure/i.test(reading.inverterState ?? '');
}

export function buildInverter(gladys, inverter, config) {
  const ids = inverterIds(gladys, inverter);
  const { language } = config;
  const F = INVERTER_FEATURES;
  const features = [
    feature(ids, F.acPower, FEATURE_NAMES.acPower, language, COUPLES.productionPower, KIND.power),
    feature(ids, F.acVoltage, FEATURE_NAMES.acVoltage, language, COUPLES.voltage, KIND.acVoltage),
    feature(ids, F.acCurrent, FEATURE_NAMES.acCurrent, language, COUPLES.current, KIND.current),
  ];
  for (let input = 1; input <= inverter.dcInputs; input += 1) {
    features.push(
      feature(
        ids,
        F.dcVoltage(input),
        FEATURE_NAMES.dcVoltage(input),
        language,
        COUPLES.voltage,
        KIND.dcVoltage,
      ),
      feature(
        ids,
        F.dcCurrent(input),
        FEATURE_NAMES.dcCurrent(input),
        language,
        COUPLES.current,
        KIND.current,
      ),
    );
  }
  features.push(
    feature(
      ids,
      F.productionToday,
      FEATURE_NAMES.productionToday,
      language,
      COUPLES.productionToday,
      KIND.dayEnergy,
    ),
    feature(ids, F.state, FEATURE_NAMES.inverterState, language, COUPLES.text, KIND.text),
    feature(ids, F.errorCode, FEATURE_NAMES.errorCode, language, COUPLES.text, KIND.text),
  );
  return device({
    name: inverter.name || pick(DEVICE_NAMES.inverter(inverter.id), language),
    externalId: ids.device,
    features,
  });
}

/**
 * @param {object} ctx
 * @param {object|null|undefined} ctx.reading the inverter's last reading (null: asleep)
 * @param {number|null} ctx.today Wh produced today (the API's, or counted)
 * @param {object} ctx.config
 */
export function inverterStates(gladys, inverter, { reading, today, config }) {
  if (reading === undefined) {
    // Never read yet (the first detail read failed): nothing to say.
    return [];
  }
  const ids = inverterIds(gladys, inverter);
  const F = INVERTER_FEATURES;
  const states = [];
  numericState(states, ids.feature(F.acPower), Math.max(reading?.acPower ?? 0, 0), 0);
  if (reading) {
    numericState(states, ids.feature(F.acVoltage), reading.acVoltage, 1);
    numericState(states, ids.feature(F.acCurrent), reading.acCurrent, 2);
    for (let input = 1; input <= inverter.dcInputs; input += 1) {
      numericState(states, ids.feature(F.dcVoltage(input)), reading.dcVoltages[input - 1], 1);
      numericState(states, ids.feature(F.dcCurrent(input)), reading.dcCurrents[input - 1], 2);
    }
  }
  numericState(states, ids.feature(F.productionToday), kwh(today), 3);
  textState(
    states,
    ids.feature(F.state),
    pick(INVERTER_STATES[inverterStateKey(reading)], config.language),
  );
  if (reading && reading.errorCode !== null) {
    const text = reading.errorCode === 0 ? ERROR_TEXTS.none : ERROR_TEXTS.code(reading.errorCode);
    textState(states, ids.feature(F.errorCode), pick(text, config.language));
  }
  return states;
}
