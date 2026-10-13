// -----------------------------------------------------------------------------
// Scene triggers: things that HAPPEN, worth more than a condition on a state.
//
// - `inverter_error`: an inverter goes into fault. One event per transition,
//   carrying the error code; at most one every 10 minutes per inverter, so an
//   inverter flapping between fault and restart does not flood the scenes.
//   The dusk codes of a Symo (306, 307: PV voltage too low, with a "startup"
//   status) are not faults and fire nothing.
// - `battery_full` / `battery_empty`: the charge level reaches the configured
//   threshold. Hysteresis of 5 points: a battery hovering at 99-100 % fires
//   once, and again only after it went down to 95 %. A device-state trigger
//   on the charge level cannot do that.
//
// "Solar surplus above X W" is not a trigger: the core's device-state trigger
// on the system's "Grid export" feature already has the threshold and the
// duration (doc: scene examples).
//
// No event on the first reading after a start: nothing has changed yet, and a
// restart must not replay the "battery full" of the morning.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { inverterIds, isInFault } from './devices/inverter.js';
import { batteryIds } from './devices/battery.js';

export const SCENE_TRIGGERS = {
  inverterError: 'inverter_error',
  batteryFull: 'battery_full',
  batteryEmpty: 'battery_empty',
};
export const SCENE_TRIGGER_KEYS = Object.values(SCENE_TRIGGERS);

export const FAULT_EVENT_GAP_MS = 10 * 60 * 1000;
export const BATTERY_HYSTERESIS = 5;

/**
 * @param {object} options
 * @param {object} options.gladys
 * @param {object} [options.logger]
 * @param {() => number} [options.now]
 */
export function createTriggerWatcher({
  gladys,
  logger = createLogger({ name: 'triggers' }),
  now = () => Date.now(),
}) {
  const inverters = new Map(); // platformId → { fault, lastEventAt }
  const batteries = new Map(); // platformId → { fullArmed, emptyArmed }

  async function fire(key, data) {
    try {
      await gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Scene event ${key} refused by Gladys (${err.message})`);
    }
  }

  async function watchInverters(inventory, snapshot) {
    if (!snapshot.detailsFresh) {
      return;
    }
    for (const inverter of inventory.inverters) {
      const reading = snapshot.inverters[inverter.id];
      if (reading === undefined) {
        continue;
      }
      const fault = isInFault(reading);
      const previous = inverters.get(inverter.platformId);
      inverters.set(inverter.platformId, {
        fault,
        lastEventAt: previous?.lastEventAt ?? -Infinity,
      });
      if (!previous || previous.fault || !fault) {
        continue;
      }
      if (now() - previous.lastEventAt < FAULT_EVENT_GAP_MS) {
        logger.debug(`Inverter ${inverter.id} in fault again: event skipped (too soon)`);
        continue;
      }
      inverters.get(inverter.platformId).lastEventAt = now();
      logger.warn(
        `Inverter ${inverter.name ?? inverter.id} in fault (status ${reading.statusCode}, error ${reading.errorCode})`,
      );
      await fire(SCENE_TRIGGERS.inverterError, {
        device: inverterIds(gladys, inverter).device,
        inverter: inverter.name ?? inverter.id,
        error_code: reading.errorCode ?? 0,
      });
    }
  }

  async function watchBatteries(inventory, snapshot, config) {
    if (!snapshot.detailsFresh) {
      return;
    }
    const full = config.batteryFullLevel;
    const empty = config.batteryEmptyLevel;
    for (const storage of inventory.storages) {
      const reading = snapshot.storages.find((entry) => entry.index === storage.index);
      if (!reading || reading.soc === null) {
        continue;
      }
      const soc = Math.round(reading.soc);
      const state = batteries.get(storage.platformId);
      if (!state) {
        batteries.set(storage.platformId, { fullArmed: soc < full, emptyArmed: soc > empty });
        continue;
      }
      const data = {
        device: batteryIds(gladys, storage).device,
        battery: storage.model ?? storage.index,
        level: reading.soc,
      };
      if (state.fullArmed && soc >= full) {
        state.fullArmed = false;
        logger.debug(`Battery ${storage.index} full (${soc} %)`);
        await fire(SCENE_TRIGGERS.batteryFull, data);
      } else if (!state.fullArmed && soc <= full - BATTERY_HYSTERESIS) {
        state.fullArmed = true;
      }
      if (state.emptyArmed && soc <= empty) {
        state.emptyArmed = false;
        logger.debug(`Battery ${storage.index} empty (${soc} %)`);
        await fire(SCENE_TRIGGERS.batteryEmpty, data);
      } else if (!state.emptyArmed && soc >= empty + BATTERY_HYSTERESIS) {
        state.emptyArmed = true;
      }
    }
  }

  return {
    /** Compare a new snapshot with the previous ones and fire what happened. */
    async evaluate(inventory, snapshot, config) {
      await watchInverters(inventory, snapshot);
      await watchBatteries(inventory, snapshot, config);
    },
    /** Another system was configured: forget the previous states. */
    reset() {
      inverters.clear();
      batteries.clear();
    },
  };
}
