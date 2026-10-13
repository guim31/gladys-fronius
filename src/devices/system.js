// -----------------------------------------------------------------------------
// The system device: the power flows of the whole site, from
// GetPowerFlowRealtimeData (one per Datamanager, or per GEN24 / Tauro).
//
// The API signs the flows; the device publishes positive values only, one
// feature per direction, so a scene reads "export above 1500 W" without
// knowing a sign convention:
//   P_PV   > 0 solar production
//   P_Load < 0 the house consuming (-P_Load is the consumption)
//   P_Grid > 0 import from the grid, < 0 export
//   P_Akku > 0 the battery discharging, < 0 charging
// A feature exists only when the system measures it: no meter, no house
// consumption nor grid exchange; no battery, no battery flows.
// -----------------------------------------------------------------------------

import { DEVICE_NAMES, FEATURE_NAMES, pick } from '../i18n.js';
import { COUPLES, KIND, device, feature, kwh, numericState, positive } from './helpers.js';

export const SYSTEM_TYPE = 'system';

export const SYSTEM_FEATURES = {
  pvPower: 'pv_power',
  homePower: 'home_power',
  gridImport: 'grid_import_power',
  gridExport: 'grid_export_power',
  batteryCharge: 'battery_charge_power',
  batteryDischarge: 'battery_discharge_power',
  productionToday: 'production_today',
  productionTotal: 'production_total',
};

export const systemIds = (gladys, inventory) =>
  gladys.externalIds(SYSTEM_TYPE, inventory.system.id);

export function buildSystem(gladys, inventory, config) {
  const ids = systemIds(gladys, inventory);
  const { language } = config;
  const { hasGrid, hasLoad, hasBattery } = inventory.system;
  const F = SYSTEM_FEATURES;
  const features = [
    feature(ids, F.pvPower, FEATURE_NAMES.pvPower, language, COUPLES.productionPower, KIND.power),
  ];
  if (hasLoad) {
    features.push(
      feature(ids, F.homePower, FEATURE_NAMES.homePower, language, COUPLES.homePower, KIND.power),
    );
  }
  if (hasGrid) {
    features.push(
      feature(
        ids,
        F.gridImport,
        FEATURE_NAMES.gridImport,
        language,
        COUPLES.gridImportPower,
        KIND.power,
      ),
      feature(
        ids,
        F.gridExport,
        FEATURE_NAMES.gridExport,
        language,
        COUPLES.gridExportPower,
        KIND.power,
      ),
    );
  }
  if (hasBattery) {
    features.push(
      feature(
        ids,
        F.batteryCharge,
        FEATURE_NAMES.batteryCharge,
        language,
        COUPLES.batteryCharge,
        KIND.power,
      ),
      feature(
        ids,
        F.batteryDischarge,
        FEATURE_NAMES.batteryDischarge,
        language,
        COUPLES.batteryDischarge,
        KIND.power,
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
    feature(
      ids,
      F.productionTotal,
      FEATURE_NAMES.productionTotal,
      language,
      COUPLES.productionIndex,
      KIND.index,
    ),
  );
  return device({
    name: pick(DEVICE_NAMES.system, language),
    externalId: ids.device,
    features,
  });
}

/**
 * @param {object} ctx
 * @param {object} ctx.snapshot
 * @param {number|null} ctx.siteToday Wh produced today (the API's, or counted)
 */
export function systemStates(gladys, inventory, { snapshot, siteToday }) {
  const ids = systemIds(gladys, inventory);
  const flow = snapshot.powerFlow;
  const F = SYSTEM_FEATURES;
  const states = [];
  // No P_PV at night on a Datamanager: the panels produce nothing.
  numericState(states, ids.feature(F.pvPower), Math.max(flow.pv ?? 0, 0), 0);
  if (inventory.system.hasLoad && flow.load !== null) {
    numericState(states, ids.feature(F.homePower), Math.max(-flow.load, 0), 0);
  }
  if (inventory.system.hasGrid && flow.grid !== null) {
    numericState(states, ids.feature(F.gridImport), positive(flow.grid), 0);
    numericState(states, ids.feature(F.gridExport), positive(-flow.grid), 0);
  }
  if (inventory.system.hasBattery) {
    // A battery the power flow does not mention is idle.
    const battery = flow.battery ?? 0;
    numericState(states, ids.feature(F.batteryCharge), positive(-battery), 0);
    numericState(states, ids.feature(F.batteryDischarge), positive(battery), 0);
  }
  numericState(states, ids.feature(F.productionToday), kwh(siteToday), 3);
  // The lifetime counter is null on some systems at night: never publish 0
  // for it, an index that drops to zero breaks every graph.
  if (flow.energyTotal) {
    numericState(states, ids.feature(F.productionTotal), kwh(flow.energyTotal), 3);
  }
  return states;
}
