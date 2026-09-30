import { app } from "../../scripts/app.js";

// Frontend half of Hot Lazy Switch.
//
// The Python side declares all slots statically so the scheduler can see their
// lazy flag (Autogrow slots are invisible to it - see lazy_switch.py). This
// file owns everything else: it reveals sockets progressively, shows a name
// box for each connected slot, and rebuilds the combo options from those
// names.
//
// Because slots are static they NEVER renumber. input_2 is always input_2, so
// name_i stays bound to input_i for the life of the node. Pulling a wire leaves
// a visible empty socket rather than compacting - which is why there is no
// link-identity tracking or name reconciliation here.

const NODE_ID = "HotLazySwitch";
const SELECTOR = "index";
const HIDDEN_TYPE = "hidden";
const SLOT_RE = /^(?:inputs\.)?input_(\d+)$/;
const NAME_RE = /^name_(\d+)$/;

function defaultName(i) {
  return `Input ${i + 1}`;
}

function nameWidgets(node) {
  return (node.widgets ?? [])
    .filter((w) => NAME_RE.test(w.name))
    .sort((a, b) => Number(a.name.slice(5)) - Number(b.name.slice(5)));
}

function slotIndex(name) {
  const m = SLOT_RE.exec(name ?? "");
  return m ? Number(m[1]) : null;
}

function findSlot(node, i) {
  return (node.inputs ?? []).find((s) => slotIndex(s.name) === i);
}

// All slot objects, stashed on first sight so removed ones can be put back
// with their original identity, name and type rather than reconstructed.
function allSlots(node) {
  if (!node.__hotSlots) {
    const found = (node.inputs ?? [])
      .filter((s) => slotIndex(s.name) !== null)
      .sort((a, b) => slotIndex(a.name) - slotIndex(b.name));
    if (!found.length) return null;
    node.__hotSlots = found;
  }
  return node.__hotSlots;
}

// litegraph stores a link's target as an index into node.inputs, so any splice
// invalidates the links after it.
function reindexLinks(node) {
  const links = node.graph?.links;
  if (!links) return;
  (node.inputs ?? []).forEach((slot, idx) => {
    if (slot.link != null) {
      const link = links[slot.link];
      if (link) link.target_slot = idx;
    }
  });
}

function setVisibleSockets(node, visible) {
  const stash = allSlots(node);
  if (!stash) return;

  let changed = false;

  // Trim from the end. A connected slot is never removed, so only empty
  // trailing rows go - which also means no link is ever destroyed here.
  for (let i = stash.length - 1; i >= visible; i--) {
    const idx = (node.inputs ?? []).findIndex((s) => slotIndex(s.name) === i);
    if (idx >= 0 && node.inputs[idx].link == null) {
      node.inputs.splice(idx, 1);
      changed = true;
    }
  }

  // Restore any missing slot, spliced in after the highest lower-numbered slot
  // so socket order stays 0,1,2... rather than appending below the widgets.
  for (let i = 0; i < visible; i++) {
    if ((node.inputs ?? []).some((s) => slotIndex(s.name) === i)) continue;
    let insertAt = 0;
    node.inputs.forEach((s, j) => {
      const si = slotIndex(s.name);
      if (si !== null && si < i) insertAt = j + 1;
    });
    node.inputs.splice(insertAt, 0, stash[i]);
    changed = true;
  }

  if (changed) reindexLinks(node);
  return changed;
}

// Setting widget.type = "hidden" alone is not enough in this build: the
// canvas leaves a phantom row for the last widget touched unless
// widget.hidden is also set.
function setHidden(widget, hidden) {
  if (hidden) {
    if (widget.__hotHidden) return;
    widget.__hotHidden = {
      type: widget.type,
      computeSize: widget.computeSize,
      hidden: widget.hidden,
      display: widget.element ? widget.element.style.display : undefined,
    };
    widget.type = HIDDEN_TYPE;
    widget.hidden = true;
    widget.computeSize = () => [0, -4];
    if (widget.element) widget.element.style.display = "none";
  } else if (widget.__hotHidden) {
    const prev = widget.__hotHidden;
    widget.type = prev.type;
    widget.hidden = prev.hidden;
    widget.computeSize = prev.computeSize;
    if (widget.element) widget.element.style.display = prev.display ?? "";
    delete widget.__hotHidden;
  }
}

function labelFor(widget, i) {
  const v = typeof widget?.value === "string" ? widget.value.trim() : "";
  return v || defaultName(i);
}

function sync(node) {
  const combo = (node.widgets ?? []).find((w) => w.name === SELECTOR);
  if (!combo) return;

  const widgets = nameWidgets(node);
  if (!widgets.length) return;
  if (!allSlots(node)) return;

  const max = Math.min(widgets.length, node.__hotSlots.length);

  const connected = [];
  let last = -1;
  for (let i = 0; i < max; i++) {
    const wired = findSlot(node, i)?.link != null;
    connected.push(wired);
    if (wired) last = i;
  }

  // Show every slot up to one past the last connection, so there is always
  // somewhere to plug the next thing in. A gap left by a pulled wire stays
  // visible and reusable rather than closing up under the user.
  setVisibleSockets(node, Math.min(Math.max(last + 2, 1), max));

  // A name box belongs to a live connection. An unused slot carries no name,
  // so re-using it later cannot resurrect the label of something removed.
  widgets.forEach((w, i) => {
    const wired = i < max && connected[i];
    setHidden(w, !wired);
    if (!wired && w.value !== defaultName(i)) w.value = defaultName(i);
  });

  const labels = [];
  for (let i = 0; i < max; i++) {
    if (connected[i]) labels.push(labelFor(widgets[i], i));
  }

  // Nothing wired yet: keep one placeholder so the dropdown is not empty.
  // Choosing it fails in Python with "is not connected", which is accurate.
  const options = labels.length ? labels : [defaultName(0)];

  const previous = combo.options?.values ?? [];
  let value = combo.value;

  if (!options.includes(value)) {
    if (options.length === previous.length) {
      // Same number of choices, so a name changed: this is a RENAME. Keep the
      // user pointed at the same position.
      let pos = previous.indexOf(value);
      if (pos < 0) pos = 0;
      value = options[Math.min(pos, options.length - 1)];
    }
    // Count changed: a slot was connected or disconnected. Deliberately do not
    // slide the selection onto a neighbour - a stale value fails loudly in
    // Python, which is the only signal that reaches someone using this through
    // a subgraph.
  }

  combo.options = { ...(combo.options ?? {}), values: options };
  combo.value = value;

  for (let i = 0; i < max; i++) {
    const slot = findSlot(node, i);
    if (slot) slot.label = connected[i] ? labelFor(widgets[i], i) : defaultName(i);
  }

  const size = node.computeSize?.();
  if (size) {
    node.setSize?.([Math.max(node.size?.[0] ?? size[0], size[0]), size[1]]);
  }

  node.setDirtyCanvas?.(true, true);
}

function hookNameWidgets(node) {
  for (const w of nameWidgets(node)) {
    if (w.__hotHooked) continue;
    w.__hotHooked = true;

    const original = w.callback;
    w.callback = function (...args) {
      const result = original?.apply(this, args);
      sync(node);
      return result;
    };
  }
}

app.registerExtension({
  name: "HotComfy.HotLazySwitch",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID) return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function (...args) {
      const result = onNodeCreated?.apply(this, args);
      const node = this;
      allSlots(node); // stash all ten before any are trimmed
      hookNameWidgets(node);
      sync(node);
      return result;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (...args) {
      const result = onConfigure?.apply(this, args);
      const node = this;
      hookNameWidgets(node);
      sync(node);
      return result;
    };

    const onConnectionsChange = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function (...args) {
      const result = onConnectionsChange?.apply(this, args);
      const node = this;
      // Deferred so a disconnect-then-connect rewire settles into one update.
      requestAnimationFrame(() => sync(node));
      return result;
    };
  },
});
