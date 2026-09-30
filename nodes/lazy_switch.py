from comfy_api.latest import io

MAX_SLOTS = 10


def default_name(i: int) -> str:
    return f"Input {i + 1}"


def slot_key(i: int) -> str:
    return f"input_{i}"


class HotLazySwitch(io.ComfyNode):
    """
    Universal lazy switch with per-instance named options.

    The selector is a COMBO so that promoting it into a subgraph shows labels
    rather than a raw index. COMBO options come from the schema, which is
    class-level, so js/lazy_switch.js rewrites them from the name_* widgets on
    each node. Selection resolves by NAME, not position.

    Inputs are lazy: only the selected branch is evaluated, so this prunes the
    graph rather than merely picking a value.
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        # One shared type binding across every slot and the output, so the node
        # adopts the type of whatever is plugged in instead of being a wildcard.
        match = io.MatchType.Template("hot_lazy_switch")

        # Declared statically rather than with io.Autogrow, and that is the
        # whole point. The scheduler decides link strength in
        # comfy_execution/graph.py, reading `lazy` via get_input_info against
        # the RAW INPUT_TYPES - before dynamic expansion has happened. An
        # Autogrow slot ("inputs.input_0") is not in the raw schema, so it
        # resolves to None, is_lazy comes out False, every upstream gets a
        # strong link, and all branches load eagerly. check_lazy_status is still
        # called afterwards, which makes it look wired up while pruning nothing.
        #
        # Statically declared inputs are visible to that lookup, so lazy works.
        # The frontend hides the unused sockets instead.
        inputs = [
            io.MatchType.Input(
                slot_key(i), template=match, lazy=True, optional=True,
                display_name=default_name(i),
            )
            for i in range(MAX_SLOTS)
        ]

        inputs.append(
            io.Combo.Input(
                "index",
                options=[default_name(i) for i in range(MAX_SLOTS)],
                default=default_name(0),
                tooltip="Which named input to pass through. Promote this widget "
                        "to a subgraph to expose the choice by name.",
            )
        )

        # Widgets serialize positionally, so these are all declared up front and
        # hidden when unused rather than created on demand.
        inputs += [
            io.String.Input(
                f"name_{i}",
                default=default_name(i),
                tooltip=f"Label shown for input_{i}.",
            )
            for i in range(MAX_SLOTS)
        ]

        return io.Schema(
            node_id="HotLazySwitch",
            display_name="Hot Lazy Switch",
            category="HotComfy/Switches",
            description="Lazy switch with named, per-instance options that "
                        "survive subgraph promotion. Works with any type, and "
                        "only the selected branch is executed.",
            inputs=inputs,
            outputs=[io.MatchType.Output(template=match, display_name="output")],
        )

    # -- resolution ---------------------------------------------------------

    @classmethod
    def _labels(cls, kwargs: dict) -> list[str]:
        labels = []
        for i in range(MAX_SLOTS):
            value = kwargs.get(f"name_{i}")
            value = value.strip() if isinstance(value, str) else ""
            labels.append(value or default_name(i))
        return labels

    @classmethod
    def _resolve(cls, index, kwargs: dict) -> int:
        labels = cls._labels(kwargs)

        if isinstance(index, str) and index in labels:
            return labels.index(index)

        # Fall back to a raw integer so an index-based workflow still runs.
        try:
            i = int(index)
        except (TypeError, ValueError):
            raise ValueError(
                f"Hot Lazy Switch: {index!r} is not one of {labels}."
            )

        if 0 <= i < MAX_SLOTS:
            return i

        raise ValueError(
            f"Hot Lazy Switch: index {i} out of range (0-{MAX_SLOTS - 1})."
        )

    @staticmethod
    def _connected(kwargs: dict) -> list[str]:
        return sorted(
            (k for k in kwargs if k.startswith("input_") and kwargs[k] is not None),
            key=lambda k: int(k.split("_")[1]),
        )

    # -- hooks --------------------------------------------------------------

    @classmethod
    def validate_inputs(cls, **kwargs) -> bool:
        # The frontend rewrites the combo options from the name_* widgets, so
        # the live value is deliberately not a member of the declared list.
        # Accepting **kwargs skips all built-in validation for this node
        # (execution.py gates the option check on validate_has_kwargs).
        return True

    @classmethod
    def check_lazy_status(cls, index=None, **kwargs) -> list[str]:
        i = cls._resolve(index, kwargs)
        key = slot_key(i)
        return [] if kwargs.get(key) is not None else [key]

    @classmethod
    def execute(cls, index=None, **kwargs) -> io.NodeOutput:
        i = cls._resolve(index, kwargs)
        label = cls._labels(kwargs)[i]
        value = kwargs.get(slot_key(i))

        if value is None:
            connected = cls._connected(kwargs) or ["none"]
            raise ValueError(
                f"Hot Lazy Switch: selected '{label}' ({slot_key(i)}) is not "
                f"connected. Connected slots: {', '.join(connected)}."
            )

        return io.NodeOutput(value)
