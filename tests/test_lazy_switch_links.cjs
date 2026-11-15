const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const sourcePath = path.join(__dirname, '../js/lazy_switch.js');
const source = fs.readFileSync(sourcePath, 'utf8').replace(/^import .*;\r?\n/gm, '');

async function harness(storeBacked = true) {
  let extension;
  const frames = [];
  const app = { configuringGraph: false, registerExtension(e) { extension = e; } };
  const context = vm.createContext({ app, requestAnimationFrame(fn) { frames.push(fn); } });
  vm.runInContext(source, context, { filename: sourcePath });

  class Node {
    constructor() {
      this.id = 42;
      this.graph = { links: storeBacked ? new Map() : {} };
      this.inputs = Array.from({ length: 10 }, (_, i) => this.slot(`input_${i}`));
      this.widgets = [
        { name: 'index', type: 'combo', value: 'First', options: { values: ['First', 'Second'] } },
        ...Array.from({ length: 10 }, (_, i) => ({ name: `name_${i}`, type: 'text', value: i === 0 ? 'First' : i === 1 ? 'Second' : `Input ${i + 1}` })),
        { name: 'unload_previous_model', type: 'toggle', value: true },
      ];
      this.nextLink = 1;
      this.size = [300, 200];
    }
    links() { return storeBacked ? [...this.graph.links.values()] : Object.values(this.graph.links); }
    slot(name) {
      const slot = { name, type: name === 'index' ? 'COMBO' : '*' };
      if (storeBacked) {
        // Current NodeInputSlot derives connectivity from the link store and
        // its CURRENT array index. There is no independent slot.link mirror.
        Object.defineProperty(slot, 'link', { enumerable: true, get: () => this.getInputLink(this.inputs.indexOf(slot))?.id ?? null });
      } else slot.link = null;
      return slot;
    }
    getInputLink(index) { return this.links().find(link => link.target_id === this.id && link.target_slot === index) ?? null; }
    isInputConnected(index) { return !!this.getInputLink(index); }
    connect(name, type = '*', subgraph = false) {
      const index = this.inputs.findIndex(slot => slot.name === name);
      assert.ok(index >= 0, `Missing input: ${name}`);
      const link = { id: this.nextLink++, target_id: this.id, target_slot: index, origin_id: subgraph ? -10 : 100, origin_slot: 0, type };
      if (storeBacked) this.graph.links.set(link.id, link);
      else { this.graph.links[link.id] = link; this.inputs[index].link = link.id; }
      return link;
    }
    disconnect(name) {
      const index = this.inputs.findIndex(slot => slot.name === name);
      const link = this.getInputLink(index);
      if (link) {
        if (storeBacked) this.graph.links.delete(link.id);
        else { delete this.graph.links[link.id]; this.inputs[index].link = null; }
      }
    }
    removeInput(index) {
      // Public LiteGraph API contract: remove the slot and atomically remap
      // every retained link, including links from subgraph input pins.
      const removed = this.inputs[index];
      for (const link of this.links()) {
        assert.notEqual(link.target_slot, index, `Attempted to remove connected ${removed.name}`);
        if (link.target_slot > index) link.target_slot--;
      }
      this.inputs.splice(index, 1);
    }
    computeSize() { return [300, 200]; }
    setSize(size) { this.size = size; }
    setDirtyCanvas() {}
  }
  await extension.beforeRegisterNodeDef(Node, { name: 'HotLazySwitch' });
  return { Node, app, sync: vm.runInContext('sync', context), flush() { while (frames.length) frames.shift()(); } };
}

function targetName(node, link) { return node.inputs[link.target_slot]?.name; }

for (const storeBacked of [true, false]) {
  for (const subgraph of [true, false]) {
    test(`${storeBacked ? 'store' : 'legacy'} links: ${subgraph ? 'subgraph' : 'ordinary'} selector survives shrinking and growing`, async () => {
      const h = await harness(storeBacked);
      h.app.configuringGraph = true;
      const node = new h.Node();
      node.onNodeCreated();
      node.inputs.push(node.slot('index'));
      const first = node.connect('input_0', 'VAE');
      const second = node.connect('input_1', 'VAE');
      const selector = node.connect('index', 'COMBO', subgraph);
      h.app.configuringGraph = false;
      h.sync(node);
      assert.equal(targetName(node, selector), 'index');
      assert.equal(targetName(node, first), 'input_0');
      assert.equal(targetName(node, second), 'input_1');
      for (let repeat = 0; repeat < 5; repeat++) {
        const third = node.connect('input_2', 'VAE');
        h.sync(node);
        assert.equal(targetName(node, selector), 'index');
        assert.equal(targetName(node, third), 'input_2');
        assert.equal(node.inputs.find(slot => slot.name === 'input_3').link, null);
        node.disconnect('input_2');
        h.sync(node);
        assert.equal(targetName(node, selector), 'index');
        assert.equal(targetName(node, second), 'input_1');
      }
    });
  }
}

test('hiding label widgets preserves a selector between label sockets', async () => {
  const h = await harness();
  h.app.configuringGraph = true;
  const node = new h.Node();
  node.inputs.push(node.slot('name_5'), node.slot('index'), node.slot('name_6'));
  node.onNodeCreated();
  node.connect('input_0', 'CLIP');
  const selector = node.connect('index', 'COMBO', true);
  h.app.configuringGraph = false;
  h.sync(node);
  assert.equal(targetName(node, selector), 'index');
  assert.ok(!node.inputs.some(slot => slot.name === 'name_5'));
  assert.ok(!node.inputs.some(slot => slot.name === 'name_6'));
});

test('adding the next socket cannot move the selector onto Input 4', async () => {
  const h = await harness();
  h.app.configuringGraph = true;
  const node = new h.Node();
  node.onNodeCreated();
  node.inputs = ['input_0', 'input_1', 'input_2', 'index'].map(name => node.slot(name));
  node.connect('input_0', 'VAE');
  node.connect('input_1', 'VAE');
  const selector = node.connect('index', 'COMBO', true);
  node.connect('input_2', 'VAE');
  h.app.configuringGraph = false;
  h.sync(node);
  assert.equal(targetName(node, selector), 'index');
  assert.equal(node.inputs.find(slot => slot.name === 'input_3').link, null);
});

test('a connected label input is retained even when its data input is unused', async () => {
  const h = await harness();
  h.app.configuringGraph = true;
  const node = new h.Node();
  node.inputs.push(node.slot('name_5'), node.slot('index'));
  node.onNodeCreated();
  node.connect('input_0', 'MODEL');
  const label = node.connect('name_5', 'STRING', true);
  const selector = node.connect('index', 'COMBO', true);
  h.app.configuringGraph = false;
  h.sync(node);
  assert.equal(targetName(node, label), 'name_5');
  assert.equal(targetName(node, selector), 'index');
  assert.notEqual(node.widgets.find(widget => widget.name === 'name_5').hidden, true);
});

test('configured sockets keep their links through repeated save and reload', async () => {
  const h = await harness();
  let saved = { inputs: ['input_0', 'index', 'input_1', 'input_2', 'input_3'], links: [
    { name: 'input_0', type: 'CLIP' }, { name: 'input_1', type: 'CLIP' }, { name: 'index', type: 'COMBO' },
  ] };
  for (let reload = 0; reload < 10; reload++) {
    h.app.configuringGraph = true;
    const node = new h.Node();
    node.onNodeCreated();
    // configure() replaces slot instances; cached schema objects must never
    // be mistaken for the currently connected instances.
    node.inputs = saved.inputs.map(name => node.slot(name));
    const links = saved.links.map(link => [link.name, node.connect(link.name, link.type, true)]);
    node.onConfigure(saved);
    h.app.configuringGraph = false;
    h.flush();
    for (const [name, link] of links) assert.equal(targetName(node, link), name);
    saved = { inputs: node.inputs.map(slot => slot.name), links: saved.links };
  }
});

test('the fourth generic data input remains a legitimate COMBO destination', async () => {
  const h = await harness();
  h.app.configuringGraph = true;
  const node = new h.Node();
  node.onNodeCreated();
  const fourth = node.connect('input_3', 'COMBO', true);
  h.app.configuringGraph = false;
  h.sync(node);
  assert.equal(targetName(node, fourth), 'input_3');
  assert.equal(node.inputs.find(slot => slot.name === 'input_3').link, fourth.id);
});
