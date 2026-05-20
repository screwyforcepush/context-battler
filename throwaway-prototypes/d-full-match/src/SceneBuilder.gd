extends Node3D

const WORLD_SCALE := 0.38

var map_data: Dictionary = {}
var mat_ground: StandardMaterial3D
var mat_wall: StandardMaterial3D
var mat_cover: StandardMaterial3D
var mat_evac: StandardMaterial3D
var mat_crate: StandardMaterial3D
var mat_airdrop: StandardMaterial3D


func _ready() -> void:
	_make_materials()
	_make_world_environment()
	_make_lighting()


func build_from_snapshot(snapshot: Dictionary) -> void:
	for child in get_children():
		child.queue_free()
	map_data = snapshot.get("map", {})
	_make_floor()
	_build_rects(map_data.get("walls", []), 1.15, mat_wall, "wall")
	_build_rects(map_data.get("coverClusters", []), 0.42, mat_cover, "cover")
	_build_evac(map_data.get("evac", {}))
	_build_static_crates(map_data.get("staticCrates", []))
	_build_airdrops(map_data.get("airdrops", []))


func tile_to_world(pos: Dictionary, y: float = 0.0) -> Vector3:
	var size: Dictionary = map_data.get("size", {"w": 100, "h": 100})
	var world_x := (float(pos.get("x", 0.0)) - float(size.get("w", 100)) * 0.5) * WORLD_SCALE
	var world_z := (float(pos.get("y", 0.0)) - float(size.get("h", 100)) * 0.5) * WORLD_SCALE
	return Vector3(world_x, y, world_z)


func _make_floor() -> void:
	var size: Dictionary = map_data.get("size", {"w": 100, "h": 100})
	var mesh := BoxMesh.new()
	mesh.size = Vector3(float(size.get("w", 100)) * WORLD_SCALE, 0.08, float(size.get("h", 100)) * WORLD_SCALE)
	var node := MeshInstance3D.new()
	node.name = "floor"
	node.mesh = mesh
	node.material_override = mat_ground
	node.position = Vector3(0.0, -0.05, 0.0)
	add_child(node)


func _build_rects(rects: Array, height: float, material: Material, prefix: String) -> void:
	for i in range(rects.size()):
		var rect = rects[i]
		if typeof(rect) != TYPE_DICTIONARY:
			continue
		var center := tile_to_world({
			"x": float(rect.get("x", 0)) + float(rect.get("w", 1)) * 0.5,
			"y": float(rect.get("y", 0)) + float(rect.get("h", 1)) * 0.5,
		}, height * 0.5)
		var scale := Vector3(
			max(0.12, float(rect.get("w", 1)) * WORLD_SCALE),
			height,
			max(0.12, float(rect.get("h", 1)) * WORLD_SCALE)
		)
		add_child(_make_box("%s-%03d" % [prefix, i], center, scale, material))


func _build_evac(evac: Dictionary) -> void:
	var zone: Dictionary = evac.get("zone", {})
	if zone.is_empty():
		var centre: Dictionary = evac.get("centre", {"x": 50, "y": 50})
		zone = {"x": float(centre.get("x", 50)) - 1.0, "y": float(centre.get("y", 50)) - 1.0, "w": 3.0, "h": 3.0}
	var center := tile_to_world({
		"x": float(zone.get("x", 0)) + float(zone.get("w", 3)) * 0.5,
		"y": float(zone.get("y", 0)) + float(zone.get("h", 3)) * 0.5,
	}, 0.04)
	var scale := Vector3(float(zone.get("w", 3)) * WORLD_SCALE, 0.04, float(zone.get("h", 3)) * WORLD_SCALE)
	add_child(_make_box("evac-zone", center, scale, mat_evac))


func _build_static_crates(crates: Array) -> void:
	for i in range(crates.size()):
		var crate = crates[i]
		if typeof(crate) != TYPE_DICTIONARY:
			continue
		add_child(_make_box("static-crate-%03d" % i, tile_to_world(crate.get("pos", {}), 0.23), Vector3(0.34, 0.46, 0.34), mat_crate))


func _build_airdrops(airdrops: Array) -> void:
	for i in range(airdrops.size()):
		var drop = airdrops[i]
		if typeof(drop) != TYPE_DICTIONARY:
			continue
		var marker := _make_box("airdrop-marker-%03d" % i, tile_to_world(drop.get("pos", {}), 0.08), Vector3(0.46, 0.08, 0.46), mat_airdrop)
		marker.visible = false
		add_child(marker)


func _make_box(label: String, pos: Vector3, size: Vector3, material: Material) -> MeshInstance3D:
	var node := MeshInstance3D.new()
	node.name = label
	var mesh := BoxMesh.new()
	mesh.size = size
	node.mesh = mesh
	node.material_override = material
	node.position = pos
	return node


func _make_world_environment() -> void:
	var environment := WorldEnvironment.new()
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.006, 0.008, 0.012)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.09, 0.14, 0.18)
	env.ambient_light_energy = 0.42
	env.glow_enabled = true
	env.glow_intensity = 0.82
	env.glow_bloom = 0.24
	environment.environment = env
	add_child(environment)


func _make_lighting() -> void:
	var sun := DirectionalLight3D.new()
	sun.name = "neon-key-light"
	sun.light_color = Color(0.55, 0.92, 1.0)
	sun.light_energy = 1.8
	sun.rotation_degrees = Vector3(-62, -30, 0)
	add_child(sun)
	var red := OmniLight3D.new()
	red.name = "crimson-rim-light"
	red.light_color = Color(1.0, 0.10, 0.18)
	red.light_energy = 2.8
	red.omni_range = 28.0
	red.position = Vector3(-12, 8, -10)
	add_child(red)


func _make_materials() -> void:
	mat_ground = _mat(Color(0.015, 0.021, 0.030), Color(0.0, 0.10, 0.16), 0.35)
	mat_wall = _mat(Color(0.06, 0.09, 0.13), Color(0.0, 0.55, 0.78), 0.55)
	mat_cover = _mat(Color(0.09, 0.12, 0.16), Color(1.0, 0.42, 0.10), 0.32)
	mat_evac = _mat(Color(0.06, 0.28, 0.22, 0.65), Color(0.0, 1.0, 0.72), 0.8)
	mat_crate = _mat(Color(0.72, 0.46, 0.13), Color(1.0, 0.58, 0.08), 0.5)
	mat_airdrop = _mat(Color(0.16, 0.04, 0.07), Color(1.0, 0.05, 0.18), 0.9)


func _mat(albedo: Color, emission: Color, energy: float) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = albedo
	material.emission_enabled = true
	material.emission = emission
	material.emission_energy_multiplier = energy
	material.roughness = 0.44
	return material
