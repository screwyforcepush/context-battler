extends SceneTree

const MANIFEST_PATH := "res://shared-harness/art-kit/manifest.json"
const ENTITY_RENDERER_PATH := "res://src/EntityRenderer.gd"
const ART_ROOT := "res://shared-harness/art-kit/"
const MIN_MULTIPLIER := 0.4
const MAX_MULTIPLIER := 3.0
const ASSERT_TOLERANCE := 0.15
const EPSILON := 0.0001

var failures: Array[String] = []


func _init() -> void:
	_run.call_deferred()


func _run() -> void:
	var manifest := _read_manifest()
	if manifest.is_empty():
		_fail("manifest did not parse")
		_finish()
		return
	var character_model_scale := _character_model_scale()
	if character_model_scale <= EPSILON:
		_fail("CHARACTER_MODEL_SCALE did not parse from args or EntityRenderer.gd")
		_finish()
		return
	var target_world_height := _target_world_height(manifest)
	var records := []
	for asset in _character_assets(manifest):
		var record = await _measure_character(asset)
		records.append(record)
	if records.size() != 8:
		_fail("expected 8 character assets, found %d" % records.size())
	var source_heights := []
	for record in records:
		if bool(record.get("ok", false)):
			source_heights.append(float(record.get("source_height", 0.0)))
		else:
			_fail(str(record.get("failure", "unknown measurement failure")))
	var source_median := _median(source_heights)
	for i in range(records.size()):
		var record: Dictionary = records[i]
		if bool(record.get("ok", false)) and source_median > EPSILON:
			var source_height := float(record.get("source_height", 0.0))
			var suggested: float = clamp(source_median / source_height, MIN_MULTIPLIER, MAX_MULTIPLIER)
			if target_world_height > EPSILON:
				suggested = clamp(target_world_height / (source_height * character_model_scale), MIN_MULTIPLIER, MAX_MULTIPLIER)
			var committed := float(record.get("modelScaleMultiplier", 1.0))
			record["suggested_multiplier"] = suggested
			record["character_model_scale"] = character_model_scale
			record["target_world_height"] = target_world_height
			record["post_scale_height"] = source_height * character_model_scale * committed
			records[i] = record
	_print_table(records, source_median, character_model_scale, target_world_height)
	if _assert_mode():
		_assert_records(records, target_world_height)
	_finish()


func _read_manifest() -> Dictionary:
	var text := FileAccess.get_file_as_string(MANIFEST_PATH)
	var parsed = JSON.parse_string(text)
	return parsed if typeof(parsed) == TYPE_DICTIONARY else {}


func _character_assets(manifest: Dictionary) -> Array:
	var assets := []
	var body_defaults: Dictionary = manifest.get("body", {}) if int(manifest.get("schemaVersion", 0)) >= 5 else {}
	for asset in manifest.get("assets", []):
		if typeof(asset) != TYPE_DICTIONARY:
			continue
		var asset_dict := asset as Dictionary
		if str(asset_dict.get("category", "")) == "character":
				if body_defaults.is_empty():
					assets.append(asset_dict)
				else:
					var merged := body_defaults.duplicate(true)
					if asset_dict.has(_body_substitution_key()):
						_fail("%s declares forbidden per-persona body substitution key" % str(asset_dict.get("personaSlot", asset_dict.get("id", ""))))
					merged.merge(asset_dict, true)
					assets.append(merged)
	return assets


func _body_substitution_key() -> String:
	return "body" + "Override"


func _measure_character(asset: Dictionary) -> Dictionary:
	var persona := str(asset.get("personaSlot", asset.get("id", "")))
	var file := str(asset.get("file", ""))
	if file.is_empty():
		return _failure_record(persona, "empty file")
	var resource_path := "%s%s" % [ART_ROOT, file]
	if not ResourceLoader.exists(resource_path):
		return _failure_record(persona, "resource does not exist: %s" % resource_path)
	var resource = load(resource_path)
	if not resource is PackedScene:
		return _failure_record(persona, "resource is not a PackedScene: %s" % resource_path)
	var instance = (resource as PackedScene).instantiate()
	if not instance is Node3D:
		if instance != null:
			instance.queue_free()
		return _failure_record(persona, "resource did not instantiate as Node3D: %s" % resource_path)
	var node := instance as Node3D
	get_root().add_child(node)
	await process_frame
	var pose := _pose_lock(node, asset)
	await process_frame
	var state := {
		"has_aabb": false,
		"aabb": AABB(),
	}
	_merge_visible_mesh_aabbs(node, state)
	var has_aabb := bool(state.get("has_aabb", false))
	var source_height := 0.0
	if has_aabb:
		var merged: AABB = state["aabb"]
		source_height = merged.size.y
	node.queue_free()
	await process_frame
	if not has_aabb or source_height <= EPSILON:
		return _failure_record(persona, "no visible non-zero MeshInstance3D AABB")
	var multiplier_value = asset.get("modelScaleMultiplier", null)
	var has_multiplier := typeof(multiplier_value) == TYPE_INT or typeof(multiplier_value) == TYPE_FLOAT
	var multiplier := 1.0
	if has_multiplier:
		multiplier = float(multiplier_value)
	return {
		"ok": true,
		"persona": persona,
		"source_height": source_height,
		"pose": pose,
		"modelScaleMultiplier": multiplier,
		"has_modelScaleMultiplier": has_multiplier,
	}


func _pose_lock(node: Node, asset: Dictionary) -> String:
	var animation = asset.get("animation", {})
	if typeof(animation) != TYPE_DICTIONARY:
		return "t-pose"
	var idle_clip := str((animation as Dictionary).get("idle", ""))
	if idle_clip.is_empty():
		return "t-pose"
	var player := _first_descendant_of_class(node, "AnimationPlayer") as AnimationPlayer
	if player == null or not player.has_animation(idle_clip):
		return "t-pose"
	player.play(idle_clip)
	player.seek(0.0, true)
	player.stop()
	return "idle@0"


func _first_descendant_of_class(node: Node, target_class: String) -> Node:
	if node == null:
		return null
	if node.is_class(target_class):
		return node
	for child in node.get_children():
		var found := _first_descendant_of_class(child, target_class)
		if found != null:
			return found
	return null


func _merge_visible_mesh_aabbs(node: Node, state: Dictionary) -> void:
	if node is MeshInstance3D:
		var mesh_instance := node as MeshInstance3D
		if mesh_instance.is_visible_in_tree():
			var local_aabb := mesh_instance.get_aabb()
			if _has_volume(local_aabb):
				var transformed_aabb: AABB = mesh_instance.global_transform * local_aabb
				if bool(state.get("has_aabb", false)):
					var merged: AABB = state["aabb"]
					state["aabb"] = merged.merge(transformed_aabb)
				else:
					state["aabb"] = transformed_aabb
					state["has_aabb"] = true
	for child in node.get_children():
		_merge_visible_mesh_aabbs(child, state)


func _has_volume(aabb: AABB) -> bool:
	return aabb.size.x > EPSILON and aabb.size.y > EPSILON and aabb.size.z > EPSILON


func _assert_records(records: Array, target_world_height: float) -> void:
	var post_heights := []
	for record in records:
		if not bool(record.get("ok", false)):
			continue
		var persona := str(record.get("persona", "unknown"))
		if not bool(record.get("has_modelScaleMultiplier", false)):
			_fail("%s missing numeric modelScaleMultiplier" % persona)
			continue
		var multiplier := float(record.get("modelScaleMultiplier", 1.0))
		if multiplier < MIN_MULTIPLIER or multiplier > MAX_MULTIPLIER:
			_fail("%s modelScaleMultiplier %.4f outside [%.1f, %.1f]" % [persona, multiplier, MIN_MULTIPLIER, MAX_MULTIPLIER])
			continue
		post_heights.append(float(record.get("post_scale_height", 0.0)))
	var center := target_world_height if target_world_height > EPSILON else _median(post_heights)
	var lower := center * (1.0 - ASSERT_TOLERANCE)
	var upper := center * (1.0 + ASSERT_TOLERANCE)
	for record in records:
		if not bool(record.get("ok", false)) or not bool(record.get("has_modelScaleMultiplier", false)):
			continue
		var persona := str(record.get("persona", "unknown"))
		var post_height := float(record.get("post_scale_height", 0.0))
		if post_height < lower or post_height > upper:
			_fail("%s effective world height %.4f outside %.4f..%.4f (target %.4f)" % [persona, post_height, lower, upper, center])


func _print_table(records: Array, source_median: float, character_model_scale: float, target_world_height: float) -> void:
	print("audit-character-scales source_median=%.4f character_model_scale=%.4f target_world_height=%.4f" % [source_median, character_model_scale, target_world_height])
	print("persona       source_h   suggested  committed  world_h   pose")
	for record in records:
		if not bool(record.get("ok", false)):
			print("%-12s FAIL       -          -          -         -     %s" % [str(record.get("persona", "unknown")), str(record.get("failure", ""))])
			continue
		print(
			"%-12s %8.4f   %8.4f   %8.4f   %8.4f  %s" %
			[
				str(record.get("persona", "")),
				float(record.get("source_height", 0.0)),
				float(record.get("suggested_multiplier", 1.0)),
				float(record.get("modelScaleMultiplier", 1.0)),
				float(record.get("post_scale_height", 0.0)),
				str(record.get("pose", "")),
			]
		)


func _median(values: Array) -> float:
	if values.is_empty():
		return 0.0
	var sorted := values.duplicate()
	sorted.sort()
	var mid := sorted.size() / 2
	if sorted.size() % 2 == 1:
		return float(sorted[mid])
	return (float(sorted[mid - 1]) + float(sorted[mid])) * 0.5


func _failure_record(persona: String, message: String) -> Dictionary:
	return {
		"ok": false,
		"persona": persona,
		"failure": "%s: %s" % [persona, message],
	}


func _assert_mode() -> bool:
	for arg in _all_args():
		if str(arg) == "--assert":
			return true
	return false


func _character_model_scale() -> float:
	var arg_value := _numeric_arg("--character-model-scale", -1.0)
	if arg_value > EPSILON:
		return arg_value
	var source := FileAccess.get_file_as_string(ENTITY_RENDERER_PATH)
	if source.is_empty():
		return 0.0
	var regex := RegEx.new()
	if regex.compile("const\\s+CHARACTER_MODEL_SCALE\\s*:=\\s*([0-9]+(?:\\.[0-9]+)?)") != OK:
		return 0.0
	var found := regex.search(source)
	if found == null:
		return 0.0
	return float(found.get_string(1))


func _target_world_height(manifest: Dictionary) -> float:
	var arg_value := _numeric_arg("--target-world-height", -1.0)
	if arg_value > EPSILON:
		return arg_value
	var body = manifest.get("body", {})
	if typeof(body) == TYPE_DICTIONARY:
		var value = (body as Dictionary).get("targetWorldHeight", null)
		if typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT:
			return float(value)
	return 0.0


func _numeric_arg(flag: String, default_value: float) -> float:
	var args := _all_args()
	var prefix := "%s=" % flag
	for i in range(args.size()):
		var arg := str(args[i])
		if arg == flag and i + 1 < args.size():
			return float(args[i + 1])
		if arg.begins_with(prefix):
			return float(arg.substr(prefix.length()))
	return default_value


func _all_args() -> Array:
	var args := []
	for arg in OS.get_cmdline_user_args():
		args.append(str(arg))
	for arg in OS.get_cmdline_args():
		var value := str(arg)
		if not args.has(value):
			args.append(value)
	return args


func _fail(message: String) -> void:
	failures.append(message)


func _finish() -> void:
	if failures.is_empty():
		print("audit-character-scales PASS")
		quit(0)
		return
	for failure in failures:
		push_error(failure)
	print("audit-character-scales FAIL")
	quit(1)
