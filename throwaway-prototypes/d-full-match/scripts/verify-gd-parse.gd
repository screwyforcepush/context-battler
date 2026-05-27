extends SceneTree

# Runtime-parse smoke for every res://src/*.gd script.
#
# Why this exists: round-4 blind-UAT surfaced GDScript parse errors in
# EntityRenderer.gd that the editor parser + the export-release build
# BOTH accepted, but the WASM runtime rejected at load() time. The
# closure summary's "Godot WebAssembly build clean" claim was technically
# true (the .wasm exported) but practically misleading.
#
# This script exercises the SAME load() codepath the game uses at runtime.
# Failed parses are reported and the process exits nonzero so verify-scaffold
# can fail the npm-test step before the user opens a browser.
#
# Invoked from scripts/verify-scaffold.mjs via:
#   godot --headless --script res://scripts/verify-gd-parse.gd

func _initialize() -> void:
	var src_dir := "res://src"
	var dir := DirAccess.open(src_dir)
	if dir == null:
		push_error("verify-gd-parse: cannot open " + src_dir)
		quit(2)
		return
	var failed: Array[String] = []
	dir.list_dir_begin()
	while true:
		var entry := dir.get_next()
		if entry.is_empty():
			break
		if dir.current_is_dir():
			continue
		if not entry.ends_with(".gd"):
			continue
		var script_path := src_dir + "/" + entry
		# load() returns null on parse error and prints SCRIPT ERROR to stderr.
		# We additionally check the resulting Resource is a GDScript instance.
		var loaded := load(script_path)
		if loaded == null:
			failed.append(script_path)
			continue
		if not (loaded is GDScript):
			failed.append(script_path + " (loaded but not GDScript)")
			continue
	dir.list_dir_end()
	if failed.size() > 0:
		print("verify-gd-parse FAIL: %d script(s) failed runtime parse:" % failed.size())
		for path in failed:
			print("  - " + path)
		quit(1)
		return
	print("verify-gd-parse PASS: all res://src/*.gd loaded under runtime parser")
	quit(0)
