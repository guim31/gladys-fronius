# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-13

### Added

- Fronius solar installations in Gladys, read locally through the Fronius
  Solar API v1 of a Datamanager (Symo, Primo, Eco, Galvo, IG Plus) or of a
  GEN24 / Tauro inverter: no cloud, no account.
- A system device: solar production, house consumption, grid import and
  export, battery charge and discharge, production of the day and lifetime
  production. A GEN24, which does not count the day, gets it counted from its
  lifetime counter.
- One device per inverter (AC power, voltage and current, DC inputs,
  production of the day, state, error code), per meter (grid exchange or house
  consumption, phases, voltages, grid import and export counters) and per
  battery (charge level, stored energy, cell temperature).
- Energy tracking: the grid import counter of the meter feeds the consumption
  and cost of the Gladys Energy screens.
- A "Fronius" dashboard widget: solar, house, grid and battery flows, today's
  production, a 24-hour graph, self-consumption and self-sufficiency, inverter
  states.
- Scene triggers: inverter in fault (with its error code), battery full and
  battery empty (configurable levels, 5-point hysteresis).
- A "Test the connection" action listing the inverters, meters and batteries
  found.
- Refresh every 10 to 60 seconds by the integration itself, one request at a
  time; only the values that changed are sent, with a heartbeat every 6 hours.
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-fronius/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-fronius/releases/tag/v1.0.1
