# SPDX-License-Identifier: MIT OR Apache-2.0
"""Rigby2D scripting API.

Scripts edit the open project and add custom tools to the Scripts menu::

    import rigby

    @rigby.tool("Mirror selected bones", description="Flip the selected bones across X = 0")
    def mirror():
        for bone in rigby.selected_bones():
            bone.x = -bone.x
            bone.rotation = 180 - bone.rotation

A whole script run, or one run of a tool, is a single undo step. When it raises an exception the
project is left exactly as it was, and the traceback appears in the log (View > Log).
"""

import json as _json

import _rigby_bridge as _bridge

__all__ = [
    "RigbyError", "Bone", "Slot", "Animation",
    "info", "bones", "bone", "add_bone", "slots", "slot",
    "animations", "animation", "add_animation", "current_animation",
    "selected_bones", "select", "time", "set_time", "mode", "set_mode", "fps",
    "log", "warn", "error", "status", "tool", "tools",
]

CHANNELS = ("rotate", "translate", "scale", "shear")
CURVES = ("linear", "stepped", "ease_in", "ease_out", "ease_in_out")


class RigbyError(Exception):
    """A request the editor cannot do: an unknown name, a bad value."""


def _call(function, /, **args):
    try:
        result = _bridge.call(function, _json.dumps(args))
    except Exception as e:  # JsException: the editor refused the call
        message = str(e)
        for prefix in ("RigbyError: ", "Error: "):
            if prefix in message:
                message = message.split(prefix, 1)[1]
        raise RigbyError(message.strip()) from None
    return _json.loads(result)


# ---- objects ------------------------------------------------------------------------------------


class Bone:
    """A bone. Setup-pose fields are relative to the parent bone; setting one changes the setup pose."""

    __slots__ = ("_name",)
    _FIELDS = ("x", "y", "rotation", "scale_x", "scale_y", "shear_x", "shear_y", "length")

    def __init__(self, name):
        object.__setattr__(self, "_name", name)

    @property
    def name(self):
        return self._name

    @name.setter
    def name(self, value):
        _call("set_bone", name=self._name, fields={"name": value})
        object.__setattr__(self, "_name", value)

    def _data(self):
        return _call("bone", name=self._name)

    def __getattr__(self, field):
        if field in Bone._FIELDS:
            return self._data()[field]
        raise AttributeError(f"Bone has no attribute '{field}'")

    def __setattr__(self, field, value):
        if field in Bone._FIELDS:
            _call("set_bone", name=self._name, fields={field: value})
        elif field == "name":
            Bone.name.fset(self, value)
        else:
            raise AttributeError(f"Bone has no attribute '{field}'")

    def set(self, **fields):
        """Sets several setup fields at once: bone.set(x=10, rotation=45)."""
        _call("set_bone", name=self._name, fields=fields)
        return self

    @property
    def parent(self):
        p = self._data()["parent"]
        return Bone(p) if p is not None else None

    @property
    def children(self):
        return [Bone(b["name"]) for b in _call("bones") if b["parent"] == self._name]

    @property
    def world(self):
        """World transform in the pose shown: dict with x, y, rotation, scale_x, scale_y."""
        return _call("world", name=self._name)

    def key(self, channel, value, time=None, animation=None, curve="linear"):
        """Keys a channel ('rotate', 'translate', 'scale', 'shear') at `time` (default: current time).

        Values are relative to the setup pose: rotate adds degrees; translate and shear add (x, y);
        scale multiplies by (x, y).
        """
        if channel != "rotate":
            value = [float(value[0]), float(value[1])]
        return _call("set_key", animation=animation, bone=self._name, channel=channel, time=time, value=value, curve=curve)

    def delete_key(self, channel, time=None, animation=None):
        return _call("delete_key", animation=animation, bone=self._name, channel=channel, time=time)

    def keys(self, channel, animation=None):
        """Keys of a channel: list of dicts with time, value and curve."""
        return _call("keys", animation=animation, bone=self._name, channel=channel)

    def __eq__(self, other):
        return isinstance(other, Bone) and other._name == self._name

    def __hash__(self):
        return hash(("bone", self._name))

    def __repr__(self):
        return f"Bone({self._name!r})"


class Slot:
    """A slot: what is drawn for a bone, and in which color."""

    def __init__(self, name):
        self._name = name

    @property
    def name(self):
        return self._name

    def _data(self):
        for s in _call("slots"):
            if s["name"] == self._name:
                return s
        raise RigbyError(f"No slot '{self._name}'")

    @property
    def bone(self):
        return Bone(self._data()["bone"])

    @property
    def attachments(self):
        return list(self._data()["attachments"])

    @property
    def attachment(self):
        return self._data()["attachment"]

    @attachment.setter
    def attachment(self, name):
        _call("set_slot", name=self._name, fields={"attachment": name})

    @property
    def color(self):
        return tuple(self._data()["color"])

    @color.setter
    def color(self, rgba):
        _call("set_slot", name=self._name, fields={"color": [float(c) for c in rgba]})

    def __repr__(self):
        return f"Slot({self._name!r})"


class Animation:
    def __init__(self, name):
        self._name = name

    @property
    def name(self):
        return self._name

    @property
    def duration(self):
        for a in _call("animations"):
            if a["name"] == self._name:
                return a["duration"]
        raise RigbyError(f"No animation '{self._name}'")

    @duration.setter
    def duration(self, seconds):
        _call("set_duration", animation=self._name, duration=seconds)

    def key(self, bone, channel, time, value, curve="linear"):
        b = bone.name if isinstance(bone, Bone) else bone
        return Bone(b).key(channel, value, time=time, animation=self._name, curve=curve)

    def open(self):
        """Shows this animation in the editor."""
        _call("set_animation", name=self._name)
        return self

    def __repr__(self):
        return f"Animation({self._name!r})"


# ---- project ------------------------------------------------------------------------------------


def info():
    """The open project: path, workspace, fps, mode, time, animation, skin."""
    return _call("info")


def bones():
    return [Bone(b["name"]) for b in _call("bones")]


def bone(name):
    _call("bone", name=name)
    return Bone(name)


def add_bone(name, parent="root", x=0.0, y=0.0, rotation=0.0, length=0.0):
    p = parent.name if isinstance(parent, Bone) else parent
    _call("add_bone", name=name, parent=p, x=x, y=y, rotation=rotation, length=length)
    return Bone(name)


def slots():
    return [Slot(s["name"]) for s in _call("slots")]


def slot(name):
    s = Slot(name)
    s._data()
    return s


def animations():
    return [Animation(a["name"]) for a in _call("animations")]


def animation(name):
    a = Animation(name)
    a.duration  # raises if missing
    return a


def add_animation(name, duration=0.0):
    _call("add_animation", name=name, duration=duration)
    return Animation(name)


def current_animation():
    name = info()["animation"]
    return Animation(name) if name is not None else None


def selected_bones():
    return [Bone(n) for n in _call("selection")]


def select(*bones_or_names):
    names = [b.name if isinstance(b, Bone) else b for b in bones_or_names]
    return _call("select", names=names)


def time():
    return info()["time"]


def set_time(seconds):
    return _call("set_time", time=seconds)


def mode():
    return info()["mode"]


def set_mode(value):
    return _call("set_mode", mode=value)


def fps():
    return info()["fps"]


# ---- output -------------------------------------------------------------------------------------


def _text(args):
    return " ".join(str(a) for a in args)


def log(*args):
    _call("log", level="info", text=_text(args))


def warn(*args):
    _call("log", level="warn", text=_text(args))


def error(*args):
    _call("log", level="error", text=_text(args))


def status(text):
    """Shows a message in the status bar."""
    _call("status", text=str(text))


# ---- tools --------------------------------------------------------------------------------------

_tools = {}


def tool(label, description=""):
    """Decorator: adds a function (no arguments) to the Scripts menu as a tool."""

    def register(fn):
        if not callable(fn):
            raise TypeError("@rigby.tool decorates a function")
        _tools[label] = {"label": label, "description": description, "fn": fn}
        return fn

    return register


def tools():
    return list(_tools)


# Called by the editor. Tools are kept per script, so reloading a script replaces only its tools.
_registry = {}


def _begin(script):
    _tools.clear()


def _collect(script):
    _registry[script] = dict(_tools)
    _tools.clear()
    return _json.dumps([{"label": t["label"], "description": t["description"]} for t in _registry[script].values()])


def _forget(script):
    _registry.pop(script, None)
    _tools.clear()


def _run(script, label):
    _registry[script][label]["fn"]()
