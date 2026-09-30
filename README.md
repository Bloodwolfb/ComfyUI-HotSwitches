# ComfyUI-HotSwitches

Switch nodes for ComfyUI, all under the **HotComfy/Switches** category.

## Nodes

### Hot Lazy Switch

A universal switch that works with any type. Give each connected input a
name; the `index` dropdown selects by that name, not by position, so the
choice survives being promoted into a subgraph. Only the selected branch is
evaluated (lazy) - unselected branches don't run.

Sockets reveal progressively as you connect them, up to 10 slots. A pulled
wire leaves a visible empty socket rather than renumbering the rest.

### Hot Resolution Mode Switch

Switches between two ways of producing a width/height pair on one node:

- **Resolution Selector** - aspect ratio + target megapixels + rounding
  multiple, same formula as ComfyUI core's built-in Resolution Selector node.
- **Manual Resolution** - direct width/height fields.

Only the active mechanic's widgets are shown; the `mode` dropdown swaps them.

## Installation

Clone into your ComfyUI `custom_nodes` folder and restart ComfyUI:

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/<your-github-username>/ComfyUI-HotSwitches.git
```

No extra Python dependencies required.

## Requirements

Both nodes use ComfyUI's V3 node schema (`comfy_api.latest.io`), so they need
a reasonably current ComfyUI build that ships that API.

## License

MIT - see [LICENSE](LICENSE).
