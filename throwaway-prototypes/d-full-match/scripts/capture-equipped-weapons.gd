extends SceneTree

const EquipmentMeshAttachmentScript = preload("res://src/EquipmentMeshAttachment.gd")

const EXPERIMENT_MODEL_PATH := "res://shared-harness/art-kit/characters/generated/experiment.glb"
const EXPERIMENT_MODEL_SCALE := 0.93464883
const DEFAULT_OUT_DIR := "res://../../screenshots/weapon-equipped"
const CHARACTER_ID := "weapon-qa"
const VIEW_SIZE := Vector2i(720, 640)
const CONTACT_COLUMNS := 2
const CONTACT_CELL_SIZE := Vector2i(540, 480)
const WEAPON_NAMES := [
	"rusty_blade",
	"dagger",
	"sword",
	"axe",
	"greatsword",
	"warhammer",
	"crowbar",
	"fire_axe",
	"nail_bat",
	"rusty_pipe",
	"tire_iron",
]
const QA_ANIMATION := "Sword_Idle"

var out_dir := ""
var stage: Node3D
var equipment_attachment: Node
var character_root: Node3D
var camera: Camera3D
var weapon_label: Label3D
var capture_paths: Array[String] = []
var animation_player: AnimationPlayer
var debug_markers := false
var hand_marker: MeshInstance3D
var root_marker: MeshInstance3D


func _init() -> void:
	_run.call_deferred()


func _run() -> void:
	out_dir = _output_dir()
	debug_markers = _has_user_arg("--debug-markers")
	DirAccess.make_dir_recursive_absolute(out_dir)
	root.size = VIEW_SIZE
	RenderingServer.set_default_clear_color(Color(0.125, 0.128, 0.130, 1.0))
	_setup_scene()
	await process_frame
	await process_frame
	for weapon_name in WEAPON_NAMES:
		var output_path := await _capture_weapon_triptych(weapon_name)
		if not output_path.is_empty():
			capture_paths.append(output_path)
	if capture_paths.size() != WEAPON_NAMES.size():
		push_error("capture-equipped-weapons captured %d/%d weapon panels" % [capture_paths.size(), WEAPON_NAMES.size()])
		quit(1)
		return
	_make_contact_sheet()
	print("capture-equipped-weapons wrote %d weapon panels to %s" % [capture_paths.size(), out_dir])
	quit(0)


func _output_dir() -> String:
	var args := OS.get_cmdline_user_args()
	for i in range(args.size()):
		if args[i] == "--out-dir" and i + 1 < args.size():
			return _global_path(str(args[i + 1]))
	return _global_path(DEFAULT_OUT_DIR)


func _global_path(path: String) -> String:
	if path.begins_with("res://") or path.begins_with("user://"):
		return ProjectSettings.globalize_path(path)
	if path.is_absolute_path():
		return path
	return ProjectSettings.globalize_path("res://%s" % path)


func _has_user_arg(flag: String) -> bool:
	for arg in OS.get_cmdline_user_args():
		if str(arg) == flag:
			return true
	return false


func _setup_scene() -> void:
	stage = Node3D.new()
	stage.name = "WeaponEquipmentQaStage"
	root.add_child(stage)
	_setup_environment()
	equipment_attachment = EquipmentMeshAttachmentScript.new()
	stage.add_child(equipment_attachment)
	equipment_attachment.configure({})
	character_root = Node3D.new()
	character_root.name = "weapon_qa_character"
	stage.add_child(character_root)
	var scene = load(EXPERIMENT_MODEL_PATH)
	if not (scene is PackedScene):
		push_error("capture-equipped-weapons cannot load %s" % EXPERIMENT_MODEL_PATH)
		quit(1)
		return
	var visual = (scene as PackedScene).instantiate()
	if not (visual is Node3D):
		push_error("capture-equipped-weapons experiment scene root is not Node3D")
		quit(1)
		return
	var visual_root := visual as Node3D
	visual_root.name = "visual"
	visual_root.scale = Vector3.ONE * EXPERIMENT_MODEL_SCALE
	character_root.add_child(visual_root)
	animation_player = _first_animation_player(visual_root)
	equipment_attachment.call(
		"register_external_character",
		CHARACTER_ID,
		character_root,
		"experiment",
		visual_root,
		{"attachBone": "hand_r", "animation": {}, "armorOverlay": {}}
	)
	_play_qa_animation()
	weapon_label = Label3D.new()
	weapon_label.name = "WeaponLabel"
	weapon_label.position = Vector3(0.0, 1.86, 0.0)
	weapon_label.pixel_size = 0.004
	weapon_label.font_size = 18
	weapon_label.outline_size = 8
	weapon_label.no_depth_test = true
	weapon_label.modulate = Color(0.88, 0.96, 1.0, 1.0)
	stage.add_child(weapon_label)
	hand_marker = _make_marker("hand_socket_marker", Color(0.1, 0.95, 1.0, 1.0), 0.022)
	root_marker = _make_marker("weapon_root_marker", Color(1.0, 0.12, 0.08, 1.0), 0.018)
	stage.add_child(hand_marker)
	stage.add_child(root_marker)
	camera = Camera3D.new()
	camera.name = "weapon_qa_camera"
	camera.projection = Camera3D.PROJECTION_ORTHOGONAL
	camera.near = 0.02
	camera.far = 30.0
	stage.add_child(camera)
	camera.make_current()


func _setup_environment() -> void:
	var world_environment := WorldEnvironment.new()
	world_environment.name = "weapon_qa_world"
	var environment := Environment.new()
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = Color(0.145, 0.146, 0.148, 1.0)
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color(0.72, 0.76, 0.78)
	environment.ambient_light_energy = 1.18
	environment.glow_enabled = true
	environment.glow_intensity = 0.42
	environment.adjustment_enabled = true
	environment.adjustment_brightness = 1.16
	environment.adjustment_contrast = 0.94
	world_environment.environment = environment
	stage.add_child(world_environment)
	var key := DirectionalLight3D.new()
	key.name = "weapon_qa_key"
	key.light_color = Color(0.86, 0.92, 1.0)
	key.light_energy = 3.2
	key.shadow_enabled = false
	key.rotation_degrees = Vector3(-45.0, -32.0, 0.0)
	stage.add_child(key)
	_add_fill_light("weapon_qa_fill_left", Vector3(-1.6, 2.0, -2.4), Color(0.70, 0.82, 1.0), 1.7)
	_add_fill_light("weapon_qa_fill_right", Vector3(1.8, 1.4, -1.5), Color(1.0, 0.74, 0.52), 0.85)
	var floor_mesh := MeshInstance3D.new()
	floor_mesh.name = "weapon_qa_floor"
	var plane := PlaneMesh.new()
	plane.size = Vector2(3.2, 3.2)
	floor_mesh.mesh = plane
	floor_mesh.position = Vector3(0.0, -0.01, 0.0)
	var floor_mat := StandardMaterial3D.new()
	floor_mat.albedo_color = Color(0.205, 0.205, 0.198, 1.0)
	floor_mat.roughness = 0.76
	floor_mesh.material_override = floor_mat
	stage.add_child(floor_mesh)


func _add_fill_light(light_name: String, light_position: Vector3, light_color: Color, energy: float) -> void:
	var light := OmniLight3D.new()
	light.name = light_name
	light.position = light_position
	light.light_color = light_color
	light.light_energy = energy
	light.omni_range = 5.0
	light.shadow_enabled = false
	stage.add_child(light)


func _capture_weapon_triptych(weapon_name: String) -> String:
	weapon_label.text = weapon_name.replace("_", " ")
	_play_qa_animation()
	equipment_attachment.call(
		"update_equipment",
		{
			CHARACTER_ID: {
				"weapon": {"name": weapon_name},
				"armour": {"name": ""},
			},
		}
	)
	for i in range(5):
		if animation_player != null:
			animation_player.advance(0.016)
		equipment_attachment.call("tick", 0.016)
		_update_debug_markers()
		await process_frame
	var target := _weapon_focus_point()
	var panels: Array[Image] = []
	for view in _view_specs(target):
		var image := await _capture_view(view)
		if image != null:
			panels.append(image)
	if panels.size() != 3:
		push_error("capture-equipped-weapons could not render all panels for %s" % weapon_name)
		return ""
	var panel := _join_images_horizontal(panels)
	var output_path := "%s/%s_equipped.png" % [out_dir, weapon_name]
	var error := panel.save_png(output_path)
	if error != OK:
		push_error("capture-equipped-weapons failed to save %s: %s" % [output_path, error])
		return ""
	return output_path


func _view_specs(target: Vector3) -> Array[Dictionary]:
	return [
		{
			"name": "full_front",
			"target": Vector3(0.0, 1.05, 0.0),
			"offset": Vector3(0.0, 0.0, 3.1),
			"size": 2.18,
		},
		{
			"name": "grip_front",
			"target": target,
			"offset": Vector3(0.0, 0.0, 0.86),
			"size": 0.62,
		},
		{
			"name": "grip_side",
			"target": target,
			"offset": Vector3(0.82, 0.0, 0.42),
			"size": 0.62,
		},
	]


func _capture_view(view: Dictionary) -> Image:
	var target := view.get("target", Vector3(0.0, 1.0, 0.0)) as Vector3
	var offset := view.get("offset", Vector3(0.0, 0.0, 2.0)) as Vector3
	camera.size = float(view.get("size", 1.0))
	camera.global_position = target + offset
	camera.look_at(target, Vector3.UP)
	await process_frame
	await process_frame
	var texture := root.get_texture()
	if texture == null:
		return null
	var image := texture.get_image()
	if image == null:
		return null
	image.convert(Image.FORMAT_RGBA8)
	return image


func _weapon_focus_point() -> Vector3:
	var socket = equipment_attachment.call("weapon_socket_for_character", CHARACTER_ID) as Node3D
	if socket != null:
		return socket.global_position + Vector3(0.0, 0.035, 0.0)
	return Vector3(0.18, 1.1, 0.0)


func _update_debug_markers() -> void:
	if hand_marker == null or root_marker == null:
		return
	hand_marker.visible = debug_markers
	root_marker.visible = debug_markers
	if not debug_markers:
		return
	var socket = equipment_attachment.call("weapon_socket_for_character", CHARACTER_ID) as Node3D
	var weapon := _find_named_node(character_root, "weapon_visual") as Node3D
	if socket != null:
		hand_marker.global_position = socket.global_position
	if weapon != null:
		root_marker.global_position = weapon.global_position


func _make_marker(marker_name: String, color: Color, radius: float) -> MeshInstance3D:
	var marker := MeshInstance3D.new()
	marker.name = marker_name
	var sphere := SphereMesh.new()
	sphere.radius = radius
	sphere.height = radius * 2.0
	marker.mesh = sphere
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	mat.emission_enabled = true
	mat.emission = color
	mat.emission_energy_multiplier = 1.8
	marker.material_override = mat
	marker.visible = false
	return marker


func _world_aabb(node: Node3D) -> AABB:
	var found := false
	var out := AABB()
	for child in _collect_nodes(node):
		if not (child is MeshInstance3D):
			continue
		var mesh_instance := child as MeshInstance3D
		if mesh_instance.mesh == null:
			continue
		var local_aabb := mesh_instance.mesh.get_aabb()
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
			var point: Vector3 = mesh_instance.global_transform * corner
			if not found:
				out = AABB(point, Vector3.ZERO)
				found = true
			else:
				out = out.expand(point)
	return out


func _find_named_node(node: Node, target_name: String) -> Node:
	if node == null:
		return null
	if str(node.name) == target_name:
		return node
	for child in node.get_children():
		var found := _find_named_node(child, target_name)
		if found != null:
			return found
	return null


func _collect_nodes(node: Node) -> Array[Node]:
	var nodes: Array[Node] = [node]
	for child in node.get_children():
		nodes.append_array(_collect_nodes(child))
	return nodes


func _first_animation_player(node: Node) -> AnimationPlayer:
	if node is AnimationPlayer:
		return node as AnimationPlayer
	for child in node.get_children():
		var found := _first_animation_player(child)
		if found != null:
			return found
	return null


func _play_qa_animation() -> void:
	if animation_player == null:
		return
	if not animation_player.has_animation(QA_ANIMATION):
		return
	animation_player.play(QA_ANIMATION)
	animation_player.advance(0.62)


func _join_images_horizontal(images: Array[Image]) -> Image:
	var width := 0
	var height := 0
	for image in images:
		width += image.get_width()
		height = max(height, image.get_height())
	var joined := Image.create(width, height, false, Image.FORMAT_RGBA8)
	joined.fill(Color(0.10, 0.105, 0.11, 1.0))
	var x := 0
	for image in images:
		joined.blit_rect(image, Rect2i(Vector2i.ZERO, image.get_size()), Vector2i(x, 0))
		x += image.get_width()
	return joined


func _make_contact_sheet() -> void:
	if capture_paths.is_empty():
		return
	var rows := int(ceil(float(capture_paths.size()) / float(CONTACT_COLUMNS)))
	var sheet := Image.create(CONTACT_CELL_SIZE.x * CONTACT_COLUMNS, CONTACT_CELL_SIZE.y * rows, false, Image.FORMAT_RGBA8)
	sheet.fill(Color(0.08, 0.085, 0.09, 1.0))
	for i in range(capture_paths.size()):
		var image := Image.load_from_file(capture_paths[i])
		if image == null:
			continue
		image.resize(CONTACT_CELL_SIZE.x, CONTACT_CELL_SIZE.y, Image.INTERPOLATE_LANCZOS)
		var cell := Vector2i(i % CONTACT_COLUMNS, int(floor(float(i) / float(CONTACT_COLUMNS))))
		sheet.blit_rect(image, Rect2i(Vector2i.ZERO, image.get_size()), Vector2i(cell.x * CONTACT_CELL_SIZE.x, cell.y * CONTACT_CELL_SIZE.y))
	var output_path := "%s/contact_sheet.png" % out_dir
	var error := sheet.save_png(output_path)
	if error != OK:
		push_error("capture-equipped-weapons failed to save contact sheet %s: %s" % [output_path, error])
