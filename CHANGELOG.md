# Changelog

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
