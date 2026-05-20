extends Node3D

const SNAPSHOT_URL := "/shared-harness/replay-snapshot.json"
const SNAPSHOT_RESOURCE := "res://shared-harness/replay-snapshot.json"
const MODEL_AGENT := "res://shared-harness/art-kit/Astronaut.glb"
const MODEL_CRATE := "res://shared-harness/art-kit/Pickup Crate.glb"
const MODEL_BASE := "res://shared-harness/art-kit/Base Large.glb"
const MODEL_BUILDING := "res://shared-harness/art-kit/Building L.glb"
const WORLD_SCALE := 0.38
const LOOP_DEFAULT_SECONDS := 16.0
const MIST_COUNT := 46
const DUEL_SPARK_COUNT := 34
const DUEL_BLOOD_COUNT := 24
const AGENT_COLORS := [
	Color(0.95, 0.10, 0.12),
	Color(0.00, 0.90, 0.78),
	Color(1.00, 0.68, 0.12),
	Color(0.42, 0.95, 0.32),
	Color(0.84, 0.28, 1.00),
	Color(0.20, 0.52, 1.00),
	Color(1.00, 0.24, 0.42),
	Color(0.26, 0.96, 0.68),
]

var snapshot: Dictionary = {}
var map_data: Dictionary = {}
var frames: Array = []
var money_shot: Dictionary = {}
var highlighted_event: Dictionary = {}
var highlighted_events: Array = []
var duel_event: Dictionary = {}
var playback: Dictionary = {}
var character_nodes: Dictionary = {}
var character_names: Dictionary = {}
var character_colors: Dictionary = {}
var static_crate_nodes: Array[Node3D] = []
var duel_root: Node3D
var duel_trace_primary: MeshInstance3D
var duel_trace_counter: MeshInstance3D
var duel_hit_flash: MeshInstance3D
var duel_kill_flash: MeshInstance3D
var duel_light: OmniLight3D
var duel_corpse_root: Node3D
var duel_blood_pool: MeshInstance3D
var duel_spark_nodes: Array[MeshInstance3D] = []
var duel_spark_velocities: Array[Vector3] = []
var duel_blood_nodes: Array[MeshInstance3D] = []
var duel_blood_velocities: Array[Vector3] = []
var drop_root: Node3D
var drop_crate: Node3D
var telegraph_beam: MeshInstance3D
var landing_ring: MeshInstance3D
var shockwave: MeshInstance3D
var impact_light: OmniLight3D
var mist_nodes: Array[MeshInstance3D] = []
var mist_velocities: Array[Vector3] = []
var mist_active := false
var mist_age := 0.0
var elapsed := 0.0
var last_loop_time := -1.0
var follow_locked := true
var yaw := -0.72
var pitch := -0.72
var radius := 13.5
var target_anchor := Vector3.ZERO
var free_anchor := Vector3.ZERO
var dragging := false
var last_pointer := Vector2.ZERO
var camera: Camera3D
var status_label: Label
var toggle_button: Button
var agent_scene: PackedScene
var crate_scene: PackedScene
var base_scene: PackedScene
var building_scene: PackedScene
var mat_ground: StandardMaterial3D
var mat_wall: StandardMaterial3D
var mat_cover: StandardMaterial3D
var mat_cyan: StandardMaterial3D
var mat_red: StandardMaterial3D
var mat_crimson: StandardMaterial3D
var mat_gold: StandardMaterial3D
var mat_shock: StandardMaterial3D
var mat_duel_trace: StandardMaterial3D
var mat_duel_counter: StandardMaterial3D
var mat_duel_flash: StandardMaterial3D
var mat_duel_spark: StandardMaterial3D
var mat_duel_blood: StandardMaterial3D
var mat_duel_corpse: StandardMaterial3D


func _ready() -> void:
	RenderingServer.set_default_clear_color(Color(0.006, 0.008, 0.012, 1.0))
	_make_materials()
	_make_world_environment()
	_make_lighting()
	_load_snapshot()
	_load_model_templates()
	_build_scene_from_snapshot()
	_make_camera()
	_make_ui()
	_signal_boot_state("loaded")


func _process(delta: float) -> void:
	if frames.is_empty():
		return

	elapsed += delta
	var loop_seconds := float(playback.get("sliceDurationSeconds", money_shot.get("loopSeconds", LOOP_DEFAULT_SECONDS)))
	var loop_time := fmod(elapsed, loop_seconds)
	if last_loop_time > loop_time:
		_reset_loop()

	var start_turn := int(playback.get("startTurn", money_shot.get("loopStartTurn", 7)))
	var end_turn := int(playback.get("endTurn", money_shot.get("loopEndTurn", 12)))
	var virtual_turn := float(start_turn) + (loop_time / loop_seconds) * float(max(1, end_turn - start_turn))
	var sample := _sample_frame(virtual_turn)
	var impact_time := _impact_time(loop_seconds, start_turn, end_turn)

	_update_characters(sample, virtual_turn, loop_time, impact_time)
	_update_duel_vfx(sample, loop_time)
	_update_airdrop(loop_time, impact_time)
	_update_mist(delta)
	_update_camera(delta, sample, loop_time, impact_time)
	_update_status(loop_time, impact_time)

	if last_loop_time < impact_time and loop_time >= impact_time:
		_trigger_mist(_tile_to_world(_landing_tile(), 0.65))

	last_loop_time = loop_time
	_signal_first_frame_once()


func _input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_LEFT:
			dragging = mb.pressed
			last_pointer = mb.position
		elif mb.pressed and mb.button_index == MOUSE_BUTTON_WHEEL_UP:
			radius = max(5.0, radius - 1.0)
		elif mb.pressed and mb.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			radius = min(28.0, radius + 1.0)
	elif event is InputEventMouseMotion and dragging:
		var mm := event as InputEventMouseMotion
		var delta := mm.position - last_pointer
		last_pointer = mm.position
		yaw -= delta.x * 0.007
		pitch = clamp(pitch - delta.y * 0.006, -1.24, -0.22)
	elif event is InputEventKey:
		var key := event as InputEventKey
		if key.pressed and not key.echo and key.keycode == KEY_SPACE:
			_toggle_follow()


func _load_snapshot() -> void:
	var raw := ""
	var source := "resource"
	if OS.has_feature("web"):
		raw = _load_snapshot_via_js_bridge()
		source = "js-bridge-xhr"
	if raw.is_empty():
		raw = FileAccess.get_file_as_string(SNAPSHOT_RESOURCE)
		source = "resource-fallback"
	var parsed = JSON.parse_string(raw)
	if typeof(parsed) != TYPE_DICTIONARY:
		push_error("Unable to parse replay snapshot from %s" % source)
		frames = []
		return
	snapshot = parsed
	map_data = snapshot.get("map", {})
	playback = snapshot.get("playback", {})
	highlighted_events = _extract_highlighted_events(snapshot)
	highlighted_event = _normalize_airdrop_event(snapshot)
	duel_event = _normalize_duel_event(snapshot)
	money_shot = _normalize_money_shot(snapshot)
	frames = _extract_frame_snapshots(snapshot)
	print("Godot WASM duel/telefrag loaded %d frames from %s" % [frames.size(), source])


func _load_snapshot_via_js_bridge() -> String:
	var script := """
(() => {
  try {
    const request = new XMLHttpRequest();
    request.open('GET', '%s', false);
    request.setRequestHeader('Cache-Control', 'no-store');
    request.send(null);
    window.__telefragBridge = {
      path: '%s',
      status: request.status,
      bytes: request.responseText ? request.responseText.length : 0,
      loadedAt: performance.now()
    };
    return request.status >= 200 && request.status < 300 ? request.responseText : '';
  } catch (error) {
    window.__telefragBridge = {
      path: '%s',
      status: -1,
      error: String(error),
      loadedAt: performance.now()
    };
    return '';
  }
})()
""" % [SNAPSHOT_URL, SNAPSHOT_URL, SNAPSHOT_URL]
	var result = JavaScriptBridge.eval(script, true)
	return "" if result == null else str(result)


func _normalize_money_shot(root: Dictionary) -> Dictionary:
	if root.has("moneyShot"):
		return root.get("moneyShot", {})
	var event: Dictionary = _normalize_airdrop_event(root)
	return {
		"victimId": event.get("victimId", "char_sprinter"),
		"dropId": event.get("airdropId", "Crate_50_50"),
		"landsAtTurn": event.get("landTurn", 10),
		"loopStartTurn": playback.get("startTurn", 7),
		"loopEndTurn": playback.get("endTurn", 12),
		"loopSeconds": playback.get("sliceDurationSeconds", LOOP_DEFAULT_SECONDS),
	}


func _extract_highlighted_events(root: Dictionary) -> Array:
	var events := []
	var raw_events = root.get("highlightedEvents", [])
	if typeof(raw_events) != TYPE_ARRAY:
		return events
	for event in raw_events:
		if typeof(event) == TYPE_DICTIONARY:
			events.append(event)
	return events


func _normalize_airdrop_event(root: Dictionary) -> Dictionary:
	var legacy = root.get("highlightedEvent", {})
	if typeof(legacy) == TYPE_DICTIONARY and not legacy.is_empty():
		return legacy
	for event in _extract_highlighted_events(root):
		if _is_airdrop_event(event):
			return event
	return {}


func _normalize_duel_event(root: Dictionary) -> Dictionary:
	var source_event: Dictionary = {}
	for event in _extract_highlighted_events(root):
		if _is_duel_event(event):
			source_event = event
			break
	if source_event.is_empty():
		return {}

	var normalized := source_event.duplicate(true)
	var killer_id := _first_string_field(source_event, ["winnerId", "killerId", "attackerId", "actorId"])
	var victim_id := _first_string_field(source_event, ["loserId", "victimId", "defenderId", "targetId"])
	if not killer_id.is_empty():
		normalized["killerId"] = killer_id
	if not victim_id.is_empty():
		normalized["victimId"] = victim_id
	normalized["participantIds"] = _collect_participant_ids(source_event, [killer_id, victim_id])

	var event_playback = source_event.get("playback", {})
	var event_times := {}
	if typeof(event_playback) == TYPE_DICTIONARY:
		event_times = _number_record(event_playback.get("eventTimesSeconds", {}))
	if event_times.is_empty():
		event_times = _number_record(playback.get("eventTimesSeconds", {}))
	if not event_times.is_empty():
		normalized["eventTimesSeconds"] = event_times
	return normalized


func _is_airdrop_event(event: Dictionary) -> bool:
	var kind := str(event.get("kind", "")).to_lower()
	return kind == "airdrop-telefrag" or (event.has("airdropId") and event.has("victimId") and event.has("landTurn"))


func _is_duel_event(event: Dictionary) -> bool:
	return str(event.get("kind", "")).to_lower().find("duel") != -1


func _first_string_field(event: Dictionary, keys: Array) -> String:
	for key in keys:
		var value = event.get(str(key), null)
		if typeof(value) == TYPE_STRING and not str(value).is_empty():
			return str(value)
	return ""


func _collect_participant_ids(event: Dictionary, candidates: Array) -> Array:
	var ids := []
	var seen := {}
	var raw_ids = event.get("participantIds", [])
	if typeof(raw_ids) == TYPE_ARRAY:
		for raw_id in raw_ids:
			_add_unique_string(ids, seen, raw_id)

	var participants = event.get("participants", [])
	if typeof(participants) == TYPE_ARRAY:
		for participant in participants:
			if typeof(participant) == TYPE_DICTIONARY:
				_add_unique_string(ids, seen, _first_string_field(participant, ["characterId", "id"]))
			else:
				_add_unique_string(ids, seen, participant)

	for candidate in candidates:
		_add_unique_string(ids, seen, candidate)
	return ids


func _add_unique_string(ids: Array, seen: Dictionary, value) -> void:
	if typeof(value) != TYPE_STRING or str(value).is_empty():
		return
	var id := str(value)
	if seen.has(id):
		return
	seen[id] = true
	ids.append(id)


func _number_record(value) -> Dictionary:
	var out := {}
	if typeof(value) != TYPE_DICTIONARY:
		return out
	for key in value.keys():
		var entry = value[key]
		if typeof(entry) == TYPE_INT or typeof(entry) == TYPE_FLOAT:
			out[str(key)] = float(entry)
	return out


func _extract_frame_snapshots(root: Dictionary) -> Array:
	if root.has("frames"):
		return root.get("frames", [])
	var timeline: Dictionary = root.get("timeline", {})
	var output: Array = []
	for frame in timeline.get("frames", []):
		if typeof(frame) == TYPE_DICTIONARY and frame.has("snapshot"):
			output.append(frame.get("snapshot"))
		elif typeof(frame) == TYPE_DICTIONARY:
			output.append(frame)
	return output


func _load_model_templates() -> void:
	agent_scene = load(MODEL_AGENT)
	crate_scene = load(MODEL_CRATE)
	base_scene = load(MODEL_BASE)
	building_scene = load(MODEL_BUILDING)


func _build_scene_from_snapshot() -> void:
	if map_data.is_empty():
		return
	_build_arena()
	_build_static_crates()
	_build_agents()
	_build_airdrop()
	_build_impact_vfx()
	_build_duel_vfx()


func _build_arena() -> void:
	var size: Dictionary = map_data.get("size", {"w": 100, "h": 100})
	var ground := MeshInstance3D.new()
	ground.name = "obsidian-grid"
	var plane := PlaneMesh.new()
	plane.size = Vector2(float(size.get("w", 100)) * WORLD_SCALE, float(size.get("h", 100)) * WORLD_SCALE)
	ground.mesh = plane
	ground.material_override = mat_ground
	add_child(ground)

	for wall in map_data.get("walls", []):
		if typeof(wall) == TYPE_DICTIONARY:
			_make_box("wall", _rect_center(wall), Vector3(float(wall.get("w", 1)) * WORLD_SCALE, 1.55, float(wall.get("h", 1)) * WORLD_SCALE), mat_wall)

	for cover in map_data.get("coverClusters", []):
		if typeof(cover) == TYPE_DICTIONARY:
			_make_box("cover", _rect_center(cover, 0.36), Vector3(float(cover.get("w", 1)) * WORLD_SCALE, 0.72, float(cover.get("h", 1)) * WORLD_SCALE), mat_cover)

	_scatter_environment_props()
	_make_evac_marker()


func _scatter_environment_props() -> void:
	var prop_data := [
		{"scene": base_scene, "tile": Vector2(18, 22), "scale": 0.75, "rot": 0.35},
		{"scene": building_scene, "tile": Vector2(71, 29), "scale": 0.56, "rot": -0.85},
		{"scene": base_scene, "tile": Vector2(24, 76), "scale": 0.58, "rot": 1.1},
		{"scene": building_scene, "tile": Vector2(80, 73), "scale": 0.5, "rot": 0.65},
	]
	for item in prop_data:
		var node := _instantiate_scene(item.scene, "environment-prop")
		node.position = _tile_to_world({"x": item.tile.x, "y": item.tile.y}, 0.0)
		node.rotation.y = item.rot
		node.scale = Vector3.ONE * item.scale
		add_child(node)


func _make_evac_marker() -> void:
	var evac: Dictionary = map_data.get("evac", {})
	if evac.has("centre"):
		evac = evac.get("centre", {})
	elif not evac.has("x"):
		return
	var ring := MeshInstance3D.new()
	ring.name = "evac-neon-ring"
	var torus := TorusMesh.new()
	torus.inner_radius = 1.05
	torus.outer_radius = 1.16
	ring.mesh = torus
	ring.material_override = _emissive_material("evac-green", Color(0.1, 1.0, 0.42), 1.8, true)
	ring.position = _tile_to_world(evac, 0.07)
	add_child(ring)


func _build_static_crates() -> void:
	for crate in map_data.get("crates", map_data.get("staticCrates", [])):
		if typeof(crate) != TYPE_DICTIONARY:
			continue
		var pos: Dictionary = crate.get("pos", crate)
		var node := _instantiate_scene(crate_scene, "static-crate")
		node.position = _tile_to_world(pos, 0.18)
		node.scale = Vector3.ONE * 0.52
		add_child(node)
		static_crate_nodes.append(node)


func _build_agents() -> void:
	var seen := {}
	for frame in frames:
		for character in frame.get("characters", []):
			if typeof(character) != TYPE_DICTIONARY:
				continue
			var id := str(character.get("characterId", ""))
			if id.is_empty() or seen.has(id):
				continue
			seen[id] = true
			var index := character_nodes.size()
			var color: Color = AGENT_COLORS[index % AGENT_COLORS.size()]
			var node := _instantiate_scene(agent_scene, "agent-%s" % id)
			node.scale = Vector3.ONE * 0.55
			_add_agent_accent(node, color)
			add_child(node)
			character_nodes[id] = node
			character_names[id] = str(character.get("displayName", id))
			character_colors[id] = color


func _build_airdrop() -> void:
	drop_root = Node3D.new()
	drop_root.name = "airdrop-root"
	add_child(drop_root)

	drop_crate = _instantiate_scene(crate_scene, "falling-airdrop-crate")
	drop_crate.scale = Vector3.ONE * 0.82
	drop_root.add_child(drop_crate)

	telegraph_beam = MeshInstance3D.new()
	telegraph_beam.name = "sky-telegraph-beam"
	var beam := CylinderMesh.new()
	beam.top_radius = 0.18
	beam.bottom_radius = 0.46
	beam.height = 14.0
	telegraph_beam.mesh = beam
	telegraph_beam.material_override = mat_cyan
	add_child(telegraph_beam)

	landing_ring = MeshInstance3D.new()
	landing_ring.name = "landing-warning-ring"
	var ring := TorusMesh.new()
	ring.inner_radius = 0.54
	ring.outer_radius = 0.64
	landing_ring.mesh = ring
	landing_ring.material_override = mat_red
	add_child(landing_ring)


func _build_impact_vfx() -> void:
	shockwave = MeshInstance3D.new()
	shockwave.name = "impact-shockwave"
	var torus := TorusMesh.new()
	torus.inner_radius = 0.6
	torus.outer_radius = 0.68
	shockwave.mesh = torus
	shockwave.material_override = mat_shock
	shockwave.visible = false
	add_child(shockwave)

	impact_light = OmniLight3D.new()
	impact_light.name = "impact-red-light"
	impact_light.light_color = Color(1.0, 0.04, 0.02)
	impact_light.light_energy = 0.0
	impact_light.omni_range = 14.0
	add_child(impact_light)

	for i in range(MIST_COUNT):
		var mist := MeshInstance3D.new()
		mist.name = "red-mist-%02d" % i
		var sphere := SphereMesh.new()
		sphere.radius = 0.08 + 0.08 * randf()
		sphere.height = sphere.radius * 2.0
		mist.mesh = sphere
		mist.material_override = mat_crimson
		mist.visible = false
		add_child(mist)
		mist_nodes.append(mist)
		var angle := randf() * TAU
		var speed := randf_range(1.2, 4.2)
		mist_velocities.append(Vector3(cos(angle) * speed, randf_range(0.5, 2.4), sin(angle) * speed))


func _build_duel_vfx() -> void:
	if duel_event.is_empty():
		return
	duel_root = Node3D.new()
	duel_root.name = "duel-vfx-root"
	add_child(duel_root)

	duel_trace_primary = _make_duel_trace("duel-killer-slash", mat_duel_trace, 0.055)
	duel_trace_counter = _make_duel_trace("duel-counter-slash", mat_duel_counter, 0.042)
	duel_hit_flash = _make_duel_sphere("duel-clash-flash", mat_duel_flash, 0.26)
	duel_kill_flash = _make_duel_sphere("duel-kill-flash", mat_duel_flash, 0.36)

	duel_light = OmniLight3D.new()
	duel_light.name = "duel-kill-light"
	duel_light.light_color = Color(1.0, 0.17, 0.05)
	duel_light.light_energy = 0.0
	duel_light.omni_range = 8.0
	duel_root.add_child(duel_light)

	_make_duel_corpse()
	_make_duel_bursts()


func _make_duel_trace(label: String, material: Material, radius: float) -> MeshInstance3D:
	var trace := MeshInstance3D.new()
	trace.name = label
	var beam := CylinderMesh.new()
	beam.top_radius = radius
	beam.bottom_radius = radius
	beam.height = 1.0
	trace.mesh = beam
	trace.material_override = material
	trace.visible = false
	duel_root.add_child(trace)
	return trace


func _make_duel_sphere(label: String, material: Material, radius: float) -> MeshInstance3D:
	var sphere_node := MeshInstance3D.new()
	sphere_node.name = label
	var sphere := SphereMesh.new()
	sphere.radius = radius
	sphere.height = radius * 2.0
	sphere_node.mesh = sphere
	sphere_node.material_override = material
	sphere_node.visible = false
	duel_root.add_child(sphere_node)
	return sphere_node


func _make_duel_corpse() -> void:
	duel_corpse_root = Node3D.new()
	duel_corpse_root.name = "duel-readable-corpse"
	duel_corpse_root.visible = false
	duel_root.add_child(duel_corpse_root)

	var body := MeshInstance3D.new()
	body.name = "duel-corpse-body"
	var capsule := CapsuleMesh.new()
	capsule.radius = 0.24
	capsule.height = 1.12
	body.mesh = capsule
	body.material_override = mat_duel_corpse
	body.rotation.z = PI * 0.5
	body.position = Vector3(0.0, 0.24, 0.0)
	duel_corpse_root.add_child(body)

	var head := MeshInstance3D.new()
	head.name = "duel-corpse-head"
	var head_mesh := SphereMesh.new()
	head_mesh.radius = 0.19
	head_mesh.height = 0.38
	head.mesh = head_mesh
	head.material_override = mat_duel_corpse
	head.position = Vector3(0.53, 0.25, 0.0)
	duel_corpse_root.add_child(head)

	var ring := MeshInstance3D.new()
	ring.name = "duel-corpse-readable-ring"
	var torus := TorusMesh.new()
	torus.inner_radius = 0.52
	torus.outer_radius = 0.59
	ring.mesh = torus
	ring.material_override = mat_duel_blood
	ring.position = Vector3(0.0, 0.06, 0.0)
	duel_corpse_root.add_child(ring)

	duel_blood_pool = MeshInstance3D.new()
	duel_blood_pool.name = "duel-blood-pool"
	var pool := CylinderMesh.new()
	pool.top_radius = 0.42
	pool.bottom_radius = 0.54
	pool.height = 0.035
	duel_blood_pool.mesh = pool
	duel_blood_pool.material_override = mat_duel_blood
	duel_blood_pool.position = Vector3(-0.08, 0.025, 0.08)
	duel_corpse_root.add_child(duel_blood_pool)


func _make_duel_bursts() -> void:
	for i in range(DUEL_SPARK_COUNT):
		var spark := _make_duel_sphere("duel-spark-%02d" % i, mat_duel_spark, randf_range(0.028, 0.055))
		duel_spark_nodes.append(spark)
		var spark_angle := randf() * TAU
		var spark_speed := randf_range(1.5, 4.2)
		duel_spark_velocities.append(Vector3(cos(spark_angle) * spark_speed, randf_range(0.4, 1.8), sin(spark_angle) * spark_speed))

	for i in range(DUEL_BLOOD_COUNT):
		var blood := _make_duel_sphere("duel-blood-%02d" % i, mat_duel_blood, randf_range(0.035, 0.085))
		duel_blood_nodes.append(blood)
		var blood_angle := randf() * TAU
		var blood_speed := randf_range(0.45, 2.2)
		duel_blood_velocities.append(Vector3(cos(blood_angle) * blood_speed, randf_range(0.15, 1.25), sin(blood_angle) * blood_speed))


func _make_camera() -> void:
	camera = Camera3D.new()
	camera.name = "director-orbit-camera"
	camera.fov = 49.0
	camera.near = 0.05
	camera.far = 160.0
	add_child(camera)
	var landing := _tile_to_world(_landing_tile(), 0.85)
	target_anchor = landing
	free_anchor = landing
	camera.make_current()


func _make_ui() -> void:
	var layer := CanvasLayer.new()
	layer.name = "overlay"
	add_child(layer)
	var panel := PanelContainer.new()
	panel.position = Vector2(14, 14)
	panel.custom_minimum_size = Vector2(310, 78)
	layer.add_child(panel)
	var box := VBoxContainer.new()
	panel.add_child(box)
	toggle_button = Button.new()
	toggle_button.text = "Follow"
	toggle_button.pressed.connect(_toggle_follow)
	box.add_child(toggle_button)
	status_label = Label.new()
	status_label.text = "Loading replay slice"
	box.add_child(status_label)


func _update_characters(sample: Dictionary, virtual_turn: float, loop_time: float, impact_time: float) -> void:
	var telefrag_victim_id := str(money_shot.get("victimId", highlighted_event.get("victimId", "")))
	var duel_victim_id := str(duel_event.get("victimId", ""))
	var duel_kill_time := _duel_kill_time()
	var seen_alive := {}
	for character in sample.get("characters", []):
		if typeof(character) != TYPE_DICTIONARY:
			continue
		var id := str(character.get("characterId", ""))
		var node: Node3D = character_nodes.get(id)
		if node == null:
			continue
		var alive := bool(character.get("alive", true))
		if id == duel_victim_id and loop_time < duel_kill_time + 0.08:
			alive = true
		if id == telefrag_victim_id:
			alive = loop_time < impact_time
		node.visible = alive
		if alive:
			seen_alive[id] = true
			node.position = _tile_to_world(character.get("pos", {"x": 0, "y": 0}), 0.35)
			if id == telefrag_victim_id and loop_time < impact_time:
				node.position = _telefrag_victim_world(character.get("pos", {"x": 0, "y": 0}), loop_time, impact_time, 0.35)
			node.rotation.y = sin(elapsed * 1.8 + float(id.hash() % 31)) * 0.18
			var bob := sin(elapsed * 4.0 + float(id.hash() % 17)) * 0.025
			node.position.y += bob
			_apply_duel_actor_pose(id, node, sample, loop_time)

	for id in character_nodes.keys():
		var node: Node3D = character_nodes[id]
		if not seen_alive.has(id) and id != telefrag_victim_id:
			node.visible = false


func _update_airdrop(loop_time: float, impact_time: float) -> void:
	var tile := _landing_tile()
	var landing := _tile_to_world(tile, 0.48)
	var warning: float = clamp(loop_time / max(0.1, impact_time), 0.0, 1.0)
	var fall_start: float = max(0.0, impact_time - 3.1)
	var fall_t: float = clamp((loop_time - fall_start) / max(0.1, impact_time - fall_start), 0.0, 1.0)
	fall_t = fall_t * fall_t * (3.0 - 2.0 * fall_t)
	var height: float = lerp(15.5, 0.48, fall_t)
	if loop_time >= impact_time:
		height = 0.48
	drop_root.position = _tile_to_world(tile, height)
	drop_root.rotation.y += get_process_delta_time() * (1.4 + warning * 3.6)
	telegraph_beam.position = _tile_to_world(tile, 7.0)
	telegraph_beam.visible = loop_time < impact_time
	telegraph_beam.scale = Vector3(1.0 + sin(elapsed * 8.0) * 0.08, 1.0, 1.0 + sin(elapsed * 8.0) * 0.08)
	landing_ring.position = landing
	landing_ring.scale = Vector3.ONE * (1.0 + sin(elapsed * 7.5) * 0.14 + warning * 0.42)
	landing_ring.visible = loop_time < impact_time + 2.4
	impact_light.position = _tile_to_world(tile, 1.3)

	var after: float = clamp((loop_time - impact_time) / 0.95, 0.0, 1.0)
	shockwave.position = _tile_to_world(tile, 0.12)
	shockwave.visible = after > 0.0 and after < 1.0
	shockwave.scale = Vector3.ONE * lerp(0.25, 5.5, after)
	impact_light.light_energy = 8.0 * max(0.0, 1.0 - after) if after > 0.0 else 0.0


func _update_mist(delta: float) -> void:
	if not mist_active:
		return
	mist_age += delta
	var life := 2.8
	var fade: float = clamp(1.0 - mist_age / life, 0.0, 1.0)
	for i in range(mist_nodes.size()):
		var mist := mist_nodes[i]
		mist.visible = fade > 0.02
		mist.position += mist_velocities[i] * delta
		mist.scale = Vector3.ONE * (0.75 + (1.0 - fade) * 3.2)
		if mist.material_override is StandardMaterial3D:
			var mat := mist.material_override as StandardMaterial3D
			mat.albedo_color.a = 0.42 * fade
			mat.emission_energy_multiplier = 1.2 + 2.4 * fade
	if mist_age >= life:
		mist_active = false
		for mist in mist_nodes:
			mist.visible = false


func _update_duel_vfx(sample: Dictionary, loop_time: float) -> void:
	if duel_event.is_empty() or duel_root == null:
		return
	var killer_id := str(duel_event.get("killerId", ""))
	var victim_id := str(duel_event.get("victimId", ""))
	if killer_id.is_empty() or victim_id.is_empty():
		return

	var killer_pos := _character_world(sample, killer_id, 0.9)
	var victim_pos := _character_world(sample, victim_id, 0.9)
	var corpse_pos := _duel_corpse_world(sample)
	var clash_time := _duel_event_time("duelFirstClash", _time_for_turn(float(duel_event.get("exchangeTurn", duel_event.get("startTurn", 3.0)))))
	var kill_time := _duel_kill_time()
	var corpse_time := _playback_event_time("duelCorpseReadable", kill_time + 0.2)
	var clash_phase := _time_pulse(loop_time, clash_time, 0.55)
	var kill_phase := _time_pulse(loop_time, kill_time, 0.75)
	var trace_phase: float = max(clash_phase, kill_phase)
	var lifted_killer := killer_pos + Vector3(0.0, 0.24 + 0.18 * kill_phase, 0.0)
	var lifted_victim := victim_pos + Vector3(0.0, 0.22, 0.0)
	var midpoint := (lifted_killer + lifted_victim) * 0.5
	var slash_side := _flat_perpendicular(lifted_victim - lifted_killer)

	_set_duel_trace(duel_trace_primary, lifted_killer + slash_side * (0.25 * trace_phase), lifted_victim - slash_side * 0.18, trace_phase)
	_set_duel_trace(duel_trace_counter, lifted_victim - slash_side * (0.2 * clash_phase), lifted_killer + slash_side * 0.16, clash_phase)

	duel_hit_flash.visible = clash_phase > 0.03
	duel_hit_flash.position = midpoint + Vector3(0.0, 0.12, 0.0)
	duel_hit_flash.scale = Vector3.ONE * (0.5 + clash_phase * 2.8)

	duel_kill_flash.visible = kill_phase > 0.03
	duel_kill_flash.position = lifted_victim + Vector3(0.0, 0.18, 0.0)
	duel_kill_flash.scale = Vector3.ONE * (0.55 + kill_phase * 3.4)
	duel_light.position = duel_kill_flash.position
	duel_light.light_energy = 7.5 * kill_phase

	var corpse_visible := loop_time >= corpse_time
	duel_corpse_root.visible = corpse_visible
	if corpse_visible:
		duel_corpse_root.position = corpse_pos
		duel_corpse_root.rotation.y = -0.42 + sin(elapsed * 0.7) * 0.02

	_update_duel_burst(duel_spark_nodes, duel_spark_velocities, midpoint + Vector3(0.0, 0.16, 0.0), loop_time - clash_time, 0.85, 1.25)
	if loop_time - kill_time >= 0.0 and loop_time - kill_time < 1.25:
		_update_duel_burst(duel_spark_nodes, duel_spark_velocities, lifted_victim + Vector3(0.0, 0.18, 0.0), loop_time - kill_time, 1.25, 1.45)
	_update_duel_burst(duel_blood_nodes, duel_blood_velocities, corpse_pos + Vector3(0.0, 0.28, 0.0), loop_time - kill_time, 2.2, 1.75)


func _set_duel_trace(trace: MeshInstance3D, start: Vector3, finish: Vector3, phase: float) -> void:
	if trace == null:
		return
	trace.visible = phase > 0.035
	if not trace.visible:
		return
	var direction := finish - start
	var length := direction.length()
	if length < 0.02:
		trace.visible = false
		return
	if trace.mesh is CylinderMesh:
		var beam := trace.mesh as CylinderMesh
		beam.height = length
	trace.position = start + direction * 0.5
	trace.basis = _basis_from_y(direction)
	trace.scale = Vector3(1.0 + phase * 0.7, 1.0, 1.0 + phase * 0.7)


func _update_duel_burst(nodes: Array, velocities: Array, origin: Vector3, age: float, life: float, gravity: float) -> void:
	var active := age >= 0.0 and age < life
	var fade: float = clamp(1.0 - age / max(0.01, life), 0.0, 1.0)
	for i in range(nodes.size()):
		var node: MeshInstance3D = nodes[i]
		node.visible = active
		if active:
			var velocity: Vector3 = velocities[i]
			var drift := velocity * age
			drift.y -= gravity * age * age
			node.position = origin + drift
			node.scale = Vector3.ONE * (0.75 + (1.0 - fade) * 1.8)


func _apply_duel_actor_pose(id: String, node: Node3D, sample: Dictionary, loop_time: float) -> void:
	if duel_event.is_empty():
		return
	var killer_id := str(duel_event.get("killerId", ""))
	var victim_id := str(duel_event.get("victimId", ""))
	if id != killer_id and id != victim_id:
		return
	var start_time := _duel_event_time("duelStarts", _time_for_turn(float(duel_event.get("startTurn", 2.0))))
	var kill_time := _duel_kill_time()
	if loop_time < start_time or loop_time > kill_time + 0.35:
		return
	var other_id := victim_id if id == killer_id else killer_id
	var other_pos := _character_world(sample, other_id, node.position.y)
	var flat_target := Vector3(other_pos.x, node.position.y, other_pos.z)
	var direction := flat_target - node.position
	if direction.length() > 0.03:
		node.look_at(flat_target, Vector3.UP)
		var clash_time := _duel_event_time("duelFirstClash", _time_for_turn(float(duel_event.get("exchangeTurn", 3.0))))
		var phase: float = max(_time_pulse(loop_time, clash_time, 0.45), _time_pulse(loop_time, kill_time, 0.55))
		var lunge := 0.28 if id == killer_id else 0.12
		node.position += direction.normalized() * lunge * phase
		node.position.y += 0.05 * phase


func _update_camera(delta: float, sample: Dictionary, loop_time: float, impact_time: float) -> void:
	if follow_locked and _apply_duel_killcam(delta, sample, loop_time):
		return
	camera.fov = lerp(camera.fov, 49.0, clamp(delta * 3.2, 0.0, 1.0))
	var victim_id := str(money_shot.get("victimId", highlighted_event.get("victimId", "")))
	var follow_pos := _tile_to_world(_landing_tile(), 0.95)
	for character in sample.get("characters", []):
		if typeof(character) == TYPE_DICTIONARY and str(character.get("characterId", "")) == victim_id and loop_time < impact_time:
			follow_pos = _telefrag_victim_world(character.get("pos", _landing_tile()), loop_time, impact_time, 0.95)
			break
	if loop_time >= impact_time:
		follow_pos = _tile_to_world(_landing_tile(), 0.95)
	target_anchor = target_anchor.lerp(follow_pos, clamp(delta * 4.5, 0.0, 1.0))
	var anchor: Vector3 = target_anchor if follow_locked else free_anchor
	var offset := Vector3(
		cos(pitch) * sin(yaw),
		-sin(pitch),
		cos(pitch) * cos(yaw)
	) * radius
	camera.position = anchor + offset
	camera.look_at(anchor, Vector3.UP)


func _apply_duel_killcam(delta: float, sample: Dictionary, loop_time: float) -> bool:
	if duel_event.is_empty():
		return false
	var kill_time := _duel_kill_time()
	var exit_time := _playback_event_time("survivorHeadsToDrop", kill_time + 3.0)
	if loop_time < kill_time - 1.15 or loop_time > exit_time - 0.1:
		return false
	var killer_id := str(duel_event.get("killerId", ""))
	var victim_id := str(duel_event.get("victimId", ""))
	if killer_id.is_empty() or victim_id.is_empty():
		return false

	var killer_pos := _character_world(sample, killer_id, 0.85)
	var victim_pos := _character_world(sample, victim_id, 0.85)
	if loop_time > kill_time + 0.18:
		victim_pos = _duel_corpse_world(sample) + Vector3(0.0, 0.65, 0.0)
	var anchor := (killer_pos + victim_pos) * 0.5 + Vector3(0.0, 0.36, 0.0)
	target_anchor = target_anchor.lerp(anchor, clamp(delta * 8.0, 0.0, 1.0))

	var line := victim_pos - killer_pos
	if line.length() < 0.01:
		line = Vector3.FORWARD
	var flat_line := Vector3(line.x, 0.0, line.z)
	if flat_line.length() < 0.001:
		flat_line = Vector3.FORWARD
	var forward := flat_line.normalized()
	var side := _flat_perpendicular(forward)
	var dolly: float = clamp((loop_time - (kill_time - 1.15)) / 2.6, 0.0, 1.0)
	dolly = dolly * dolly * (3.0 - 2.0 * dolly)
	var camera_target: Vector3 = target_anchor + Vector3(0.0, 0.22, 0.0)
	var camera_pos: Vector3 = target_anchor + side * lerp(5.8, 3.8, dolly) - forward * 1.1 + Vector3(0.0, lerp(2.25, 1.35, dolly), 0.0)
	var shake := _time_pulse(loop_time, kill_time, 0.38) * 0.09
	camera_pos += side * sin(elapsed * 39.0) * shake + Vector3.UP * cos(elapsed * 31.0) * shake
	camera.position = camera.position.lerp(camera_pos, clamp(delta * 6.5, 0.0, 1.0))
	camera.look_at(camera_target, Vector3.UP)
	camera.fov = lerp(camera.fov, 34.0, clamp(delta * 5.0, 0.0, 1.0))
	return true


func _update_status(loop_time: float, impact_time: float) -> void:
	if status_label == null:
		return
	var text := "Airdrop warning"
	if not duel_event.is_empty():
		var duel_start := _duel_event_time("duelStarts", _time_for_turn(float(duel_event.get("startTurn", 2.0))))
		var clash_time := _duel_event_time("duelFirstClash", _time_for_turn(float(duel_event.get("exchangeTurn", 3.0))))
		var kill_time := _duel_kill_time()
		var corpse_time := _playback_event_time("duelCorpseReadable", kill_time + 0.2)
		var walk_time := _playback_event_time("survivorHeadsToDrop", kill_time + 3.0)
		var killer_name := str(duel_event.get("killerDisplayName", character_names.get(str(duel_event.get("killerId", "")), "Sprinter")))
		var victim_name := str(duel_event.get("victimDisplayName", character_names.get(str(duel_event.get("victimId", "")), "Vulture")))
		if loop_time < duel_start:
			text = "%s and %s close distance" % [killer_name, victim_name]
		elif loop_time < clash_time + 0.7:
			text = "%s / %s brutal duel" % [killer_name, victim_name]
		elif loop_time < corpse_time + 1.4:
			text = "Kill-cam: %s drops %s" % [killer_name, victim_name]
		elif loop_time < walk_time:
			text = "%s corpse readable" % victim_name
		else:
			text = "%s heads to the drop" % killer_name
	if loop_time > impact_time - 2.6 and loop_time < impact_time:
		text = "Crate falling"
	elif loop_time >= impact_time and loop_time < impact_time + 2.2:
		text = "Telefrag: red mist"
	elif loop_time >= impact_time + 2.2:
		text = "No corpse, crate remains"
	status_label.text = text
	toggle_button.text = "Follow" if follow_locked else "Director"


func _trigger_mist(origin: Vector3) -> void:
	mist_active = true
	mist_age = 0.0
	for i in range(mist_nodes.size()):
		var mist := mist_nodes[i]
		mist.position = origin + Vector3(randf_range(-0.18, 0.18), randf_range(0.0, 0.45), randf_range(-0.18, 0.18))
		mist.scale = Vector3.ONE * randf_range(0.7, 1.2)
		mist.visible = true


func _reset_loop() -> void:
	mist_active = false
	mist_age = 0.0
	for mist in mist_nodes:
		mist.visible = false
	shockwave.visible = false
	impact_light.light_energy = 0.0
	if duel_trace_primary != null:
		duel_trace_primary.visible = false
	if duel_trace_counter != null:
		duel_trace_counter.visible = false
	if duel_hit_flash != null:
		duel_hit_flash.visible = false
	if duel_kill_flash != null:
		duel_kill_flash.visible = false
	if duel_light != null:
		duel_light.light_energy = 0.0
	if duel_corpse_root != null:
		duel_corpse_root.visible = false
	for spark in duel_spark_nodes:
		spark.visible = false
	for blood in duel_blood_nodes:
		blood.visible = false


func _toggle_follow() -> void:
	follow_locked = not follow_locked
	if not follow_locked:
		free_anchor = target_anchor
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.__telefragCameraMode = '%s';" % ("follow" if follow_locked else "director"), true)


func _sample_frame(virtual_turn: float) -> Dictionary:
	if frames.is_empty():
		return {}
	var previous: Dictionary = frames[0]
	var next: Dictionary = frames[frames.size() - 1]
	for frame in frames:
		if typeof(frame) != TYPE_DICTIONARY:
			continue
		var turn := float(frame.get("turn", 0))
		if turn <= virtual_turn:
			previous = frame
		if turn >= virtual_turn:
			next = frame
			break
	if previous == next:
		return previous
	return _interpolate_frames(previous, next, clamp(inverse_lerp(float(previous.get("turn", 0)), float(next.get("turn", 0)), virtual_turn), 0.0, 1.0))


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
		var alive_a := bool(char_a.get("alive", true))
		var alive_b := bool(char_b.get("alive", alive_a))
		merged["alive"] = alive_a if t < 0.985 else alive_b
		merged["pos"] = {
			"x": lerp(float(pos_a.get("x", 0)), float(pos_b.get("x", 0)), t),
			"y": lerp(float(pos_a.get("y", 0)), float(pos_b.get("y", 0)), t),
		}
		characters.append(merged)
	var out: Dictionary = a.duplicate(true)
	out["characters"] = characters
	return out


func _landing_tile() -> Dictionary:
	if highlighted_event.has("landingTile"):
		return highlighted_event.get("landingTile", {})
	var drop_id := str(money_shot.get("dropId", ""))
	for frame in frames:
		for drop in frame.get("airdrops", []):
			if typeof(drop) == TYPE_DICTIONARY and str(drop.get("id", "")) == drop_id:
				return drop.get("pos", {"x": 50, "y": 50})
	return {"x": 50, "y": 50}


func _character_world(sample: Dictionary, character_id: String, y: float = 0.35) -> Vector3:
	for character in sample.get("characters", []):
		if typeof(character) == TYPE_DICTIONARY and str(character.get("characterId", "")) == character_id:
			return _tile_to_world(character.get("pos", {"x": 0, "y": 0}), y)
	var node: Node3D = character_nodes.get(character_id)
	if node != null:
		return Vector3(node.position.x, y, node.position.z)
	return Vector3.ZERO


func _telefrag_victim_world(sample_pos: Dictionary, loop_time: float, impact_time: float, y: float) -> Vector3:
	var staging = highlighted_event.get("stagingTile", {})
	var landing = highlighted_event.get("landingTile", _landing_tile())
	if typeof(staging) != TYPE_DICTIONARY or typeof(landing) != TYPE_DICTIONARY:
		return _tile_to_world(sample_pos, y)
	var walk_time := _playback_event_time("survivorHeadsToDrop", _time_for_turn(5.0))
	var final_step_time := _playback_event_time("victimStartsFinalStep", max(0.0, impact_time - 0.9))
	if loop_time >= walk_time and loop_time < final_step_time:
		return _tile_to_world(staging, y)
	if loop_time >= final_step_time and loop_time < impact_time:
		var t: float = clamp((loop_time - final_step_time) / max(0.01, impact_time - final_step_time), 0.0, 1.0)
		t = t * t * (3.0 - 2.0 * t)
		return _tile_to_world({
			"x": lerp(float(staging.get("x", 0)), float(landing.get("x", 0)), t),
			"y": lerp(float(staging.get("y", 0)), float(landing.get("y", 0)), t),
		}, y)
	return _tile_to_world(sample_pos, y)


func _duel_corpse_world(sample: Dictionary) -> Vector3:
	var victim_id := str(duel_event.get("victimId", ""))
	var corpse_tile = duel_event.get("corpseTile", {})
	if typeof(corpse_tile) == TYPE_DICTIONARY:
		return _tile_to_world(corpse_tile, 0.08)
	for corpse in sample.get("corpses", []):
		if typeof(corpse) == TYPE_DICTIONARY and str(corpse.get("characterId", "")) == victim_id:
			return _tile_to_world(corpse.get("pos", {"x": 0, "y": 0}), 0.08)
	return _character_world(sample, victim_id, 0.08)


func _impact_time(loop_seconds: float, start_turn: int, end_turn: int) -> float:
	var events: Dictionary = playback.get("eventTimesSeconds", {})
	if events.has("airdropImpact"):
		return float(events.get("airdropImpact", 11.0))
	var land_turn := float(money_shot.get("landsAtTurn", highlighted_event.get("landTurn", 10)))
	return ((land_turn - float(start_turn)) / float(max(1, end_turn - start_turn))) * loop_seconds


func _duel_kill_time() -> float:
	if duel_event.is_empty():
		return -999.0
	var fallback_turn := float(duel_event.get("killTurn", duel_event.get("endTurn", 4.0)))
	return _duel_event_time("duelKillingBlow", _time_for_turn(fallback_turn))


func _duel_event_time(key: String, fallback: float) -> float:
	var times = duel_event.get("eventTimesSeconds", {})
	if typeof(times) == TYPE_DICTIONARY and times.has(key):
		return float(times.get(key, fallback))
	return _playback_event_time(key, fallback)


func _playback_event_time(key: String, fallback: float) -> float:
	var times = playback.get("eventTimesSeconds", {})
	if typeof(times) == TYPE_DICTIONARY and times.has(key):
		return float(times.get(key, fallback))
	return fallback


func _time_for_turn(turn: float) -> float:
	var loop_seconds := float(playback.get("sliceDurationSeconds", money_shot.get("loopSeconds", LOOP_DEFAULT_SECONDS)))
	var start_turn := float(playback.get("startTurn", money_shot.get("loopStartTurn", 7)))
	var end_turn := float(playback.get("endTurn", money_shot.get("loopEndTurn", 12)))
	return ((turn - start_turn) / float(max(1.0, end_turn - start_turn))) * loop_seconds


func _time_pulse(time: float, center: float, half_width: float) -> float:
	var pulse: float = clamp(1.0 - abs(time - center) / max(0.01, half_width), 0.0, 1.0)
	return pulse * pulse * (3.0 - 2.0 * pulse)


func _basis_from_y(direction: Vector3) -> Basis:
	var y_axis := direction.normalized()
	var x_axis := Vector3.UP.cross(y_axis)
	if x_axis.length() < 0.001:
		x_axis = Vector3.RIGHT
	x_axis = x_axis.normalized()
	var z_axis := x_axis.cross(y_axis).normalized()
	return Basis(x_axis, y_axis, z_axis)


func _flat_perpendicular(direction: Vector3) -> Vector3:
	var flat := Vector3(direction.x, 0.0, direction.z)
	if flat.length() < 0.001:
		return Vector3.RIGHT
	flat = flat.normalized()
	return Vector3(-flat.z, 0.0, flat.x)


func _tile_to_world(pos: Dictionary, y: float = 0.0) -> Vector3:
	var size: Dictionary = map_data.get("size", {"w": 100, "h": 100})
	var world_x := (float(pos.get("x", 0.0)) - float(size.get("w", 100)) * 0.5) * WORLD_SCALE
	var world_z := (float(pos.get("y", 0.0)) - float(size.get("h", 100)) * 0.5) * WORLD_SCALE
	return Vector3(world_x, y, world_z)


func _rect_center(rect: Dictionary, y: float = 0.78) -> Vector3:
	return _tile_to_world({
		"x": float(rect.get("x", 0)) + float(rect.get("w", 1)) * 0.5,
		"y": float(rect.get("y", 0)) + float(rect.get("h", 1)) * 0.5,
	}, y)


func _make_box(label: String, pos: Vector3, scale: Vector3, material: Material) -> MeshInstance3D:
	var node := MeshInstance3D.new()
	node.name = label
	var mesh := BoxMesh.new()
	mesh.size = Vector3.ONE
	node.mesh = mesh
	node.position = pos
	node.scale = scale
	node.material_override = material
	add_child(node)
	return node


func _instantiate_scene(scene: PackedScene, fallback_name: String) -> Node3D:
	if scene != null:
		var node = scene.instantiate()
		if node is Node3D:
			node.name = fallback_name
			return node
	var fallback := MeshInstance3D.new()
	fallback.name = fallback_name
	var mesh := CapsuleMesh.new()
	mesh.radius = 0.24
	mesh.height = 1.0
	fallback.mesh = mesh
	fallback.material_override = mat_gold
	return fallback


func _add_agent_accent(root: Node3D, color: Color) -> void:
	var light := OmniLight3D.new()
	light.name = "agent-neon-accent"
	light.light_color = color
	light.light_energy = 0.65
	light.omni_range = 3.2
	light.position = Vector3(0, 1.0, 0)
	root.add_child(light)
	var halo := MeshInstance3D.new()
	halo.name = "agent-halo"
	var torus := TorusMesh.new()
	torus.inner_radius = 0.36
	torus.outer_radius = 0.39
	halo.mesh = torus
	halo.material_override = _emissive_material("agent-halo", color, 1.6, true)
	halo.position = Vector3(0, 0.08, 0)
	root.add_child(halo)


func _make_world_environment() -> void:
	var world := WorldEnvironment.new()
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.006, 0.008, 0.012)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.045, 0.075, 0.09)
	env.ambient_light_energy = 0.75
	env.fog_enabled = true
	env.fog_density = 0.025
	env.fog_light_color = Color(0.02, 0.06, 0.075)
	env.glow_enabled = true
	env.glow_intensity = 0.55
	env.glow_bloom = 0.18
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_exposure = 1.05
	world.environment = env
	add_child(world)


func _make_lighting() -> void:
	var moon := DirectionalLight3D.new()
	moon.name = "cold-key-light"
	moon.light_color = Color(0.55, 0.82, 1.0)
	moon.light_energy = 2.1
	moon.rotation_degrees = Vector3(-48, -36, 0)
	add_child(moon)

	var cyan := OmniLight3D.new()
	cyan.name = "cyan-rim"
	cyan.light_color = Color(0.0, 0.85, 1.0)
	cyan.light_energy = 4.8
	cyan.omni_range = 24
	cyan.position = Vector3(-9, 7, -11)
	add_child(cyan)

	var infernal := OmniLight3D.new()
	infernal.name = "red-rim"
	infernal.light_color = Color(1.0, 0.08, 0.02)
	infernal.light_energy = 3.8
	infernal.omni_range = 22
	infernal.position = Vector3(9, 5, 9)
	add_child(infernal)


func _make_materials() -> void:
	mat_ground = _material("obsidian-ground", Color(0.018, 0.020, 0.026), Color(0.00, 0.18, 0.22), 0.2)
	mat_wall = _material("black-steel-wall", Color(0.035, 0.038, 0.052), Color(0.0, 0.42, 0.56), 0.65)
	mat_cover = _material("violet-cover", Color(0.065, 0.038, 0.072), Color(0.58, 0.08, 0.95), 0.7)
	mat_cyan = _emissive_material("cyan-beam", Color(0.0, 0.9, 1.0), 2.8, true)
	mat_red = _emissive_material("warning-red", Color(1.0, 0.04, 0.02), 2.6, true)
	mat_crimson = _emissive_material("red-mist", Color(1.0, 0.02, 0.04, 0.42), 2.5, true)
	mat_gold = _emissive_material("gold-fallback", Color(1.0, 0.56, 0.12), 0.6, false)
	mat_shock = _emissive_material("shockwave", Color(1.0, 0.04, 0.02, 0.36), 3.2, true)
	mat_duel_trace = _emissive_material("duel-hot-slash", Color(1.0, 0.84, 0.18, 0.78), 4.2, true)
	mat_duel_counter = _emissive_material("duel-counter-slash", Color(0.0, 0.92, 1.0, 0.56), 3.4, true)
	mat_duel_flash = _emissive_material("duel-hit-flash", Color(1.0, 0.24, 0.06, 0.58), 5.5, true)
	mat_duel_spark = _emissive_material("duel-sparks", Color(1.0, 0.68, 0.12, 0.72), 4.0, true)
	mat_duel_blood = _emissive_material("duel-blood", Color(0.82, 0.0, 0.04, 0.48), 1.8, true)
	mat_duel_corpse = _material("duel-corpse", Color(0.16, 0.04, 0.06), Color(0.7, 0.0, 0.08), 0.45)


func _material(name: String, albedo: Color, emission: Color, emission_energy: float) -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	mat.resource_name = name
	mat.albedo_color = albedo
	mat.roughness = 0.68
	mat.metallic = 0.35
	mat.emission_enabled = true
	mat.emission = emission
	mat.emission_energy_multiplier = emission_energy
	return mat


func _emissive_material(name: String, color: Color, energy: float, transparent: bool) -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	mat.resource_name = name
	mat.albedo_color = color
	mat.emission_enabled = true
	mat.emission = Color(color.r, color.g, color.b)
	mat.emission_energy_multiplier = energy
	if transparent:
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
		mat.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	return mat


func _signal_boot_state(state: String) -> void:
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.__telefragBootState = '%s';" % state, true)


func _signal_first_frame_once() -> void:
	if OS.has_feature("web"):
		JavaScriptBridge.eval("""
if (!window.__telefragReady) {
  window.__telefragReady = true;
  window.__prototypeReady = true;
  window.__telefragReadyAt = performance.now();
  document.documentElement.dataset.ready = 'true';
}
""", true)
