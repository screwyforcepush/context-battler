extends Node3D

const CHARACTER_MODEL_SCALE := 0.21
const CRATE_MODEL_SCALE := 0.17
const AIRDROP_CRATE_MODEL_SCALE := 0.21
const CORPSE_MODEL_SCALE := 0.21
const CHARACTER_GROUND_Y := 0.0
const CRATE_GROUND_Y := 0.0
const AIRDROP_GROUND_Y := 0.0
const CORPSE_GROUND_Y := 0.0
const CHARACTER_ANCHOR_Y := 0.22
const FALLBACK_CHARACTER_HALF_HEIGHT := 0.17
const EQUIPMENT_ATTACHMENT_SCRIPT := "res://src/EquipmentMeshAttachment.gd"
const COMBAT_VFX_SCRIPT := "res://src/CombatVfx.gd"

var snapshot: Dictionary = {}
var frames: Array = []
var scene_builder: Node
var camera_rig: Node
var movements_by_turn_character: Dictionary = {}
var character_nodes: Dictionary = {}
var character_personas: Dictionary = {}
var corpse_nodes: Dictionary = {}
var crate_nodes: Dictionary = {}
var airdrop_nodes: Dictionary = {}
var anchor_positions: Dictionary = {}
var last_heading_by_character: Dictionary = {}
var attack_pose_by_character: Dictionary = {}
var wall_slam_by_character: Dictionary = {}
var loot_pose_by_character: Dictionary = {}
var lethal_targets_by_character: Dictionary = {}
var loot_source_marks: Dictionary = {}
var mist_nodes: Array[MeshInstance3D] = []
var mist_age := 999.0
var last_effect_turn := -1
var previous_turn_value := -1.0
var current_turn_value := 1.0
var crate_scene: PackedScene
var corpse_scene: PackedScene
var equipment_attachment: Node
var combat_vfx: Node
var mat_agent: Array[StandardMaterial3D] = []
var mat_corpse: StandardMaterial3D
var mat_opened: StandardMaterial3D
var mat_closed: StandardMaterial3D
var mat_airdrop: StandardMaterial3D
var mat_beam: StandardMaterial3D
var mat_mist: StandardMaterial3D


func configure(root: Dictionary, builder: Node) -> void:
	snapshot = root
	scene_builder = builder
	frames = _extract_frames(snapshot)
	_ensure_equipment_attachment()
	equipment_attachment.configure(snapshot)
	_index_movements()
	_clear()
	_make_materials()
	_load_models()
	_spawn_characters(snapshot.get("characters", []))
	_spawn_crates()
	_spawn_airdrops()
	_spawn_mist()
	_ensure_combat_vfx()
	combat_vfx.configure(snapshot, scene_builder, self)
	if camera_rig != null:
		combat_vfx.set_camera_rig(camera_rig)
	last_effect_turn = -1
	previous_turn_value = -1.0


func update_to_turn(turn_value: float) -> void:
	if frames.is_empty():
		return
	var delta := get_process_delta_time()
	current_turn_value = turn_value
	if previous_turn_value >= 0.0 and turn_value < previous_turn_value:
		_clear_event_marks()
	var sample := sample_turn(turn_value)
	_update_characters(sample)
	_update_corpses(sample)
	_update_crates(sample)
	_update_airdrops(sample)
	_update_equipment_for_turn(turn_value)
	_update_environmental_effects(int(floor(turn_value)))
	_update_attack_poses(delta)
	_update_loot_source_marks()
	if equipment_attachment != null and equipment_attachment.has_method("tick"):
		equipment_attachment.tick(delta)
	if combat_vfx != null:
		combat_vfx.update_to_turn(turn_value, delta)
	_update_mist(delta)
	previous_turn_value = turn_value


func sample_turn(turn_value: float) -> Dictionary:
	if frames.is_empty():
		return {}
	var previous: Dictionary = frames[0]
	var next: Dictionary = frames[frames.size() - 1]
	for frame in frames:
		if typeof(frame) != TYPE_DICTIONARY:
			continue
		var frame_turn := float(frame.get("turn", 0))
		if frame_turn <= turn_value:
			previous = frame
		if frame_turn >= turn_value:
			next = frame
			break
	if previous == next:
		return previous
	var amount: float = clamp(inverse_lerp(float(previous.get("turn", 0)), float(next.get("turn", 0)), turn_value), 0.0, 1.0)
	return _interpolate_frames(previous, next, amount)


func get_anchor_world(character_id: String) -> Vector3:
	return anchor_positions.get(character_id, Vector3.ZERO)


func get_character_world(character_id: String) -> Vector3:
	var node: Node3D = character_nodes.get(character_id)
	if node != null:
		return node.global_position
	var corpse: Node3D = corpse_nodes.get(character_id)
	if corpse != null:
		return corpse.global_position
	return anchor_positions.get(character_id, Vector3.ZERO)


func world_from_tile(tile, y: float = 0.0) -> Vector3:
	return _tile_to_world(tile if typeof(tile) == TYPE_DICTIONARY else {}, y)


func set_camera_rig(rig: Node) -> void:
	camera_rig = rig
	if combat_vfx != null and combat_vfx.has_method("set_camera_rig"):
		combat_vfx.set_camera_rig(camera_rig)


func play_attack_pose(character_id: String, target_world: Vector3, weapon: String, hit: bool, lethal: bool) -> void:
	var node: Node3D = character_nodes.get(character_id)
	if node == null:
		return
	var heading := target_world - node.global_position
	heading.y = 0.0
	if heading.length() > 0.001:
		last_heading_by_character[character_id] = heading.normalized()
		node.rotation.y = _yaw_for_heading(heading.normalized())
	attack_pose_by_character[character_id] = {
		"age": 0.0,
		"duration": 0.62 if lethal else 0.48,
		"weapon": weapon,
		"hit": hit,
		"lethal": lethal,
	}


func mark_lethal_target(character_id: String) -> void:
	lethal_targets_by_character[character_id] = int(floor(current_turn_value))
	var node: Node3D = character_nodes.get(character_id)
	if node != null:
		var visual := node.get_node_or_null("visual") as Node3D
		if visual != null:
			visual.visible = false


func play_wall_slam(character_id: String, _wall_world: Vector3) -> void:
	wall_slam_by_character[character_id] = {"age": 0.0, "duration": 0.34}


func play_loot_pickup(character_id: String, item: Dictionary) -> void:
	loot_pose_by_character[character_id] = {"age": 0.0, "duration": 0.42}
	if equipment_attachment != null and equipment_attachment.has_method("play_loot_swap"):
		equipment_attachment.play_loot_swap(character_id, item)


func mark_loot_source(source: String, source_id: String) -> void:
	if source.is_empty() or source_id.is_empty():
		return
	loot_source_marks["%s:%s" % [source, source_id]] = int(floor(current_turn_value))
	if source == "crate" and crate_nodes.has(source_id):
		var crate_node: Node3D = crate_nodes[source_id]
		crate_node.scale = Vector3.ONE * 0.72
		_apply_material(crate_node, mat_opened)
	elif source == "airdrop" and airdrop_nodes.has(source_id):
		var drop_node: Node3D = airdrop_nodes[source_id]
		drop_node.scale = Vector3.ONE * 0.68
	elif source == "corpse" and corpse_nodes.has(source_id):
		var corpse_node: Node3D = corpse_nodes[source_id]
		_apply_material(corpse_node, mat_corpse)
		corpse_node.scale = Vector3(0.9, 0.78, 0.9)


func _extract_frames(root: Dictionary) -> Array:
	var timeline = root.get("timeline", {})
	var out := []
	if typeof(timeline) != TYPE_DICTIONARY:
		return out
	for frame in timeline.get("frames", []):
		if typeof(frame) != TYPE_DICTIONARY:
			continue
		var snap = frame.get("snapshot", {})
		if typeof(snap) != TYPE_DICTIONARY:
			continue
		var merged: Dictionary = snap.duplicate(true)
		merged["turn"] = frame.get("turn", snap.get("turn", 0))
		out.append(merged)
	return out


func _clear() -> void:
	for child in get_children():
		if child == equipment_attachment or child == combat_vfx:
			continue
		child.queue_free()
	character_nodes.clear()
	character_personas.clear()
	corpse_nodes.clear()
	crate_nodes.clear()
	airdrop_nodes.clear()
	anchor_positions.clear()
	last_heading_by_character.clear()
	attack_pose_by_character.clear()
	wall_slam_by_character.clear()
	loot_pose_by_character.clear()
	lethal_targets_by_character.clear()
	loot_source_marks.clear()
	mist_nodes.clear()


func _index_movements() -> void:
	movements_by_turn_character.clear()
	for movement in snapshot.get("movements", []):
		if typeof(movement) != TYPE_DICTIONARY:
			continue
		var turn := int(movement.get("turn", -1))
		var character_id := str(movement.get("characterId", ""))
		if turn < 0 or character_id.is_empty():
			continue
		if not movements_by_turn_character.has(turn):
			movements_by_turn_character[turn] = {}
		var by_character: Dictionary = movements_by_turn_character[turn]
		by_character[character_id] = movement
		movements_by_turn_character[turn] = by_character


func _load_models() -> void:
	crate_scene = equipment_attachment.environment_scene_for_role("crate") if equipment_attachment != null else null
	corpse_scene = equipment_attachment.corpse_scene() if equipment_attachment != null else null


func _spawn_characters(characters: Array) -> void:
	for i in range(characters.size()):
		var character = characters[i]
		if typeof(character) != TYPE_DICTIONARY:
			continue
		var id := str(character.get("characterId", ""))
		var persona := str(character.get("personaId", ""))
		var scene: PackedScene = equipment_attachment.character_scene_for_persona(persona) if equipment_attachment != null else null
		var pivot_y: float = equipment_attachment.pivot_y_for_persona(persona) if equipment_attachment != null else 0.0
		var node := _instance_or_capsule(scene, "character-%s" % id, mat_agent[i % mat_agent.size()], pivot_y)
		add_child(node)
		character_nodes[id] = node
		character_personas[id] = persona
		anchor_positions[id] = Vector3.ZERO
		if equipment_attachment != null and equipment_attachment.has_method("register_character"):
			equipment_attachment.register_character(id, node, persona)


func _spawn_crates() -> void:
	if frames.is_empty():
		return
	for crate in frames[0].get("crates", []):
		if typeof(crate) != TYPE_DICTIONARY:
			continue
		var id := str(crate.get("id", ""))
		var node := _instance_or_box(crate_scene, "crate-%s" % id, mat_closed, Vector3(0.17, 0.21, 0.17), CRATE_MODEL_SCALE)
		if equipment_attachment != null:
			var pivot_y: float = equipment_attachment.pivot_y_for_environment_role("crate")
			var visual := node.get_node_or_null("visual") as Node3D
			if visual != null:
				visual.position.y = pivot_y
		add_child(node)
		crate_nodes[id] = node


func _spawn_airdrops() -> void:
	if frames.is_empty():
		return
	for drop in frames[0].get("airdrops", []):
		if typeof(drop) != TYPE_DICTIONARY:
			continue
		var id := str(drop.get("id", ""))
		var root := Node3D.new()
		root.name = "airdrop-%s" % id
		var crate := _instance_or_box(crate_scene, "crate", mat_airdrop, Vector3(0.21, 0.21, 0.21), AIRDROP_CRATE_MODEL_SCALE)
		root.add_child(crate)
		var beam := MeshInstance3D.new()
		beam.name = "telegraphed-beam"
		var mesh := CylinderMesh.new()
		mesh.top_radius = 0.12
		mesh.bottom_radius = 0.38
		mesh.height = 13.0
		beam.mesh = mesh
		beam.material_override = mat_beam
		beam.position.y = 6.4
		root.add_child(beam)
		add_child(root)
		airdrop_nodes[id] = root


func _spawn_mist() -> void:
	for i in range(36):
		var mist := MeshInstance3D.new()
		mist.name = "red-mist-%02d" % i
		var mesh := SphereMesh.new()
		mesh.radius = 0.12
		mesh.height = 0.22
		mist.mesh = mesh
		mist.material_override = mat_mist
		mist.visible = false
		add_child(mist)
		mist_nodes.append(mist)


func _update_characters(sample: Dictionary) -> void:
	var seen := {}
	for character in sample.get("characters", []):
		if typeof(character) != TYPE_DICTIONARY:
			continue
		var id := str(character.get("characterId", ""))
		var node: Node3D = character_nodes.get(id)
		if node == null:
			continue
		var pos := _character_world_position(id, character)
		node.position = pos
		var suppressed := lethal_targets_by_character.has(id) and int(floor(current_turn_value)) >= int(lethal_targets_by_character[id])
		node.visible = bool(character.get("alive", true)) and character.get("extractedAtTurn", null) == null and not suppressed
		_update_character_heading(id, node)
		anchor_positions[id] = pos + Vector3(0.0, CHARACTER_ANCHOR_Y, 0.0)
		seen[id] = true
	for id in character_nodes.keys():
		if not seen.has(id):
			var node: Node3D = character_nodes[id]
			node.visible = false


func _character_world_position(character_id: String, character: Dictionary) -> Vector3:
	var movement := _active_movement_for_character(character_id)
	if not movement.is_empty():
		var path: Array = movement.get("path", [])
		if not path.is_empty():
			var tile_pos := _tile_along_path(path, _turn_fraction())
			return _tile_to_world_with_wall_inset(tile_pos, CHARACTER_GROUND_Y)
	return _tile_to_world_with_wall_inset(character.get("pos", {}), CHARACTER_GROUND_Y)


func _active_movement_for_character(character_id: String) -> Dictionary:
	var turn_base := int(floor(current_turn_value))
	var movement_turn := turn_base
	if not movements_by_turn_character.has(movement_turn):
		return {}
	var by_character = movements_by_turn_character[movement_turn]
	if typeof(by_character) != TYPE_DICTIONARY:
		return {}
	var movement = by_character.get(character_id, {})
	if typeof(movement) != TYPE_DICTIONARY:
		return {}
	return movement


func _turn_fraction() -> float:
	return clamp(current_turn_value - floor(current_turn_value), 0.0, 1.0)


func _tile_along_path(path: Array, progress: float) -> Dictionary:
	var points := _valid_path_points(path)
	if points.is_empty():
		return {"x": 0.0, "y": 0.0}
	if points.size() == 1:
		return points[0]
	var segment_count := points.size() - 1
	var scaled: float = clamp(progress, 0.0, 1.0) * float(segment_count)
	var segment_index: int = min(int(floor(scaled)), segment_count - 1)
	var local_t := clamp(scaled - float(segment_index), 0.0, 1.0)
	var a: Dictionary = points[segment_index]
	var b: Dictionary = points[segment_index + 1]
	return {
		"x": lerp(float(a.get("x", 0.0)), float(b.get("x", 0.0)), local_t),
		"y": lerp(float(a.get("y", 0.0)), float(b.get("y", 0.0)), local_t),
	}


func _update_character_heading(character_id: String, node: Node3D) -> void:
	var heading := _active_heading_for_character(character_id)
	if heading.length() > 0.001:
		last_heading_by_character[character_id] = heading
	elif last_heading_by_character.has(character_id):
		heading = last_heading_by_character[character_id]
	else:
		heading = Vector3(0.0, 0.0, -1.0)
		last_heading_by_character[character_id] = heading
	node.rotation.y = _yaw_for_heading(heading)


func _active_heading_for_character(character_id: String) -> Vector3:
	var movement := _active_movement_for_character(character_id)
	if movement.is_empty():
		return Vector3.ZERO
	var path: Array = movement.get("path", [])
	var points := _valid_path_points(path)
	if points.size() < 2:
		return Vector3.ZERO
	var segment_count := points.size() - 1
	var scaled: float = clamp(_turn_fraction(), 0.0, 1.0) * float(segment_count)
	var segment_index: int = min(int(floor(scaled)), segment_count - 1)
	for offset in range(segment_count):
		var index: int = clamp(segment_index + offset, 0, segment_count - 1)
		var heading := _heading_between_tiles(points[index], points[index + 1])
		if heading.length() > 0.001:
			return heading
	for index in range(segment_index - 1, -1, -1):
		var heading := _heading_between_tiles(points[index], points[index + 1])
		if heading.length() > 0.001:
			return heading
	return Vector3.ZERO


func _valid_path_points(path: Array) -> Array:
	var points := []
	for point in path:
		if typeof(point) == TYPE_DICTIONARY:
			points.append(point)
	return points


func _heading_between_tiles(a: Dictionary, b: Dictionary) -> Vector3:
	var from_world := _tile_to_world(a, 0.0)
	var to_world := _tile_to_world(b, 0.0)
	var heading := to_world - from_world
	heading.y = 0.0
	return heading.normalized() if heading.length() > 0.001 else Vector3.ZERO


func _yaw_for_heading(heading: Vector3) -> float:
	return atan2(-heading.x, -heading.z)


func _tile_to_world_with_wall_inset(pos: Dictionary, y: float = 0.0) -> Vector3:
	var world := _tile_to_world(pos, y)
	if scene_builder != null and scene_builder.has_method("cosmetic_wall_inset"):
		world += scene_builder.cosmetic_wall_inset(pos)
	return world


func _update_corpses(sample: Dictionary) -> void:
	var live_corpses := {}
	for corpse in sample.get("corpses", []):
		if typeof(corpse) != TYPE_DICTIONARY:
			continue
		var id := str(corpse.get("characterId", ""))
		var node: Node3D = corpse_nodes.get(id)
		if node == null:
			node = _instance_or_corpse(corpse_scene, "corpse-%s" % id, mat_corpse)
			add_child(node)
			corpse_nodes[id] = node
		node.position = _tile_to_world(corpse.get("pos", {}), CORPSE_GROUND_Y)
		node.visible = true
		anchor_positions[id] = node.position + Vector3(0.0, 0.35, 0.0)
		live_corpses[id] = true
	for id in corpse_nodes.keys():
		if not live_corpses.has(id):
			var node: Node3D = corpse_nodes[id]
			node.visible = false


func _update_crates(sample: Dictionary) -> void:
	for crate in sample.get("crates", []):
		if typeof(crate) != TYPE_DICTIONARY:
			continue
		var id := str(crate.get("id", ""))
		var node: Node3D = crate_nodes.get(id)
		if node == null:
			continue
		node.position = _tile_to_world(crate.get("pos", {}), CRATE_GROUND_Y)
		var opened := bool(crate.get("opened", false))
		node.visible = true
		_apply_material(node, mat_opened if opened else mat_closed)
		node.scale = Vector3.ONE * (0.78 if _loot_source_mark_active("crate", id) else 1.0)


func _update_airdrops(sample: Dictionary) -> void:
	for drop in sample.get("airdrops", []):
		if typeof(drop) != TYPE_DICTIONARY:
			continue
		var id := str(drop.get("id", ""))
		var root: Node3D = airdrop_nodes.get(id)
		if root == null:
			continue
		var state := str(drop.get("state", "pre"))
		root.position = _tile_to_world(drop.get("pos", {}), AIRDROP_GROUND_Y)
		root.visible = state != "pre"
		var crate_node := root.get_node_or_null("crate")
		var beam_node := root.get_node_or_null("telegraphed-beam")
		if crate_node != null:
			crate_node.visible = state == "landed" or state == "spent"
		if beam_node != null:
			beam_node.visible = state == "telegraphed"
		if state == "spent":
			root.scale = Vector3(0.82, 0.82, 0.82)
		else:
			root.scale = Vector3.ONE
		if _loot_source_mark_active("airdrop", id):
			root.scale *= 0.72


func _update_environmental_effects(turn: int) -> void:
	if turn == last_effect_turn:
		return
	last_effect_turn = turn
	for event in snapshot.get("killFeed", []):
		if typeof(event) != TYPE_DICTIONARY:
			continue
		if int(event.get("turn", -1)) == turn and str(event.get("kind", "")) == "environmental":
			var victim_id := str(event.get("victimId", ""))
			_trigger_mist(anchor_positions.get(victim_id, Vector3.ZERO))


func _trigger_mist(origin: Vector3) -> void:
	mist_age = 0.0
	for i in range(mist_nodes.size()):
		var mist := mist_nodes[i]
		var angle := randf() * TAU
		var radius := randf_range(0.0, 0.55)
		mist.position = origin + Vector3(cos(angle) * radius, randf_range(0.0, 0.8), sin(angle) * radius)
		mist.scale = Vector3.ONE * randf_range(0.8, 1.4)
		mist.visible = true


func _update_mist(delta: float) -> void:
	if mist_age > 2.4:
		return
	mist_age += delta
	var fade: float = clamp(1.0 - mist_age / 2.4, 0.0, 1.0)
	for mist in mist_nodes:
		mist.visible = fade > 0.02
		mist.scale = Vector3.ONE * (1.0 + (1.0 - fade) * 2.7)


func _interpolate_frames(a: Dictionary, b: Dictionary, t: float) -> Dictionary:
	var b_by_id := {}
	for character in b.get("characters", []):
		if typeof(character) == TYPE_DICTIONARY:
			b_by_id[str(character.get("characterId", ""))] = character
	var characters := []
	for char_a in a.get("characters", []):
		if typeof(char_a) != TYPE_DICTIONARY:
			continue
		var id := str(char_a.get("characterId", ""))
		var char_b: Dictionary = b_by_id.get(id, char_a)
		var pos_a: Dictionary = char_a.get("pos", {"x": 0, "y": 0})
		var pos_b: Dictionary = char_b.get("pos", pos_a)
		var merged: Dictionary = char_a.duplicate(true)
		merged["alive"] = bool(char_a.get("alive", true)) if t < 0.985 else bool(char_b.get("alive", char_a.get("alive", true)))
		merged["extractedAtTurn"] = char_a.get("extractedAtTurn", null) if t < 0.985 else char_b.get("extractedAtTurn", char_a.get("extractedAtTurn", null))
		merged["pos"] = pos_a if t < 0.985 else pos_b
		characters.append(merged)
	var out: Dictionary = a.duplicate(true)
	out["characters"] = characters
	return out


func _tile_to_world(pos: Dictionary, y: float = 0.0) -> Vector3:
	if scene_builder != null and scene_builder.has_method("tile_to_world"):
		return scene_builder.tile_to_world(pos, y)
	return Vector3(float(pos.get("x", 0)), y, float(pos.get("y", 0)))


func _instance_or_capsule(scene: PackedScene, label: String, material: Material, pivot_y: float = 0.0) -> Node3D:
	var root := Node3D.new()
	root.name = label
	if scene != null:
		var visual := scene.instantiate() as Node3D
		visual.name = "visual"
		visual.scale = Vector3.ONE * CHARACTER_MODEL_SCALE
		visual.position.y = pivot_y
		_apply_material(visual, material)
		root.add_child(visual)
		return root
	var fallback := MeshInstance3D.new()
	fallback.name = "visual"
	var mesh := CapsuleMesh.new()
	mesh.radius = 0.09
	mesh.height = FALLBACK_CHARACTER_HALF_HEIGHT * 2.0
	fallback.mesh = mesh
	fallback.material_override = material
	fallback.position.y = FALLBACK_CHARACTER_HALF_HEIGHT
	root.add_child(fallback)
	return root


func _instance_or_corpse(scene: PackedScene, label: String, material: Material) -> Node3D:
	var root := Node3D.new()
	root.name = label
	if scene != null:
		var visual := scene.instantiate() as Node3D
		visual.name = "visual"
		visual.scale = Vector3.ONE * CORPSE_MODEL_SCALE
		visual.position.y = equipment_attachment.corpse_pivot_y() if equipment_attachment != null else 0.0
		visual.rotation_degrees = Vector3(0.0, 0.0, 0.0)
		_apply_material(visual, material)
		root.add_child(visual)
		return root
	var body := _make_box("corpse-body", Vector3(0.48, 0.10, 0.20), material)
	body.position.y = 0.05
	root.add_child(body)
	var head := MeshInstance3D.new()
	head.name = "corpse-head"
	var head_mesh := SphereMesh.new()
	head_mesh.radius = 0.09
	head_mesh.height = 0.12
	head.mesh = head_mesh
	head.material_override = material
	head.position = Vector3(0.33, 0.08, 0.0)
	root.add_child(head)
	return root


func _instance_or_box(scene: PackedScene, label: String, material: Material, size: Vector3, scene_scale: float) -> Node3D:
	var root := Node3D.new()
	root.name = label
	if scene != null:
		var visual := scene.instantiate() as Node3D
		visual.name = "visual"
		visual.scale = Vector3.ONE * scene_scale
		_apply_material(visual, material)
		root.add_child(visual)
		return root
	var box := _make_box("visual", size, material)
	box.position.y = size.y * 0.5
	root.add_child(box)
	return root


func _make_box(label: String, size: Vector3, material: Material) -> MeshInstance3D:
	var node := MeshInstance3D.new()
	node.name = label
	var mesh := BoxMesh.new()
	mesh.size = size
	node.mesh = mesh
	node.material_override = material
	return node


func _ensure_equipment_attachment() -> void:
	if equipment_attachment != null and is_instance_valid(equipment_attachment):
		return
	var script = load(EQUIPMENT_ATTACHMENT_SCRIPT)
	equipment_attachment = script.new()
	equipment_attachment.name = "EquipmentMeshAttachment"
	add_child(equipment_attachment)


func _ensure_combat_vfx() -> void:
	if combat_vfx != null and is_instance_valid(combat_vfx):
		return
	var script = load(COMBAT_VFX_SCRIPT)
	combat_vfx = script.new()
	combat_vfx.name = "CombatVfx"
	add_child(combat_vfx)


func _update_equipment_for_turn(turn_value: float) -> void:
	if equipment_attachment == null or not equipment_attachment.has_method("update_equipment"):
		return
	var frame := _contract_frame_for_turn(int(floor(turn_value)))
	var equipped = frame.get("equippedByCharacter", {})
	if typeof(equipped) == TYPE_DICTIONARY:
		equipment_attachment.update_equipment(equipped)


func _contract_frame_for_turn(turn: int) -> Dictionary:
	var timeline: Dictionary = snapshot.get("timeline", {})
	var timeline_frames: Array = timeline.get("frames", [])
	var selected := {}
	for frame in timeline_frames:
		if typeof(frame) != TYPE_DICTIONARY:
			continue
		if int(frame.get("turn", 0)) <= turn:
			selected = frame
		else:
			break
	return selected


func _update_attack_poses(delta: float) -> void:
	for character_id in attack_pose_by_character.keys():
		var pose: Dictionary = attack_pose_by_character.get(character_id, {})
		var node: Node3D = character_nodes.get(character_id)
		if node == null:
			attack_pose_by_character.erase(character_id)
			continue
		var age := float(pose.get("age", 0.0)) + delta
		var duration := float(pose.get("duration", 0.48))
		var phase := clamp(age / max(duration, 0.001), 0.0, 1.0)
		var swing := sin(phase * PI)
		var weapon := str(pose.get("weapon", ""))
		var weapon_socket := node.get_node_or_null("weapon_socket") as Node3D
		var visual := node.get_node_or_null("visual") as Node3D
		if visual != null:
			visual.rotation_degrees.x = -8.0 * swing if bool(pose.get("hit", false)) else 6.0 * swing
			visual.position.y = sin(phase * TAU) * 0.025
		if weapon_socket != null:
			var heavy := weapon in ["axe", "greatsword", "warhammer"]
			weapon_socket.rotation_degrees.x = -92.0 * swing if heavy else -52.0 * swing
			weapon_socket.rotation_degrees.z = 34.0 * swing if weapon in ["dagger", "sword"] else -24.0 * swing
		pose["age"] = age
		attack_pose_by_character[character_id] = pose
		if age >= duration:
			_reset_character_pose(node)
			attack_pose_by_character.erase(character_id)
	for character_id in wall_slam_by_character.keys():
		var slam: Dictionary = wall_slam_by_character.get(character_id, {})
		var node: Node3D = character_nodes.get(character_id)
		if node == null:
			wall_slam_by_character.erase(character_id)
			continue
		var age := float(slam.get("age", 0.0)) + delta
		var duration := float(slam.get("duration", 0.34))
		var phase := clamp(age / max(duration, 0.001), 0.0, 1.0)
		var visual := node.get_node_or_null("visual") as Node3D
		if visual != null:
			visual.rotation_degrees.x = -18.0 * sin(phase * PI)
		slam["age"] = age
		wall_slam_by_character[character_id] = slam
		if age >= duration:
			_reset_character_pose(node)
			wall_slam_by_character.erase(character_id)
	for character_id in loot_pose_by_character.keys():
		var loot: Dictionary = loot_pose_by_character.get(character_id, {})
		var node: Node3D = character_nodes.get(character_id)
		if node == null:
			loot_pose_by_character.erase(character_id)
			continue
		var age := float(loot.get("age", 0.0)) + delta
		var duration := float(loot.get("duration", 0.42))
		var phase := clamp(age / max(duration, 0.001), 0.0, 1.0)
		var visual := node.get_node_or_null("visual") as Node3D
		if visual != null:
			visual.position.y = sin(phase * PI) * 0.055
		loot["age"] = age
		loot_pose_by_character[character_id] = loot
		if age >= duration:
			_reset_character_pose(node)
			loot_pose_by_character.erase(character_id)


func _reset_character_pose(node: Node3D) -> void:
	var visual := node.get_node_or_null("visual") as Node3D
	if visual != null:
		visual.rotation_degrees = Vector3.ZERO
		visual.position.y = equipment_attachment.pivot_y_for_persona(character_personas.get(str(node.name).replace("character-", ""), "")) if equipment_attachment != null else 0.0
	var weapon_socket := node.get_node_or_null("weapon_socket") as Node3D
	if weapon_socket != null:
		weapon_socket.rotation_degrees = Vector3.ZERO


func _update_loot_source_marks() -> void:
	var turn := int(floor(current_turn_value))
	for key in loot_source_marks.keys():
		if turn - int(loot_source_marks[key]) > 1:
			loot_source_marks.erase(key)


func _loot_source_mark_active(source: String, source_id: String) -> bool:
	var key := "%s:%s" % [source, source_id]
	return loot_source_marks.has(key) and int(floor(current_turn_value)) - int(loot_source_marks[key]) <= 1


func _clear_event_marks() -> void:
	attack_pose_by_character.clear()
	wall_slam_by_character.clear()
	loot_pose_by_character.clear()
	lethal_targets_by_character.clear()
	loot_source_marks.clear()
	if combat_vfx != null:
		combat_vfx.configure(snapshot, scene_builder, self)
		if camera_rig != null:
			combat_vfx.set_camera_rig(camera_rig)


func _apply_material(node: Node, material: Material) -> void:
	if node is MeshInstance3D:
		(node as MeshInstance3D).material_override = material
	for child in node.get_children():
		_apply_material(child, material)


func _make_materials() -> void:
	if not mat_agent.is_empty():
		return
	var colors := [
		Color(0.95, 0.10, 0.12),
		Color(0.00, 0.90, 0.78),
		Color(1.00, 0.68, 0.12),
		Color(0.42, 0.95, 0.32),
		Color(0.84, 0.28, 1.00),
		Color(0.20, 0.52, 1.00),
		Color(1.00, 0.24, 0.42),
		Color(0.26, 0.96, 0.68),
	]
	for color in colors:
		mat_agent.append(_mat(color, color, 0.36))
	mat_corpse = _mat(Color(0.18, 0.02, 0.03), Color(0.8, 0.0, 0.05), 0.42)
	var crate_texture = load("res://shared-harness/art-kit/textures/crate-neon-wear.png")
	mat_opened = _mat(Color(0.22, 0.18, 0.12), Color(0.25, 0.12, 0.03), 0.16, crate_texture)
	mat_closed = _mat(Color(0.78, 0.47, 0.12), Color(1.0, 0.62, 0.08), 0.55, crate_texture)
	mat_airdrop = _mat(Color(0.55, 0.04, 0.08), Color(1.0, 0.04, 0.10), 0.8, crate_texture)
	mat_beam = _mat(Color(0.3, 0.02, 0.05, 0.35), Color(1.0, 0.04, 0.12), 1.2)
	mat_mist = _mat(Color(0.9, 0.02, 0.04, 0.42), Color(1.0, 0.02, 0.05), 1.4)


func _mat(albedo: Color, emission: Color, energy: float, texture_resource: Resource = null) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = albedo
	var texture := texture_resource as Texture2D
	if texture != null:
		material.albedo_texture = texture
	material.emission_enabled = true
	material.emission = emission
	material.emission_energy_multiplier = energy
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA if albedo.a < 1.0 else BaseMaterial3D.TRANSPARENCY_DISABLED
	return material
