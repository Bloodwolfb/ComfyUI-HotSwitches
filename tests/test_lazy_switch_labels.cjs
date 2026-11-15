const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { test } = require('node:test');

const sourcePath = path.join(__dirname, '../js/lazy_switch.js');
const source = fs.readFileSync(sourcePath, 'utf8').replace(/^import .*;\r?\n/gm, '');
const switches = [
  ['Encoder standard', 'Encoder alternative'],
  ['VAE standard', 'VAE texture'],
  ['Base', 'Portrait', 'Anime', 'Quantized', 'Photo', 'Fast', 'Alternative'],
].map((labels, id) => ({
  id,
  type: 'HotLazySwitch',
  widgets_values: [labels[0], ...Array.from({ length: 10 }, (_, i) => labels[i] ?? `Input ${i + 1}`), true],
  inputs: Array.from({ length: labels.length + 1 }, (_, i) => ({
    name: `input_${i}`, link: i < labels.length ? id * 100 + i + 1 : null,
  })),
}));

async function harness() {
  let extension;
  const frames = [];
  const app = { configuringGraph: false, registerExtension(e) { extension = e; } };
  const context = vm.createContext({
    app, api: { fetchApi: () => Promise.resolve() }, console: { log() {} },
    requestAnimationFrame(fn) { frames.push(fn); },
  });
  vm.runInContext(source, context, { filename: sourcePath });

  class Node {
    constructor() {
      this.inputs = Array.from({ length: 10 }, (_, i) => ({ name: `input_${i}`, link: null }));
      this.widgets = [
        { name: 'index', type: 'combo', value: 'Input 1', options: { values: Array.from({ length: 10 }, (_, i) => `Input ${i + 1}`) } },
        ...Array.from({ length: 10 }, (_, i) => ({ name: `name_${i}`, type: 'text', value: `Input ${i + 1}` })),
        { name: 'unload_previous_model', type: 'toggle', value: true },
      ];
      this.graph = { links: {} };
      this.size = [300, 200];
    }
    computeSize() { return [300, 200]; }
    setSize(size) { this.size = size; }
    setDirtyCanvas() {}
    isInputConnected(index) { return this.inputs[index]?.link != null; }
    removeInput(index) {
      this.inputs.splice(index, 1);
      for (const link of Object.values(this.graph.links)) {
        if (link.target_slot > index) link.target_slot--;
      }
    }
  }
  await extension.beforeRegisterNodeDef(Node, { name: 'HotLazySwitch' });
  return {
    app, Node,
    flush() {
      while (frames.length) frames.shift()();
    },
    sync: vm.runInContext('sync', context),
  };
}

function configure(h, saved) {
  h.app.configuringGraph = true;
  const node = new h.Node();
  node.onNodeCreated();
  node.widgets.forEach((w, i) => { w.value = saved.widgets_values[i] ?? w.value; });
  // NodeInputSlot.link is temporarily empty until the owning graph restores links.
  const inputs = saved.inputs.map(input => ({ ...input, link: null }));
  node.inputs = inputs;
  node.onConfigure(saved);
  inputs.forEach((slot, i) => {
    slot.link = saved.inputs[i].link;
    if (slot.link != null) node.graph.links[slot.link] = { target_slot: i };
  });
  h.app.configuringGraph = false;
  h.flush();
  return node;
}

for (const saved of switches) {
  test(`switch ${saved.id}: all labels and the last choice survive three reloads`, async () => {
    const h = await harness();
    let fixture = structuredClone(saved);
    const labels = saved.inputs.filter(i => /^input_\d+$/.test(i.name) && i.link != null)
      .map(i => saved.widgets_values[Number(i.name.slice(6)) + 1]);
    fixture.widgets_values[0] = labels.at(-1);
    for (let reload = 0; reload < 3; reload++) {
      const node = configure(h, fixture);
      const actual = node.widgets.filter(w => /^name_\d+$/.test(w.name)).map(w => w.value);
      assert.deepEqual(actual, saved.widgets_values.slice(1, 11));
      assert.equal(node.widgets[0].value, labels.at(-1));
      assert.deepEqual(Array.from(node.widgets[0].options.values), labels);
      assert.equal(node.inputs.filter(i => /^input_\d+$/.test(i.name) && i.link != null).length, labels.length);
      assert.equal(node.widgets.at(-1).value, true);
      fixture = { ...fixture, inputs: structuredClone(node.inputs), widgets_values: node.widgets.map(w => w.value) };
    }
  });
}

test('layout does not trim sockets or erase labels while the graph is loading', async () => {
  const h = await harness();
  h.app.configuringGraph = true;
  const node = new h.Node();
  node.widgets[2].value = 'Saved second input';
  node.onNodeCreated();
  assert.equal(node.inputs.length, 10);
  assert.equal(node.widgets[2].value, 'Saved second input');
});

test('temporary disconnect and reconnect preserve a slot label and selection', async () => {
  const h = await harness();
  const node = configure(h, switches[0]);
  const slot = node.inputs.find(i => i.name === 'input_1');
  const link = slot.link;
  const label = node.widgets[2].value;
  node.widgets[0].value = label;
  slot.link = null;
  node.onConnectionsChange(1, 1, false);
  h.flush();
  assert.equal(node.widgets[2].value, label);
  assert.equal(node.widgets[0].value, label);
  node.inputs.find(i => i.name === 'input_1').link = link;
  node.onConnectionsChange(1, 1, true);
  h.flush();
  assert.equal(node.widgets[2].value, label);
  assert.equal(node.widgets[0].value, label);
  assert.ok(node.widgets[0].options.values.includes(label));
});

test('the last label survives when its link is restored after the other links', async () => {
  const h = await harness();
  const node = configure(h, switches[2]);
  const last = node.inputs.find(i => i.name === 'input_6');
  const link = last.link;
  last.link = null;
  node.widgets[0].value = 'Alternative';
  h.sync(node);
  assert.equal(node.widgets[7].value, 'Alternative');
  node.inputs.find(i => i.name === 'input_6').link = link;
  h.sync(node);
  assert.equal(node.widgets[7].value, 'Alternative');
  assert.equal(node.widgets[0].value, 'Alternative');
  assert.ok(node.widgets[0].options.values.includes('Alternative'));
});

test('renaming a connected slot keeps the selection on that slot', async () => {
  const h = await harness();
  const node = configure(h, switches[0]);
  node.widgets[0].value = node.widgets[2].value;
  node.widgets[2].value = 'Renamed encoder';
  node.widgets[2].callback();
  assert.equal(node.widgets[0].value, 'Renamed encoder');
  assert.equal(node.inputs.find(i => i.name === 'input_1').label, 'Renamed encoder');
});
