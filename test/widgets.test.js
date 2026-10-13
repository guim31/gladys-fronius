// -----------------------------------------------------------------------------
// The "Fronius" widget: within the budget of the core on every system, bound
// to features that exist, literal values before the devices are added, and
// never a request to the Datamanager when the devices refresh anyway.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createWorld } from './helpers/world.js';
import { SYSTEMS } from './helpers/fakeFronius.js';

async function widget(world) {
  const ack = await world.gladys.fake.widgetGet('energy_flow', { language: 'fr' });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content;
}

const featureIdsOf = (world) =>
  new Set(world.gladys.fake.discoveredDevices.flatMap((d) => d.features.map((f) => f.external_id)));

for (const system of SYSTEMS) {
  test(`${system}: the content fits the core budget and binds only published features`, async () => {
    const world = await createWorld({ system });
    const content = await widget(world);
    assert.deepEqual(validateWidgetContent(content), []);
    assert.ok(content.components.length <= 8);
    const published = featureIdsOf(world);
    for (const component of content.components) {
      for (const id of [component.device_feature, ...(component.device_features ?? [])]) {
        if (id !== undefined) {
          assert.ok(published.has(id), `${id} is bound but not published`);
        }
      }
    }
    await world.app.stop();
  });
}

test('the tiles follow the flows: solar, house, grid both ways, battery, today', async () => {
  const world = await createWorld({ system: 'gen24_storage' });
  const content = await widget(world);
  const tiles = content.components.filter((c) => c.type === 'value');
  assert.deepEqual(
    tiles.map((t) => t.label.en),
    ['Solar', 'House', 'From the grid', 'To the grid', 'Battery', 'Today'],
  );
  assert.ok(
    tiles.slice(0, 5).every((t) => t.device_feature),
    'live tiles',
  );
  const chart = content.components.find((c) => c.type === 'chart');
  assert.equal(chart.device_features.length, 2);
  const status = content.components.find((c) => c.type === 'status');
  const labels = status.items.map((item) => item.label.en ?? item.label);
  assert.deepEqual(labels.slice(0, 4), [
    'Self-consumption',
    'Self-sufficiency',
    'Battery',
    'Inverters',
  ]);
  const battery = status.items[2].value;
  assert.equal(battery.fr, 'Au repos · Suspendue · 16,6 kWh');
  assert.equal(battery.en, 'Idle · Suspended · 16.6 kWh');
  await world.app.stop();
});

test('before the devices are added: literal values from the last reading, no chart', async () => {
  const world = await createWorld({ system: 'symo', create: false });
  const content = await widget(world);
  assert.deepEqual(validateWidgetContent(content), []);
  const tiles = content.components.filter((c) => c.type === 'value');
  assert.equal(tiles[0].value, 1111);
  assert.equal(tiles[0].unit, 'W');
  assert.equal(tiles.find((t) => t.label.en === 'Today').value.fr, '1,1');
  assert.equal(
    content.components.find((c) => c.type === 'chart'),
    undefined,
  );
  const status = content.components.find((c) => c.type === 'status');
  const total = status.items.find((item) => item.label.en === 'Total');
  assert.equal(total.value.fr, '44188 kWh');
  await world.app.stop();
});

test('a widget never reads the Datamanager while the devices refresh', async () => {
  const world = await createWorld({ system: 'symo' });
  const before = world.fronius.requests.length;
  await widget(world);
  await widget(world);
  assert.equal(world.fronius.requests.length, before);
  await world.app.stop();
});

test('without any device added, the widget reads at most once per interval', async () => {
  const world = await createWorld({ system: 'symo', create: false });
  const before = world.fronius.count('powerFlow');
  await widget(world);
  assert.equal(world.fronius.count('powerFlow'), before, 'the discovery reading is fresh');
  world.clock.advance(15000);
  await widget(world);
  await widget(world);
  assert.equal(world.fronius.count('powerFlow'), before + 1);
  await world.app.stop();
});

test('not configured, or nothing read yet: a sentence instead of data', async () => {
  const empty = await createWorld({ config: { host: '' }, create: false });
  const content = await widget(empty);
  assert.equal(content.components[0].type, 'text');
  assert.match(content.components[0].text.en, /IP address/);
  await empty.app.stop();

  const down = await createWorld({ create: false, before: (fronius) => fronius.goDown() });
  const noData = await widget(down);
  assert.match(noData.components[0].text.en, /No reading/);
  await down.app.stop();
});

test('a new reading nudges the widget, once a minute at most', async () => {
  const world = await createWorld({ system: 'symo' });
  const nudges = () => world.gladys.fake.widgetRefreshes.length;
  const start = nudges();
  world.clock.advance(15000);
  await world.app.cycle();
  world.clock.advance(15000);
  await world.app.cycle();
  assert.equal(nudges(), start, 'within the minute of the last nudge');
  world.clock.advance(60000);
  await world.app.cycle();
  assert.equal(nudges(), start + 1);
  await world.app.stop();
});
