extends SceneTree

const MANIFEST_PATH := "res://shared-harness/art-kit/manifest.json"
const ART_ROOT := "res://shared-harness/art-kit/"


func _init() -> void:
	_run.call_deferred()


func _run() -> void:
	var file := FileAccess.open(MANIFEST_PATH, FileAccess.READ)
	if file == null:
		push_error("inspect-weapon-bounds cannot open manifest")
		quit(1)
		return
	var parsed = JSON.parse_string(file.get_as_text())
	if typeof(parsed) != TYPE_DICTIONARY:
		push_error("inspect-weapon-bounds manifest is not an object")
		quit(1)
		return
	var assets = (parsed as Dictionary).get("assets", [])
	if typeof(assets) != TYPE_ARRAY:
		push_error("inspect-weapon-bounds manifest assets is not an array")
		quit(1)
		return
	for asset_value in assets:
		if typeof(asset_value) != TYPE_DICTIONARY:
			continue
		var asset := asset_value as Dictionary
		if str(asset.get("category", "")) != "weapon":
			continue
		_print_weapon_bounds(asset)
	quit(0)


func _print_weapon_bounds(asset: Dictionary) -> void:
	var weapon_name := str(asset.get("weaponName", asset.get("id", "")))
	var file_path := str(asset.get("file", ""))
	if weapon_name.is_empty() or file_path.is_empty():
		return
	var scene = load("%s%s" % [ART_ROOT, file_path])
	if not (scene is PackedScene):
		print("%s LOAD_FAIL %s" % [weapon_name, file_path])
		return
	var root = (scene as PackedScene).instantiate()
	if not (root is Node3D):
		print("%s NOT_NODE3D %s" % [weapon_name, file_path])
		if root != null:
			root.queue_free()
		return
	var node := root as Node3D
	get_root().add_child(node)
	var aabb := _local_aabb(node)
	var min_v := aabb.position
	var max_v := aabb.position + aabb.size
	print(
		"%s|%s|min=(%.5f,%.5f,%.5f)|max=(%.5f,%.5f,%.5f)|size=(%.5f,%.5f,%.5f)|center=(%.5f,%.5f,%.5f)"
		% [
			weapon_name,
			file_path,
			min_v.x,
			min_v.y,
			min_v.z,
			max_v.x,
			max_v.y,
			max_v.z,
			aabb.size.x,
			aabb.size.y,
			aabb.size.z,
			aabb.get_center().x,
			aabb.get_center().y,
			aabb.get_center().z,
		]
	)
	_print_axis_sections(weapon_name, _local_vertices(node), aabb)
	node.queue_free()


func _local_aabb(root: Node3D) -> AABB:
	var found := false
	var out := AABB()
	var inverse := root.global_transform.affine_inverse()
	for child in _collect_nodes(root):
		if not (child is MeshInstance3D):
			continue
		var mesh_instance := child as MeshInstance3D
		if mesh_instance.mesh == null:
			continue
		var local_aabb := mesh_instance.mesh.get_aabb()
		var transform := inverse * mesh_instance.global_transform
		var corners: Array[Vector3] = [
			local_aabb.position,
			local_aabb.position + Vector3(local_aabb.size.x, 0.0, 0.0),
			local_aabb.position + Vector3(0.0, local_aabb.size.y, 0.0),
			local_aabb.position + Vector3(0.0, 0.0, local_aabb.size.z),
			local_aabb.position + Vector3(local_aabb.size.x, local_aabb.size.y, 0.0),
			local_aabb.position + Vector3(local_aabb.size.x, 0.0, local_aabb.size.z),
			local_aabb.position + Vector3(0.0, local_aabb.size.y, local_aabb.size.z),
			local_aabb.position + local_aabb.size,
		]
		for corner in corners:
			var point: Vector3 = transform * corner
			if not found:
				out = AABB(point, Vector3.ZERO)
				found = true
			else:
				out = out.expand(point)
	return out


func _collect_nodes(node: Node) -> Array[Node]:
	var nodes: Array[Node] = [node]
	for child in node.get_children():
		nodes.append_array(_collect_nodes(child))
	return nodes


func _local_vertices(root: Node3D) -> Array[Vector3]:
	var out: Array[Vector3] = []
	var inverse := root.global_transform.affine_inverse()
	for child in _collect_nodes(root):
		if not (child is MeshInstance3D):
			continue
		var mesh_instance := child as MeshInstance3D
		if mesh_instance.mesh == null:
			continue
		var transform := inverse * mesh_instance.global_transform
		for surface_index in range(mesh_instance.mesh.get_surface_count()):
			var arrays := mesh_instance.mesh.surface_get_arrays(surface_index)
			if arrays.is_empty():
				continue
			var vertices = arrays[Mesh.ARRAY_VERTEX]
			if typeof(vertices) != TYPE_PACKED_VECTOR3_ARRAY:
				continue
			for vertex in vertices:
				out.append(transform * vertex)
	return out


func _axis_value(point: Vector3, axis: int) -> float:
	match axis:
		0:
			return point.x
		1:
			return point.y
		_:
			return point.z


func _dominant_axis(size: Vector3) -> int:
	if size.x >= size.y and size.x >= size.z:
		return 0
	if size.y >= size.x and size.y >= size.z:
		return 1
	return 2


func _print_axis_sections(weapon_name: String, vertices: Array[Vector3], aabb: AABB) -> void:
	if vertices.is_empty():
		return
	var axis := _dominant_axis(aabb.size)
	var axis_name := str(["x", "y", "z"][axis])
	var min_axis := _axis_value(aabb.position, axis)
	var max_axis := _axis_value(aabb.position + aabb.size, axis)
	var span := max_axis - min_axis
	if span <= 0.0001:
		return
	var bin_count := 12
	var bins: Array[Dictionary] = []
	for i in range(bin_count):
		bins.append({
			"count": 0,
			"min": Vector3(INF, INF, INF),
			"max": Vector3(-INF, -INF, -INF),
		})
	for point in vertices:
		var t := clampf((_axis_value(point, axis) - min_axis) / span, 0.0, 0.9999)
		var index := int(floor(t * float(bin_count)))
		var bin := bins[index]
		bin["count"] = int(bin.get("count", 0)) + 1
		var bin_min := bin.get("min", Vector3.ZERO) as Vector3
		var bin_max := bin.get("max", Vector3.ZERO) as Vector3
		bin_min.x = minf(bin_min.x, point.x)
		bin_min.y = minf(bin_min.y, point.y)
		bin_min.z = minf(bin_min.z, point.z)
		bin_max.x = maxf(bin_max.x, point.x)
		bin_max.y = maxf(bin_max.y, point.y)
		bin_max.z = maxf(bin_max.z, point.z)
		bin["min"] = bin_min
		bin["max"] = bin_max
	for i in range(bin_count):
		var bin := bins[i]
		var count := int(bin.get("count", 0))
		if count == 0:
			continue
		var bin_min := bin.get("min", Vector3.ZERO) as Vector3
		var bin_max := bin.get("max", Vector3.ZERO) as Vector3
		var center := min_axis + span * ((float(i) + 0.5) / float(bin_count))
		var lateral := bin_max - bin_min
		var widths := [lateral.x, lateral.y, lateral.z]
		widths[axis] = 0.0
		print(
			"%s|axis=%s|bin=%02d|center=%.5f|count=%d|lateral=(%.5f,%.5f,%.5f)"
			% [weapon_name, axis_name, i, center, count, widths[0], widths[1], widths[2]]
		)
