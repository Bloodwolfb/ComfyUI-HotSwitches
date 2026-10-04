<p align="center">
  <img src="docs/images/icon.png" width="120" alt="ComfyUI-HotSwitches icon">
</p>

# ComfyUI-HotSwitches

I kept doing the same annoying thing in ComfyUI: wanting to try a different
model's variations or a different model altogether, or a different resolution, 
and ending up either rewiring a tangle of
noodles or keeping five slightly-different copies of the same workflow around
just so I could run A/B tests on something. These two nodes exist so I could stop doing
that. Pick from a dropdown, keep working.

## Nodes

### Hot Lazy Switch

<img src="docs/images/hot-lazy-switch.png" alt="Hot Lazy Switch node with six named model inputs" width="420">

Plug in up to 10 things of any type - models, images, conditioning, whatever
- give each one a name, and pick which one feeds downstream from a single
dropdown. The unpicked branches don't just get ignored, they don't run at
all, so you're not paying the load/compute cost for every option every time,
only the one you're actually using.

Sockets show up one at a time as you connect them, so the node isn't a wall
of ten empty inputs on day one. Unplug something and its socket stays put
rather than shuffling everything below it around.

The selector is a dropdown rather than a raw index, so promoting it into a
subgraph input still shows real names to pick from instead of a bare number:

<img src="docs/images/hot-lazy-switch-subgraph.png" alt="The index selector promoted to a subgraph input, showing a filterable dropdown of real names" width="500">

### Hot Resolution Mode Switch

<img src="docs/images/hot-resolution-mode-switch-selector.png" alt="Hot Resolution Mode Switch in Resolution Selector mode" width="400"> <img src="docs/images/hot-resolution-mode-switch-manual.png" alt="Hot Resolution Mode Switch in Manual Resolution mode" width="400">

For when you want the convenience of an aspect-ratio + megapixel resolution
picker most of the time, but still want to drop in exact numbers sometimes -
or just match the size of an image you already have. One dropdown flips the
node between:

- **Resolution Selector** - pick an aspect ratio and a target megapixel
  count, it does the math (same formula as ComfyUI's own built-in Resolution
  Selector node).
- **Manual Resolution** - just type the width and height yourself.
- **From Image** - plug an image into the `image` input and it outputs that
  image's width and height. Saves you a separate Get Image Size node.

Only the controls for whichever mode you're in are shown, so the node isn't
cluttered with fields you're not using. The `image` input is lazy, too:
whatever feeds it (a loader, a scaler, a whole chain) only runs when you're
actually in From Image mode.

## Installation

**Via ComfyUI-Manager:** open Manager -> Install via Git URL -> paste
`https://github.com/Bloodwolfb/ComfyUI-HotSwitches.git` -> restart ComfyUI.

**Manually:** clone into your ComfyUI `custom_nodes` folder and restart:

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/Bloodwolfb/ComfyUI-HotSwitches.git
```

No extra Python dependencies required.

## Example Workflow

[`examples/hot_switches_demo.json`](examples/hot_switches_demo.json) has both
nodes wired up and annotated with notes explaining what to do with them -
drag it straight into ComfyUI (or Workflow -> Open) to see them working live.
It uses plain Text nodes as stand-ins for whatever you'd actually switch
between, so it opens and runs for anyone regardless of what models they have
installed, and it shows Hot Lazy Switch both plain and promoted into a
subgraph (the way it's meant to be used).

## Requirements

Both nodes use ComfyUI's V3 node schema (`comfy_api.latest.io`), so they need
a reasonably current ComfyUI build that ships that API.

## License

MIT - see [LICENSE](LICENSE). TLDR version: do whatever you want
with this - use it, modify it, ship it in something you sell - just keep
it credited to me, Brad Girman, as the original author. That's the actual
legal requirement (not just the license file along for the ride), it's
just easy to miss buried in license jargon.
