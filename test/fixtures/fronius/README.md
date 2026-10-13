# Fronius Solar API v1 answers

Real answers of Fronius systems, taken from the tests of the Home Assistant
`fronius` integration
([home-assistant/core](https://github.com/home-assistant/core/tree/dev/tests/components/fronius/fixtures),
Apache License 2.0, © the Home Assistant authors), one directory per system:

| Directory       | System                                                                  |
| --------------- | ----------------------------------------------------------------------- |
| `symo`          | Datamanager card, one Symo, Smart Meter 63A at the feed-in point; night |
| `primo_s0`      | Datamanager card, two Primo, S0 meter on the consumption path           |
| `gen24`         | GEN24 without battery (no logger), Smart Meter TS 65A-3                 |
| `gen24_storage` | GEN24 with a BYD Battery-Box Premium HV, Smart Meter TS 65A-3           |

The serial numbers are the placeholders of the original files, except the
battery serial, replaced by an invented one. The Ohmpilot and API version
answers are left out (unused).
