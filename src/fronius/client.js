// -----------------------------------------------------------------------------
// HTTP client of the Fronius Solar API v1 (local, JSON, no authentication).
//
// - One request at a time: the Datamanager answers slowly (a few hundred ms,
//   seconds for a Datamanager 2.0 relaying to several inverters) and serves
//   concurrent requests worse than sequential ones. Home Assistant serializes
//   them for the same reason.
// - Redirects are followed (3 at most): from firmware 1.35.4-1, a GEN24
//   redirects http:// to https:// with a self-signed certificate. That
//   certificate cannot be checked (no CA, no stable name), so HTTPS skips the
//   check. Nothing secret travels — the API has no authentication and only
//   reads — and the target is the address the user typed.
// - A body whose `Head.Status.Code` is not 0 is an API error (FroniusError
//   with `apiCode`): 11/255 "not supported", 12 "device not available"
//   (inverter asleep), 8 "LNRequestTimeout" (a flaky Datamanager-to-inverter
//   link, retried once).
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';

export const API_PATHS = {
  loggerInfo: '/solar_api/v1/GetLoggerInfo.cgi',
  inverterInfo: '/solar_api/v1/GetInverterInfo.cgi',
  powerFlow: '/solar_api/v1/GetPowerFlowRealtimeData.fcgi',
  inverter: (id) =>
    `/solar_api/v1/GetInverterRealtimeData.cgi?Scope=Device&DeviceId=${encodeURIComponent(id)}&DataCollection=CommonInverterData`,
  meters: '/solar_api/v1/GetMeterRealtimeData.cgi?Scope=System',
  storages: '/solar_api/v1/GetStorageRealtimeData.cgi?Scope=System',
};

// Status codes of the Solar API that mean "this system has no such thing".
export const NOT_SUPPORTED_CODES = new Set([1, 11, 255]);
export const DEVICE_NOT_AVAILABLE_CODE = 12;
const LN_REQUEST_TIMEOUT_CODE = 8;

export class FroniusError extends Error {
  /**
   * @param {string} message
   * @param {{ kind: 'network'|'timeout'|'http'|'format'|'api', apiCode?: number, status?: number }} details
   */
  constructor(message, { kind, apiCode, status }) {
    super(message);
    this.name = 'FroniusError';
    this.kind = kind;
    this.apiCode = apiCode;
    this.status = status;
  }

  /** The system does not have this endpoint (no logger, no battery...). */
  get notSupported() {
    return (
      (this.kind === 'api' && NOT_SUPPORTED_CODES.has(this.apiCode)) ||
      (this.kind === 'http' && this.status === 404)
    );
  }
}

const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * One GET with node:http(s): `{ status, location, body }`. Injected in the
 * tests (the fake transport serves fixtures without any socket).
 * @param {string} url
 * @param {{ timeoutMs: number }} options
 */
export function httpGet(url, { timeoutMs }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === 'https:' ? https : http;
    const request = lib.get(
      target,
      {
        timeout: timeoutMs,
        headers: { accept: 'application/json' },
        // Self-signed certificate of the GEN24 (see the header of this file).
        ...(target.protocol === 'https:' ? { rejectUnauthorized: false } : {}),
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            request.destroy(new FroniusError('response too large', { kind: 'format' }));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            location: response.headers.location,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        response.on('error', reject);
      },
    );
    request.on('timeout', () =>
      request.destroy(new FroniusError(`no answer within ${timeoutMs} ms`, { kind: 'timeout' })),
    );
    request.on('error', reject);
  });
}

/**
 * @param {object} options
 * @param {string} options.baseUrl e.g. http://192.0.2.10 (no trailing slash)
 * @param {number} [options.timeoutMs]
 * @param {typeof httpGet} [options.get] the transport
 */
export function createClient({ baseUrl, timeoutMs = 10000, get = httpGet }) {
  // The queue: every request waits for the previous one.
  let queue = Promise.resolve();

  async function fetchOnce(path) {
    let url = `${baseUrl}${path}`;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      let response;
      try {
        response = await get(url, { timeoutMs });
      } catch (err) {
        if (err instanceof FroniusError) {
          throw err;
        }
        throw new FroniusError(err.code ? `${err.code}` : err.message, { kind: 'network' });
      }
      if (response.status >= 300 && response.status < 400 && response.location) {
        url = new URL(response.location, url).toString();
        continue;
      }
      if (response.status !== 200) {
        throw new FroniusError(`HTTP ${response.status}`, {
          kind: 'http',
          status: response.status,
        });
      }
      let body;
      try {
        body = JSON.parse(response.body);
      } catch {
        throw new FroniusError('the answer is not JSON: is this a Fronius device?', {
          kind: 'format',
        });
      }
      const status = body?.Head?.Status;
      if (!status || typeof status.Code !== 'number') {
        throw new FroniusError('the answer is not a Solar API v1 answer', { kind: 'format' });
      }
      if (status.Code !== 0) {
        throw new FroniusError(
          `API status ${status.Code}${status.Reason ? ` (${status.Reason})` : ''}`,
          {
            kind: 'api',
            apiCode: status.Code,
          },
        );
      }
      return body;
    }
    throw new FroniusError('too many redirects', { kind: 'http' });
  }

  async function fetchJson(path) {
    try {
      return await fetchOnce(path);
    } catch (err) {
      if (err.kind === 'api' && err.apiCode === LN_REQUEST_TIMEOUT_CODE) {
        return fetchOnce(path);
      }
      throw err;
    }
  }

  return {
    baseUrl,
    /**
     * GET a Solar API path, after the requests already queued.
     * @param {string} path
     * @returns {Promise<object>} the whole JSON body
     */
    get(path) {
      const run = queue.then(() => fetchJson(path));
      queue = run.catch(() => {});
      return run;
    },
  };
}
