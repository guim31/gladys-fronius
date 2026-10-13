// -----------------------------------------------------------------------------
// A whole integration under test: the app wired to the SDK's fake Gladys and
// to a fake Fronius system, a clock the test moves, an in-memory /data and a
// logger that records every line.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createApp } from '../../src/app.js';
import { createMemoryStore } from '../../src/store.js';
import { createFakeFronius } from './fakeFronius.js';

export const TEST_HOST = '192.0.2.10';
// A summer morning in Paris, panels producing.
export const MORNING = Date.parse('2026-06-21T08:00:00Z');

/** A logger recording its lines: `{ level, text }`. */
export function createRecordingLogger() {
  const lines = [];
  const write =
    (level) =>
    (...args) =>
      lines.push({
        level,
        text: args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' '),
      });
  const logger = {
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
    child: () => logger,
  };
  return { logger, lines, at: (level) => lines.filter((line) => line.level === level) };
}

export function createClock(start = MORNING) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/**
 * @param {object} [options]
 * @param {string} [options.system] a directory of test/fixtures/fronius
 * @param {object} [options.config] config values (host defaults to TEST_HOST)
 * @param {boolean} [options.night] serve the night answers
 * @param {boolean} [options.create] the user adds every discovered device
 * @param {boolean} [options.timers] run the app's refresh timer
 * @param {object} [options.store]
 * @param {object} [options.clock]
 * @param {Function} [options.before] (fronius) => void, before the connection
 */
export async function createWorld({
  system = 'symo',
  config = {},
  night = false,
  create = true,
  timers = false,
  store = createMemoryStore(),
  clock = createClock(),
  before,
} = {}) {
  const fronius = createFakeFronius(system, { night });
  before?.(fronius);
  const logs = createRecordingLogger();
  const gladys = createFakeGladys({ config: { host: TEST_HOST, ...config } });
  const app = createApp({
    gladys,
    store,
    transport: fronius.get,
    logger: logs.logger,
    now: clock.now,
    timers,
    timeZone: 'Europe/Paris',
  });
  app.register();
  await gladys.connect();
  if (create) {
    for (const device of gladys.fake.discoveredDevices) {
      await gladys.fake.deviceCreated(device);
    }
  }
  return {
    gladys,
    app,
    fronius,
    logs,
    clock,
    store,
    /** The published device whose external id contains `fragment`. */
    device(fragment) {
      return gladys.fake.discoveredDevices.find((device) => device.external_id.includes(fragment));
    },
    /** The last state of `<device fragment>` + `:<feature key>`. */
    state(deviceFragment, key) {
      const device = this.device(deviceFragment);
      return gladys.fake.lastState(`${device.external_id}:${key}`);
    },
  };
}
