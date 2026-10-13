// -----------------------------------------------------------------------------
// The "Fronius" dashboard widget: the power flows of the site (solar → house →
// grid → battery), today's production, and a status list.
//
// A widget never costs a request to the Datamanager: the content is built from
// the snapshot of the last cycle. Tiles and chart are bound to the published
// features when the system device exists in Gladys (the core then animates
// them live from the states); otherwise the tiles carry the cached values.
//
// Budget of the core: 8 components at most, 6 tiles, 1 focal, 1 status. This
// content uses at most 6 tiles + 1 chart + 1 status = 8.
// -----------------------------------------------------------------------------

import {
  WIDGET_CHART_INTERVALS,
  WIDGET_CHART_TYPES,
  WIDGET_COLORS,
} from '@gladysassistant/integration-sdk';
import {
  BATTERY_MODES,
  INVERTER_STATES,
  WIDGET_MESSAGES,
  WIDGET_TEXT,
  formatNumber,
  localize,
  pick,
} from './i18n.js';
import { SYSTEM_FEATURES, systemIds } from './devices/system.js';
import { BATTERY_FEATURES, batteryIds } from './devices/battery.js';
import { inverterStateKey } from './devices/inverter.js';

export const WIDGET_KEY = 'energy_flow';
export const WIDGET_TTL_SECONDS = 60;

/** A sentence instead of data (not configured, nothing read yet). */
export function messageContent(message) {
  return {
    ttl_seconds: WIDGET_TTL_SECONDS,
    components: [{ type: 'text', variant: 'body', text: message }],
  };
}

export const notConfiguredContent = () => messageContent(WIDGET_MESSAGES.notConfigured);
export const noDataContent = () => messageContent(WIDGET_MESSAGES.noData);

/** kWh as a short text: one decimal under 1000 kWh, none above (tiles are narrow). */
function energyText(kwhValue, language) {
  return formatNumber(kwhValue, kwhValue >= 1000 ? 0 : 1, language);
}

function percentText(value, language) {
  return language === 'en' ? `${Math.round(value)}%` : `${Math.round(value)} %`;
}

function clockText(ms, timeZone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ms));
}

/**
 * A tile bound to a feature when Gladys has it, the cached value otherwise.
 * @param {Set<string>} created the feature external ids Gladys knows
 */
function tile(created, { label, icon, externalId, value, unit }) {
  if (created.has(externalId)) {
    return { type: 'value', label, icon, device_feature: externalId };
  }
  if (value === null || value === undefined) {
    return null;
  }
  return { type: 'value', label, icon, value, unit };
}

/**
 * @param {object} input
 * @param {object} input.gladys only for the external ids
 * @param {object} input.inventory
 * @param {object} input.snapshot
 * @param {number|null} input.siteToday Wh produced today
 * @param {Set<string>} input.created feature external ids of the devices Gladys has
 * @param {string} [input.timeZone]
 * @returns {object} the widget content
 */
export function buildFlowContent({ gladys, inventory, snapshot, siteToday, created, timeZone }) {
  const ids = systemIds(gladys, inventory);
  const flow = snapshot.powerFlow;
  const { hasGrid, hasLoad, hasBattery } = inventory.system;
  const F = SYSTEM_FEATURES;
  const watts = (value) => (value === null ? null : Math.round(Math.max(value, 0)));

  const tiles = [
    tile(created, {
      label: WIDGET_TEXT.solar,
      icon: 'sun',
      externalId: ids.feature(F.pvPower),
      value: watts(flow.pv ?? 0),
      unit: 'W',
    }),
  ];
  if (hasLoad) {
    tiles.push(
      tile(created, {
        label: WIDGET_TEXT.house,
        icon: 'home',
        externalId: ids.feature(F.homePower),
        value: watts(flow.load === null ? null : -flow.load),
        unit: 'W',
      }),
    );
  }
  if (hasGrid) {
    tiles.push(
      tile(created, {
        label: WIDGET_TEXT.fromGrid,
        icon: 'download',
        externalId: ids.feature(F.gridImport),
        value: watts(flow.grid),
        unit: 'W',
      }),
      tile(created, {
        label: WIDGET_TEXT.toGrid,
        icon: 'upload',
        externalId: ids.feature(F.gridExport),
        value: watts(flow.grid === null ? null : -flow.grid),
        unit: 'W',
      }),
    );
  }
  const storage = inventory.storages[0];
  if (hasBattery) {
    const reading = storage && snapshot.storages.find((entry) => entry.index === storage.index);
    const soc = reading?.soc ?? flow.inverters.find((inverter) => inverter.soc !== null)?.soc;
    tiles.push(
      tile(created, {
        label: WIDGET_TEXT.battery,
        icon: 'battery',
        externalId: storage ? batteryIds(gladys, storage).feature(BATTERY_FEATURES.level) : '',
        value: soc === undefined || soc === null ? null : Math.round(soc),
        unit: '%',
      }),
    );
  }
  tiles.push(
    tile(created, {
      label: WIDGET_TEXT.today,
      icon: 'sunrise',
      externalId: ids.feature(F.productionToday),
      value: siteToday === null ? null : localize((lang) => energyText(siteToday / 1000, lang)),
      unit: 'kWh',
    }),
  );

  const components = tiles.filter(Boolean);

  // The chart needs the history Gladys keeps: only for created features.
  const charted = [ids.feature(F.pvPower), ...(hasLoad ? [ids.feature(F.homePower)] : [])].filter(
    (externalId) => created.has(externalId),
  );
  if (charted.length > 0) {
    components.push({
      type: 'chart',
      title: WIDGET_TEXT.chartTitle,
      device_features: charted,
      interval: WIDGET_CHART_INTERVALS.LAST_DAY,
      chart_type: WIDGET_CHART_TYPES.LINE,
    });
  }

  components.push({ type: 'status', items: statusItems({ inventory, snapshot, timeZone }) });
  return { ttl_seconds: WIDGET_TTL_SECONDS, components };
}

function statusItems({ inventory, snapshot, timeZone }) {
  const flow = snapshot.powerFlow;
  const items = [];
  if (inventory.system.hasGrid && flow.selfConsumption !== null) {
    items.push({
      label: WIDGET_TEXT.selfConsumption,
      value: localize((lang) => percentText(flow.selfConsumption, lang)),
      icon: 'refresh-cw',
    });
  }
  if (inventory.system.hasGrid && flow.autonomy !== null) {
    items.push({
      label: WIDGET_TEXT.autonomy,
      value: localize((lang) => percentText(flow.autonomy, lang)),
      icon: 'shield',
    });
  }
  if (inventory.system.hasBattery) {
    // Rounded first: a GEN24 reports a few tenths of a watt on an idle battery.
    const battery = Math.round(flow.battery ?? 0);
    const direction =
      battery > 0
        ? WIDGET_TEXT.discharging
        : battery < 0
          ? WIDGET_TEXT.charging
          : WIDGET_TEXT.batteryIdle;
    const mode = flow.batteryMode ? BATTERY_MODES[flow.batteryMode.toLowerCase()] : null;
    const reading = inventory.storages[0]
      ? snapshot.storages.find((entry) => entry.index === inventory.storages[0].index)
      : null;
    const capacity = reading?.capacity ? reading.capacity / 1000 : null;
    items.push({
      label: WIDGET_TEXT.batteryFlow,
      value: localize((lang) => {
        const parts = [pick(direction, lang)];
        if (battery !== 0) parts[0] += ` ${Math.abs(battery)} W`;
        if (flow.batteryMode) parts.push(mode ? pick(mode, lang) : flow.batteryMode);
        if (capacity) parts.push(`${formatNumber(capacity, 1, lang)} kWh`);
        return parts.join(' · ').slice(0, 40);
      }),
      icon: 'battery-charging',
    });
  }
  for (const inverter of inventory.inverters.slice(0, 4)) {
    const reading = snapshot.inverters[inverter.id];
    if (reading === undefined) {
      continue;
    }
    const key = inverterStateKey(reading);
    const color =
      key === 'error'
        ? WIDGET_COLORS.DANGER
        : key === 'running'
          ? WIDGET_COLORS.SUCCESS
          : WIDGET_COLORS.NEUTRAL;
    items.push({
      label:
        inventory.inverters.length === 1 || !inverter.name
          ? WIDGET_TEXT.inverters
          : inverter.name.slice(0, 40),
      value: INVERTER_STATES[key],
      icon: 'cpu',
      color,
    });
  }
  if (flow.energyYear) {
    items.push({
      label: WIDGET_TEXT.thisYear,
      value: localize((lang) => `${energyText(flow.energyYear / 1000, lang)} kWh`),
      icon: 'calendar',
    });
  }
  if (flow.energyTotal) {
    items.push({
      label: WIDGET_TEXT.total,
      value: localize((lang) => `${energyText(flow.energyTotal / 1000, lang)} kWh`),
      icon: 'award',
    });
  }
  items.push({
    label: WIDGET_TEXT.updated,
    value: clockText(snapshot.fetchedAt, timeZone),
    icon: 'clock',
  });
  return items.slice(0, 10);
}
