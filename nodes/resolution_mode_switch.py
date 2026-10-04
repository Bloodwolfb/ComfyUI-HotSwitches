from comfy_api.latest import io

# Same aspect ratios/formula as the core "Resolution Selector" node
# (comfy_extras/nodes_resolution.py), duplicated here so this pack has no
# dependency on ComfyUI internals.
ASPECT_RATIOS = {
    "1:1 (Square)": (1, 1),
    "2:3 (Portrait Photo)": (2, 3),
    "3:2 (Photo)": (3, 2),
    "3:4 (Portrait Standard)": (3, 4),
    "4:3 (Standard)": (4, 3),
    "9:16 (Portrait Widescreen)": (9, 16),
    "16:9 (Widescreen)": (16, 9),
    "21:9 (Ultrawide)": (21, 9),
}

MODE_BUCKETED = "Resolution Selector"
MODE_MANUAL = "Manual Resolution"
MODE_IMAGE = "From Image"


class HotResolutionModeSwitch(io.ComfyNode):
    """
    Switches between a bucketed Resolution Selector (aspect ratio + megapixels
    + multiple, same formula as core's Resolution Selector), a manual
    width/height pair, and reading the size of a connected image.

    All widgets from every mechanic are declared up front since widgets
    serialize positionally; js/resolution_mode_switch.js hides whichever
    aren't active on the node. The image socket is deliberately never hidden -
    hiding a socket would drop its wire every time the mode flips.

    The image input is lazy, so whatever feeds it only runs in From Image mode.
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="HotResolutionModeSwitch",
            display_name="Hot Resolution Mode Switch",
            category="HotComfy/Switches",
            description="Switch between a bucketed Resolution Selector (aspect "
                        "ratio + megapixels + multiple), a manual width/height "
                        "pair, or the size of a connected image. Only the "
                        "active mechanic's controls are shown on the node, and "
                        "the image branch only runs in From Image mode.",
            inputs=[
                io.Combo.Input(
                    "mode",
                    options=[MODE_BUCKETED, MODE_MANUAL, MODE_IMAGE],
                    default=MODE_BUCKETED,
                    tooltip="Which mechanic drives the output width/height.",
                ),
                io.Combo.Input(
                    "aspect_ratio",
                    options=list(ASPECT_RATIOS.keys()),
                    default="1:1 (Square)",
                    tooltip="The aspect ratio for the bucketed dimensions.",
                ),
                io.Float.Input(
                    "megapixels",
                    default=1.0,
                    min=0.1,
                    max=16.0,
                    step=0.1,
                    tooltip="Target total megapixels. 1.0 MP ≈ 1024x1024 for square.",
                ),
                io.Int.Input(
                    "multiple",
                    default=8,
                    min=8,
                    max=128,
                    step=4,
                    tooltip="Nearest multiple of the result to round the bucketed resolution to.",
                ),
                io.Int.Input(
                    "width",
                    default=512,
                    min=64,
                    max=16384,
                    step=8,
                    tooltip="Manual width. Used when mode is Manual Resolution.",
                ),
                io.Int.Input(
                    "height",
                    default=512,
                    min=64,
                    max=16384,
                    step=8,
                    tooltip="Manual height. Used when mode is Manual Resolution.",
                ),
                # Declared last: it's a socket, not a widget, so it takes no
                # slot in widgets_values and existing saved workflows load
                # unchanged.
                io.Image.Input(
                    "image",
                    optional=True,
                    lazy=True,
                    tooltip="Image to read the size from. Used when mode is "
                            "From Image; ignored (and not evaluated) otherwise.",
                ),
            ],
            outputs=[
                io.Int.Output("width", tooltip="Selected width in pixels."),
                io.Int.Output("height", tooltip="Selected height in pixels."),
            ],
        )

    @classmethod
    def check_lazy_status(cls, mode=None, **kwargs) -> list[str]:
        # A wired-but-unevaluated lazy input arrives as image=None; an unwired
        # one is absent from kwargs entirely. Requesting an unwired input makes
        # the executor raise an unhelpful NodeInputError, so only ask for it
        # when it's actually connected and let execute() report the rest.
        if mode == MODE_IMAGE and "image" in kwargs and kwargs["image"] is None:
            return ["image"]
        return []

    @classmethod
    def execute(cls, mode, aspect_ratio, megapixels, multiple, width, height,
                image=None) -> io.NodeOutput:
        if mode == MODE_BUCKETED:
            w_ratio, h_ratio = ASPECT_RATIOS[aspect_ratio]
            total_pixels = megapixels * 1024 * 1024
            scale = (total_pixels / (w_ratio * h_ratio)) ** 0.5
            width = round(w_ratio * scale / multiple) * multiple
            height = round(h_ratio * scale / multiple) * multiple
        elif mode == MODE_IMAGE:
            if image is None:
                raise ValueError(
                    "Hot Resolution Mode Switch: mode is 'From Image' but "
                    "nothing is connected to the image input."
                )
            # ComfyUI images are [batch, height, width, channels].
            height = image.shape[1]
            width = image.shape[2]

        return io.NodeOutput(int(width), int(height))
