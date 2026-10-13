// -----------------------------------------------------------------------------
// Energy produced today, for the systems that do not count it themselves.
//
// A GEN24 (and a Tauro) answers `E_Day: null` / `DAY_ENERGY: null`: only the
// lifetime counter exists. Today's production is then that counter minus its
// value at the start of the day. Solar panels produce nothing at night, so any
// reading taken while the system is idle before sunrise, or after the last
// production of the evening before, is a valid start-of-day value.
//
// - On a new day, the last reading of yesterday becomes the baseline if it was
//   taken while idle in the evening (after noon). Otherwise a reading taken
//   now while idle (before sunrise) is; otherwise today's value is unknown:
//   publishing a partial day as if it were the whole day would be wrong, so
//   nothing is published until the next morning.
// - The baselines live in /data, so a restart in the middle of the day keeps
//   the count. The last reading is saved at most every 10 minutes (an SD card
//   does not need a write every 15 seconds), and on every new baseline.
// -----------------------------------------------------------------------------

const STORE_KEY = 'day-energy';
const SAVE_EVERY_MS = 10 * 60 * 1000;

/** Local calendar day and hour of an instant, in the container's time zone (TZ). */
export function localDay(ms, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

function previousDay(day) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * @param {object} options
 * @param {{ read: Function, write: Function }} options.store
 * @param {string} [options.timeZone] defaults to the TZ injected by Gladys
 */
export function createDayEnergyTracker({ store, timeZone = process.env.TZ || undefined }) {
  /** key → { day, base (Wh or null), last: { total, idle, day, hour } } */
  let entries = {};
  let loaded = false;
  let savedAt = 0;
  let dirty = false;

  async function save(now, force) {
    if (!dirty || (!force && now - savedAt < SAVE_EVERY_MS)) {
      return;
    }
    dirty = false;
    savedAt = now;
    await store.write(STORE_KEY, entries).catch(() => {});
  }

  return {
    async load() {
      if (!loaded) {
        entries = (await store.read(STORE_KEY)) ?? {};
        loaded = true;
      }
    },

    /**
     * Record a lifetime counter and get today's energy.
     * @param {string} key one counter (the site, an inverter)
     * @param {number} totalWh the lifetime counter
     * @param {boolean} producing the panels produce right now
     * @param {number} now
     * @returns {Promise<number|null>} Wh produced today, null while unknown
     */
    async update(key, totalWh, producing, now) {
      await this.load();
      const { day, hour } = localDay(now, timeZone);
      let entry = entries[key];
      let newBase = false;
      if (!entry || entry.day !== day) {
        const last = entry?.last;
        let base = null;
        if (last?.idle && last.day === previousDay(day) && last.hour >= 12) {
          base = last.total;
        } else if (!producing && hour < 12) {
          base = totalWh;
        }
        entry = { day, base, last: null };
        entries[key] = entry;
        newBase = true;
      }
      // A counter that went backwards (a replaced inverter, a reset): restart
      // from it rather than publish a negative day.
      if (entry.base !== null && totalWh < entry.base) {
        entry.base = producing || hour >= 12 ? null : totalWh;
        newBase = true;
      }
      entry.last = { total: totalWh, idle: !producing, day, hour };
      dirty = true;
      await save(now, newBase);
      return entry.base === null ? null : totalWh - entry.base;
    },

    /** Save now (shutdown). */
    async flush(now = Date.now()) {
      await save(now, true);
    },
  };
}
