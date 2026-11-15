# Changelog

## 0.3.2 — November 14, 2026

### Hot Lazy Switch: plugs stay where you put them

Some Hot Lazy Switch connections were suddenly jumping to **Input 4**,
including model, CLIP, and VAE selectors connected through a subgraph. That
could leave the switch using a different selection from the one you expected.

This happened when the switch added or hid unused inputs. Those layout
changes could shift an existing wire onto another socket. Connections now
stay attached to the right inputs as the node grows or shrinks, and your
custom labels and selected option stay intact too.

### Hot Resolution Mode Switch: up to 150 MP

The **Resolution Selector** mode now goes up to **150 MP**, increased from
16 MP. Your existing settings keep producing the same dimensions, with the
same aspect ratios and rounding.

Higher targets still need to fit the limits of the nodes using those
dimensions. At 150 MP with the default multiple of 8, 16:9 produces
16720 × 9408 and 21:9 produces 19160 × 8208, so both exceed 16384 pixels
on the long side. The same applies to 9:16 on its tall side.

### After updating

Restart ComfyUI, then hard-refresh the page with **Ctrl+F5**. If a selector
wire already moved in a saved workflow, reconnect it to **index** once and
save the workflow again.

## 0.3.1 — November 14, 2026

### Model unloading now survives ComfyUI clearing its cache

Fixed a gap in 0.3.0 where the switch could forget which model it last used
when ComfyUI discarded cached node outputs. The old model's weights could
still be in VRAM, so switching models would leave them behind again.

The switch now keeps that small piece of bookkeeping independently of the
output cache. It still unloads only the previous model when the selected
model changes, and repeated runs with the same model keep its weights.
The bookkeeping itself does not keep model objects or weights alive.

This fix was checked with real GPU allocations and a sequence of BF16 and
NVFP4 Qwen generations, including repeat runs and switching back.
Restart ComfyUI after updating to activate it.

## 0.3.0 — November 14, 2026

### Switching models without leaving the previous weights behind

When comparing models with the same prompt, previously used models could
stay in VRAM as you worked through the list. Hot Lazy Switch now recognizes
model inputs and unloads its previous model before sampling a different one.

If the model hasn't changed, the switch leaves its weights loaded. You can
keep generating with the same model without an extra unload and reload on
every image. Switching back to an earlier, cached choice is handled too.

The new **Unload previous model** option is enabled by default. It only
unloads the previous model used by that switch and its patched copies;
shared text encoders, VAEs, and unrelated models are left alone. Images,
text, conditioning, and other input types continue to work as before.
Turn the option off to leave model retention to ComfyUI.

### The last custom label no longer clears itself

Fixed a bug where the last named input could reset to its default name
after refreshing the page or reopening a workflow. If that input was
selected, generation could fail because the dropdown's selection no longer
matched the label.

Labels now stay in place while ComfyUI restores the workflow's connections,
including inside subgraphs. Disconnecting and reconnecting a slot also
preserves its name.

### After updating

Restart ComfyUI, then hard-refresh the page with **Ctrl+F5**. Existing
workflows use the new model-unloading behavior by default. If a label was
already overwritten and saved by the old version, restore that name once
and save the workflow again.
