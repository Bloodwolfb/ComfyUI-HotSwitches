import { app } from "../../scripts/app.js";

// Frontend half of Hot Resolution Mode Switch.
//
// The Python side declares every widget from both mechanics up front
// (widgets serialize positionally). This file hides whichever group isn't
// selected by the `mode` combo.
//
// Setting widget.type = "hidden" alone is not enough in this build: the
// canvas leaves a phantom row for the last widget touched unless
// widget.hidden is also set. Matches the setHidden() convention in
// lazy_switch.js.
//
// That still isn't the whole story: every widget here also has a matching
// entry in node.inputs (for "convert to input" support), and collapsing the
// widget's row doesn't remove that socket - it stays a live, connectable
// drop target at a stale position even while "hidden". node.removeInput()
// takes the slot fully out of play (and cleanly disconnects anything wired
// into it), and the stashed object goes right back in via node.inputs.push
// when the widget is shown again.

const NODE_ID = "HotResolutionModeSwitch";
const MODE_WIDGET = "mode";
const MODE_BUCKETED = "Resolution Selector";
const MODE_MANUAL = "Manual Resolution";
const BUCKETED_WIDGETS = ["aspect_ratio", "megapixels", "multiple"];
const MANUAL_WIDGETS = ["width", "height"];
const HIDDEN_TYPE = "hidden";

function setHidden(node, widget, hidden) {
    if (hidden) {
        if (widget.__hotHidden) return;
        widget.__hotHidden = {
            type: widget.type,
            computeSize: widget.computeSize,
            hidden: widget.hidden,
        };
        widget.type = HIDDEN_TYPE;
        widget.hidden = true;
        widget.computeSize = () => [0, -4];

        const idx = (node.inputs ?? []).findIndex((s) => s.name === widget.name);
        if (idx >= 0) {
            widget.__hotHiddenSlot = node.inputs[idx];
            node.removeInput(idx);
        }
    } else if (widget.__hotHidden) {
        const prev = widget.__hotHidden;
        widget.type = prev.type;
        widget.hidden = prev.hidden;
        widget.computeSize = prev.computeSize;
        delete widget.__hotHidden;

        if (widget.__hotHiddenSlot) {
            node.inputs.push(widget.__hotHiddenSlot);
            delete widget.__hotHiddenSlot;
        }
    }
}

function sync(node) {
    const modeWidget = node.widgets?.find((w) => w.name === MODE_WIDGET);
    if (!modeWidget) return;

    // From Image mode shows neither group - the image socket (never hidden,
    // it's not a widget) is the only input that matters there.
    const showBucketed = modeWidget.value === MODE_BUCKETED;
    const showManual = modeWidget.value === MODE_MANUAL;
    for (const widget of node.widgets) {
        if (BUCKETED_WIDGETS.includes(widget.name)) {
            setHidden(node, widget, !showBucketed);
        } else if (MANUAL_WIDGETS.includes(widget.name)) {
            setHidden(node, widget, !showManual);
        }
    }

    const size = node.computeSize?.();
    if (size) node.setSize(size);
    node.setDirtyCanvas?.(true, true);
}

function hookModeWidget(node) {
    const modeWidget = node.widgets?.find((w) => w.name === MODE_WIDGET);
    if (!modeWidget || modeWidget.__hotHooked) return;
    modeWidget.__hotHooked = true;

    const original = modeWidget.callback;
    modeWidget.callback = function (...args) {
        const result = original?.apply(this, args);
        sync(node);
        return result;
    };
}

app.registerExtension({
    name: "HotComfy.HotResolutionModeSwitch",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_ID) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function (...args) {
            const result = onNodeCreated?.apply(this, args);
            hookModeWidget(this);
            sync(this);
            return result;
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (...args) {
            const result = onConfigure?.apply(this, args);
            hookModeWidget(this);
            sync(this);
            return result;
        };
    },
});
