extends SceneTree

const SOURCE_BODY := "res://shared-harness/art-kit/characters/camper-mesh2motion-human-base.glb"
const ALBEDO_OUT := "res://shared-harness/art-kit/textures/skin/hell-cyborg-face-body-albedo.png"
const EMISSION_OUT := "res://shared-harness/art-kit/textures/skin/hell-cyborg-face-body-emission.png"
const TEXTURE_SIZE := 1024


func _init() -> void:
	var albedo := Image.create_empty(TEXTURE_SIZE, TEXTURE_SIZE, false, Image.FORMAT_RGBA8)
	var emission := Image.create_empty(TEXTURE_SIZE, TEXTURE_SIZE, false, Image.FORMAT_RGBA8)
	albedo.fill(Color(0.0, 0.0, 0.0, 0.0))
	emission.fill(Color(0.0, 0.0, 0.0, 0.0))
	_paint_base_uv_island(albedo)
	_paint_guided_mesh_marks(albedo, emission)
	_paint_authored_face_marks(albedo, emission)
	_paint_authored_body_marks(albedo, emission)
	var albedo_error := albedo.save_png(ALBEDO_OUT)
	var emission_error := emission.save_png(EMISSION_OUT)
	if albedo_error != OK or emission_error != OK:
		push_error("failed to save hell cyborg skin pngs: albedo=%s emission=%s" % [error_string(albedo_error), error_string(emission_error)])
		quit(1)
		return
	print("generated %s and %s" % [ALBEDO_OUT, EMISSION_OUT])
	quit(0)


func _paint_base_uv_island(albedo: Image) -> void:
	_fill_uv_rect(albedo, Rect2(0.525, 0.250, 0.475, 0.385), Color(0.034, 0.038, 0.044, 0.96))
	for i in range(44):
		var u: float = 0.540 + fmod(float(i) * 0.073, 0.430)
		var v: float = 0.270 + fmod(float(i) * 0.041, 0.330)
		var length: float = 0.040 + fmod(float(i) * 0.013, 0.055)
		var color := Color(0.190, 0.205, 0.215, 0.34)
		_draw_uv_line(albedo, Vector2(u, v), Vector2(min(u + length, 0.990), v + 0.008 * sin(float(i))), 2 if i % 5 == 0 else 1, color)
	for i in range(28):
		var u: float = 0.552 + fmod(float(i) * 0.101, 0.405)
		var v: float = 0.282 + fmod(float(i) * 0.057, 0.300)
		_stamp_uv(albedo, Vector2(u, v), 3 + i % 3, Color(0.008, 0.009, 0.011, 0.36))


func _paint_guided_mesh_marks(albedo: Image, emission: Image) -> void:
	var scene := load(SOURCE_BODY) as PackedScene
	if scene == null:
		push_error("missing source body: %s" % SOURCE_BODY)
		return
	var root := scene.instantiate()
	_paint_mesh_node(root, albedo, emission)
	root.queue_free()


func _paint_mesh_node(node: Node, albedo: Image, emission: Image) -> void:
	if node is MeshInstance3D:
		_paint_mesh(node as MeshInstance3D, albedo, emission)
	for child in node.get_children():
		_paint_mesh_node(child, albedo, emission)


func _paint_mesh(mesh_instance: MeshInstance3D, albedo: Image, emission: Image) -> void:
	var mesh := mesh_instance.mesh
	if mesh == null:
		return
	for surface in range(mesh.get_surface_count()):
		var arrays := mesh.surface_get_arrays(surface)
		if arrays.is_empty():
			continue
		var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var uvs: PackedVector2Array = arrays[Mesh.ARRAY_TEX_UV]
		for i in range(min(vertices.size(), uvs.size())):
			var vertex := vertices[i]
			var uv := uvs[i]
			if uv.x <= 0.0 and uv.y <= 0.0:
				continue
			_paint_vertex_mark(vertex, uv, albedo, emission)


func _paint_vertex_mark(vertex: Vector3, uv: Vector2, albedo: Image, emission: Image) -> void:
	var front := vertex.z > 0.012
	var head := vertex.y > 1.420
	var torso := vertex.y > 0.810 and vertex.y < 1.345
	var lower_body := vertex.y <= 0.810
	if head:
		var face_alpha: float = 0.88 if front else 0.36
		_stamp_uv(albedo, uv, 8 if front else 4, Color(0.080, 0.088, 0.098, face_alpha))
		if front and vertex.y > 1.615 and vertex.y < 1.745 and abs(vertex.x) < 0.250:
			_stamp_uv(albedo, uv, 9, Color(0.008, 0.009, 0.012, 0.98))
		if front and vertex.y > 1.545 and vertex.y < 1.690 and abs(vertex.x) > 0.045 and abs(vertex.x) < 0.220:
			_stamp_uv(albedo, uv, 5, Color(0.280, 0.030, 0.018, 0.78))
			_stamp_uv(emission, uv, 3, Color(1.0, 0.020, 0.006, 0.72))
		if front and vertex.y > 1.430 and vertex.y < 1.560 and abs(vertex.x) < 0.185:
			_stamp_uv(albedo, uv, 6, Color(0.012, 0.014, 0.018, 0.96))
	elif torso:
		_stamp_uv(albedo, uv, 5, Color(0.046, 0.052, 0.058, 0.78))
		if front and abs(vertex.x) < 0.075 and vertex.y > 1.050 and vertex.y < 1.270:
			_stamp_uv(emission, uv, 10, Color(1.0, 0.060, 0.010, 0.92))
		if front and abs(vertex.x) > 0.060 and abs(vertex.x) < 0.190 and fmod(vertex.y * 18.0, 1.0) < 0.180:
			_stamp_uv(albedo, uv, 5, Color(0.235, 0.245, 0.252, 0.68))
			_stamp_uv(emission, uv, 4, Color(0.950, 0.045, 0.010, 0.48))
	elif lower_body:
		_stamp_uv(albedo, uv, 4, Color(0.044, 0.048, 0.055, 0.64))
	if front and fmod((vertex.x + vertex.y) * 9.0, 1.0) < 0.050:
		_stamp_uv(emission, uv, 2, Color(0.050, 0.900, 1.0, 0.46))


func _paint_authored_face_marks(albedo: Image, emission: Image) -> void:
	_fill_uv_rect(albedo, Rect2(0.565, 0.284, 0.370, 0.230), Color(0.050, 0.057, 0.066, 0.96))
	_fill_uv_rect(albedo, Rect2(0.602, 0.322, 0.282, 0.052), Color(0.006, 0.006, 0.008, 0.96))
	_draw_uv_line(albedo, Vector2(0.596, 0.346), Vector2(0.900, 0.350), 10, Color(0.470, 0.505, 0.535, 0.90))
	_draw_uv_line(albedo, Vector2(0.628, 0.385), Vector2(0.840, 0.392), 4, Color(0.320, 0.350, 0.375, 0.80))
	_draw_uv_line(albedo, Vector2(0.744, 0.360), Vector2(0.744, 0.462), 5, Color(0.390, 0.420, 0.445, 0.88))
	_draw_uv_line(albedo, Vector2(0.620, 0.422), Vector2(0.870, 0.416), 8, Color(0.335, 0.365, 0.390, 0.86))
	_draw_uv_line(emission, Vector2(0.625, 0.372), Vector2(0.715, 0.390), 4, Color(1.0, 0.020, 0.004, 0.82))
	_draw_uv_line(emission, Vector2(0.795, 0.390), Vector2(0.885, 0.372), 4, Color(1.0, 0.020, 0.004, 0.82))
	_draw_uv_line(emission, Vector2(0.664, 0.405), Vector2(0.846, 0.405), 2, Color(1.0, 0.070, 0.016, 0.34))
	_draw_uv_line(albedo, Vector2(0.642, 0.456), Vector2(0.840, 0.476), 7, Color(0.006, 0.007, 0.010, 0.92))
	_draw_uv_line(emission, Vector2(0.675, 0.466), Vector2(0.808, 0.482), 2, Color(1.0, 0.115, 0.030, 0.26))
	for i in range(7):
		var u: float = 0.610 + float(i) * 0.047
		_draw_uv_line(albedo, Vector2(u, 0.418), Vector2(u + 0.018, 0.502), 3, Color(0.520, 0.550, 0.575, 0.78))


func _paint_authored_body_marks(albedo: Image, emission: Image) -> void:
	for i in range(8):
		var v: float = 0.468 + float(i) * 0.014
		_draw_uv_line(albedo, Vector2(0.600, v), Vector2(0.920, v + 0.010 * sin(float(i))), 4, Color(0.330, 0.352, 0.365, 0.66))
		if i % 2 == 0:
			_draw_uv_line(emission, Vector2(0.642, v + 0.006), Vector2(0.880, v + 0.012), 3, Color(1.0, 0.060, 0.010, 0.54))
	_draw_uv_line(emission, Vector2(0.756, 0.438), Vector2(0.756, 0.565), 8, Color(1.0, 0.035, 0.005, 1.0))
	_draw_uv_line(emission, Vector2(0.715, 0.525), Vector2(0.814, 0.478), 4, Color(1.0, 0.090, 0.010, 0.82))
	for i in range(18):
		var u: float = 0.555 + fmod(float(i) * 0.089, 0.420)
		var v: float = 0.275 + fmod(float(i) * 0.061, 0.330)
		var color := Color(0.080, 0.900, 1.0, 0.58) if i % 3 == 0 else Color(1.0, 0.045, 0.010, 0.52)
		_draw_uv_line(emission, Vector2(u, v), Vector2(min(u + 0.020 + float(i % 4) * 0.010, 0.985), v + 0.020), 2, color)


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
	var pixel: Vector2 = _uv_to_pixel(uv)
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
