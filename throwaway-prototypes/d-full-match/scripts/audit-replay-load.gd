extends SceneTree

const PRIMARY_FIXTURE := "res://../shared-harness/replay-snapshot.json"
const SCENE_BUILDER_SCRIPT := "res://src/SceneBuilder.gd"
const ENTITY_RENDERER_SCRIPT := "res://src/EntityRenderer.gd"
const BASE_SCALE := 0.21

var failures: Array[String] = []


func _init() -> void:
	_run.call_deferred()


func _run() -> void:
	var snapshot := _load_fixture_or_fallback()
	var builder := _new_script_node(SCENE_BUILDER_SCRIPT, "AuditSceneBuilder") as Node3D
	var renderer := _new_script_node(ENTITY_RENDERER_SCRIPT, "AuditEntityRenderer") as Node3D
	if builder == null or renderer == null:
		_finish()
		return
	get_root().add_child(builder)
	get_root().add_child(renderer)
	await process_frame
	if builder.has_method("build_from_snapshot"):
		builder.build_from_snapshot(snapshot)
	else:
		_fail("SceneBuilder missing build_from_snapshot")
	if renderer.has_method("configure"):
		renderer.configure(snapshot, builder)
	else:
		_fail("EntityRenderer missing configure")
	await process_frame
	var target_turn := _first_corpse_turn(snapshot)
	if renderer.has_method("update_to_turn"):
		renderer.update_to_turn(float(target_turn))
	else:
		_fail("EntityRenderer missing update_to_turn")
	await process_frame
	_assert_spawned(renderer, "character_nodes", "character")
	_assert_spawned(renderer, "corpse_nodes", "corpse")
	await _exercise_persona_corpse_factory(renderer)
	builder.queue_free()
	renderer.queue_free()
	_finish()


func _load_fixture_or_fallback() -> Dictionary:
	var fixture_path := ProjectSettings.globalize_path(PRIMARY_FIXTURE)
	if FileAccess.file_exists(fixture_path):
		var text := FileAccess.get_file_as_string(fixture_path)
		var parsed = JSON.parse_string(text)
		if typeof(parsed) == TYPE_DICTIONARY and _snapshot_has_death(parsed):
			print("audit-replay-load fixture: %s" % PRIMARY_FIXTURE)
			return parsed
	print("audit-replay-load fixture: inline fallback")
	return _inline_snapshot()


func _snapshot_has_death(snapshot: Dictionary) -> bool:
	if not snapshot.has("characters") or not snapshot.has("timeline"):
		return false
	var timeline: Dictionary = snapshot.get("timeline", {})
	for frame in timeline.get("frames", []):
		if typeof(frame) != TYPE_DICTIONARY:
			continue
		var frame_snapshot = (frame as Dictionary).get("snapshot", {})
		if typeof(frame_snapshot) == TYPE_DICTIONARY and not (frame_snapshot as Dictionary).get("corpses", []).is_empty():
			return true
	return false


func _inline_snapshot() -> Dictionary:
	return {
		"schemaVersion": 3,
		"playback": {"startTurn": 1, "endTurn": 2, "turnCount": 2},
		"map": {
			"size": {"w": 12, "h": 8},
			"walls": [{"x": 0, "y": 0, "w": 12, "h": 1}],
			"coverClusters": [],
			"evac": {"zone": {"x": 9, "y": 5, "w": 2, "h": 2}},
			"airdrops": [],
		},
		"characters": [
			{"characterId": "c-rat", "personaId": "rat", "pos": {"x": 3, "y": 4}, "alive": false},
			{"characterId": "c-duelist", "personaId": "duelist", "pos": {"x": 5, "y": 4}, "alive": true},
		],
		"movements": [],
		"attacks": [{"turn": 1, "attackerId": "c-duelist", "targetId": "c-rat", "hit": true, "lethal": true}],
		"loots": [],
		"killFeed": [{"turn": 1, "kind": "attack", "attackerId": "c-duelist", "victimId": "c-rat"}],
		"timeline": {
			"frames": [
				{
					"turn": 1,
					"snapshot": {
						"characters": [
							{"characterId": "c-rat", "personaId": "rat", "pos": {"x": 3, "y": 4}, "alive": true},
							{"characterId": "c-duelist", "personaId": "duelist", "pos": {"x": 5, "y": 4}, "alive": true},
						],
						"corpses": [],
						"crates": [],
						"airdrops": [],
					},
				},
				{
					"turn": 2,
					"snapshot": {
						"characters": [
							{"characterId": "c-rat", "personaId": "rat", "pos": {"x": 3, "y": 4}, "alive": false},
							{"characterId": "c-duelist", "personaId": "duelist", "pos": {"x": 5, "y": 4}, "alive": true},
						],
						"corpses": [{"characterId": "c-rat", "personaId": "rat", "pos": {"x": 3, "y": 4}}],
						"crates": [],
						"airdrops": [],
					},
				},
			],
		},
		"equippedByCharacter": {},
	}


func _first_corpse_turn(snapshot: Dictionary) -> int:
	var timeline: Dictionary = snapshot.get("timeline", {})
	for frame in timeline.get("frames", []):
		if typeof(frame) != TYPE_DICTIONARY:
			continue
		var frame_dict := frame as Dictionary
		var frame_snapshot = frame_dict.get("snapshot", {})
		if typeof(frame_snapshot) == TYPE_DICTIONARY and not (frame_snapshot as Dictionary).get("corpses", []).is_empty():
			return int(frame_dict.get("turn", 1))
	var playback: Dictionary = snapshot.get("playback", {})
	return int(playback.get("endTurn", 1))


func _new_script_node(script_path: String, label: String) -> Node:
	var script = load(script_path)
	if script == null:
		_fail("script did not load: %s" % script_path)
		return null
	var node = script.new()
	if not node is Node:
		_fail("script did not instantiate Node: %s" % script_path)
		return null
	(node as Node).name = label
	return node


func _assert_spawned(renderer: Node, property_name: String, label: String) -> void:
	var value = renderer.get(property_name)
	if typeof(value) != TYPE_DICTIONARY:
		_fail("EntityRenderer.%s is not a Dictionary" % property_name)
		return
	if (value as Dictionary).is_empty():
		_fail("EntityRenderer did not exercise %s path" % label)
	else:
		print("audit-replay-load %s count=%d" % [label, (value as Dictionary).size()])


func _exercise_persona_corpse_factory(renderer: Node) -> void:
	var equipment = renderer.get("equipment_attachment")
	if not equipment is Node:
		_fail("EntityRenderer did not expose equipment_attachment")
		return
	if not (equipment as Node).has_method("instantiate_persona_corpse"):
		_fail("EquipmentMeshAttachment missing instantiate_persona_corpse")
		return
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(0.3, 0.02, 0.03)
	var corpse = (equipment as Node).instantiate_persona_corpse("rat", "audit-persona-corpse-rat", material, BASE_SCALE)
	if not corpse is Node3D:
		_fail("instantiate_persona_corpse did not return Node3D")
		return
	get_root().add_child(corpse)
	await process_frame
	(corpse as Node3D).queue_free()
	print("audit-replay-load instantiate_persona_corpse OK")


func _fail(message: String) -> void:
	failures.append(message)


func _finish() -> void:
	if failures.is_empty():
		print("audit-replay-load PASS")
		quit(0)
		return
	for failure in failures:
		push_error(failure)
	print("audit-replay-load FAIL")
	quit(1)
