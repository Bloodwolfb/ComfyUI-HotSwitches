import gc
import copy
import importlib.util
import pathlib
import os
import sys
import unittest
import weakref
from types import SimpleNamespace
from unittest.mock import patch

PACKAGE_ROOT = pathlib.Path(__file__).resolve().parents[1]
ROOT = pathlib.Path(os.environ.get("COMFYUI_ROOT", str(PACKAGE_ROOT.parents[1])))
if not (ROOT / "comfy").is_dir():
    raise SystemExit("Set COMFYUI_ROOT to your ComfyUI folder and use its Python environment.")
sys.path.insert(0, str(ROOT))
sys.argv = [sys.argv[0], "--cpu"]

import comfy.options
comfy.options.enable_args_parsing()

import torch
import comfy.model_management as mm
from comfy.model_patcher import ModelPatcher
from comfy.patcher_extension import WrappersMP, WrapperExecutor
from comfy_api.latest import io

sys.argv = [sys.argv[0]]
spec = importlib.util.spec_from_file_location(
    "hot_switch_under_test", PACKAGE_ROOT / "nodes/lazy_switch.py",
)
switch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(switch)


class HotSwitchTests(unittest.TestCase):
    def setUp(self):
        switch._model_selections.clear()
        self.resident = []
        self.unloaded = []
        self.events = []
        self.loaded_patch = patch.object(mm, "loaded_models", lambda: list(self.resident))
        self.unload_patch = patch.object(mm, "unload_model_and_clones", self.unload)
        self.loaded_patch.start()
        self.unload_patch.start()
        self.addCleanup(self.loaded_patch.stop)
        self.addCleanup(self.unload_patch.stop)

    @staticmethod
    def model():
        return ModelPatcher(torch.nn.Linear(2, 2), torch.device("cpu"), torch.device("cpu"))

    def select(self, model, node_id="switch-a", **kwargs):
        node = switch.HotLazySwitch.PREPARE_CLASS_CLONE({
            "hidden_inputs": {io.Hidden.unique_id: node_id},
        })
        return node.execute(index="Input 1", input_0=model, **kwargs)[0]

    def unload(self, model, *, unload_additional_models, all_devices):
        self.assertFalse(unload_additional_models)
        self.assertTrue(all_devices)
        self.unloaded.append(model.clone_base_uuid)
        self.events.append(("unload", model.clone_base_uuid))
        self.resident[:] = [
            p for p in self.resident if p.clone_base_uuid != model.clone_base_uuid
        ]

    def sample(self, model):
        def prepare(patcher, shape, *, model_options):
            self.events.append(("prepare", patcher.clone_base_uuid))
            if patcher not in self.resident:
                self.resident.append(patcher)
            self.assertEqual(shape, (1, 4, 8, 8))
            self.assertEqual(model_options, {"sentinel": True})
            return "prepared"

        executor = WrapperExecutor.new_executor(
            prepare, model.get_all_wrappers(WrappersMP.PREPARE_SAMPLING),
        )
        self.assertEqual(executor.execute(model, (1, 4, 8, 8), model_options={"sentinel": True}), "prepared")

    def test_repeated_model_keeps_weights_and_cached_switch_back_unloads_previous(self):
        a, b, encoder, vae, unrelated = [self.model() for _ in range(5)]
        self.resident.extend([encoder, vae, unrelated])
        cached_a = self.select(a)
        self.sample(cached_a)
        self.sample(cached_a)
        self.assertEqual(self.unloaded, [])

        cached_b = self.select(b)
        a_clone = cached_a.clone()
        self.resident.append(a_clone)
        self.sample(cached_b)
        self.assertEqual(self.unloaded, [a.clone_base_uuid])
        self.assertFalse(any(p.clone_base_uuid == a.clone_base_uuid for p in self.resident))
        self.assertEqual(self.events[-2:], [("unload", a.clone_base_uuid), ("prepare", b.clone_base_uuid)])

        # Do not execute the switch again: reuse the previously cached A output.
        self.sample(cached_a)
        self.sample(cached_a)
        self.assertEqual(self.unloaded, [a.clone_base_uuid, b.clone_base_uuid])
        for retained in (encoder, vae, unrelated, cached_a):
            self.assertIn(retained, self.resident)

    def test_new_clone_of_same_weights_does_not_unload(self):
        a = self.model()
        self.sample(self.select(a))
        self.sample(self.select(a.clone()))
        self.assertEqual(self.unloaded, [])

    def test_previous_weights_are_unloaded_after_cached_outputs_are_evicted(self):
        a, b = self.model(), self.model()
        out_a = self.select(a)
        self.sample(out_a)
        # ComfyUI can evict switch/patch outputs while the loader still owns
        # the same resident weights and the loaded-model entry falls back to it.
        self.resident[:] = [a]
        del out_a
        gc.collect()
        self.sample(self.select(b))
        self.assertEqual(self.unloaded, [a.clone_base_uuid])

    def test_new_model_in_same_slot_is_recognized(self):
        a, replacement = self.model(), self.model()
        self.sample(self.select(a))
        self.sample(self.select(replacement))
        self.assertEqual(self.unloaded, [a.clone_base_uuid])

    def test_non_model_inputs_pass_through_unchanged(self):
        class ClipOrVae:
            def __init__(self, patcher):
                self.patcher = patcher

        for value in ("text", 7, True, torch.zeros(1, 2, 2, 3), {"samples": torch.zeros(1)}, ClipOrVae(self.model())):
            self.assertIs(self.select(value), value)
        self.assertEqual(self.unloaded, [])
        self.assertEqual(len(switch._model_selections), 0)

    def test_separate_switches_do_not_unload_each_others_models(self):
        a, b, c = [self.model() for _ in range(3)]
        out_a = self.select(a, "switch-a")
        out_b = self.select(b, "switch-b")
        self.sample(out_a)
        self.sample(out_b)
        self.assertEqual(self.unloaded, [])
        out_c = self.select(c, "switch-a")
        self.sample(out_c)
        self.assertEqual(self.unloaded, [a.clone_base_uuid])
        self.assertIn(out_b, self.resident)

    def test_option_off_returns_original_model(self):
        a = self.model()
        out = self.select(a, unload_previous_model=False)
        self.assertIs(out, a)
        self.sample(out)
        self.assertEqual(out.get_all_wrappers(WrappersMP.PREPARE_SAMPLING), [])
        self.assertEqual(self.unloaded, [])

    def test_downstream_patches_keep_wrapper_without_modifying_source(self):
        a, b = self.model(), self.model()
        out_a = self.select(a)
        out_b = self.select(b)
        self.assertEqual(a.get_all_wrappers(WrappersMP.PREPARE_SAMPLING), [])
        downstream_a, downstream_b = out_a.clone().clone(), out_b.clone().clone()
        self.sample(downstream_a)
        self.sample(downstream_b)
        self.assertEqual(self.unloaded, [a.clone_base_uuid])
        wrapped_twice = self.select(out_a)
        self.assertEqual(len(wrapped_twice.get_all_wrappers(WrappersMP.PREPARE_SAMPLING)), 1)

    def test_bookkeeping_keeps_identity_without_keeping_models_alive(self):
        a = self.model()
        out = self.select(a)
        self.sample(out)
        ref = weakref.ref(out)
        source_ref = weakref.ref(a)
        state_ref = weakref.ref(switch._model_selections["switch-a"])
        model_id = a.clone_base_uuid
        self.resident.clear()
        del out, a
        gc.collect()
        self.assertIsNone(ref())
        self.assertIsNone(source_ref())
        self.assertIsNotNone(state_ref())
        self.assertEqual(state_ref().model_id, model_id)

    def test_lazy_schema_and_old_widget_positions_are_preserved(self):
        schema = switch.HotLazySwitch.GET_SCHEMA()
        inputs = switch.HotLazySwitch.INPUT_TYPES()
        for i in range(10):
            self.assertTrue(inputs["optional"][f"input_{i}"][1]["lazy"])
        widget_ids = [i.id for i in schema.inputs if not i.id.startswith("input_")]
        self.assertEqual(widget_ids, ["index"] + [f"name_{i}" for i in range(10)] + ["unload_previous_model"])
        self.assertEqual(schema.hidden, [io.Hidden.unique_id])
        self.assertEqual(switch.HotLazySwitch.check_lazy_status(index="Input 2", input_0=None, input_1=None), ["input_1"])

    def test_real_executor_reuses_cached_switch_and_loads_only_selected_branch(self):
        import execution
        import nodes

        owner = self
        calls = {"a": 0, "b": 0}

        class Loader:
            @classmethod
            def INPUT_TYPES(cls):
                return {"required": {"name": ("STRING",)}}

            RETURN_TYPES = ("MODEL",)
            FUNCTION = "load"

            def load(self, name):
                calls[name] += 1
                return (owner.model(),)

        class Sampler:
            @classmethod
            def INPUT_TYPES(cls):
                return {"required": {"model": ("MODEL",), "run": ("INT",)}}

            RETURN_TYPES = ()
            OUTPUT_NODE = True
            FUNCTION = "sample"

            def sample(self, model, run):
                owner.sample(model)
                return {"ui": {"text": [str(run)]}}

        prompt = {
            "a": {"class_type": "HotTestLoader", "inputs": {"name": "a"}},
            "b": {"class_type": "HotTestLoader", "inputs": {"name": "b"}},
            "switch": {"class_type": "HotLazySwitch", "inputs": {
                "index": "Input 1", "input_0": ["a", 0], "input_1": ["b", 0],
            }},
            "out": {"class_type": "HotTestSampler", "inputs": {"model": ["switch", 0], "run": 1}},
        }
        server = SimpleNamespace(client_id=None, send_sync=lambda *a, **k: None)
        with patch.dict(nodes.NODE_CLASS_MAPPINGS, {
            "HotTestLoader": Loader, "HotTestSampler": Sampler,
            "HotLazySwitch": switch.HotLazySwitch,
        }):
            executor = execution.PromptExecutor(server, cache_type=execution.CacheType.RAM_PRESSURE,
                                                cache_args={"ram": 0, "ram_inactive": 0})
            for run, choice in enumerate(("Input 1", "Input 1", "Input 2", "Input 2", "Input 1", "Input 1"), 1):
                current = copy.deepcopy(prompt)
                current["switch"]["inputs"]["index"] = choice
                current["out"]["inputs"]["run"] = run
                executor.execute(current, f"test-{run}", execute_outputs=["out"])
                self.assertTrue(executor.success, executor.status_messages)
                cached = next(m["nodes"] for event, m in executor.status_messages if event == "execution_cached")
                if run in (2, 4, 5, 6):
                    self.assertIn("switch", cached)
                if run == 1:
                    self.assertEqual(calls, {"a": 1, "b": 0})
                self.assertEqual(len(self.resident), 1)
            self.assertEqual(calls, {"a": 1, "b": 1})
            self.assertEqual(len(self.unloaded), 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
