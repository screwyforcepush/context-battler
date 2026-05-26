extends Node3D

const MAX_BLOOD_POOLS := 64
const MAX_PARTICLE_BURST := 96
const MAX_GORE_CHUNKS := 5
const BURST_LIFETIME := 1.05
const CHUNK_LIFETIME := 1.8

var snapshot: Dictionary = {}
var scene_builder: Node
var entity_renderer: Node
var camera_rig: Node
var attacks_by_turn: Dictionary = {}
var loots_by_turn: Dictionary = {}
var blocked_movements_by_turn: Dictionary = {}
var last_triggered_turn := -1
var active_bursts: Array = []
var active_chunks: Array = []
var blood_pools: Array[MeshInstance3D] = []
var mat_blood: StandardMaterial3D
var mat_blood_dark: StandardMaterial3D
var mat_miss_spray: StandardMaterial3D
var mat_dust: StandardMaterial3D
var mat_loot: StandardMaterial3D
var mat_chunk: StandardMaterial3D


func configure(root: Dictionary, builder: Node, renderer: Node) -> void:
	snapshot = root
	scene_builder = builder
	entity_renderer = renderer
	attacks_by_turn.clear()
	loots_by_turn.clear()
	blocked_movements_by_turn.clear()
	_clear_effects()
	_make_materials()
	_index_events()
	last_triggered_turn = -1


func set_camera_rig(rig: Node) -> void:
	camera_rig = rig


func update_to_turn(turn_value: float, delta: float) -> void:
	var turn_int := int(floor(turn_value))
	if turn_int < last_triggered_turn:
		_clear_effects()
		last_triggered_turn = -1
	if turn_int != last_triggered_turn:
		for event_turn in range(last_triggered_turn + 1, turn_int + 1):
			_trigger_turn(event_turn)
		last_triggered_turn = turn_int
	_update_bursts(delta)
	_update_chunks(delta)


func _index_events() -> void:
	for attack in snapshot.get("attacks", []):
		if typeof(attack) == TYPE_DICTIONARY:
			_bucket(attacks_by_turn, int(attack.get("turn", -1)), attack)
	for loot in snapshot.get("loots", []):
		if typeof(loot) == TYPE_DICTIONARY:
			_bucket(loots_by_turn, int(loot.get("turn", -1)), loot)
	for movement in snapshot.get("movements", []):
		if typeof(movement) != TYPE_DICTIONARY:
			continue
		if str(movement.get("blockedBy", "")) == "wall":
			_bucket(blocked_movements_by_turn, int(movement.get("turn", -1)), movement)


func _bucket(bucket: Dictionary, turn: int, event: Dictionary) -> void:
	if turn < 0:
		return
	if not bucket.has(turn):
		bucket[turn] = []
	var events: Array = bucket[turn]
	events.append(event)
	bucket[turn] = events


func _trigger_turn(turn: int) -> void:
	for movement in blocked_movements_by_turn.get(turn, []):
		if typeof(movement) == TYPE_DICTIONARY:
			_trigger_wall_face_slam(movement)
	for attack in attacks_by_turn.get(turn, []):
		if typeof(attack) == TYPE_DICTIONARY:
			_trigger_attack(attack)
	for loot in loots_by_turn.get(turn, []):
		if typeof(loot) == TYPE_DICTIONARY:
			_trigger_loot(loot)


func _trigger_attack(event: Dictionary) -> void:
	var attacker_id := str(event.get("attackerId", ""))
	var target_id := str(event.get("targetId", ""))
	var weapon := str(event.get("weapon", ""))
	var hit := bool(event.get("hit", false))
	var lethal := bool(event.get("lethal", false))
	var event_turn := int(event.get("turn", last_triggered_turn))
	var attacker_pos := _character_world_for_event(attacker_id, event_turn)
	var target_pos := _character_world_for_event(target_id, event_turn)
	var direction := _flat_direction(attacker_pos, target_pos)
	if entity_renderer != null and entity_renderer.has_method("play_attack_pose"):
		entity_renderer.play_attack_pose(attacker_id, target_pos, weapon, hit, lethal)
	if hit:
		_spawn_burst(target_pos + Vector3(0.0, 0.42, 0.0), direction, mat_blood, MAX_PARTICLE_BURST, 2.0)
		_spawn_blood_pool(target_pos)
		_screen_punch(direction, _attack_punch_magnitude(event))
	else:
		var miss_origin := attacker_pos.lerp(target_pos, 0.72) + Vector3(0.0, 0.34, 0.0)
		_spawn_burst(miss_origin, direction, mat_miss_spray, min(MAX_PARTICLE_BURST, 44), 1.25)
		_screen_punch(direction, 0.025)
	if lethal:
		_spawn_dismemberment(target_pos, direction)
		_spawn_blood_pool(target_pos + direction * 0.12)
		if entity_renderer != null and entity_renderer.has_method("mark_lethal_target"):
			entity_renderer.mark_lethal_target(target_id)


func _trigger_wall_face_slam(event: Dictionary) -> void:
	var character_id := str(event.get("characterId", ""))
	var origin := _tile_world(event.get("fromTile", {}), 0.18)
	_spawn_burst(origin + Vector3(0.0, 0.22, 0.0), Vector3.UP, mat_dust, min(MAX_PARTICLE_BURST, 38), 0.85)
	if entity_renderer != null and entity_renderer.has_method("play_wall_slam"):
		entity_renderer.play_wall_slam(character_id, origin)
	_screen_punch(Vector3.UP, 0.035)


func _trigger_loot(event: Dictionary) -> void:
	var character_id := str(event.get("characterId", ""))
	var origin := _character_world_for_event(character_id, int(event.get("turn", last_triggered_turn)))
	_spawn_loot_flourish(origin + Vector3(0.0, 0.32, 0.0))
	if entity_renderer != null:
		if entity_renderer.has_method("mark_loot_source"):
			entity_renderer.mark_loot_source(str(event.get("source", "")), str(event.get("sourceId", "")))
		if entity_renderer.has_method("play_loot_pickup"):
			var item = event.get("item", {})
			entity_renderer.play_loot_pickup(character_id, item if typeof(item) == TYPE_DICTIONARY else {})


func _spawn_burst(origin: Vector3, direction: Vector3, material: Material, amount: int, speed_scale: float) -> void:
	var count: int = clamp(amount, 0, MAX_PARTICLE_BURST)
	var base_direction := direction.normalized() if direction.length() > 0.001 else Vector3.UP
	for i in range(count):
		var particle := MeshInstance3D.new()
		particle.name = "vfx-particle"
		var mesh := SphereMesh.new()
		mesh.radius = randf_range(0.018, 0.052)
		mesh.height = mesh.radius * 1.4
		particle.mesh = mesh
		particle.material_override = material
		particle.position = origin
		add_child(particle)
		var spread := Vector3(randf_range(-0.75, 0.75), randf_range(-0.15, 1.25), randf_range(-0.75, 0.75))
		var velocity := (base_direction * randf_range(0.25, 1.5) + spread).normalized() * randf_range(0.4, 1.7) * speed_scale
		active_bursts.append({
			"node": particle,
			"velocity": velocity,
			"age": 0.0,
			"lifetime": randf_range(0.45, BURST_LIFETIME),
			"baseScale": particle.scale,
		})


func _spawn_loot_flourish(origin: Vector3) -> void:
	_spawn_burst(origin, Vector3.UP, mat_loot, min(MAX_PARTICLE_BURST, 36), 0.72)
	var ring := MeshInstance3D.new()
	ring.name = "loot-pickup-ring"
	var mesh := TorusMesh.new()
	mesh.inner_radius = 0.12
	mesh.outer_radius = 0.18
	ring.mesh = mesh
	ring.material_override = mat_loot
	ring.position = origin
	add_child(ring)
	active_bursts.append({
		"node": ring,
		"velocity": Vector3(0.0, 0.18, 0.0),
		"age": 0.0,
		"lifetime": 0.42,
		"baseScale": Vector3.ONE,
	})


func _spawn_blood_pool(origin: Vector3) -> void:
	var pool := MeshInstance3D.new()
	pool.name = "persistent-blood-pool"
	var mesh := CylinderMesh.new()
	mesh.top_radius = randf_range(0.20, 0.42)
	mesh.bottom_radius = mesh.top_radius
	mesh.height = 0.012
	pool.mesh = mesh
	pool.material_override = mat_blood_dark
	pool.position = Vector3(origin.x + randf_range(-0.07, 0.07), 0.018, origin.z + randf_range(-0.07, 0.07))
	pool.rotation.y = randf() * TAU
	add_child(pool)
	blood_pools.append(pool)
	while blood_pools.size() > MAX_BLOOD_POOLS:
		var oldest := blood_pools.pop_front()
		if oldest != null and is_instance_valid(oldest):
			oldest.queue_free()


func _spawn_dismemberment(origin: Vector3, direction: Vector3) -> void:
	var forward := direction.normalized() if direction.length() > 0.001 else Vector3(0.0, 0.0, -1.0)
	for i in range(MAX_GORE_CHUNKS):
		var chunk := MeshInstance3D.new()
		chunk.name = "dismemberment-chunk"
		var mesh := BoxMesh.new()
		mesh.size = Vector3(randf_range(0.06, 0.16), randf_range(0.05, 0.20), randf_range(0.05, 0.13))
		chunk.mesh = mesh
		chunk.material_override = mat_chunk
		chunk.position = origin + Vector3(0.0, randf_range(0.22, 0.58), 0.0)
		chunk.rotation_degrees = Vector3(randf_range(-45, 45), randf_range(0, 360), randf_range(-45, 45))
		add_child(chunk)
		var side := Vector3(-forward.z, 0.0, forward.x)
		active_chunks.append({
			"node": chunk,
			"velocity": forward * randf_range(0.45, 1.3) + side * randf_range(-0.8, 0.8) + Vector3.UP * randf_range(0.55, 1.7),
			"age": 0.0,
			"lifetime": randf_range(0.9, CHUNK_LIFETIME),
			"spin": Vector3(randf_range(-4.0, 4.0), randf_range(-7.0, 7.0), randf_range(-4.0, 4.0)),
		})


func _update_bursts(delta: float) -> void:
	for i in range(active_bursts.size() - 1, -1, -1):
		var burst: Dictionary = active_bursts[i]
		var node: MeshInstance3D = burst.get("node")
		if node == null or not is_instance_valid(node):
			active_bursts.remove_at(i)
			continue
		var age := float(burst.get("age", 0.0)) + delta
		var lifetime := float(burst.get("lifetime", BURST_LIFETIME))
		node.position += (burst.get("velocity", Vector3.ZERO) as Vector3) * delta
		node.position.y -= age * delta * 0.62
		var fade: float = clamp(1.0 - age / lifetime, 0.0, 1.0)
		node.scale = (burst.get("baseScale", Vector3.ONE) as Vector3) * (0.45 + fade * 0.9)
		burst["age"] = age
		active_bursts[i] = burst
		if age >= lifetime:
			node.queue_free()
			active_bursts.remove_at(i)


func _update_chunks(delta: float) -> void:
	for i in range(active_chunks.size() - 1, -1, -1):
		var chunk: Dictionary = active_chunks[i]
		var node: MeshInstance3D = chunk.get("node")
		if node == null or not is_instance_valid(node):
			active_chunks.remove_at(i)
			continue
		var age := float(chunk.get("age", 0.0)) + delta
		var velocity: Vector3 = chunk.get("velocity", Vector3.ZERO)
		velocity.y -= 1.8 * delta
		node.position += velocity * delta
		node.position.y = max(0.04, node.position.y)
		node.rotation += (chunk.get("spin", Vector3.ZERO) as Vector3) * delta
		chunk["age"] = age
		chunk["velocity"] = velocity
		active_chunks[i] = chunk
		if age >= float(chunk.get("lifetime", CHUNK_LIFETIME)):
			node.queue_free()
			active_chunks.remove_at(i)


func _clear_effects() -> void:
	for burst in active_bursts:
		var node: Node = burst.get("node") if typeof(burst) == TYPE_DICTIONARY else null
		if node != null and is_instance_valid(node):
			node.queue_free()
	for chunk in active_chunks:
		var node: Node = chunk.get("node") if typeof(chunk) == TYPE_DICTIONARY else null
		if node != null and is_instance_valid(node):
			node.queue_free()
	for pool in blood_pools:
		if pool != null and is_instance_valid(pool):
			pool.queue_free()
	active_bursts.clear()
	active_chunks.clear()
	blood_pools.clear()


func _character_world(character_id: String) -> Vector3:
	if entity_renderer != null and entity_renderer.has_method("get_character_world"):
		return entity_renderer.get_character_world(character_id)
	if entity_renderer != null and entity_renderer.has_method("get_anchor_world"):
		return entity_renderer.get_anchor_world(character_id)
	return Vector3.ZERO


func _character_world_for_event(character_id: String, turn: int) -> Vector3:
	var sample := _frame_snapshot_for_turn(turn)
	for character in sample.get("characters", []):
		if typeof(character) == TYPE_DICTIONARY and str(character.get("characterId", "")) == character_id:
			return _tile_world(character.get("pos", {}), 0.0)
	for corpse in sample.get("corpses", []):
		if typeof(corpse) == TYPE_DICTIONARY and str(corpse.get("characterId", "")) == character_id:
			return _tile_world(corpse.get("pos", {}), 0.0)
	return _character_world(character_id)


func _frame_snapshot_for_turn(turn: int) -> Dictionary:
	var timeline: Dictionary = snapshot.get("timeline", {})
	var frames: Array = timeline.get("frames", [])
	var selected := {}
	for frame in frames:
		if typeof(frame) != TYPE_DICTIONARY:
			continue
		if int(frame.get("turn", 0)) <= turn:
			selected = frame
		else:
			break
	var sample = selected.get("snapshot", {})
	return sample if typeof(sample) == TYPE_DICTIONARY else {}


func _tile_world(tile, y: float) -> Vector3:
	if entity_renderer != null and entity_renderer.has_method("world_from_tile"):
		return entity_renderer.world_from_tile(tile if typeof(tile) == TYPE_DICTIONARY else {}, y)
	if scene_builder != null and scene_builder.has_method("tile_to_world"):
		return scene_builder.tile_to_world(tile if typeof(tile) == TYPE_DICTIONARY else {}, y)
	return Vector3.ZERO


func _flat_direction(from_pos: Vector3, to_pos: Vector3) -> Vector3:
	var direction := to_pos - from_pos
	direction.y = 0.0
	return direction.normalized() if direction.length() > 0.001 else Vector3(0.0, 0.0, -1.0)


func _screen_punch(direction: Vector3, magnitude: float) -> void:
	if camera_rig != null and camera_rig.has_method("screen_punch"):
		camera_rig.screen_punch(direction, magnitude)


func _attack_punch_magnitude(event: Dictionary) -> float:
	if bool(event.get("lethal", false)):
		return 0.105
	var weapon := str(event.get("weapon", ""))
	if weapon in ["greatsword", "warhammer", "axe"]:
		return 0.075
	if str(event.get("kind", "")) == "bodyCollision":
		return 0.065
	return 0.045


func _make_materials() -> void:
	if mat_blood != null:
		return
	mat_blood = _mat(Color(0.86, 0.0, 0.035, 0.68), Color(1.0, 0.0, 0.04), 1.2, true)
	mat_blood_dark = _mat(Color(0.32, 0.0, 0.02, 0.72), Color(0.65, 0.0, 0.03), 0.45, true)
	mat_miss_spray = _mat(Color(0.95, 0.05, 0.08, 0.42), Color(1.0, 0.06, 0.08), 0.75, true)
	mat_dust = _mat(Color(0.64, 0.55, 0.38, 0.46), Color(1.0, 0.48, 0.14), 0.32, true)
	mat_loot = _mat(Color(0.0, 0.92, 1.0, 0.58), Color(0.0, 1.0, 1.0), 1.35, true)
	mat_chunk = _mat(Color(0.48, 0.0, 0.03), Color(0.9, 0.0, 0.05), 0.85, false)


func _mat(albedo: Color, emission: Color, energy: float, transparent: bool) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = albedo
	material.emission_enabled = true
	material.emission = emission
	material.emission_energy_multiplier = energy
	material.roughness = 0.6
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA if transparent else BaseMaterial3D.TRANSPARENCY_DISABLED
	return material
