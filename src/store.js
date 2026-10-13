// -----------------------------------------------------------------------------
// Small JSON files under /data, the only writable volume of the container.
//
// What is kept: the inventory of the system (so its devices are published
// again after a restart, even at night or while the Datamanager is down) and
// the day-energy baselines of the systems that do not count the day
// themselves (GEN24). No secret: the Solar API has no credentials.
//
// Writes go to a temporary file renamed over the target, so a container
// stopped mid-write never leaves half a file.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * @param {string} dir usually /data (FRONIUS_DATA_DIR overrides it in development)
 */
export function createFileStore(dir) {
  return {
    /** @returns {Promise<object|null>} null when absent or unreadable */
    async read(name) {
      try {
        return JSON.parse(await readFile(join(dir, `${name}.json`), 'utf8'));
      } catch {
        return null;
      }
    },
    async write(name, value) {
      await mkdir(dir, { recursive: true });
      const target = join(dir, `${name}.json`);
      const temporary = `${target}.tmp`;
      await writeFile(temporary, `${JSON.stringify(value)}\n`, 'utf8');
      await rename(temporary, target);
    },
  };
}

/** The same interface in memory, for the tests. */
export function createMemoryStore(initial = {}) {
  const files = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    files,
    async read(name) {
      return files.has(name) ? JSON.parse(files.get(name)) : null;
    },
    async write(name, value) {
      files.set(name, JSON.stringify(value));
    },
  };
}
