from typing_extensions import override
from comfy_api.latest import ComfyExtension, io

from .nodes.lazy_switch import HotLazySwitch
from .nodes.resolution_mode_switch import HotResolutionModeSwitch


class HotSwitchesExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [HotLazySwitch, HotResolutionModeSwitch]


async def comfy_entrypoint() -> ComfyExtension:
    return HotSwitchesExtension()


# Deliberately no NODE_CLASS_MAPPINGS: ComfyUI's V1 loader branch would
# otherwise shadow this V3 registration before comfy_entrypoint is reached.
WEB_DIRECTORY = "./js"

__all__ = ["comfy_entrypoint", "WEB_DIRECTORY"]
