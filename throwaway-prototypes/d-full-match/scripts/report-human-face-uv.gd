extends SceneTree

const SOURCE_BODY := "res://shared-harness/art-kit/characters/camper-mesh2motion-human-base.glb"


func _init() -> void:
	var scene := load(SOURCE_BODY) as PackedScene
	if scene == null:
		push_error("missing source body: %s" % SOURCE_BODY)
		quit(1)
		return
	var root := scene.instantiate()
	var samples: Array[Dictionary] = []
	_collect_mesh_samples(root, Transform3D.IDENTITY, samples)
	root.queue_free()
	if samples.is_empty():
		push_error("no mesh UV samples found")
		quit(1)
		return
	_report(samples)
	quit(0)


func _collect_mesh_samples(node: Node, parent_transform: Transform3D, samples: Array[Dictionary]) -> void:
	var node3d := node as Node3D
	var transform := parent_transform
	if node3d != null:
		transform = parent_transform * node3d.transform
	if node is MeshInstance3D:
		_collect_mesh_instance(node as MeshInstance3D, transform, samples)
	for child in node.get_children():
		_collect_mesh_samples(child, transform, samples)


func _collect_mesh_instance(mesh_instance: MeshInstance3D, transform: Transform3D, samples: Array[Dictionary]) -> void:
	var mesh := mesh_instance.mesh
	if mesh == null:
		return
	var local_min := Vector3(INF, INF, INF)
	var local_max := Vector3(-INF, -INF, -INF)
	var local_count := 0
	for surface in range(mesh.get_surface_count()):
		var arrays := mesh.surface_get_arrays(surface)
		if arrays.is_empty():
			continue
		var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var uv: PackedVector2Array = arrays[Mesh.ARRAY_TEX_UV]
		var uv2: PackedVector2Array = arrays[Mesh.ARRAY_TEX_UV2]
		for i in range(vertices.size()):
			local_min = local_min.min(vertices[i])
			local_max = local_max.max(vertices[i])
			local_count += 1
			var p := transform * vertices[i]
			var u := uv[i] if i < uv.size() else Vector2.ZERO
			var u2 := uv2[i] if i < uv2.size() else Vector2.ZERO
			samples.append({"p": p, "uv": u, "uv2": u2})
	if local_count > 0:
		print("mesh=%s local_bounds=%s..%s transform_origin=%s" % [mesh_instance.name, local_min, local_max, transform.origin])


func _report(samples: Array[Dictionary]) -> void:
	var min_p := Vector3(INF, INF, INF)
	var max_p := Vector3(-INF, -INF, -INF)
	for sample in samples:
		var p: Vector3 = sample["p"]
		min_p = min_p.min(p)
		max_p = max_p.max(p)
	print("samples=%d bounds min=%s max=%s size=%s" % [samples.size(), min_p, max_p, max_p - min_p])
	var height := max_p.y - min_p.y
	var head_min_y := max_p.y - height * 0.235
	var head_max_y := max_p.y
	var face_min_z := lerpf(min_p.z, max_p.z, 0.62)
	_print_region("all", samples, min_p, max_p, Callable())
	_print_region("head_all_top_23pct", samples, min_p, max_p, func(p: Vector3) -> bool:
		return p.y >= head_min_y and p.y <= head_max_y
	)
	_print_region("face_front_top_23pct", samples, min_p, max_p, func(p: Vector3) -> bool:
		return p.y >= head_min_y and p.y <= head_max_y and p.z >= face_min_z
	)
	_print_region("eye_band_estimate", samples, min_p, max_p, func(p: Vector3) -> bool:
		var ny := inverse_lerp(min_p.y, max_p.y, p.y)
		var nx := inverse_lerp(min_p.x, max_p.x, p.x)
		return p.z >= face_min_z and ny >= 0.885 and ny <= 0.945 and ((nx >= 0.365 and nx <= 0.485) or (nx >= 0.515 and nx <= 0.635))
	)
	_print_region("mouth_band_estimate", samples, min_p, max_p, func(p: Vector3) -> bool:
		var ny := inverse_lerp(min_p.y, max_p.y, p.y)
		var nx := inverse_lerp(min_p.x, max_p.x, p.x)
		return p.z >= face_min_z and ny >= 0.825 and ny <= 0.875 and nx >= 0.405 and nx <= 0.595
	)


func _print_region(label: String, samples: Array[Dictionary], min_p: Vector3, max_p: Vector3, filter: Callable) -> void:
	var count := 0
	var min_uv := Vector2(INF, INF)
	var max_uv := Vector2(-INF, -INF)
	var sum_uv := Vector2.ZERO
	var min_uv2 := Vector2(INF, INF)
	var max_uv2 := Vector2(-INF, -INF)
	var sum_uv2 := Vector2.ZERO
	var min_pos := Vector3(INF, INF, INF)
	var max_pos := Vector3(-INF, -INF, -INF)
	for sample in samples:
		var p: Vector3 = sample["p"]
		if filter.is_valid() and not bool(filter.call(p)):
			continue
		var uv: Vector2 = sample["uv"]
		var uv2: Vector2 = sample["uv2"]
		count += 1
		min_pos = min_pos.min(p)
		max_pos = max_pos.max(p)
		min_uv = min_uv.min(uv)
		max_uv = max_uv.max(uv)
		sum_uv += uv
		min_uv2 = min_uv2.min(uv2)
		max_uv2 = max_uv2.max(uv2)
		sum_uv2 += uv2
	if count <= 0:
		print("%s count=0" % label)
		return
	print("%s count=%d pos=%s..%s UV=%s..%s avg=%s UV2=%s..%s avg=%s" % [
		label,
		count,
		min_pos,
		max_pos,
		min_uv,
		max_uv,
		sum_uv / float(count),
		min_uv2,
		max_uv2,
		sum_uv2 / float(count),
	])
