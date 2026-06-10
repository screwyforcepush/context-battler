extends SceneTree

const SHOWROOM_SCENE := "res://scenes/Showroom.tscn"

var failures: Array[String] = []


func _init() -> void:
	_run.call_deferred()


func _run() -> void:
	var resource = load(SHOWROOM_SCENE)
	if not resource is PackedScene:
		_fail("Showroom scene did not load")
		_finish()
		return
	var showroom := (resource as PackedScene).instantiate()
	get_root().add_child(showroom)
	await process_frame
	await process_frame
	for kind in ["idle", "walk"]:
		if showroom.has_method("_trigger_animation"):
			showroom.call("_trigger_animation", kind)
		await process_frame
		_report_players(showroom, kind)
	showroom.queue_free()
	_finish()


func _report_players(showroom: Node, kind: String) -> void:
	var players = showroom.get("standalone_animation_players")
	if typeof(players) != TYPE_DICTIONARY:
		_fail("standalone_animation_players is not exposed")
		return
	for key in (players as Dictionary).keys():
		var model_id := str(key)
		if not model_id.begins_with("experiment_"):
			continue
		var player := (players as Dictionary).get(key) as AnimationPlayer
		var path := "(missing)"
		var clips := PackedStringArray()
		var assigned := ""
		var current := ""
		if player != null:
			path = str(player.get_path())
			clips = player.get_animation_list()
			assigned = str(player.assigned_animation)
			current = str(player.current_animation)
		print("%s %s player=%s assigned=%s current=%s clip_count=%d first_clips=%s" % [
			kind,
			model_id,
			path,
			assigned,
			current,
			clips.size(),
			", ".join(clips.slice(0, mini(8, clips.size()))),
		])


func _fail(message: String) -> void:
	failures.append(message)


func _finish() -> void:
	if failures.is_empty():
		print("audit-experiment-showroom-variant-animation PASS")
		quit(0)
		return
	for failure in failures:
		push_error(failure)
	print("audit-experiment-showroom-variant-animation FAIL")
	quit(1)
