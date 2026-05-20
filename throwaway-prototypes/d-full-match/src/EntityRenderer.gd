extends Node3D

const MODEL_AGENT := "res://shared-harness/art-kit/Astronaut.glb"
const MODEL_CRATE := "res://shared-harness/art-kit/Pickup Crate.glb"

var snapshot: Dictionary = {}
var frames: Array = []
var scene_builder: Node
var character_nodes: Dictionary = {}
var corpse_nodes: Dictionary = {}
var crate_nodes: Dictionary = {}
var airdrop_nodes: Dictionary = {}
var anchor_positions: Dictionary = {}
var mist_nodes: Array[MeshInstance3D] = []
var mist_age := 999.0
var last_effect_turn := -1
var agent_scene: PackedScene
var crate_scene: PackedScene
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
	_clear()
	_make_materials()
	_load_models()
	_spawn_characters(snapshot.get("characters", []))
	_spawn_crates()
	_spawn_airdrops()
	_spawn_mist()
	last_effect_turn = -1


func update_to_turn(turn_value: float) -> void:
	if frames.is_empty():
		return
	var sample := sample_turn(turn_value)
	_update_characters(sample)
	_update_corpses(sample)
	_update_crates(sample)
	_update_airdrops(sample)
	_update_environmental_effects(int(floor(turn_value)))
	_update_mist(get_process_delta_time())


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
		child.queue_free()
	character_nodes.clear()
	corpse_nodes.clear()
	crate_nodes.clear()
	airdrop_nodes.clear()
	anchor_positions.clear()
	mist_nodes.clear()


func _load_models() -> void:
	agent_scene = load(MODEL_AGENT)
	crate_scene = load(MODEL_CRATE)


func _spawn_characters(characters: Array) -> void:
	for i in range(characters.size()):
		var character = characters[i]
		if typeof(character) != TYPE_DICTIONARY:
			continue
		var id := str(character.get("characterId", ""))
		var node := _instance_or_capsule(agent_scene, "character-%s" % id, mat_agent[i % mat_agent.size()])
		add_child(node)
		character_nodes[id] = node
		anchor_positions[id] = Vector3.ZERO


func _spawn_crates() -> void:
	if frames.is_empty():
		return
	for crate in frames[0].get("crates", []):
		if typeof(crate) != TYPE_DICTIONARY:
			continue
		var id := str(crate.get("id", ""))
		var node := _instance_or_box(crate_scene, "crate-%s" % id, mat_closed, Vector3(0.34, 0.42, 0.34))
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
		var crate := _instance_or_box(crate_scene, "crate", mat_airdrop, Vector3(0.42, 0.42, 0.42))
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
		var pos := _tile_to_world(character.get("pos", {}), 0.35)
		node.position = pos
		node.visible = bool(character.get("alive", true)) and character.get("extractedAtTurn", null) == null
		node.rotation.y = sin(Time.get_ticks_msec() * 0.002 + float(id.hash() % 29)) * 0.14
		anchor_positions[id] = pos
		seen[id] = true
	for id in character_nodes.keys():
		if not seen.has(id):
			var node: Node3D = character_nodes[id]
			node.visible = false


func _update_corpses(sample: Dictionary) -> void:
	var live_corpses := {}
	for corpse in sample.get("corpses", []):
		if typeof(corpse) != TYPE_DICTIONARY:
			continue
		var id := str(corpse.get("characterId", ""))
		var node: MeshInstance3D = corpse_nodes.get(id)
		if node == null:
			node = _make_box("corpse-%s" % id, Vector3(0.62, 0.08, 0.28), mat_corpse)
			add_child(node)
			corpse_nodes[id] = node
		node.position = _tile_to_world(corpse.get("pos", {}), 0.06)
		node.visible = true
		anchor_positions[id] = node.position + Vector3(0.0, 0.35, 0.0)
		live_corpses[id] = true
	for id in corpse_nodes.keys():
		if not live_corpses.has(id):
			var node: MeshInstance3D = corpse_nodes[id]
			node.visible = false


func _update_crates(sample: Dictionary) -> void:
	for crate in sample.get("crates", []):
		if typeof(crate) != TYPE_DICTIONARY:
			continue
		var id := str(crate.get("id", ""))
		var node: Node3D = crate_nodes.get(id)
		if node == null:
			continue
		node.position = _tile_to_world(crate.get("pos", {}), 0.24)
		var opened := bool(crate.get("opened", false))
		node.visible = true
		_apply_material(node, mat_opened if opened else mat_closed)


func _update_airdrops(sample: Dictionary) -> void:
	for drop in sample.get("airdrops", []):
		if typeof(drop) != TYPE_DICTIONARY:
			continue
		var id := str(drop.get("id", ""))
		var root: Node3D = airdrop_nodes.get(id)
		if root == null:
			continue
		var state := str(drop.get("state", "pre"))
		root.position = _tile_to_world(drop.get("pos", {}), 0.26)
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
		merged["pos"] = {
			"x": lerp(float(pos_a.get("x", 0)), float(pos_b.get("x", 0)), t),
			"y": lerp(float(pos_a.get("y", 0)), float(pos_b.get("y", 0)), t),
		}
		characters.append(merged)
	var out: Dictionary = a.duplicate(true)
	out["characters"] = characters
	return out


func _tile_to_world(pos: Dictionary, y: float = 0.0) -> Vector3:
	if scene_builder != null and scene_builder.has_method("tile_to_world"):
		return scene_builder.tile_to_world(pos, y)
	return Vector3(float(pos.get("x", 0)), y, float(pos.get("y", 0)))


func _instance_or_capsule(scene: PackedScene, label: String, material: Material) -> Node3D:
	if scene != null:
		var node := scene.instantiate() as Node3D
		node.name = label
		node.scale = Vector3.ONE * 0.42
		_apply_material(node, material)
		return node
	var fallback := MeshInstance3D.new()
	fallback.name = label
	var mesh := CapsuleMesh.new()
	mesh.radius = 0.18
	mesh.height = 0.68
	fallback.mesh = mesh
	fallback.material_override = material
	return fallback


func _instance_or_box(scene: PackedScene, label: String, material: Material, size: Vector3) -> Node3D:
	if scene != null:
		var node := scene.instantiate() as Node3D
		node.name = label
		node.scale = Vector3.ONE * 0.34
		_apply_material(node, material)
		return node
	return _make_box(label, size, material)


func _make_box(label: String, size: Vector3, material: Material) -> MeshInstance3D:
	var node := MeshInstance3D.new()
	node.name = label
	var mesh := BoxMesh.new()
	mesh.size = size
	node.mesh = mesh
	node.material_override = material
	return node


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
	mat_opened = _mat(Color(0.22, 0.18, 0.12), Color(0.25, 0.12, 0.03), 0.16)
	mat_closed = _mat(Color(0.78, 0.47, 0.12), Color(1.0, 0.62, 0.08), 0.55)
	mat_airdrop = _mat(Color(0.55, 0.04, 0.08), Color(1.0, 0.04, 0.10), 0.8)
	mat_beam = _mat(Color(0.3, 0.02, 0.05, 0.35), Color(1.0, 0.04, 0.12), 1.2)
	mat_mist = _mat(Color(0.9, 0.02, 0.04, 0.42), Color(1.0, 0.02, 0.05), 1.4)


func _mat(albedo: Color, emission: Color, energy: float) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = albedo
	material.emission_enabled = true
	material.emission = emission
	material.emission_energy_multiplier = energy
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA if albedo.a < 1.0 else BaseMaterial3D.TRANSPARENCY_DISABLED
	return material
