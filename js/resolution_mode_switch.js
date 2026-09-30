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

const NODE_ID = "HotResolutionModeSwitch";
const MODE_WIDGET = "mode";
const MODE_BUCKETED = "Resolution Selector";
const BUCKETED_WIDGETS = ["aspect_ratio", "megapixels", "multiple"];
const MANUAL_WIDGETS = ["width", "height"];
const HIDDEN_TYPE = "hidden";

function setHidden(widget, hidden) {
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
    } else if (widget.__hotHidden) {
        const prev = widget.__hotHidden;
        widget.type = prev.type;
        widget.hidden = prev.hidden;
        widget.computeSize = prev.computeSize;
        delete widget.__hotHidden;
    }
}

function sync(node) {
    const modeWidget = node.widgets?.find((w) => w.name === MODE_WIDGET);
    if (!modeWidget) return;

    const isBucketed = modeWidget.value === MODE_BUCKETED;
    for (const widget of node.widgets) {
        if (BUCKETED_WIDGETS.includes(widget.name)) {
            setHidden(widget, !isBucketed);
        } else if (MANUAL_WIDGETS.includes(widget.name)) {
            setHidden(widget, isBucketed);
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
