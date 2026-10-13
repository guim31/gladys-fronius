// -----------------------------------------------------------------------------
// The integration, wired to a Gladys client (the SDK's GladysIntegration, or
// its fake Gladys in the tests).
//
// Life of the integration:
// 1. On connection and on every configuration change: the devices kept in
//    /data are published at once, then the system is read whole
//    (discovery) and its devices published again.
// 2. Every refresh interval (10 to 60 s), the container's own timer runs a
//    cycle: power flow (and, once a minute, inverters, meters, batteries),
//    then the states that changed, the scene events, the widget nudge.
//    Gladys's onPoll is only a fallback, skipped when the timer just ran
//    (GladysAssistant/Gladys#3198: a device created without should_poll is
//    never polled by Gladys 5.2).
// 3. Only the devices the user added are refreshed: without any, nothing is
//    read (except for the widget, at most once per interval).
//
// Logs: info for the life cycle only (start, system found, lost and back,
// one line per user action); a normal cycle writes debug lines only.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { DEFAULT_CONFIG, isConfigured, normalizeConfig } from './config.js';
import { createClient, httpGet } from './fronius/client.js';
import { createFroniusService } from './fronius/service.js';
import { buildDevices, buildStates, deviceIds, producedToday } from './devices/index.js';
import { createDayEnergyTracker } from './dayEnergy.js';
import { createTriggerWatcher } from './triggers.js';
import { createIssueLog } from './issues.js';
import { MESSAGES } from './i18n.js';
import { WIDGET_KEY, buildFlowContent, noDataContent, notConfiguredContent } from './widgets.js';

export const ACTIONS = { testConnection: 'test_connection' };
export const WIDGETS = [WIDGET_KEY];

// A value that does not change is published again after this delay, so
// Gladys never shows "no recent value" (it does past 48 hours).
export const HEARTBEAT_MS = 6 * 60 * 60 * 1000;
// The inventory is read again this often (an inverter that woke up, a
// battery installed): cheap, and it never removes a device.
export const REDISCOVERY_MS = 30 * 60 * 1000;
// The widget content follows the states: one nudge a minute at most.
const WIDGET_NUDGE_MS = 60 * 1000;

/**
 * @param {object} options
 * @param {object} options.gladys GladysIntegration or the SDK's fake Gladys
 * @param {{ read: Function, write: Function }} options.store /data
 * @param {Function} [options.transport] HTTP GET (node:http by default)
 * @param {object} [options.logger]
 * @param {() => number} [options.now]
 * @param {boolean} [options.timers] run the refresh timer (tests may drive cycles by hand)
 * @param {string} [options.timeZone] defaults to TZ
 */
export function createApp({
  gladys,
  store,
  transport = httpGet,
  logger = createLogger({ name: 'fronius' }),
  now = () => Date.now(),
  timers = true,
  timeZone = process.env.TZ || undefined,
}) {
  const issues = createIssueLog(logger);
  const dayEnergy = createDayEnergyTracker({ store, timeZone });
  const triggers = createTriggerWatcher({ gladys, logger, now });

  let config = normalizeConfig(DEFAULT_CONFIG);
  let service = null;
  let timer = null;
  let stopped = false;
  let running = null; // the cycle in progress
  let lastCycleAt = -Infinity;
  let discoveredAt = -Infinity;
  let lastNudgeAt = -Infinity;
  let lastToday = { site: null, inverters: {} };
  let reachable = null; // null: not known yet

  // --- Helpers -----------------------------------------------------------------

  /** Our devices that the user added to Gladys, and their feature ids. */
  function createdOnGladys() {
    const inventory = service?.inventory;
    const features = new Set();
    const devices = new Set();
    if (!inventory) {
      return { devices, features };
    }
    const ours = deviceIds(gladys, inventory);
    const all = new Set([ours.system, ...ours.inverters, ...ours.meters, ...ours.batteries]);
    for (const device of gladys.devices ?? []) {
      if (all.has(device.external_id)) {
        devices.add(device.external_id);
        for (const feature of device.features ?? []) {
          features.add(feature.external_id);
        }
      }
    }
    return { devices, features };
  }

  async function setStatus(connected, message) {
    await gladys.setConnectionStatus(connected, message).catch((err) => {
      logger.debug(`Connection status not sent (${err.message})`);
    });
  }

  async function publishTransports(transport) {
    const { devices } = createdOnGladys();
    if (devices.size === 0) {
      return;
    }
    await gladys
      .publishTransports([...devices].map((external_id) => ({ external_id, transport })))
      .catch((err) => logger.debug(`Transport badges not sent (${err.message})`));
  }

  async function markReachable() {
    if (reachable === true) {
      return;
    }
    reachable = true;
    issues.ok('fronius', 'Fronius system answers again');
    await setStatus(true);
    await publishTransports('local');
  }

  async function markUnreachable(err) {
    issues.fail('fronius', `Fronius system unreachable at ${config.baseUrl} (${err.message})`);
    if (reachable === false) {
      return;
    }
    reachable = false;
    await setStatus(false, MESSAGES.unreachable(err.message));
    await publishTransports('unreachable');
  }

  async function publishDevices() {
    const devices = buildDevices(gladys, service?.inventory, config);
    if (devices.length === 0) {
      return;
    }
    try {
      await gladys.publishDiscoveredDevices(devices);
      issues.ok('publish', 'Devices accepted by Gladys again');
    } catch (err) {
      issues.fail('publish', `Gladys refused the devices (${err.message})`);
      await setStatus(false, MESSAGES.publishFailed(err.message));
    }
  }

  function describe(inventory) {
    const kind = inventory.system.kind === 'datamanager' ? 'Datamanager' : 'GEN24/Tauro';
    return (
      `${kind} ${inventory.system.id}: ${inventory.inverters.length} inverter(s), ` +
      `${inventory.meters.length} meter(s), ${inventory.storages.length} battery(ies)`
    );
  }

  /**
   * Read the whole system, publish its devices.
   * @throws the reading error (after reporting it)
   */
  async function discoverAndPublish() {
    let result;
    try {
      result = await service.discover();
    } catch (err) {
      await markUnreachable(err);
      throw err;
    }
    discoveredAt = now();
    for (const { endpoint, err } of result.errors) {
      logger.debug(`Discovery: ${endpoint} not read (${err.message})`);
    }
    // Said once per connection, and when the hardware changes.
    if (result.changed || reachable === null) {
      logger.info(`Fronius system at ${config.baseUrl}: ${describe(result.inventory)}`);
    }
    await markReachable();
    await publishDevices();
    return result;
  }

  function nudgeWidget(force = false) {
    if (!force && now() - lastNudgeAt < WIDGET_NUDGE_MS) {
      return;
    }
    lastNudgeAt = now();
    try {
      // Fire and forget: dropped by the SDK while disconnected.
      gladys.requestWidgetRefresh(WIDGET_KEY);
    } catch (err) {
      logger.debug(`Widget nudge not sent (${err.message})`);
    }
  }

  /** Publish the states of the cached snapshot (no request to Fronius). */
  async function publishSnapshot(snapshot) {
    const { features } = createdOnGladys();
    const inventory = service.inventory;
    lastToday = await producedToday(inventory, snapshot, dayEnergy, now());
    const states = buildStates(gladys, inventory, snapshot, lastToday, config).filter((state) =>
      features.has(state.device_feature_external_id),
    );
    try {
      const { count } = await gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
      issues.ok('states', 'States accepted by Gladys again');
      logger.debug(`${count} state(s) published out of ${states.length}`);
    } catch (err) {
      issues.fail('states', `States not published (${err.message})`);
    }
  }

  // --- The cycle -------------------------------------------------------------------

  async function runCycle() {
    if (!isConfigured(config) || !service || gladys.connected === false) {
      logger.debug('Cycle skipped (not configured or Gladys unreachable)');
      return;
    }
    if (!service.inventory || now() - discoveredAt >= REDISCOVERY_MS) {
      try {
        await discoverAndPublish();
      } catch {
        if (!service.inventory) {
          return;
        }
      }
    }
    const { devices } = createdOnGladys();
    if (devices.size === 0) {
      logger.debug('No Fronius device added to Gladys yet: nothing to refresh');
      return;
    }
    let snapshot;
    try {
      snapshot = await service.refresh();
    } catch (err) {
      await markUnreachable(err);
      return;
    }
    lastCycleAt = now();
    await markReachable();
    const failed = new Set(snapshot.errors.map(({ endpoint }) => endpoint));
    for (const { endpoint, err } of snapshot.errors) {
      issues.fail(endpoint, `Fronius ${endpoint} not read (${err.message})`);
    }
    if (snapshot.detailsFresh) {
      for (const endpoint of [
        'meters',
        'storages',
        ...service.inventory.inverters.map((i) => `inverter ${i.id}`),
      ]) {
        if (!failed.has(endpoint)) {
          issues.ok(endpoint, `Fronius ${endpoint} read again`);
        }
      }
    }
    if (snapshot.unknownHardware) {
      logger.debug('New hardware in the readings: discovery');
      await discoverAndPublish().catch(() => {});
    }
    await publishSnapshot(snapshot);
    await triggers.evaluate(service.inventory, snapshot, config);
    nudgeWidget();
  }

  /** One cycle at a time: a caller arriving during a cycle waits for it. */
  function cycle() {
    if (!running) {
      running = runCycle()
        .catch((err) => logger.error(`Refresh cycle failed (${err.message})`))
        .finally(() => {
          running = null;
        });
    }
    return running;
  }

  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (!timers || stopped || !isConfigured(config)) {
      return;
    }
    timer = setTimeout(async () => {
      timer = null;
      await cycle();
      schedule();
    }, config.pollIntervalMs);
  }

  // --- Configuration -------------------------------------------------------------

  async function applyConfig(raw) {
    const next = normalizeConfig(raw ?? {});
    const hostChanged = next.baseUrl !== config.baseUrl || !service;
    config = next;
    if (!isConfigured(config)) {
      clearTimeout(timer);
      service = null;
      logger.info(
        config.hostValid
          ? 'Waiting for the address of the Fronius system'
          : 'Invalid Fronius address',
      );
      await setStatus(false, config.hostValid ? MESSAGES.notConfigured : MESSAGES.invalidHost);
      return;
    }
    if (hostChanged) {
      service = createFroniusService({
        client: createClient({ baseUrl: config.baseUrl, get: transport }),
        store,
        now,
      });
      triggers.reset();
      reachable = null;
      discoveredAt = -Infinity;
      if (await service.load()) {
        // Known from a previous run: the devices are there even if the
        // system does not answer right now.
        await publishDevices();
      }
    }
    // The discovery has just read everything: its states are published as
    // they are, the timer takes over from there.
    await discoverAndPublish().catch(() => {});
    if (service.snapshot && createdOnGladys().devices.size > 0) {
      await publishSnapshot(service.snapshot);
    }
    schedule();
  }

  // --- Handlers --------------------------------------------------------------------

  const handlers = {
    async scanRequest() {
      logger.info('Discovery requested from Gladys');
      if (!service) {
        return;
      }
      await discoverAndPublish().catch(() => publishDevices());
    },

    /** The core's onPoll: a fallback, skipped while the timer is on time. */
    async poll(device) {
      const { devices } = createdOnGladys();
      if (!devices.has(device.external_id)) {
        return;
      }
      // The last reading, whoever made it (timer, discovery, widget).
      const age = now() - Math.max(lastCycleAt, service.snapshot?.fetchedAt ?? -Infinity);
      if (age < config.pollIntervalMs * 0.9) {
        logger.debug(`onPoll ${device.external_id}: read ${age} ms ago, skipped`);
        return;
      }
      await cycle();
    },

    /** A device was just added (or updated): Gladys needs all its states now. */
    async deviceChanged(device) {
      const { devices } = createdOnGladys();
      if (!service || !devices.has(device.external_id)) {
        return;
      }
      if (service.snapshot) {
        await publishSnapshot(service.snapshot);
      } else {
        await cycle();
      }
      nudgeWidget(true);
    },

    async testConnection() {
      logger.info('Action: test the connection');
      if (!isConfigured(config)) {
        return config.hostValid ? MESSAGES.notConfigured : MESSAGES.invalidHost;
      }
      try {
        const { inventory } = await discoverAndPublish();
        return MESSAGES.found({
          datamanager: inventory.system.kind === 'datamanager',
          inverters: inventory.inverters.length,
          meters: inventory.meters.length,
          batteries: inventory.storages.length,
        });
      } catch (err) {
        return MESSAGES.unreachable(err.message);
      }
    },

    async widgetGet() {
      if (!isConfigured(config) || !service) {
        return notConfiguredContent();
      }
      const { features, devices } = createdOnGladys();
      // Without any device added, no cycle runs: read for the widget, at the
      // configured pace at most.
      if (service.inventory && devices.size === 0) {
        const age = now() - (service.snapshot?.fetchedAt ?? -Infinity);
        if (age >= config.pollIntervalMs) {
          await service
            .refresh()
            .then(async (snapshot) => {
              lastToday = await producedToday(service.inventory, snapshot, dayEnergy, now());
            })
            .catch((err) => logger.debug(`Widget: Fronius not read (${err.message})`));
        }
      }
      if (!service.inventory || !service.snapshot) {
        return noDataContent();
      }
      return buildFlowContent({
        gladys,
        inventory: service.inventory,
        snapshot: service.snapshot,
        siteToday: service.snapshot.powerFlow.energyDay ?? lastToday.site,
        created: features,
        timeZone,
      });
    },
  };

  return {
    handlers,
    get config() {
      return config;
    },
    get service() {
      return service;
    },
    cycle,

    /** Register every handler on the Gladys client (before connect()). */
    register() {
      gladys.onScanRequest(() => handlers.scanRequest());
      gladys.onPoll((device) => handlers.poll(device));
      gladys.onDeviceCreated((device) => handlers.deviceChanged(device));
      gladys.onDeviceUpdated((device) => handlers.deviceChanged(device));
      gladys.onAction(ACTIONS.testConnection, () => handlers.testConnection());
      gladys.onWidgetGet(WIDGET_KEY, () => handlers.widgetGet());
      gladys.onConfigUpdated(async (raw) => {
        logger.info('Configuration updated');
        await applyConfig(raw);
      });
      gladys.on('connected', async () => {
        try {
          await applyConfig(await gladys.getConfig());
        } catch (err) {
          logger.error(`Initialization failed (${err.message})`);
        }
      });
    },

    async stop() {
      stopped = true;
      clearTimeout(timer);
      timer = null;
      await running;
      await dayEnergy.flush(now());
    },
  };
}
