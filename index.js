// -----------------------------------------------------------------------------
// Entry point of the Fronius integration: SDK wiring only.
//
// Everything else lives in src/app.js (handlers, refresh cycle), src/fronius/
// (Solar API client and parsers) and src/devices/ (what Gladys receives).
//
// Environment variables provided by the Gladys supervisor to the container:
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR
// (read by the SDK), TZ (the time zone of Gladys, for "today"), LOG_LEVEL.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';
import { createFileStore } from './src/store.js';

const gladys = new GladysIntegration();

// /data is the only writable volume of the container (read-only rootfs).
const app = createApp({
  gladys,
  store: createFileStore(process.env.FRONIUS_DATA_DIR || '/data'),
});

// Handlers are registered before connect().
app.register();

gladys.handleShutdown(async (signal) => {
  logger.info(`Received ${signal}: stopping`);
  await app.stop();
});

logger.info('Starting the Fronius integration');
gladys.connect().catch((err) => {
  logger.error(`Initial connection to Gladys failed (${err.message})`);
  process.exit(1);
});
