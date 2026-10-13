// -----------------------------------------------------------------------------
// Pure parsers of the Fronius Solar API v1 responses.
//
// Every reader takes the whole JSON body (`{ Head, Body }`) and returns plain
// values in the API's own units (W, Wh, V, A, %): conversions belong to the
// device modules. A value the API leaves out or sends as `null` is `null`
// here — the API does so at night (an inverter asleep has no AC values), on a
// GEN24 (no day or year energy), on a system without meter or battery.
//
// Field names follow the "Fronius Solar API V1" documentation and the real
// answers collected by Home Assistant's `fronius` tests (test/fixtures/).
// -----------------------------------------------------------------------------

/** A finite number, or null. Numbers sent as strings are accepted. */
export function num(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** The `{ Value, Unit }` wrapper of the inverter readings. */
function valueOf(field) {
  return field && typeof field === 'object' ? num(field.Value) : num(field);
}

/** The first non-null number among the given candidates. */
function firstNum(...candidates) {
  for (const candidate of candidates) {
    const n = num(candidate);
    if (n !== null) {
      return n;
    }
  }
  return null;
}

/**
 * Decode the HTML character references the Datamanager puts in custom names
 * ("&#83;&#121;&#109;&#111;" is "Symo").
 * @param {unknown} text
 * @returns {string}
 */
export function decodeEntities(text) {
  if (typeof text !== 'string') {
    return '';
  }
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match)
    .trim();
}

function safeCodePoint(code) {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}

/** Trimmed text, or null when empty or a placeholder ("n.a."). */
function cleanText(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const text = value.trim();
  return text === '' || /^n\.?\s?a\.?$/i.test(text) ? null : text;
}

const dataOf = (body) => body?.Body?.Data ?? {};

/**
 * GetLoggerInfo.cgi — the Datamanager card or box. A GEN24 or Tauro answers
 * "not supported" (status 11): the caller treats that as "no logger".
 * @returns {{ uniqueId: string, productId: string|null, softwareVersion: string|null } | null}
 */
export function parseLoggerInfo(body) {
  const info = body?.Body?.LoggerInfo;
  const uniqueId = cleanText(info?.UniqueID);
  if (!uniqueId) {
    return null;
  }
  return {
    uniqueId,
    productId: cleanText(info.ProductID),
    softwareVersion: cleanText(info.SWVersion),
  };
}

/**
 * GetInverterInfo.cgi — the inverters the system knows, asleep ones included.
 * @returns {Array<{ id: string, uniqueId: string|null, name: string, deviceType: number|null,
 *   peakPower: number|null, statusCode: number|null, errorCode: number|null }>} by SolarNet id
 */
export function parseInverterInfo(body) {
  return Object.entries(dataOf(body))
    .filter(([, inverter]) => inverter && typeof inverter === 'object')
    .map(([id, inverter]) => ({
      id: String(id),
      uniqueId: cleanText(String(inverter.UniqueID ?? '')),
      name: decodeEntities(inverter.CustomName),
      deviceType: num(inverter.DT),
      peakPower: num(inverter.PVPower),
      statusCode: num(inverter.StatusCode),
      errorCode: num(inverter.ErrorCode),
    }))
    .sort((a, b) => Number(a.id) - Number(b.id));
}

/**
 * GetPowerFlowRealtimeData.fcgi — the power flows of the whole site.
 * Signs are the API's: `grid` > 0 imports from the grid, `load` < 0 is the
 * house consuming, `battery` > 0 discharges the battery, `pv` > 0 produces.
 */
export function parsePowerFlow(body) {
  const data = dataOf(body);
  const site = data.Site ?? {};
  const inverters = Object.entries(data.Inverters ?? {}).map(([id, inverter]) => ({
    id: String(id),
    power: num(inverter?.P),
    soc: num(inverter?.SOC),
    batteryMode: cleanText(inverter?.Battery_Mode),
    energyDay: num(inverter?.E_Day),
    energyTotal: num(inverter?.E_Total),
  }));
  return {
    mode: cleanText(site.Mode),
    meterLocation: cleanText(site.Meter_Location),
    pv: num(site.P_PV),
    grid: num(site.P_Grid),
    load: num(site.P_Load),
    battery: num(site.P_Akku),
    selfConsumption: num(site.rel_SelfConsumption),
    autonomy: num(site.rel_Autonomy),
    energyDay: num(site.E_Day),
    energyYear: num(site.E_Year),
    energyTotal: num(site.E_Total),
    batteryMode: inverters.find((inverter) => inverter.batteryMode)?.batteryMode ?? null,
    inverters,
  };
}

/**
 * GetInverterRealtimeData.cgi?Scope=Device&DataCollection=CommonInverterData.
 * At night a Symo only sends its energies and the DC input: the AC values are
 * null, which is not an error.
 */
export function parseInverterRealtime(body) {
  const data = dataOf(body);
  const status = data.DeviceStatus ?? {};
  const dcVoltages = [];
  const dcCurrents = [];
  for (let input = 1; input <= 4; input += 1) {
    const suffix = input === 1 ? '' : `_${input}`;
    dcVoltages.push(valueOf(data[`UDC${suffix}`]));
    dcCurrents.push(valueOf(data[`IDC${suffix}`]));
  }
  return {
    acPower: valueOf(data.PAC),
    acVoltage: valueOf(data.UAC),
    acCurrent: valueOf(data.IAC),
    frequency: valueOf(data.FAC),
    dcVoltages,
    dcCurrents,
    energyDay: valueOf(data.DAY_ENERGY),
    energyYear: valueOf(data.YEAR_ENERGY),
    energyTotal: valueOf(data.TOTAL_ENERGY),
    statusCode: num(status.StatusCode),
    errorCode: num(status.ErrorCode),
    inverterState: cleanText(status.InverterState),
  };
}

/**
 * Where a meter sits, from `Meter_Location_Current` (Fronius Solar API V1):
 * 0 feed-in point (the grid meter), 1 consumption path, 3 external
 * generator, 4 external battery, 256-511 sub-loads.
 */
export function meterLocationKind(code) {
  if (code === 0) return 'grid';
  if (code === 1) return 'load';
  if (code === 3) return 'generator';
  if (code === 4) return 'battery';
  if (code !== null && code >= 256 && code <= 511) return 'subload';
  return 'unknown';
}

/**
 * GetMeterRealtimeData.cgi?Scope=System — every meter, by index. The newer
 * GEN24 firmwares also name some fields `SMARTMETER_*`: both are read (the
 * alternatives pyfronius knows).
 * Powers keep the meter's sign (positive = from the grid at the feed-in point).
 */
export function parseMeters(body) {
  return Object.entries(dataOf(body))
    .filter(([, meter]) => meter && typeof meter === 'object')
    .map(([index, meter]) => {
      const details = meter.Details ?? {};
      const location = num(meter.Meter_Location_Current);
      const phase = (n) => ({
        power: firstNum(meter[`PowerReal_P_Phase_${n}`], meter[`SMARTMETER_POWERACTIVE_0${n}_F64`]),
        voltage: num(meter[`Voltage_AC_Phase_${n}`]),
      });
      return {
        index: String(index),
        serial: cleanText(details.Serial),
        model: cleanText(details.Model),
        manufacturer: cleanText(details.Manufacturer),
        location,
        locationKind: meterLocationKind(location),
        power: num(meter.PowerReal_P_Sum),
        phases: [phase(1), phase(2), phase(3)],
        // Absolute counters, in Wh: "plus" is the energy that flowed in the
        // positive direction (from the grid, at the feed-in point).
        energyPlus: firstNum(
          meter.EnergyReal_WAC_Plus_Absolute,
          meter.EnergyReal_WAC_Sum_Consumed,
          meter.SMARTMETER_ENERGYACTIVE_CONSUMED_SUM_F64,
        ),
        energyMinus: firstNum(
          meter.EnergyReal_WAC_Minus_Absolute,
          meter.EnergyReal_WAC_Sum_Produced,
          meter.SMARTMETER_ENERGYACTIVE_PRODUCED_SUM_F64,
        ),
      };
    })
    .sort((a, b) => Number(a.index) - Number(b.index));
}

/**
 * GetStorageRealtimeData.cgi?Scope=System — every battery, by index.
 * `Capacity_Maximum` is the usable capacity in Wh.
 */
export function parseStorages(body) {
  return Object.entries(dataOf(body))
    .filter(([, storage]) => storage?.Controller && typeof storage.Controller === 'object')
    .map(([index, storage]) => {
      const controller = storage.Controller;
      const details = controller.Details ?? {};
      return {
        index: String(index),
        serial: cleanText(details.Serial),
        model: cleanText(details.Model),
        manufacturer: cleanText(details.Manufacturer),
        soc: num(controller.StateOfCharge_Relative),
        temperature: num(controller.Temperature_Cell),
        capacity: firstNum(controller.Capacity_Maximum, controller.DesignedCapacity),
        enabled: num(controller.Enable) !== 0,
      };
    })
    .sort((a, b) => Number(a.index) - Number(b.index));
}
