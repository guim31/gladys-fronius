// -----------------------------------------------------------------------------
// The devices of a Fronius system, built from its inventory, and their states,
// built from the latest snapshot.
//
// One system device (power flows), one device per inverter, per meter and per
// battery. External ids come from the serial numbers the system gives (logger,
// inverter UniqueID, meter and battery serials): they never change.
// -----------------------------------------------------------------------------

import { buildSystem, systemIds, systemStates } from './system.js';
import { buildInverter, inverterIds, inverterStates } from './inverter.js';
import { buildMeter, meterIds, meterStates } from './meter.js';
import { buildBattery, batteryIds, batteryStates } from './battery.js';

/** Every device the system has, ready for publishDiscoveredDevices. */
export function buildDevices(gladys, inventory, config) {
  if (!inventory) {
    return [];
  }
  return [
    buildSystem(gladys, inventory, config),
    ...inventory.inverters.map((inverter) => buildInverter(gladys, inverter, config)),
    ...inventory.meters.map((meter) => buildMeter(gladys, meter, config)),
    ...inventory.storages.map((storage) => buildBattery(gladys, storage, config)),
  ];
}

/** The device external ids of the system, by kind. */
export function deviceIds(gladys, inventory) {
  return {
    system: systemIds(gladys, inventory).device,
    inverters: inventory.inverters.map((inverter) => inverterIds(gladys, inverter).device),
    meters: inventory.meters.map((meter) => meterIds(gladys, meter).device),
    batteries: inventory.storages.map((storage) => batteryIds(gladys, storage).device),
  };
}

const findByIndex = (list, index) => list?.find((entry) => entry.index === index);

/**
 * Energy produced today, by counter: the API's day energy when it has one
 * (Datamanager), counted from the lifetime counter otherwise (GEN24).
 * @returns {Promise<{ site: number|null, inverters: Record<string, number|null> }>} Wh
 */
export async function producedToday(inventory, snapshot, dayEnergy, now) {
  const flow = snapshot.powerFlow;
  let site = flow.energyDay;
  if (site === null && flow.energyTotal) {
    site = await dayEnergy.update('site', flow.energyTotal, (flow.pv ?? 0) > 0, now);
  }
  const inverters = {};
  for (const inverter of inventory.inverters) {
    const reading = snapshot.inverters[inverter.id];
    let today = reading?.energyDay ?? null;
    if (today === null && reading?.energyTotal) {
      today = await dayEnergy.update(
        `inverter:${inverter.platformId}`,
        reading.energyTotal,
        (reading.acPower ?? 0) > 0,
        now,
      );
    }
    inverters[inverter.id] = today;
  }
  return { site, inverters };
}

/**
 * The states of every device, from a snapshot.
 * @param {{ site: number|null, inverters: Record<string, number|null> }} today
 */
export function buildStates(gladys, inventory, snapshot, today, config) {
  return [
    ...systemStates(gladys, inventory, { snapshot, siteToday: today.site }),
    ...inventory.inverters.flatMap((inverter) =>
      inverterStates(gladys, inverter, {
        reading: snapshot.inverters[inverter.id],
        today: today.inverters[inverter.id] ?? null,
        config,
      }),
    ),
    ...inventory.meters.flatMap((meter) =>
      meterStates(gladys, meter, { reading: findByIndex(snapshot.meters, meter.index) }),
    ),
    ...inventory.storages.flatMap((storage) =>
      batteryStates(gladys, storage, { reading: findByIndex(snapshot.storages, storage.index) }),
    ),
  ];
}
