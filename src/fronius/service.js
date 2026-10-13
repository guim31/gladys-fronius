// -----------------------------------------------------------------------------
// What the integration knows about the Fronius system: its inventory (which
// devices exist) and its latest readings (the snapshot).
//
// Inventory. Read by `discover()`: the logger (Datamanager) or, on a GEN24 /
// Tauro that has none, the first inverter gives the system its identity; the
// inverters, meters and batteries come from their system-scope endpoints.
// A capability needs a reading, not a key: a system "has a grid meter" when
// the power flow carries a grid power or a meter sits at the feed-in point.
// What was seen once stays known for the life of the system — an inverter
// asleep at night, a meter that missed one answer, must not make a device
// disappear from the Discovery tab — and the inventory is kept in /data, so
// the devices are published again after a restart even if the Datamanager
// is down.
//
// Snapshot. `refresh()` reads the power flow at every cycle (one light
// request), and the per-device endpoints (each inverter, the meters, the
// batteries) at most once a minute: that is the pace Home Assistant uses,
// and the Datamanager 2.0 is slow.
// -----------------------------------------------------------------------------

import {
  parseInverterInfo,
  parseInverterRealtime,
  parseLoggerInfo,
  parseMeters,
  parsePowerFlow,
  parseStorages,
} from './parse.js';
import { API_PATHS, DEVICE_NOT_AVAILABLE_CODE, FroniusError } from './client.js';

export const DETAILS_PERIOD_MS = 60 * 1000;
const STORE_KEY = 'inventory';

/** A platform id usable inside an external id (no colon, no space). */
export function sanitizeId(value) {
  return String(value)
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-');
}

/**
 * @param {object} options
 * @param {{ baseUrl: string, get: (path: string) => Promise<object> }} options.client
 * @param {{ read: Function, write: Function }} options.store
 * @param {() => number} [options.now]
 */
export function createFroniusService({ client, store, now = () => Date.now() }) {
  let inventory = null;
  let snapshot = null;
  let detailsAt = null;

  /** An optional endpoint: "not supported" is an empty answer, not an error. */
  async function optional(path, parse) {
    try {
      return parse(await client.get(path));
    } catch (err) {
      if (err instanceof FroniusError && err.notSupported) {
        return parse({});
      }
      throw err;
    }
  }

  /** One inverter: null while it sleeps (status 12, "device not available"). */
  async function readInverter(id) {
    try {
      return parseInverterRealtime(await client.get(API_PATHS.inverter(id)));
    } catch (err) {
      if (
        err instanceof FroniusError &&
        err.kind === 'api' &&
        err.apiCode === DEVICE_NOT_AVAILABLE_CODE
      ) {
        return null;
      }
      throw err;
    }
  }

  /**
   * The logger, null when the system has none (GEN24 / Tauro: "not
   * supported"). Any other failure is thrown: taking it for "no logger" would
   * name the system after its first inverter, and change every external id.
   */
  async function readLogger() {
    try {
      return parseLoggerInfo(await client.get(API_PATHS.loggerInfo));
    } catch (err) {
      if (err instanceof FroniusError && err.notSupported) {
        return null;
      }
      throw err;
    }
  }

  /** Every per-device endpoint; an endpoint that fails keeps its last values. */
  async function readDetails(inverterIds, previous) {
    const errors = [];
    const inverters = { ...(previous?.inverters ?? {}) };
    for (const id of inverterIds) {
      try {
        inverters[id] = await readInverter(id);
      } catch (err) {
        errors.push({ endpoint: `inverter ${id}`, err });
      }
    }
    let meters = previous?.meters ?? [];
    try {
      meters = await optional(API_PATHS.meters, parseMeters);
    } catch (err) {
      errors.push({ endpoint: 'meters', err });
    }
    let storages = previous?.storages ?? [];
    try {
      storages = await optional(API_PATHS.storages, parseStorages);
    } catch (err) {
      errors.push({ endpoint: 'storages', err });
    }
    return { inverters, meters, storages, errors };
  }

  async function persist() {
    await store.write(STORE_KEY, inventory).catch(() => {});
  }

  return {
    get inventory() {
      return inventory;
    },
    get snapshot() {
      return snapshot;
    },

    /** The inventory kept in /data, when it was read from the same address. */
    async load() {
      const saved = await store.read(STORE_KEY);
      if (saved?.host === client.baseUrl && saved.system?.id) {
        inventory = saved;
      }
      return inventory;
    },

    /**
     * Read the whole system and merge what it has into the inventory.
     * @returns {Promise<{ inventory: object, changed: boolean }>}
     * @throws FroniusError when the system does not answer
     */
    async discover() {
      const logger = await readLogger();
      const infos = parseInverterInfo(await client.get(API_PATHS.inverterInfo));
      const powerFlow = parsePowerFlow(await client.get(API_PATHS.powerFlow));
      // A per-device endpoint that fails here only leaves its devices out of
      // this discovery: the known ones are kept by the merge, and the next
      // discovery (every 30 minutes) adds the missing ones.
      const details = await readDetails(
        infos.map((info) => info.id),
        null,
      );
      if (!logger && inventory?.system.kind === 'datamanager') {
        // A Datamanager never stops being one: an answer without logger is
        // a glitch, not a new system.
        throw new FroniusError('the Datamanager did not describe itself', { kind: 'format' });
      }
      const firstInverter = infos.find((info) => info.uniqueId);
      const identity = logger?.uniqueId ?? firstInverter?.uniqueId;
      if (!identity) {
        throw new FroniusError('the system gives no serial number (no logger, no inverter)', {
          kind: 'format',
        });
      }
      const systemId = sanitizeId(identity);
      const found = {
        host: client.baseUrl,
        system: {
          id: systemId,
          kind: logger ? 'datamanager' : 'inverter',
          productId: logger?.productId ?? null,
          hasGrid:
            powerFlow.grid !== null ||
            details.meters.some((meter) => meter.locationKind === 'grid'),
          hasLoad: powerFlow.load !== null,
          hasBattery: powerFlow.battery !== null || details.storages.length > 0,
        },
        inverters: infos.map((info) => ({
          id: info.id,
          platformId: sanitizeId(info.uniqueId ?? `${systemId}-${info.id}`),
          name: info.name || null,
          dcInputs: dcInputCount(details.inverters[info.id]),
        })),
        meters: details.meters.map((meter) => ({
          index: meter.index,
          platformId: sanitizeId(meter.serial ?? `${systemId}-meter-${meter.index}`),
          model: meter.model,
          locationKind: meter.locationKind,
          phases: meter.phases.filter((phase) => phase.voltage !== null || phase.power !== null)
            .length,
          hasIndexes: meter.energyPlus !== null && meter.energyMinus !== null,
        })),
        storages: details.storages.map((storage) => ({
          index: storage.index,
          platformId: sanitizeId(storage.serial ?? `${systemId}-battery-${storage.index}`),
          model: storage.model,
        })),
      };
      const merged = mergeInventory(inventory?.system.id === systemId ? inventory : null, found);
      const changed = JSON.stringify(merged) !== JSON.stringify(inventory);
      inventory = merged;
      if (changed) {
        await persist();
      }
      const at = now();
      snapshot = { fetchedAt: at, powerFlow, ...details, detailsFresh: true };
      detailsAt = at;
      return { inventory, changed, errors: details.errors };
    },

    /**
     * Read the power flow, and the per-device endpoints when they are due.
     * @param {{ forceDetails?: boolean }} [options]
     * @returns {Promise<object>} the new snapshot (`errors` lists the
     *   per-device endpoints that failed this time)
     * @throws FroniusError when the power flow cannot be read
     */
    async refresh({ forceDetails = false } = {}) {
      if (!inventory) {
        throw new Error('refresh() before discover()');
      }
      const powerFlow = parsePowerFlow(await client.get(API_PATHS.powerFlow));
      const at = now();
      const due = forceDetails || detailsAt === null || at - detailsAt >= DETAILS_PERIOD_MS * 0.95;
      let details = {
        inverters: snapshot?.inverters ?? {},
        meters: snapshot?.meters ?? [],
        storages: snapshot?.storages ?? [],
        errors: [],
      };
      if (due) {
        details = await readDetails(
          inventory.inverters.map((inverter) => inverter.id),
          snapshot,
        );
        detailsAt = at;
      }
      snapshot = {
        fetchedAt: at,
        powerFlow,
        ...details,
        detailsFresh: due,
        // Hardware the inventory does not list yet (a battery just installed,
        // a second DC input that woke up): the poller runs a discovery.
        unknownHardware: due && hasUnknownHardware(inventory, details),
      };
      return snapshot;
    },

    /** Forget everything (another address was configured). */
    reset() {
      inventory = null;
      snapshot = null;
      detailsAt = null;
    },
  };
}

/** How many DC inputs (MPPT) an inverter reading shows. */
function dcInputCount(reading) {
  if (!reading) {
    return 1;
  }
  let count = 1;
  reading.dcVoltages.forEach((voltage, i) => {
    if (voltage !== null || reading.dcCurrents[i] !== null) {
      count = Math.max(count, i + 1);
    }
  });
  return count;
}

function hasUnknownHardware(inventory, details) {
  const known = (list, index) => list.some((entry) => entry.index === index);
  return (
    details.meters.some((meter) => !known(inventory.meters, meter.index)) ||
    details.storages.some((storage) => !known(inventory.storages, storage.index)) ||
    inventory.inverters.some(
      (inverter) => dcInputCount(details.inverters[inverter.id]) > inverter.dcInputs,
    )
  );
}

/** Union of what was known and what was just found: nothing is ever lost. */
export function mergeInventory(known, found) {
  if (!known) {
    return found;
  }
  const byKey = (list, key, merge) => {
    const result = list.map((entry) => ({ ...entry }));
    for (const entry of found[key]) {
      const existing = result.find((item) => item.platformId === entry.platformId);
      if (existing) {
        Object.assign(existing, merge(existing, entry));
      } else {
        result.push(entry);
      }
    }
    return result;
  };
  return {
    host: found.host,
    system: {
      ...found.system,
      hasGrid: known.system.hasGrid || found.system.hasGrid,
      hasLoad: known.system.hasLoad || found.system.hasLoad,
      hasBattery: known.system.hasBattery || found.system.hasBattery,
    },
    inverters: byKey(known.inverters, 'inverters', (a, b) => ({
      id: b.id,
      name: b.name ?? a.name,
      dcInputs: Math.max(a.dcInputs, b.dcInputs),
    })),
    meters: byKey(known.meters, 'meters', (a, b) => ({
      index: b.index,
      model: b.model ?? a.model,
      locationKind: b.locationKind,
      phases: Math.max(a.phases, b.phases),
      hasIndexes: a.hasIndexes || b.hasIndexes,
    })),
    storages: byKey(known.storages, 'storages', (a, b) => ({
      index: b.index,
      model: b.model ?? a.model,
    })),
  };
}
