# Fronius for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that reads **Fronius** solar installations — inverters, Smart Meters and
batteries — **on the local network**, through the Fronius Solar API v1. No
cloud, no account, no password.

> **Developed without the hardware: feedback welcome.** The code is tested
> against real answers of Fronius systems (Symo, Primo, GEN24 with and without
> battery, from the Home Assistant test suite), not yet on a real installation.
> Please report what works and what does not in an issue.

Not affiliated with Fronius International GmbH. Fronius, Symo, Primo, Eco,
GEN24 and Tauro are trademarks of their owners.

## What it does

- **System device** (power flow of the site): solar production, house
  consumption, grid import, grid export, battery charge and discharge,
  production of the day, lifetime production. Every flow is a positive value,
  one feature per direction.
- **One device per inverter**: AC power, voltage, current, DC voltage and
  current of each input, production of the day, state and error code (as
  texts).
- **One device per meter** (Smart Meter, S0): grid exchange or house
  consumption depending on where it sits, power and voltage per phase, grid
  import and export counters (kWh).
- **One device per battery**: charge level, stored energy, cell temperature.
- **Energy tracking**: the grid import counter of the meter is an energy
  index, from which Gladys computes the consumption and cost of the Energy
  screens.
- **Dashboard widget "Fronius"**: solar → house → grid → battery flows,
  today's production, 24-hour graph, self-consumption, self-sufficiency,
  inverter states.
- **Scene triggers**: inverter in fault (with its error code), battery full,
  battery empty (configurable levels, with hysteresis).
- **Action**: test the connection, listing what was found.
- Feature names and texts in English, French, German or Spanish.

The full user documentation is in [`docs/`](docs/en.md) (English, French,
German, Spanish); Gladys shows it from the Configuration screen.

## Supported hardware

- **Fronius Datamanager** 1.0 and 2.0, card or box: Symo, Primo, Eco, Galvo,
  IG Plus… (one Datamanager sees every inverter of its Solar Net).
- **GEN24, GEN24 Plus and Tauro** inverters, which serve the Solar API
  themselves. The Solar API must be turned on: web interface, **Communication >
  Solar API**.
- Meters: Fronius Smart Meter (63A, TS 65A-3, TS 5kA…), S0 meters.
- Batteries seen by the Solar API: BYD Battery-Box, Fronius Solar Battery,
  Reserva…

Not supported: the old Datalogger Web (Solar API v0), Modbus, Ohmpilot, any
control (power limit, battery management).

## Requirements

- Gladys **5.1.0** or later.
- The Datamanager or the GEN24 on the same network as Gladys, with a fixed IP
  address (DHCP reservation).

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and enter
   `https://github.com/guim31/gladys-fronius` (or install it from the store
   once it is listed).
2. In the **Configuration** tab, enter the IP address of the Datamanager or of
   the GEN24, and save. **Test the connection** lists what was found.
3. In the **Discovery** tab, add the devices you want: only the devices added
   are refreshed.
4. Add the **Fronius** widget to a dashboard, and use the triggers in your
   scenes.

## How it works

- The power flow (`GetPowerFlowRealtimeData`) is read every 10 to 60 seconds
  (15 by default); inverters, meters and batteries once a minute. One request
  at a time: the Datamanager 2.0 is slow. Fronius sets no quota on this local
  API.
- The integration refreshes the devices with its own timer; the poll of the
  Gladys core (once a minute) is only a fallback (GladysAssistant/Gladys#3198).
- Only the values that changed are sent to Gladys, plus every value again
  every 6 hours.
- A GEN24 does not count the production of the day: the integration counts it
  from the lifetime counter, with a baseline taken while the panels are idle,
  kept in `/data`.
- The devices found are kept in `/data`, so they are published again after a
  restart even if the Datamanager is off. A device seen once is never removed.
- From firmware 1.35.4-1, a GEN24 redirects to HTTPS with a self-signed
  certificate: the redirect is followed and the certificate accepted (nothing
  secret is sent).

## Limits

- Developed without the hardware (see above).
- No automatic discovery: Fronius devices do not announce themselves in mDNS
  or SSDP, the only mediated discoveries of Gladys.
- No AC frequency (Gladys has no hertz unit); self-consumption and
  self-sufficiency are in the widget only (no feature type for a ratio).
- The counters of a meter on the consumption path are not published.
- Gladys 5.2.1 does not compute a half-hourly production for external
  integrations yet: the production index is kept, the Energy screens show the
  consumption.
- One Fronius system (one IP address) per integration.

## Development

Node.js 22 or later, ESM, no build step. The only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

```bash
npm install
npm test                 # node --test, against the SDK's fake Gladys and recorded Fronius answers
npm run lint             # ESLint
npm run format:check     # Prettier, as the CI runs it
npx github:GladysAssistant/integration-store --skip-image-check .   # store checks
```

Run it against a real system, outside Docker:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="fronius" \
FRONIUS_DATA_DIR=./data \
LOG_LEVEL=debug \
npm start
```

Project layout:

```
index.js                SDK wiring
src/app.js              handlers, refresh cycle, reachability, widget, action
src/fronius/            Solar API client, parsers, service (inventory + readings)
src/devices/            system, inverter, meter, battery: devices and states
src/dayEnergy.js        production of the day for systems that do not count it
src/triggers.js         scene triggers
src/widgets.js          the "Fronius" widget
src/i18n.js             every user-visible text, in en / fr / de / es
test/                   node --test; test/fixtures/fronius holds real answers
```

`test/gladys-rules.test.js` checks every device built from the fixtures
against the couples, units and polling values the Gladys core accepts.

## Releasing

Releases are made from GitHub: describe the change under `## [Unreleased]` in
[`CHANGELOG.md`](CHANGELOG.md), then **Actions → Release → Run workflow**
(`patch`, `minor` or `major`). The workflow bumps the version in `package.json`
and in the manifest (`version` and `docker_image`), builds the multi-arch image
to `ghcr.io/guim31/gladys-fronius`, tags and publishes the GitHub Release.

> A hand-pushed `vX.Y.Z` tag triggers the same build, but does not touch
> `package.json`, the manifest or the changelog: bump `version` in
> `package.json` and in `gladys-assistant-integration.json` (with the
> `docker_image` tag) and commit it before tagging.

## Credits

- [**pyfronius**](https://github.com/nielstron/pyfronius) by Niels Mündler and
  Gerrit Beine (MIT): the reference reading of the Solar API, its field names
  and the `SMARTMETER_*` variants of the GEN24 firmwares.
- The Home Assistant [**fronius**](https://github.com/home-assistant/core/tree/dev/homeassistant/components/fronius)
  integration (Apache 2.0): the meaning of the status codes, the meter
  locations, the pace of the requests, and the recorded answers used as test
  fixtures (`test/fixtures/fronius/`).
- The Fronius Solar API V1 documentation, published by Fronius.

## License

[Apache-2.0](LICENSE)
