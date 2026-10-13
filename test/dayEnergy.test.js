// -----------------------------------------------------------------------------
// Today's production counted from a lifetime counter (GEN24): a baseline is
// taken only when it is certain (panels idle), a partial day is never
// published as a whole one, and a restart keeps the count.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDayEnergyTracker, localDay } from '../src/dayEnergy.js';
import { createMemoryStore } from '../src/store.js';

const TZ = 'Europe/Paris';
// Local times in Paris (UTC+2 in June).
const at = (day, hour, minute = 0) =>
  Date.parse(
    `2026-06-${String(day).padStart(2, '0')}T${String(hour - 2).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`,
  );

test('localDay follows the time zone of Gladys', () => {
  assert.deepEqual(localDay(Date.parse('2026-06-20T22:30:00Z'), TZ), {
    day: '2026-06-21',
    hour: 0,
  });
  assert.deepEqual(localDay(Date.parse('2026-06-20T22:30:00Z'), 'UTC'), {
    day: '2026-06-20',
    hour: 22,
  });
});

test('a start before sunrise takes the counter as the baseline of the day', async () => {
  const tracker = createDayEnergyTracker({ store: createMemoryStore(), timeZone: TZ });
  assert.equal(await tracker.update('site', 1000000, false, at(21, 5)), 0);
  assert.equal(await tracker.update('site', 1000500, true, at(21, 9)), 500);
  assert.equal(await tracker.update('site', 1012000, false, at(21, 22)), 12000);
});

test('a start while producing leaves the day unknown, until the next morning', async () => {
  const tracker = createDayEnergyTracker({ store: createMemoryStore(), timeZone: TZ });
  assert.equal(await tracker.update('site', 1000000, true, at(21, 11)), null);
  assert.equal(await tracker.update('site', 1008000, false, at(21, 21)), null);
  // The last reading of the evening, idle, is the baseline of the next day.
  assert.equal(await tracker.update('site', 1008000, true, at(22, 10)), 0);
  assert.equal(await tracker.update('site', 1010000, true, at(22, 12)), 2000);
});

test('an evening start without production leaves the day unknown (it may have produced)', async () => {
  const tracker = createDayEnergyTracker({ store: createMemoryStore(), timeZone: TZ });
  assert.equal(await tracker.update('site', 1000000, false, at(21, 20)), null);
});

test('the evening reading of the day before is the baseline after a night off', async () => {
  const store = createMemoryStore();
  const first = createDayEnergyTracker({ store, timeZone: TZ });
  await first.update('site', 1000000, false, at(21, 4));
  await first.update('site', 1015000, false, at(21, 21, 30));
  await first.flush(at(21, 21, 30));
  // The container is restarted at noon the next day, panels producing.
  const second = createDayEnergyTracker({ store, timeZone: TZ });
  assert.equal(await second.update('site', 1020000, true, at(22, 12)), 5000);
});

test('a restart in the middle of the day keeps the baseline', async () => {
  const store = createMemoryStore();
  const first = createDayEnergyTracker({ store, timeZone: TZ });
  await first.update('site', 1000000, false, at(21, 5));
  const second = createDayEnergyTracker({ store, timeZone: TZ });
  assert.equal(await second.update('site', 1003000, true, at(21, 10)), 3000);
});

test('a morning reading of the day before is no baseline (the whole day followed)', async () => {
  const store = createMemoryStore();
  const first = createDayEnergyTracker({ store, timeZone: TZ });
  await first.update('site', 1000000, false, at(21, 5));
  await first.flush(at(21, 5));
  const second = createDayEnergyTracker({ store, timeZone: TZ });
  assert.equal(await second.update('site', 1020000, true, at(22, 12)), null);
});

test('a counter going backwards restarts the count instead of going negative', async () => {
  const tracker = createDayEnergyTracker({ store: createMemoryStore(), timeZone: TZ });
  await tracker.update('site', 1000000, false, at(21, 5));
  assert.equal(await tracker.update('site', 10, false, at(21, 6)), 0);
  assert.equal(await tracker.update('site', 5, true, at(21, 9)), null);
});

test('counters are independent (site, each inverter)', async () => {
  const tracker = createDayEnergyTracker({ store: createMemoryStore(), timeZone: TZ });
  await tracker.update('site', 1000, false, at(21, 5));
  await tracker.update('inverter:a', 50, false, at(21, 5));
  assert.equal(await tracker.update('site', 1100, true, at(21, 9)), 100);
  assert.equal(await tracker.update('inverter:a', 60, true, at(21, 9)), 10);
});

test('the store is written on a new baseline, then at most every 10 minutes', async () => {
  const store = createMemoryStore();
  let writes = 0;
  const counting = {
    read: store.read,
    write: async (...args) => ((writes += 1), store.write(...args)),
  };
  const tracker = createDayEnergyTracker({ store: counting, timeZone: TZ });
  await tracker.update('site', 1000, false, at(21, 5));
  assert.equal(writes, 1);
  for (let minute = 1; minute < 10; minute += 1) {
    await tracker.update('site', 1000, false, at(21, 5, minute));
  }
  assert.equal(writes, 1);
  await tracker.update('site', 1000, false, at(21, 5, 11));
  assert.equal(writes, 2);
});
