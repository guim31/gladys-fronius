// -----------------------------------------------------------------------------
// A fake Fronius system: the transport of the Solar API client, serving the
// real answers recorded in test/fixtures/fronius/<system>/ (no socket).
//
// `fronius.answers` maps an endpoint to a body, an Error to throw, or a
// `{ status, location? }` HTTP answer: a test edits it to simulate the night,
// a Datamanager that goes down, a battery being installed...
// -----------------------------------------------------------------------------

import { readFileSync, readdirSync } from 'node:fs';
import { FroniusError } from '../../src/fronius/client.js';

const FIXTURES = new URL('../fixtures/fronius/', import.meta.url);

export const SYSTEMS = readdirSync(FIXTURES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

/** One recorded answer of a system ("GetPowerFlowRealtimeData", "..._night"). */
export function fixture(system, name) {
  return JSON.parse(readFileSync(new URL(`${system}/${name}.json`, FIXTURES), 'utf8'));
}

function hasFixture(system, name) {
  return readdirSync(new URL(`${system}/`, FIXTURES)).includes(`${name}.json`);
}

/** The endpoint key of a Solar API URL ("powerFlow", "inverter:1"...). */
export function endpointOf(url) {
  const { pathname, searchParams } = new URL(url);
  const name = pathname.split('/').pop();
  if (name === 'GetInverterRealtimeData.cgi') {
    return `inverter:${searchParams.get('DeviceId')}`;
  }
  return {
    'GetLoggerInfo.cgi': 'logger',
    'GetInverterInfo.cgi': 'inverterInfo',
    'GetPowerFlowRealtimeData.fcgi': 'powerFlow',
    'GetMeterRealtimeData.cgi': 'meters',
    'GetStorageRealtimeData.cgi': 'storages',
  }[name];
}

/** The recorded answers of a system, by endpoint; `night: true` takes the night ones. */
export function recordedAnswers(system, { night = false } = {}) {
  const pick = (name) => (night && hasFixture(system, `${name}_night`) ? `${name}_night` : name);
  const answers = {
    logger: fixture(system, 'GetLoggerInfo'),
    inverterInfo: fixture(system, pick('GetInverterInfo')),
    powerFlow: fixture(system, pick('GetPowerFlowRealtimeData')),
    meters: fixture(system, 'GetMeterRealtimeData'),
    storages: fixture(system, 'GetStorageRealtimeData'),
  };
  for (const id of Object.keys(answers.inverterInfo.Body.Data)) {
    answers[`inverter:${id}`] = fixture(system, pick(`GetInverterRealtimeData_Device_${id}`));
  }
  return answers;
}

/**
 * @param {string} system a directory of test/fixtures/fronius
 * @param {{ night?: boolean }} [options]
 */
export function createFakeFronius(system, options) {
  const fronius = {
    answers: recordedAnswers(system, options),
    /** Every URL requested, in order. */
    requests: [],
    /** Count of requests per endpoint. */
    count(endpoint) {
      return fronius.requests.filter((url) => endpointOf(url) === endpoint).length;
    },
    /** Make every endpoint fail like a Datamanager switched off. */
    goDown(code = 'EHOSTUNREACH') {
      fronius.down = code;
    },
    comeBack() {
      fronius.down = null;
    },
    down: null,
    /** The transport given to createApp / createClient. */
    async get(url) {
      fronius.requests.push(url);
      if (fronius.down) {
        const err = new Error(`connect ${fronius.down}`);
        err.code = fronius.down;
        throw err;
      }
      const answer = fronius.answers[endpointOf(url)];
      if (answer === undefined) {
        return { status: 404, body: '' };
      }
      if (answer instanceof Error || answer instanceof FroniusError) {
        throw answer;
      }
      if (typeof answer.status === 'number' && !answer.Head) {
        return answer;
      }
      return { status: 200, body: JSON.stringify(answer) };
    },
  };
  return fronius;
}

/** A Solar API answer with an error status (11: not supported, 12: device asleep...). */
export function apiError(code, reason = '') {
  return { Body: { Data: {} }, Head: { Status: { Code: code, Reason: reason, UserMessage: '' } } };
}
