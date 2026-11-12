# SPDX-License-Identifier: MIT OR Apache-2.0
# Renders the demo scene at fixed animation times and saves the frames to tests/output/
# (needs a renderer, so run it without --headless):
#   godot --path runtimes/godot --script res://tests/capture.gd
extends SceneTree

const TIMES := [0.0, 0.42, 1.2]


func _initialize() -> void:
	var scene: Node = load("res://demo/main.tscn").instantiate()
	root.add_child(scene)
	_capture.call_deferred(scene)


func _capture(scene: Node) -> void:
	var node: RigbySkeleton2D = scene.get_node("Rigbytron")
	node.playing = false
	node.show_bones = false
	scene.get_node("Hint").visible = false
	DirAccess.make_dir_recursive_absolute("res://tests/output")
	node.play("release", false, 0.0)
	var t := 0.0
	for i in TIMES.size():
		node.advance(TIMES[i] - t)
		t = TIMES[i]
		await process_frame
		await process_frame
		await RenderingServer.frame_post_draw
		var image := root.get_texture().get_image()
		image.save_png("res://tests/output/release_%d.png" % i)
		print("saved release_%d.png (t = %.2f s, %d batches)" % [i, t, node.get_draw_batch_count()])
	quit(0)
