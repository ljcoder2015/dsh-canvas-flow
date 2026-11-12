# Demo: Rigbytron holds, slashes on Space, and reports animation events.
extends Node2D

@onready var rigbytron: RigbySkeleton2D = $Rigbytron


func _ready() -> void:
	rigbytron.animation_event.connect(_on_event)
	rigbytron.animation_completed.connect(_on_completed)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_SPACE:
			rigbytron.set_animation_on(0, "release", false, 0.1)
			rigbytron.queue(0, "hold", true, 0.3, -1.0)
		elif event.keycode == KEY_S:
			rigbytron.show_bones = not rigbytron.show_bones


func _on_event(track: int, event_name: String, _int_value: int, _float_value: float, _string_value: String, _audio: String) -> void:
	print("event %s on track %d" % [event_name, track])


func _on_completed(track: int, animation_name: String) -> void:
	print("%s completed on track %d" % [animation_name, track])
