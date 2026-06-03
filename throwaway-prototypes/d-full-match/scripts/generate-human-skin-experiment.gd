extends SceneTree

const SOURCE_BODY := "res://shared-harness/art-kit/characters/camper-mesh2motion-human-base.glb"
const ALBEDO_OUT := "res://shared-harness/art-kit/textures/skin/human-face-body-albedo.png"
const EMISSION_OUT := "res://shared-harness/art-kit/textures/skin/human-face-body-emission.png"
const TEXTURE_SIZE := 1024


func _init() -> void:
	var albedo := Image.create_empty(TEXTURE_SIZE, TEXTURE_SIZE, false, Image.FORMAT_RGBA8)
	var emission := Image.create_empty(TEXTURE_SIZE, TEXTURE_SIZE, false, Image.FORMAT_RGBA8)
	albedo.fill(Color(0.0, 0.0, 0.0, 0.0))
	emission.fill(Color(0.0, 0.0, 0.0, 0.0))
	_paint_simple_face_locator(albedo)
	var albedo_error := albedo.save_png(ALBEDO_OUT)
	var emission_error := emission.save_png(EMISSION_OUT)
	if albedo_error != OK or emission_error != OK:
		push_error("failed to save human skin experiment pngs: albedo=%s emission=%s" % [error_string(albedo_error), error_string(emission_error)])
		quit(1)
		return
	print("generated %s and %s" % [ALBEDO_OUT, EMISSION_OUT])
	quit(0)


func _paint_simple_face_locator(albedo: Image) -> void:
	# Diagnostic primary-UV face island found by scripts/report-human-face-uv.gd:
	# face front UV ~= x 0.56..0.84, y 0.26..0.53. Draw oversized marks first.
	_fill_uv_rect(albedo, Rect2(0.545, 0.245, 0.325, 0.325), Color(0.835, 0.560, 0.415, 0.96))
	_fill_uv_rect(albedo, Rect2(0.595, 0.330, 0.105, 0.050), Color(0.965, 0.900, 0.810, 1.0))
	_fill_uv_rect(albedo, Rect2(0.735, 0.330, 0.105, 0.050), Color(0.965, 0.900, 0.810, 1.0))
	_stamp_uv(albedo, Vector2(0.648, 0.356), 16, Color(0.045, 0.025, 0.018, 1.0))
	_stamp_uv(albedo, Vector2(0.788, 0.356), 16, Color(0.045, 0.025, 0.018, 1.0))
	_draw_uv_line(albedo, Vector2(0.713, 0.382), Vector2(0.700, 0.452), 8, Color(0.690, 0.340, 0.245, 0.86))
	_draw_uv_line(albedo, Vector2(0.615, 0.490), Vector2(0.820, 0.494), 13, Color(0.225, 0.070, 0.072, 1.0))
	_draw_uv_line(albedo, Vector2(0.640, 0.478), Vector2(0.795, 0.478), 5, Color(0.650, 0.225, 0.210, 0.95))
	_stamp_uv(albedo, Vector2(0.604, 0.414), 18, Color(0.890, 0.405, 0.345, 0.28))
	_stamp_uv(albedo, Vector2(0.834, 0.414), 18, Color(0.890, 0.405, 0.345, 0.28))


func _paint_soft_uv_backdrop(albedo: Image) -> void:
	_fill_uv_rect(albedo, Rect2(0.000, 0.000, 1.000, 1.000), Color(0.735, 0.455, 0.330, 0.18))
	_fill_uv_rect(albedo, Rect2(0.520, 0.245, 0.480, 0.405), Color(0.760, 0.485, 0.355, 0.58))
	for i in range(120):
		var u: float = 0.535 + fmod(float(i) * 0.071, 0.445)
		var v: float = 0.255 + fmod(float(i) * 0.047, 0.375)
		var freckle := _skin_color(0.55 + fmod(float(i) * 0.037, 0.35), -0.10)
		_stamp_uv(albedo, Vector2(u, v), 1 + i % 2, Color(freckle.r, freckle.g, freckle.b, 0.18))


func _paint_guided_mesh_skin(albedo: Image) -> void:
	var scene := load(SOURCE_BODY) as PackedScene
	if scene == null:
		push_error("missing source body: %s" % SOURCE_BODY)
		return
	var root := scene.instantiate()
	_paint_mesh_node(root, albedo)
	root.queue_free()


func _paint_mesh_node(node: Node, albedo: Image) -> void:
	if node is MeshInstance3D:
		_paint_mesh(node as MeshInstance3D, albedo)
	for child in node.get_children():
		_paint_mesh_node(child, albedo)


func _paint_mesh(mesh_instance: MeshInstance3D, albedo: Image) -> void:
	var mesh := mesh_instance.mesh
	if mesh == null:
		return
	for surface in range(mesh.get_surface_count()):
		var arrays := mesh.surface_get_arrays(surface)
		if arrays.is_empty():
			continue
		var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var uvs: PackedVector2Array = arrays[Mesh.ARRAY_TEX_UV]
		var indices: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
		_paint_surface_triangles(vertices, uvs, indices, albedo)
		for i in range(min(vertices.size(), uvs.size())):
			var vertex := vertices[i]
			var uv := uvs[i]
			if uv.x <= 0.0 and uv.y <= 0.0:
				continue
			_paint_vertex_skin(vertex, uv, albedo)


func _paint_surface_triangles(vertices: PackedVector3Array, uvs: PackedVector2Array, indices: PackedInt32Array, albedo: Image) -> void:
	if vertices.is_empty() or uvs.is_empty():
		return
	if indices.is_empty():
		for i in range(0, min(vertices.size(), uvs.size()) - 2, 3):
			_raster_skin_triangle(vertices[i], vertices[i + 1], vertices[i + 2], uvs[i], uvs[i + 1], uvs[i + 2], albedo)
		return
	for i in range(0, indices.size() - 2, 3):
		var ia := int(indices[i])
		var ib := int(indices[i + 1])
		var ic := int(indices[i + 2])
		if ia < 0 or ib < 0 or ic < 0:
			continue
		if ia >= vertices.size() or ib >= vertices.size() or ic >= vertices.size():
			continue
		if ia >= uvs.size() or ib >= uvs.size() or ic >= uvs.size():
			continue
		_raster_skin_triangle(vertices[ia], vertices[ib], vertices[ic], uvs[ia], uvs[ib], uvs[ic], albedo)


func _raster_skin_triangle(v0: Vector3, v1: Vector3, v2: Vector3, uv0: Vector2, uv1: Vector2, uv2: Vector2, albedo: Image) -> void:
	var p0 := _uv_to_pixel(uv0)
	var p1 := _uv_to_pixel(uv1)
	var p2 := _uv_to_pixel(uv2)
	var area := _edge(p0, p1, p2)
	if absf(area) < 0.001:
		return
	var min_x: int = clampi(floori(min(p0.x, min(p1.x, p2.x))) - 2, 0, TEXTURE_SIZE - 1)
	var max_x: int = clampi(ceili(max(p0.x, max(p1.x, p2.x))) + 2, 0, TEXTURE_SIZE - 1)
	var min_y: int = clampi(floori(min(p0.y, min(p1.y, p2.y))) - 2, 0, TEXTURE_SIZE - 1)
	var max_y: int = clampi(ceili(max(p0.y, max(p1.y, p2.y))) + 2, 0, TEXTURE_SIZE - 1)
	if max_x < min_x or max_y < min_y:
		return
	for y in range(min_y, max_y + 1):
		for x in range(min_x, max_x + 1):
			var p := Vector2(float(x) + 0.5, float(y) + 0.5)
			var w0 := _edge(p1, p2, p) / area
			var w1 := _edge(p2, p0, p) / area
			var w2 := _edge(p0, p1, p) / area
			if w0 < -0.004 or w1 < -0.004 or w2 < -0.004:
				continue
			var vertex := v0 * w0 + v1 * w1 + v2 * w2
			var color := _skin_surface_color(vertex)
			_blend_pixel(albedo, x, y, color)
			_paint_surface_detail(albedo, x, y, vertex)


func _skin_surface_color(vertex: Vector3) -> Color:
	var front := vertex.z > 0.010
	var side_warmth := clampf((vertex.x + 0.38) / 0.76, 0.0, 1.0)
	var height_warmth := clampf(vertex.y / 1.82, 0.0, 1.0)
	var shade := 0.02 if front else -0.09
	if vertex.y > 1.420:
		shade += 0.04 if front else -0.02
	elif vertex.y < 0.240:
		shade -= 0.06
	var tone := _skin_color(0.50 + side_warmth * 0.13 + height_warmth * 0.12, shade)
	return Color(tone.r, tone.g, tone.b, 0.94)


func _paint_surface_detail(albedo: Image, x: int, y: int, vertex: Vector3) -> void:
	if _hash_noise(x, y, 17) > 0.992:
		_blend_pixel(albedo, x, y, Color(0.405, 0.205, 0.145, 0.24))
	if _hash_noise(x, y, 29) > 0.982:
		_blend_pixel(albedo, x, y, Color(0.930, 0.720, 0.580, 0.10))
	var front := vertex.z > 0.010
	if front and vertex.y > 1.420:
		_paint_face_pixel_detail(albedo, x, y, vertex)
	elif front and vertex.y > 0.700 and vertex.y < 1.230:
		_paint_torso_pixel_detail(albedo, x, y, vertex)


func _paint_face_pixel_detail(albedo: Image, x: int, y: int, vertex: Vector3) -> void:
	if vertex.y > 1.620 and vertex.y < 1.705 and abs(vertex.x) > 0.050 and abs(vertex.x) < 0.245:
		_blend_pixel(albedo, x, y, Color(0.170, 0.095, 0.065, 0.36))
	if vertex.y > 1.575 and vertex.y < 1.655 and abs(vertex.x) > 0.070 and abs(vertex.x) < 0.210:
		_blend_pixel(albedo, x, y, Color(0.930, 0.860, 0.785, 0.50))
	if vertex.y > 1.585 and vertex.y < 1.648 and abs(abs(vertex.x) - 0.128) < 0.025:
		_blend_pixel(albedo, x, y, Color(0.055, 0.032, 0.022, 0.66))
	if vertex.y > 1.505 and vertex.y < 1.625 and abs(vertex.x) < 0.055:
		_blend_pixel(albedo, x, y, Color(0.940, 0.610, 0.455, 0.24))
	if vertex.y > 1.452 and vertex.y < 1.520 and abs(vertex.x) < 0.175:
		_blend_pixel(albedo, x, y, Color(0.575, 0.190, 0.205, 0.42))
	if vertex.y > 1.520 and vertex.y < 1.620 and abs(vertex.x) > 0.130 and abs(vertex.x) < 0.270:
		_blend_pixel(albedo, x, y, Color(0.900, 0.430, 0.375, 0.16))


func _paint_torso_pixel_detail(albedo: Image, x: int, y: int, vertex: Vector3) -> void:
	if vertex.y > 1.045 and vertex.y < 1.245 and abs(vertex.x) < 0.210:
		_blend_pixel(albedo, x, y, Color(0.980, 0.700, 0.545, 0.11))
	if vertex.y > 0.835 and vertex.y < 1.105 and abs(vertex.x) < 0.035:
		_blend_pixel(albedo, x, y, Color(0.465, 0.235, 0.170, 0.23))
	if vertex.y > 0.720 and vertex.y < 0.780 and abs(vertex.x) < 0.042:
		_blend_pixel(albedo, x, y, Color(0.260, 0.115, 0.085, 0.33))


func _paint_vertex_skin(vertex: Vector3, uv: Vector2, albedo: Image) -> void:
	var front := vertex.z > 0.010
	var side_warmth := clampf((vertex.x + 0.35) / 0.70, 0.0, 1.0)
	var height_warmth := clampf(vertex.y / 1.82, 0.0, 1.0)
	var tone := _skin_color(0.52 + side_warmth * 0.12 + height_warmth * 0.08, 0.0)
	var radius := 8
	if vertex.y > 1.420:
		radius = 10
		tone = _skin_color(0.70, 0.03 if front else -0.06)
	elif vertex.y > 0.820:
		tone = _skin_color(0.60, 0.00 if front else -0.08)
	elif vertex.y < 0.250:
		tone = _skin_color(0.50, -0.08)
	_stamp_uv(albedo, uv, radius, Color(tone.r, tone.g, tone.b, 0.88))
	_paint_anatomy_marks(vertex, uv, albedo)


func _paint_anatomy_marks(vertex: Vector3, uv: Vector2, albedo: Image) -> void:
	var front := vertex.z > 0.010
	if vertex.y > 1.420:
		_paint_face_marks(vertex, uv, albedo, front)
		return
	if front and vertex.y > 1.180 and vertex.y < 1.360 and abs(vertex.x) < 0.170:
		_stamp_uv(albedo, uv, 5, Color(0.900, 0.610, 0.470, 0.28))
	if front and vertex.y > 0.930 and vertex.y < 1.100 and abs(vertex.x) < 0.035:
		_stamp_uv(albedo, uv, 4, Color(0.470, 0.255, 0.195, 0.30))
	if vertex.y > 0.500 and vertex.y < 0.610 and abs(vertex.x) > 0.055 and abs(vertex.x) < 0.180:
		_stamp_uv(albedo, uv, 4, Color(0.620, 0.350, 0.270, 0.24))
	if vertex.y > 0.955 and vertex.y < 1.045 and abs(vertex.x) > 0.190:
		_stamp_uv(albedo, uv, 4, Color(0.570, 0.330, 0.250, 0.18))


func _paint_face_marks(vertex: Vector3, uv: Vector2, albedo: Image, front: bool) -> void:
	if not front:
		_stamp_uv(albedo, uv, 4, Color(0.520, 0.300, 0.235, 0.22))
		return
	if vertex.y > 1.690:
		_stamp_uv(albedo, uv, 5, Color(0.705, 0.435, 0.315, 0.28))
	if vertex.y > 1.630 and vertex.y < 1.700 and abs(vertex.x) > 0.045 and abs(vertex.x) < 0.230:
		_stamp_uv(albedo, uv, 4, Color(0.220, 0.125, 0.095, 0.50))
	if vertex.y > 1.580 and vertex.y < 1.660 and abs(vertex.x) > 0.060 and abs(vertex.x) < 0.205:
		_stamp_uv(albedo, uv, 4, Color(0.925, 0.845, 0.770, 0.72))
	if vertex.y > 1.585 and vertex.y < 1.645 and abs(abs(vertex.x) - 0.125) < 0.026:
		_stamp_uv(albedo, uv, 3, Color(0.120, 0.075, 0.050, 0.78))
		_stamp_uv(albedo, uv, 1, Color(0.015, 0.012, 0.010, 0.86))
	if vertex.y > 1.510 and vertex.y < 1.625 and abs(vertex.x) < 0.052:
		_stamp_uv(albedo, uv, 4, Color(0.850, 0.560, 0.420, 0.34))
	if vertex.y > 1.500 and vertex.y < 1.565 and abs(vertex.x) < 0.120:
		_stamp_uv(albedo, uv, 2, Color(0.470, 0.250, 0.190, 0.34))
	if vertex.y > 1.438 and vertex.y < 1.515 and abs(vertex.x) < 0.170:
		_stamp_uv(albedo, uv, 4, Color(0.610, 0.250, 0.245, 0.52))
	if vertex.y > 1.530 and vertex.y < 1.625 and abs(vertex.x) > 0.115 and abs(vertex.x) < 0.255:
		_stamp_uv(albedo, uv, 7, Color(0.840, 0.430, 0.385, 0.24))
	if vertex.y > 1.420 and vertex.y < 1.480:
		_stamp_uv(albedo, uv, 4, Color(0.585, 0.340, 0.260, 0.25))


func _paint_authored_face_fallback(albedo: Image) -> void:
	_fill_uv_rect(albedo, Rect2(0.570, 0.292, 0.355, 0.220), Color(0.740, 0.485, 0.360, 0.72))
	_draw_uv_line(albedo, Vector2(0.620, 0.356), Vector2(0.712, 0.366), 5, Color(0.945, 0.865, 0.780, 0.72))
	_draw_uv_line(albedo, Vector2(0.795, 0.366), Vector2(0.890, 0.356), 5, Color(0.945, 0.865, 0.780, 0.72))
	_draw_uv_line(albedo, Vector2(0.632, 0.342), Vector2(0.724, 0.352), 3, Color(0.210, 0.125, 0.090, 0.60))
	_draw_uv_line(albedo, Vector2(0.780, 0.352), Vector2(0.880, 0.342), 3, Color(0.210, 0.125, 0.090, 0.60))
	_stamp_uv(albedo, Vector2(0.670, 0.365), 3, Color(0.090, 0.055, 0.035, 0.88))
	_stamp_uv(albedo, Vector2(0.835, 0.365), 3, Color(0.090, 0.055, 0.035, 0.88))
	_draw_uv_line(albedo, Vector2(0.752, 0.386), Vector2(0.742, 0.455), 4, Color(0.870, 0.560, 0.420, 0.46))
	_draw_uv_line(albedo, Vector2(0.680, 0.472), Vector2(0.820, 0.478), 5, Color(0.570, 0.230, 0.230, 0.62))
	_draw_uv_line(albedo, Vector2(0.695, 0.490), Vector2(0.805, 0.492), 3, Color(0.330, 0.120, 0.125, 0.48))
	_stamp_uv(albedo, Vector2(0.630, 0.416), 12, Color(0.870, 0.410, 0.360, 0.22))
	_stamp_uv(albedo, Vector2(0.875, 0.416), 12, Color(0.870, 0.410, 0.360, 0.22))


func _paint_authored_body_fallback(albedo: Image) -> void:
	for i in range(7):
		var v: float = 0.475 + float(i) * 0.018
		_draw_uv_line(albedo, Vector2(0.625, v), Vector2(0.900, v + 0.006 * sin(float(i))), 3, Color(0.860, 0.580, 0.440, 0.34))
	_draw_uv_line(albedo, Vector2(0.755, 0.460), Vector2(0.755, 0.575), 5, Color(0.560, 0.310, 0.240, 0.26))
	_stamp_uv(albedo, Vector2(0.754, 0.545), 5, Color(0.320, 0.170, 0.130, 0.34))


func _skin_color(warmth: float, shade: float) -> Color:
	var light := Color(0.910, 0.660, 0.520, 1.0)
	var mid := Color(0.735, 0.455, 0.330, 1.0)
	var deep := Color(0.470, 0.255, 0.185, 1.0)
	var t := clampf(warmth, 0.0, 1.0)
	var color := deep.lerp(mid, min(t * 1.55, 1.0)).lerp(light, max(t - 0.55, 0.0) * 1.4)
	if shade > 0.0:
		color = color.lerp(Color(1.0, 0.82, 0.66, 1.0), clampf(shade, 0.0, 1.0))
	elif shade < 0.0:
		color = color.lerp(Color(0.220, 0.110, 0.085, 1.0), clampf(-shade, 0.0, 1.0))
	return color


func _fill_uv_rect(image: Image, rect: Rect2, color: Color) -> void:
	var x0: int = clampi(roundi(rect.position.x * float(TEXTURE_SIZE - 1)), 0, TEXTURE_SIZE - 1)
	var y0: int = clampi(roundi(rect.position.y * float(TEXTURE_SIZE - 1)), 0, TEXTURE_SIZE - 1)
	var x1: int = clampi(roundi((rect.position.x + rect.size.x) * float(TEXTURE_SIZE - 1)), 0, TEXTURE_SIZE - 1)
	var y1: int = clampi(roundi((rect.position.y + rect.size.y) * float(TEXTURE_SIZE - 1)), 0, TEXTURE_SIZE - 1)
	for y in range(min(y0, y1), max(y0, y1) + 1):
		for x in range(min(x0, x1), max(x0, x1) + 1):
			_blend_pixel(image, x, y, color)


func _draw_uv_line(image: Image, from_uv: Vector2, to_uv: Vector2, radius: int, color: Color) -> void:
	var from_px: Vector2 = _uv_to_pixel(from_uv)
	var to_px: Vector2 = _uv_to_pixel(to_uv)
	var distance: float = max(1.0, from_px.distance_to(to_px))
	var steps := int(ceil(distance / max(float(radius), 1.0)))
	for i in range(steps + 1):
		var t: float = float(i) / float(max(steps, 1))
		var point := from_px.lerp(to_px, t)
		_stamp_pixel(image, roundi(point.x), roundi(point.y), radius, color)


func _stamp_uv(image: Image, uv: Vector2, radius: int, color: Color) -> void:
	var pixel := _uv_to_pixel(uv)
	_stamp_pixel(image, roundi(pixel.x), roundi(pixel.y), radius, color)


func _stamp_pixel(image: Image, cx: int, cy: int, radius: int, color: Color) -> void:
	var r: int = max(radius, 1)
	for y in range(cy - r, cy + r + 1):
		if y < 0 or y >= TEXTURE_SIZE:
			continue
		for x in range(cx - r, cx + r + 1):
			if x < 0 or x >= TEXTURE_SIZE:
				continue
			var dist := Vector2(float(x - cx), float(y - cy)).length()
			if dist > float(r):
				continue
			var falloff: float = 1.0 - smoothstep(float(r) * 0.55, float(r), dist)
			_blend_pixel(image, x, y, Color(color.r, color.g, color.b, color.a * falloff))


func _blend_pixel(image: Image, x: int, y: int, src: Color) -> void:
	if src.a <= 0.0:
		return
	var dst := image.get_pixel(x, y)
	var out_alpha: float = src.a + dst.a * (1.0 - src.a)
	if out_alpha <= 0.0001:
		image.set_pixel(x, y, Color(0.0, 0.0, 0.0, 0.0))
		return
	var out_rgb := (Vector3(src.r, src.g, src.b) * src.a + Vector3(dst.r, dst.g, dst.b) * dst.a * (1.0 - src.a)) / out_alpha
	image.set_pixel(x, y, Color(out_rgb.x, out_rgb.y, out_rgb.z, out_alpha))


func _uv_to_pixel(uv: Vector2) -> Vector2:
	return Vector2(
		clampf(uv.x, 0.0, 1.0) * float(TEXTURE_SIZE - 1),
		clampf(uv.y, 0.0, 1.0) * float(TEXTURE_SIZE - 1)
	)


func _edge(a: Vector2, b: Vector2, c: Vector2) -> float:
	return (c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)


func _hash_noise(x: int, y: int, salt: int) -> float:
	var n := int(x * 374761393 + y * 668265263 + salt * 2246822519)
	n = (n ^ (n >> 13)) * 1274126177
	n = n ^ (n >> 16)
	return float(n & 0xffff) / 65535.0
