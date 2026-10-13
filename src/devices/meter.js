// -----------------------------------------------------------------------------
// One device per meter (Fronius Smart Meter, S0 meter...), from
// GetMeterRealtimeData (Scope=System).
//
// What a meter measures depends on where it sits (Meter_Location_Current):
// - at the feed-in point (the grid meter, the usual case), its power is the
//   grid exchange (positive: import) and its two absolute counters are the
//   energy taken from the grid and the energy fed into it. The import counter
//   is published as `energy-sensor/index`: Gladys turns it into a consumption
//   per half-hour and a cost, which feeds its Energy screens — it is what the
//   supplier bills. The export counter is a `grid-sensor/output-index`,
//   which Gladys never counts as consumption.
// - on the consumption path, its power is the house consumption (the meter
//   counts it negative: the sign is flipped). Its counters are not published:
//   which of the two is the consumption is not documented well enough to
//   feed an energy graph with it.
// - elsewhere (external generator, sub-load), its power as the meter signs it.
// -----------------------------------------------------------------------------

import { DEVICE_NAMES, FEATURE_NAMES, pick } from '../i18n.js';
import { COUPLES, KIND, device, feature, kwh, numericState } from './helpers.js';

export const METER_TYPE = 'meter';

export const METER_FEATURES = {
  power: 'power',
  phasePower: (phase) => `power_phase_${phase}`,
  phaseVoltage: (phase) => `voltage_phase_${phase}`,
  importIndex: 'import_index',
  exportIndex: 'export_index',
};

export const meterIds = (gladys, meter) => gladys.externalIds(METER_TYPE, meter.platformId);

/** How the power of a meter is published, from where it sits. */
function powerOf(meter) {
  if (meter.locationKind === 'grid') {
    return { name: FEATURE_NAMES.gridPower, couple: COUPLES.gridPower, sign: 1 };
  }
  if (meter.locationKind === 'load') {
    return { name: FEATURE_NAMES.homePower, couple: COUPLES.homePower, sign: -1 };
  }
  return { name: FEATURE_NAMES.meterPower, couple: COUPLES.power, sign: 1 };
}

const hasIndexes = (meter) => meter.locationKind === 'grid' && meter.hasIndexes;

export function buildMeter(gladys, meter, config) {
  const ids = meterIds(gladys, meter);
  const { language } = config;
  const F = METER_FEATURES;
  const power = powerOf(meter);
  // A meter whose total can be negative keeps symmetric display bounds.
  const powerKind = power.couple === COUPLES.homePower ? KIND.power : KIND.signedPower;
  const features = [feature(ids, F.power, power.name, language, power.couple, powerKind)];
  // A three-phase meter: its phases. A single-phase one: the total says it all.
  if (meter.phases > 1) {
    for (let phase = 1; phase <= meter.phases; phase += 1) {
      features.push(
        feature(
          ids,
          F.phasePower(phase),
          FEATURE_NAMES.phasePower(phase),
          language,
          COUPLES.power,
          KIND.signedPower,
        ),
      );
    }
  }
  for (let phase = 1; phase <= meter.phases; phase += 1) {
    features.push(
      feature(
        ids,
        F.phaseVoltage(phase),
        FEATURE_NAMES.phaseVoltage(phase),
        language,
        COUPLES.voltage,
        KIND.acVoltage,
      ),
    );
  }
  if (hasIndexes(meter)) {
    features.push(
      feature(
        ids,
        F.importIndex,
        FEATURE_NAMES.importIndex,
        language,
        COUPLES.gridImportIndex,
        KIND.index,
      ),
      feature(
        ids,
        F.exportIndex,
        FEATURE_NAMES.exportIndex,
        language,
        COUPLES.gridExportIndex,
        KIND.index,
      ),
    );
  }
  return device({
    name: meter.model
      ? `${meter.model.startsWith('Fronius') ? '' : 'Fronius '}${meter.model}`
      : pick(DEVICE_NAMES.meter(meter.index), language),
    externalId: ids.device,
    features,
  });
}

/**
 * @param {object} ctx
 * @param {object|undefined} ctx.reading the meter's last reading
 */
export function meterStates(gladys, meter, { reading }) {
  if (!reading) {
    return [];
  }
  const ids = meterIds(gladys, meter);
  const F = METER_FEATURES;
  const { sign } = powerOf(meter);
  const states = [];
  const signed = (value) => (value === null ? null : sign * value);
  const total = signed(reading.power);
  numericState(
    states,
    ids.feature(F.power),
    sign < 0 && total !== null ? Math.max(total, 0) : total,
    0,
  );
  if (meter.phases > 1) {
    for (let phase = 1; phase <= meter.phases; phase += 1) {
      numericState(
        states,
        ids.feature(F.phasePower(phase)),
        signed(reading.phases[phase - 1].power),
        0,
      );
    }
  }
  for (let phase = 1; phase <= meter.phases; phase += 1) {
    numericState(states, ids.feature(F.phaseVoltage(phase)), reading.phases[phase - 1].voltage, 1);
  }
  if (hasIndexes(meter)) {
    // An index never goes back to zero: a missing counter publishes nothing.
    if (reading.energyPlus) {
      numericState(states, ids.feature(F.importIndex), kwh(reading.energyPlus), 3);
    }
    if (reading.energyMinus) {
      numericState(states, ids.feature(F.exportIndex), kwh(reading.energyMinus), 3);
    }
  }
  return states;
}
