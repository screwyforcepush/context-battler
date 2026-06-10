extends Node3D

const EntityRendererScript = preload("res://src/EntityRenderer.gd")
const PERSONAS := ["rat", "duelist", "trader", "opportunist", "paranoid", "camper", "sprinter", "vulture"]
const GLITCH_REAPER_PROTOTYPE_PATH := "res://shared-harness/art-kit/characters/generated/glitch_reaper.glb"
const EXPERIMENT_MODEL_PATH := "res://shared-harness/art-kit/characters/generated/experiment.glb"
const EXPERIMENT_VARIANT_CONFIG_PATH := "res://shared-harness/art-kit/characters/generated/experiment_persona_variants.json"
const GLITCH_REAPER_PROTOTYPE_SCALE := 0.93464883
const GLITCH_REAPER_CLIP_FALLBACKS := {
	"idle": ["Idle", "Idle_Loop", "Idle_Loop_Armature", "Zombie_Idle", "Zombie_Idle_Loop", "Zombie_Idle_Loop_Armature"],
	"walk": ["Walk", "Walk_Loop", "Walk_Loop_Armature", "Zombie_Walk_Fwd", "Zombie_Walk_Fwd_Loop", "Zombie_Walk_Fwd_Loop_Armature"],
	"run": ["Sprint", "Sprint_Loop", "Sprint_Loop_Armature", "Jog_Fwd", "Jog_Fwd_Loop", "Jog_Fwd_Loop_Armature"],
	"attack_unarmed": ["Punch_Jab", "Punch_Jab_Armature", "Melee_Hook", "Melee_Hook_Armature", "Sword_Attack", "Sword_Attack_Armature"],
	"attack_armed": ["Sword_Attack", "Sword_Attack_Armature", "Sword_Regular_A", "Sword_Regular_A_Armature", "Melee_Hook", "Melee_Hook_Armature"],
	"loot": ["PickUp_Table", "PickUp_Table_Armature", "Interact", "Interact_Armature"],
	"take_hit": ["Hit_Chest", "Hit_Chest_Armature", "Hit_Head", "Hit_Head_Armature"],
	"death": ["Death01", "Death01_Armature"],
}
const SHOW_MANIFEST_PERSONAS := false
const SHOW_EXPERIMENT_PERSONA_VARIANTS := true
const STANDALONE_SHOWROOM_MODELS := [
	{
		"id": "glitch_reaper",
		"label": "glitch_reaper",
		"source": "replacement_head_glb",
		"path": GLITCH_REAPER_PROTOTYPE_PATH,
		"phase_driver": true,
	},
	{
		"id": "experiment",
		"label": "experiment",
		"source": "reallusion_head_transplant",
		"path": EXPERIMENT_MODEL_PATH,
		"phase_driver": false,
	},
]
const STATION_SPACING := 1.6
const SAMPLE_MAP_WIDTH := 32
const SAMPLE_MAP_HEIGHT := 12
const LAYER_SKIN := "skin"
const LAYER_GORE := "gore"
const LAYER_WEAPONS := "weapons"
const LAYER_ARMOUR := "armour"
const ARMOUR_RENDER_PROP := "modular_submesh_prop"
const ARMOUR_PROP_ALL := "all"
const PERSONA_NAME_LABEL_HEIGHT := 2.20
const PERSONA_CLIP_LABEL_HEIGHT := 1.96
const GLITCH_REAPER_NAME_LABEL_HEIGHT := 2.42
const GLITCH_REAPER_CLIP_LABEL_HEIGHT := 2.18
const GLITCH_REAPER_PHASE_MAX_NODES := 80
const GLITCH_REAPER_PHASE_MARKERS := [
	"_phase_",
	"cyan_phase",
	"data_tear",
	"scanline",
	"dimension_slice",
]
const SHOWROOM_REVIEW_CLEAR := Color(0.145, 0.148, 0.150, 1.0)
const SHOWROOM_REVIEW_BACKGROUND := Color(0.155, 0.156, 0.158, 1.0)
const SHOWROOM_REVIEW_FLOOR := Color(0.205, 0.205, 0.198, 1.0)
const SHOWROOM_REVIEW_WALL := Color(0.115, 0.120, 0.124, 1.0)
const SHOWROOM_REVIEW_COVER := Color(0.145, 0.125, 0.110, 1.0)

var current_weapon_tier := 0
var current_armour_tier := 0
var current_armour_render_mode := ARMOUR_RENDER_PROP
var current_armour_prop_selection := ARMOUR_PROP_ALL
var current_weapon_selection := ""
var weapon_by_tier := {0: "", 1: "", 2: "", 3: ""}
var armour_by_tier := {0: "", 1: "", 2: "", 3: ""}
var weapon_asset_options := []
var armour_prop_options := []
var clip_labels: Dictionary = {}
var standalone_animation_players: Dictionary = {}
var standalone_clip_labels: Dictionary = {}
var standalone_current_clips: Dictionary = {}
var glitch_reaper_phase_time := 0.0
var glitch_reaper_phase_nodes: Array[Dictionary] = []
var experiment_skin_flicker_time := 0.0
var experiment_skin_flicker_materials: Array[Dictionary] = []
var experiment_embedded_decoration_time := 0.0
var experiment_embedded_decoration_nodes: Array[Dictionary] = []
var cover_visible := false
var active_station_count := 0
var experiment_variant_configs: Dictionary = {}
var selected_tier_buttons: Dictionary = {}
var layer_enabled := {
	LAYER_SKIN: true,
	LAYER_GORE: false,
	LAYER_WEAPONS: true,
	LAYER_ARMOUR: true,
}
var fallback_material: StandardMaterial3D
var weapon_asset_selector: OptionButton
var armour_asset_selector: OptionButton

@onready var scene_builder: Node3D = %SceneBuilder
@onready var equipment_attachment: Node = %EquipmentMeshAttachment
@onready var camera_rig = %CameraRig
@onready var persona_stations: Node3D = %PersonaStations
@onready var ui: CanvasLayer = %UI


func _ready() -> void:
	_make_materials()
	equipment_attachment.configure({})
	_build_sample_environment()
	_apply_model_review_render_profile()
	_apply_cover_visibility()
	_build_tier_maps()
	_build_weapon_asset_options()
	_build_armour_prop_options()
	_spawn_persona_row()
	_configure_camera()
	_make_ui()
	_reapply_showroom_layers()
	_trigger_animation("idle")


func _process(delta: float) -> void:
	if camera_rig != null and camera_rig.has_method("update_camera"):
		camera_rig.update_camera(delta)
	if equipment_attachment != null and equipment_attachment.has_method("tick"):
		equipment_attachment.tick(delta)
	_tick_glitch_reaper_phase_driver(delta)
	_tick_experiment_skin_flicker(delta)
	_tick_experiment_embedded_decorations(delta)
	_update_clip_labels()


func _input(event: InputEvent) -> void:
	if event is InputEventKey:
		var key := event as InputEventKey
		if key.pressed and not key.echo and key.keycode == KEY_ESCAPE:
			_on_back_pressed()


func _build_sample_environment() -> void:
	var synthetic_snapshot := {
		"map": {
			"size": {"w": SAMPLE_MAP_WIDTH, "h": SAMPLE_MAP_HEIGHT},
			"walls": [
				{"x": 0, "y": 0, "w": SAMPLE_MAP_WIDTH, "h": 1},
			],
			"coverClusters": [
				{"x": 15, "y": 6, "w": 2, "h": 1},
			],
			"evac": {
				"zone": {"x": -50, "y": -50, "w": 1, "h": 1},
			},
			"airdrops": [],
		},
	}
	scene_builder.build_from_snapshot(synthetic_snapshot)


func _apply_model_review_render_profile() -> void:
	RenderingServer.set_default_clear_color(SHOWROOM_REVIEW_CLEAR)
	_apply_review_environment()
	_apply_review_lighting()
	_apply_review_map_materials()


func _apply_review_environment() -> void:
	var world_environment := scene_builder.get_node_or_null("neon-world-environment") as WorldEnvironment
	if world_environment == null:
		world_environment = WorldEnvironment.new()
		world_environment.name = "showroom-review-world-environment"
		add_child(world_environment)
	var env := world_environment.environment
	if env == null:
		env = Environment.new()
		world_environment.environment = env
	env.background_mode = Environment.BG_COLOR
	env.background_color = SHOWROOM_REVIEW_BACKGROUND
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.72, 0.76, 0.78)
	env.ambient_light_energy = 1.26
	env.glow_enabled = true
	env.glow_intensity = 0.58
	env.glow_bloom = 0.18
	env.adjustment_enabled = true
	env.adjustment_brightness = 1.24
	env.adjustment_contrast = 0.90
	env.adjustment_saturation = 1.03


func _apply_review_lighting() -> void:
	var key := scene_builder.get_node_or_null("neon-key-light") as DirectionalLight3D
	if key != null:
		key.light_color = Color(0.86, 0.92, 1.0)
		key.light_energy = 3.15
		key.shadow_enabled = false
		key.rotation_degrees = Vector3(-46.0, -34.0, 0.0)
	var old_rim := scene_builder.get_node_or_null("crimson-rim-light") as OmniLight3D
	if old_rim != null:
		old_rim.light_color = Color(1.0, 0.18, 0.12)
		old_rim.light_energy = 0.95
		old_rim.omni_range = 9.0
		old_rim.shadow_enabled = false
		old_rim.position = Vector3(-2.6, 2.2, -2.4)
	_ensure_review_omni_light("showroom-softbox-left", Vector3(-2.8, 2.6, -3.4), Color(0.82, 0.91, 1.0), 2.6, 8.0)
	_ensure_review_omni_light("showroom-softbox-right", Vector3(2.8, 1.8, -2.0), Color(0.78, 0.84, 0.88), 1.65, 7.0)
	_ensure_review_omni_light("showroom-warm-low-fill", Vector3(0.0, 0.85, 2.4), Color(1.0, 0.68, 0.44), 0.72, 5.5)
	_ensure_review_reflection_probe()


func _ensure_review_omni_light(light_name: String, light_position: Vector3, light_color: Color, energy: float, light_range: float) -> void:
	var light := get_node_or_null(light_name) as OmniLight3D
	if light == null:
		light = OmniLight3D.new()
		light.name = light_name
		add_child(light)
	light.position = light_position
	light.light_color = light_color
	light.light_energy = energy
	light.omni_range = light_range
	light.shadow_enabled = false


func _ensure_review_reflection_probe() -> void:
	var probe := get_node_or_null("showroom-review-reflection-probe") as ReflectionProbe
	if probe == null:
		probe = ReflectionProbe.new()
		probe.name = "showroom-review-reflection-probe"
		add_child(probe)
	probe.position = Vector3(0.0, 1.05, 0.0)
	probe.size = Vector3(7.0, 4.0, 7.0)
	probe.intensity = 1.24


func _apply_review_map_materials() -> void:
	var map_root := scene_builder.get_node_or_null("map_geometry_root")
	if map_root == null:
		return
	var floor_mat := _review_surface_material("showroom-review-floor", SHOWROOM_REVIEW_FLOOR, 0.0, 0.72)
	var wall_mat := _review_surface_material("showroom-review-wall", SHOWROOM_REVIEW_WALL, 0.0, 0.66)
	var cover_mat := _review_surface_material("showroom-review-cover", SHOWROOM_REVIEW_COVER, 0.0, 0.70)
	_apply_review_map_materials_recursive(map_root, floor_mat, wall_mat, cover_mat)


func _apply_review_map_materials_recursive(node: Node, floor_mat: Material, wall_mat: Material, cover_mat: Material) -> void:
	if node is MeshInstance3D:
		var mesh_node := node as MeshInstance3D
		var node_name := str(mesh_node.name)
		if node_name == "floor":
			mesh_node.material_override = floor_mat
		elif node_name.begins_with("wall-"):
			mesh_node.material_override = wall_mat
			mesh_node.visible = false
		elif node_name.begins_with("cover-"):
			mesh_node.material_override = cover_mat
	for child in node.get_children():
		_apply_review_map_materials_recursive(child, floor_mat, wall_mat, cover_mat)


func _review_surface_material(material_name: String, albedo: Color, metallic: float, roughness: float) -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	mat.resource_name = material_name
	mat.albedo_color = albedo
	mat.metallic = metallic
	mat.roughness = roughness
	mat.emission_enabled = false
	return mat


func _spawn_persona_row() -> void:
	if SHOW_EXPERIMENT_PERSONA_VARIANTS:
		_spawn_experiment_persona_variant_row()
		return
	if not SHOW_MANIFEST_PERSONAS:
		_spawn_standalone_model_row()
		return
	var total_stations := PERSONAS.size() + 1
	active_station_count = total_stations
	var prototype_index := int(floor(float(total_stations) * 0.5))
	var offset := float(total_stations - 1) * STATION_SPACING * 0.5
	var persona_index := 0
	for i in range(total_stations):
		if i == prototype_index:
			var prototype_station := Node3D.new()
			prototype_station.name = "Station_glitch_reaper_prototype"
			prototype_station.position = Vector3(float(i) * STATION_SPACING - offset, 0.0, 0.0)
			persona_stations.add_child(prototype_station)
			_spawn_standalone_model_station(prototype_station, STANDALONE_SHOWROOM_MODELS[0] as Dictionary)
			continue
		var persona := str(PERSONAS[persona_index])
		persona_index += 1
		var station := Node3D.new()
		station.name = "Station_%s" % persona
		station.position = Vector3(float(i) * STATION_SPACING - offset, 0.0, 0.0)
		persona_stations.add_child(station)
		_spawn_persona_station(station, persona)


func _spawn_standalone_model_row() -> void:
	standalone_animation_players.clear()
	standalone_clip_labels.clear()
	standalone_current_clips.clear()
	glitch_reaper_phase_time = 0.0
	glitch_reaper_phase_nodes.clear()
	experiment_skin_flicker_time = 0.0
	experiment_skin_flicker_materials.clear()
	experiment_embedded_decoration_time = 0.0
	experiment_embedded_decoration_nodes.clear()
	var total_stations := STANDALONE_SHOWROOM_MODELS.size()
	active_station_count = total_stations
	var offset := float(total_stations - 1) * STATION_SPACING * 0.5
	for i in range(total_stations):
		var config := STANDALONE_SHOWROOM_MODELS[i] as Dictionary
		var model_id := str(config.get("id", "model_%d" % i))
		var station := Node3D.new()
		station.name = "Station_%s" % model_id
		station.position = Vector3(float(i) * STATION_SPACING - offset, 0.0, 0.0)
		persona_stations.add_child(station)
		_spawn_standalone_model_station(station, config)


func _spawn_experiment_persona_variant_row() -> void:
	standalone_animation_players.clear()
	standalone_clip_labels.clear()
	standalone_current_clips.clear()
	glitch_reaper_phase_time = 0.0
	glitch_reaper_phase_nodes.clear()
	experiment_skin_flicker_time = 0.0
	experiment_skin_flicker_materials.clear()
	experiment_embedded_decoration_time = 0.0
	experiment_embedded_decoration_nodes.clear()
	active_station_count = PERSONAS.size()
	var offset := float(active_station_count - 1) * STATION_SPACING * 0.5
	for i in range(PERSONAS.size()):
		var persona := str(PERSONAS[i])
		var station := Node3D.new()
		station.name = "Station_experiment_%s" % persona
		station.position = Vector3(float(i) * STATION_SPACING - offset, 0.0, 0.0)
		persona_stations.add_child(station)
		var config := {
			"id": "experiment_%s" % persona,
			"label": persona,
			"source": "seeded experiment",
			"path": EXPERIMENT_MODEL_PATH,
			"variant_id": persona,
			"phase_driver": false,
			"register_equipment": true,
			"scale": GLITCH_REAPER_PROTOTYPE_SCALE,
			"show_source_label": false,
			"show_clip_label": false,
			"name_label_height": 2.04,
			"clip_label_height": 1.82,
		}
		_spawn_standalone_model_station(station, config)


func _spawn_persona_station(station: Node3D, persona: String) -> void:
	var showroom_id := _showroom_id(persona)
	var character: Node3D = equipment_attachment.instantiate_persona_character(
		persona,
		"showroom-character-%s" % persona,
		fallback_material,
		EntityRendererScript.CHARACTER_MODEL_SCALE
	)
	station.add_child(character)
	equipment_attachment.register_character(showroom_id, character, persona)
	var source_key := _source_key_for_persona(persona)
	var name_label := _make_label("NameLabel", "%s\n%s" % [persona, source_key], Vector3(0.0, PERSONA_NAME_LABEL_HEIGHT, 0.0), 0.0048, 18)
	station.add_child(name_label)
	var clip_label := _make_label("ClipLabel", "(idle/none)", Vector3(0.0, PERSONA_CLIP_LABEL_HEIGHT, 0.0), 0.0040, 12)
	station.add_child(clip_label)
	clip_labels[showroom_id] = clip_label


func _spawn_standalone_model_station(station: Node3D, config: Dictionary) -> void:
	var model_id := str(config.get("id", station.name))
	var display_label := str(config.get("label", model_id))
	var source_label := str(config.get("source", "standalone_glb"))
	var model_path := str(config.get("path", ""))
	var scene = load(model_path)
	if scene is PackedScene:
		var instance = (scene as PackedScene).instantiate()
		if instance is Node3D:
			var visual := instance as Node3D
			visual.name = "visual"
			visual.scale = Vector3.ONE * float(config.get("scale", GLITCH_REAPER_PROTOTYPE_SCALE))
			_apply_standalone_material_review_lift(visual, model_id)
			station.add_child(visual)
			var variant_id := str(config.get("variant_id", ""))
			if not variant_id.is_empty():
				_apply_experiment_seeded_variant(visual, variant_id)
			if bool(config.get("register_equipment", false)) and not variant_id.is_empty():
				_register_experiment_variant_equipment(station, visual, variant_id)
			standalone_animation_players[model_id] = _standalone_character_animation_player(visual)
			if bool(config.get("phase_driver", false)):
				_configure_glitch_reaper_phase_driver(visual)
	else:
		push_warning("Standalone showroom asset did not load: %s" % model_path)
	var show_source_label := bool(config.get("show_source_label", true))
	var name_label_text := display_label
	if show_source_label and not source_label.is_empty():
		name_label_text = "%s\n%s" % [display_label, source_label]
	var name_label_height := float(config.get("name_label_height", GLITCH_REAPER_NAME_LABEL_HEIGHT))
	var clip_label_height := float(config.get("clip_label_height", GLITCH_REAPER_CLIP_LABEL_HEIGHT))
	var name_label := _make_label("NameLabel", name_label_text, Vector3(0.0, name_label_height, 0.0), 0.0048, 18)
	station.add_child(name_label)
	var clip_label := _make_label("ClipLabel", "(idle/none)", Vector3(0.0, clip_label_height, 0.0), 0.0040, 12)
	clip_label.visible = bool(config.get("show_clip_label", true))
	station.add_child(clip_label)
	standalone_clip_labels[model_id] = clip_label
	standalone_current_clips[model_id] = "(idle/none)"


func _register_experiment_variant_equipment(station: Node3D, visual: Node3D, variant_id: String) -> void:
	if equipment_attachment == null or not equipment_attachment.has_method("register_external_character"):
		push_warning("EquipmentMeshAttachment lacks external registration; experiment equipment disabled for %s" % variant_id)
		return
	var asset_override := _experiment_equipment_asset_for_variant(variant_id)
	equipment_attachment.call("register_external_character", _showroom_id(variant_id), station, variant_id, visual, asset_override)


func _experiment_equipment_asset_for_variant(variant_id: String) -> Dictionary:
	return {
		"attachBone": "hand_r",
		"animation": {},
		"armorOverlay": {},
	}


func _make_label(label_name: String, label_text: String, label_position: Vector3, pixel_size: float, font_size: int) -> Label3D:
	var label := Label3D.new()
	label.name = label_name
	label.text = label_text
	label.position = label_position
	label.pixel_size = pixel_size
	label.font_size = font_size
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.no_depth_test = true
	label.outline_size = 6
	label.modulate = Color(0.88, 0.98, 1.0, 1.0)
	return label


func _configure_camera() -> void:
	camera_rig.lock_free_mode = true
	camera_rig.mode = camera_rig.MODE_FREE
	camera_rig.configure({"characters": []}, null, scene_builder, null)
	camera_rig.lock_free_mode = true
	camera_rig.mode = camera_rig.MODE_FREE
	var row_width: float = maxf(1.0, float(maxi(active_station_count - 1, 1)) * STATION_SPACING)
	var review_radius: float = maxf(4.55, row_width * 0.86)
	camera_rig.yaw = 0.0
	camera_rig.pitch = -0.34
	camera_rig.director_radius = review_radius
	camera_rig.radius = review_radius
	camera_rig.free_anchor = Vector3(0.0, 0.86, -0.02)
	camera_rig.smooth_anchor = camera_rig.free_anchor


func _make_ui() -> void:
	var panel := PanelContainer.new()
	panel.name = "ShowroomPanel"
	panel.position = Vector2(16, 14)
	panel.custom_minimum_size = Vector2(1030, 218)
	var panel_style := StyleBoxFlat.new()
	panel_style.bg_color = Color(0.34, 0.34, 0.34, 1.0)
	panel_style.corner_radius_top_left = 3
	panel_style.corner_radius_top_right = 3
	panel_style.corner_radius_bottom_left = 3
	panel_style.corner_radius_bottom_right = 3
	panel.add_theme_stylebox_override("panel", panel_style)
	ui.add_child(panel)
	var root := VBoxContainer.new()
	root.add_theme_constant_override("separation", 8)
	panel.add_child(root)
	var header := HBoxContainer.new()
	header.add_theme_constant_override("separation", 10)
	root.add_child(header)
	var back_button := Button.new()
	back_button.name = "BackButton"
	back_button.text = "Back"
	back_button.pressed.connect(_on_back_pressed)
	header.add_child(back_button)
	var title := Label.new()
	title.name = "TitleLabel"
	title.text = "Showroom - Round 11"
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title.add_theme_font_size_override("font_size", 18)
	header.add_child(title)
	var animation_bar := HBoxContainer.new()
	animation_bar.name = "AnimationTriggerBar"
	animation_bar.add_theme_constant_override("separation", 6)
	root.add_child(animation_bar)
	for config in [
		{"label": "Idle", "kind": "idle"},
		{"label": "Walk", "kind": "walk"},
		{"label": "Attack (unarmed)", "kind": "attack_unarmed"},
		{"label": "Attack (armed)", "kind": "attack_armed"},
		{"label": "Loot", "kind": "loot"},
		{"label": "Take hit", "kind": "take_hit"},
		{"label": "Death", "kind": "death"},
	]:
		var button := Button.new()
		button.text = str(config.get("label", ""))
		button.pressed.connect(_trigger_animation.bind(str(config.get("kind", ""))))
		animation_bar.add_child(button)
	var layers_bar := HBoxContainer.new()
	layers_bar.name = "AdherenceLayersBar"
	layers_bar.add_theme_constant_override("separation", 8)
	root.add_child(layers_bar)
	var layers_label := Label.new()
	layers_label.text = "Adherence Layers:"
	layers_label.custom_minimum_size = Vector2(132, 0)
	layers_bar.add_child(layers_label)
	_make_layer_toggle(layers_bar, "Skin", LAYER_SKIN)
	_make_layer_toggle(layers_bar, "Gore", LAYER_GORE)
	_make_layer_toggle(layers_bar, "Weapons", LAYER_WEAPONS)
	_make_layer_toggle(layers_bar, "Armour", LAYER_ARMOUR)
	_make_cover_toggle(layers_bar)
	var tier_box := VBoxContainer.new()
	tier_box.name = "EquipmentTierBar"
	tier_box.add_theme_constant_override("separation", 4)
	root.add_child(tier_box)
	_make_tier_row(tier_box, "Weapon", "weapon")
	_make_weapon_asset_row(tier_box)
	_make_tier_row(tier_box, "Armour", "armour")
	_make_armour_asset_row(tier_box)


func _make_layer_toggle(parent: Node, label_text: String, layer: String) -> void:
	var button := CheckButton.new()
	button.name = "%sLayerToggle" % label_text
	button.text = label_text
	button.button_pressed = bool(layer_enabled.get(layer, true))
	button.toggled.connect(_set_layer_enabled.bind(layer))
	parent.add_child(button)


func _make_cover_toggle(parent: Node) -> void:
	var button := CheckButton.new()
	button.name = "CoverToggle"
	button.text = "Cover"
	button.button_pressed = cover_visible
	button.toggled.connect(_set_cover_visible)
	parent.add_child(button)


func _make_tier_row(parent: Node, label_text: String, slot: String) -> void:
	var row := HBoxContainer.new()
	row.name = "%sTierBar" % label_text
	row.add_theme_constant_override("separation", 6)
	parent.add_child(row)
	var label := Label.new()
	label.text = "%s:" % label_text
	label.custom_minimum_size = Vector2(70, 0)
	row.add_child(label)
	for tier_config in [
		{"label": "None", "tier": 0},
		{"label": "Low", "tier": 1},
		{"label": "Mid", "tier": 2},
		{"label": "High", "tier": 3},
	]:
		var tier := int(tier_config.get("tier", 0))
		var button := Button.new()
		button.text = str(tier_config.get("label", ""))
		button.toggle_mode = true
		button.button_pressed = tier == _current_tier_for_slot(slot)
		button.disabled = tier != 0 and _asset_for_slot_tier(slot, tier).is_empty()
		button.pressed.connect(_set_equipment_tier.bind(slot, tier))
		row.add_child(button)
		selected_tier_buttons["%s:%d" % [slot, tier]] = button


func _make_weapon_asset_row(parent: Node) -> void:
	var row := HBoxContainer.new()
	row.name = "WeaponAssetBar"
	row.add_theme_constant_override("separation", 6)
	parent.add_child(row)
	var label := Label.new()
	label.text = "Weapon Asset:"
	label.custom_minimum_size = Vector2(104, 0)
	row.add_child(label)
	weapon_asset_selector = OptionButton.new()
	weapon_asset_selector.name = "WeaponAssetSelector"
	weapon_asset_selector.custom_minimum_size = Vector2(360, 0)
	for i in range(weapon_asset_options.size()):
		var option := weapon_asset_options[i] as Dictionary
		var option_label := str(option.get("label", ""))
		var weapon_name := str(option.get("name", ""))
		weapon_asset_selector.add_item(option_label, i)
		weapon_asset_selector.set_item_metadata(i, weapon_name)
		if weapon_name == current_weapon_selection:
			weapon_asset_selector.select(i)
	weapon_asset_selector.item_selected.connect(_set_weapon_asset_selection)
	row.add_child(weapon_asset_selector)


func _make_armour_asset_row(parent: Node) -> void:
	var row := HBoxContainer.new()
	row.name = "ArmourAssetBar"
	row.add_theme_constant_override("separation", 6)
	parent.add_child(row)
	var label := Label.new()
	label.text = "Armour Asset:"
	label.custom_minimum_size = Vector2(104, 0)
	row.add_child(label)
	armour_asset_selector = OptionButton.new()
	armour_asset_selector.name = "ArmourAssetSelector"
	armour_asset_selector.custom_minimum_size = Vector2(360, 0)
	for i in range(armour_prop_options.size()):
		var option := armour_prop_options[i] as Dictionary
		var option_label := str(option.get("label", ""))
		var prop_id := str(option.get("id", ARMOUR_PROP_ALL))
		armour_asset_selector.add_item(option_label, i)
		armour_asset_selector.set_item_metadata(i, prop_id)
		if prop_id == current_armour_prop_selection:
			armour_asset_selector.select(i)
	armour_asset_selector.item_selected.connect(_set_armour_prop_selection)
	row.add_child(armour_asset_selector)


func _trigger_animation(kind: String) -> void:
	for persona in _visible_personas():
		var showroom_id := _showroom_id(str(persona))
		equipment_attachment.play_character_animation(showroom_id, kind)
	_play_standalone_model_animation(kind)
	_update_clip_labels()


func _set_equipment_tier(slot: String, tier: int) -> void:
	if slot == "weapon":
		current_weapon_tier = tier
		if tier > 0:
			_select_weapon_name(str(weapon_by_tier.get(tier, current_weapon_selection)))
	else:
		current_armour_tier = tier
	_update_tier_buttons(slot, tier)
	_reapply_showroom_layers()


func _set_layer_enabled(enabled: bool, layer: String) -> void:
	if bool(layer_enabled.get(layer, true)) == enabled:
		return
	layer_enabled[layer] = enabled
	_reapply_showroom_layers()


func _set_cover_visible(enabled: bool) -> void:
	if cover_visible == enabled:
		return
	cover_visible = enabled
	_apply_cover_visibility()


func _set_weapon_asset_selection(index: int) -> void:
	if weapon_asset_selector == null:
		return
	if index < 0 or index >= weapon_asset_selector.get_item_count():
		return
	var weapon_name := str(weapon_asset_selector.get_item_metadata(index))
	_select_weapon_name(weapon_name)
	var assets = equipment_attachment.get("weapon_assets_by_name")
	if typeof(assets) == TYPE_DICTIONARY and (assets as Dictionary).has(weapon_name):
		var asset = (assets as Dictionary).get(weapon_name, {})
		if typeof(asset) == TYPE_DICTIONARY:
			current_weapon_tier = max(1, int((asset as Dictionary).get("tier", current_weapon_tier)))
			_update_tier_buttons("weapon", current_weapon_tier)
	_reapply_showroom_layers()


func _set_armour_prop_selection(index: int) -> void:
	if armour_asset_selector == null:
		return
	if index < 0 or index >= armour_asset_selector.get_item_count():
		return
	var prop_id := str(armour_asset_selector.get_item_metadata(index))
	if prop_id.is_empty():
		prop_id = ARMOUR_PROP_ALL
	if current_armour_prop_selection == prop_id:
		return
	current_armour_prop_selection = prop_id
	current_armour_tier = 0 if current_armour_prop_selection == ARMOUR_PROP_ALL else max(1, current_armour_tier)
	_update_tier_buttons("armour", current_armour_tier)
	if equipment_attachment.has_method("set_armour_prop_selection"):
		equipment_attachment.call("set_armour_prop_selection", current_armour_prop_selection)
	else:
		push_warning("EquipmentMeshAttachment lacks set_armour_prop_selection; armour asset selector cannot apply %s" % current_armour_prop_selection)
	_reapply_showroom_layers()


func _reapply_showroom_layers() -> void:
	_apply_runtime_modes()
	_apply_equipment_layers()
	_apply_surface_layers()


func _apply_runtime_modes() -> void:
	if equipment_attachment.has_method("set_armour_render_mode"):
		equipment_attachment.call("set_armour_render_mode", current_armour_render_mode)
	if equipment_attachment.has_method("set_armour_prop_selection"):
		equipment_attachment.call("set_armour_prop_selection", current_armour_prop_selection)


func _apply_equipment_layers() -> void:
	var weapon_name := current_weapon_selection if _layer_is_enabled(LAYER_WEAPONS) and current_weapon_tier > 0 else ""
	var armour_name := str(armour_by_tier.get(current_armour_tier, "")) if _layer_is_enabled(LAYER_ARMOUR) else ""
	var equipped := {}
	for persona in _equipment_personas():
		equipped[_showroom_id(str(persona))] = {
			"weapon": {"name": weapon_name},
			"armour": {"name": armour_name},
		}
	equipment_attachment.update_equipment(equipped)


func _apply_surface_layers() -> void:
	if SHOW_EXPERIMENT_PERSONA_VARIANTS:
		return
	var armour_tier := _surface_armour_tier()
	for persona in _visible_personas():
		var showroom_id := _showroom_id(str(persona))
		if not _layer_is_enabled(LAYER_GORE):
			equipment_attachment.restore_persona_skin_to_live_character(showroom_id)
		if _layer_is_enabled(LAYER_SKIN):
			equipment_attachment.apply_persona_skin(showroom_id, armour_tier)
		elif equipment_attachment.has_method("apply_neutral_body_material"):
			equipment_attachment.call("apply_neutral_body_material", showroom_id, fallback_material, armour_tier)
		else:
			equipment_attachment.apply_persona_skin(showroom_id, armour_tier)
		if _layer_is_enabled(LAYER_GORE):
			equipment_attachment.apply_corpse_skin_to_live_character(showroom_id)


func _apply_cover_visibility() -> void:
	if scene_builder == null:
		return
	var map_root := scene_builder.get_node_or_null("map_geometry_root")
	if map_root == null:
		return
	_apply_cover_visibility_recursive(map_root)


func _apply_cover_visibility_recursive(node: Node) -> void:
	if node is Node3D and str(node.name).begins_with("cover-"):
		(node as Node3D).visible = cover_visible
	for child in node.get_children():
		_apply_cover_visibility_recursive(child)


func _build_tier_maps() -> void:
	weapon_by_tier = _numeric_tier_map_for_assets("weapon_assets_by_name")
	armour_by_tier = _armour_visual_tier_map()
	current_weapon_tier = 0
	current_armour_tier = 0
	current_weapon_selection = str(weapon_by_tier.get(_default_visible_tier(weapon_by_tier), ""))


func _build_weapon_asset_options() -> void:
	weapon_asset_options = []
	var assets = equipment_attachment.get("weapon_assets_by_name")
	if typeof(assets) != TYPE_DICTIONARY:
		return
	var asset_dict := assets as Dictionary
	var names := []
	for asset_name in asset_dict.keys():
		names.append(str(asset_name))
	names.sort()
	for weapon_name in names:
		var asset = asset_dict.get(weapon_name, {})
		if typeof(asset) != TYPE_DICTIONARY:
			continue
		var tier := int((asset as Dictionary).get("tier", 0))
		var label := "%s (tier %d)" % [str(weapon_name).replace("_", " "), tier]
		weapon_asset_options.append({
			"name": str(weapon_name),
			"label": label,
		})
	if current_weapon_selection.is_empty() and not weapon_asset_options.is_empty():
		current_weapon_selection = str((weapon_asset_options[0] as Dictionary).get("name", ""))


func _build_armour_prop_options() -> void:
	armour_prop_options = [
		{
			"id": ARMOUR_PROP_ALL,
			"label": "None / default",
		},
	]
	var seen := {ARMOUR_PROP_ALL: true}
	var manifest = equipment_attachment.get("manifest")
	if typeof(manifest) != TYPE_DICTIONARY:
		return
	var props = (manifest as Dictionary).get("armourProps", [])
	if typeof(props) != TYPE_ARRAY:
		return
	for prop_value in (props as Array):
		if typeof(prop_value) != TYPE_DICTIONARY:
			continue
		var prop := prop_value as Dictionary
		var prop_id := str(prop.get("id", ""))
		if prop_id.is_empty() or seen.has(prop_id):
			continue
		seen[prop_id] = true
		var prop_name := str(prop.get("name", prop_id))
		var slot := str(prop.get("slot", ""))
		var label := prop_name
		if not slot.is_empty():
			label = "%s (%s)" % [prop_name, slot]
		armour_prop_options.append({
			"id": prop_id,
			"label": label,
		})
	current_armour_prop_selection = ARMOUR_PROP_ALL


func _numeric_tier_map_for_assets(property_name: String) -> Dictionary:
	var out := {0: "", 1: "", 2: "", 3: ""}
	var assets = equipment_attachment.get(property_name)
	if typeof(assets) != TYPE_DICTIONARY:
		return out
	var asset_dict := assets as Dictionary
	for asset_name in asset_dict.keys():
		var asset = asset_dict.get(asset_name, {})
		if typeof(asset) != TYPE_DICTIONARY:
			continue
		var tier := int((asset as Dictionary).get("tier", 0))
		if out.has(tier) and str(out.get(tier, "")).is_empty():
			out[tier] = str(asset_name)
	return out


func _armour_visual_tier_map() -> Dictionary:
	var out := {0: "", 1: "", 2: "", 3: ""}
	var assets = equipment_attachment.get("armour_assets_by_name")
	if typeof(assets) != TYPE_DICTIONARY:
		return out
	var asset_dict := assets as Dictionary
	for asset_name in asset_dict.keys():
		var asset = asset_dict.get(asset_name, {})
		if typeof(asset) != TYPE_DICTIONARY:
			continue
		var tier := _armour_visual_bucket(asset as Dictionary)
		if out.has(tier) and str(out.get(tier, "")).is_empty():
			out[tier] = str(asset_name)
	return out


func _armour_visual_bucket(asset: Dictionary) -> int:
	match str(asset.get("visualTier", "")):
		"low":
			return 1
		"mid":
			return 2
		"high":
			return 3
		_:
			return -1


func _asset_for_slot_tier(slot: String, tier: int) -> String:
	if slot == "weapon":
		return str(weapon_by_tier.get(tier, ""))
	return str(armour_by_tier.get(tier, ""))


func _select_weapon_name(weapon_name: String) -> void:
	if weapon_name.is_empty():
		return
	current_weapon_selection = weapon_name
	if weapon_asset_selector == null:
		return
	for i in range(weapon_asset_selector.get_item_count()):
		if str(weapon_asset_selector.get_item_metadata(i)) == weapon_name:
			weapon_asset_selector.select(i)
			return


func _current_tier_for_slot(slot: String) -> int:
	if slot == "weapon":
		return current_weapon_tier
	return current_armour_tier


func _default_visible_tier(tier_map: Dictionary) -> int:
	for tier in [2, 1, 3]:
		if not str(tier_map.get(tier, "")).is_empty():
			return tier
	return 0


func _surface_armour_tier() -> int:
	return 0


func _layer_is_enabled(layer: String) -> bool:
	return bool(layer_enabled.get(layer, true))


func _update_tier_buttons(slot: String, selected_tier: int) -> void:
	for tier in [0, 1, 2, 3]:
		var key := "%s:%d" % [slot, tier]
		var button := selected_tier_buttons.get(key) as Button
		if button != null:
			button.button_pressed = tier == selected_tier


func _update_clip_labels() -> void:
	for persona in _visible_personas():
		var showroom_id := _showroom_id(str(persona))
		var clip_label := clip_labels.get(showroom_id) as Label3D
		if clip_label == null:
			continue
		var state: Dictionary = equipment_attachment.animation_state_for_character(showroom_id)
		clip_label.text = _clip_label_text(state)
	for model_id_value in standalone_clip_labels.keys():
		var model_id := str(model_id_value)
		var label := standalone_clip_labels.get(model_id) as Label3D
		if label != null:
			label.text = str(standalone_current_clips.get(model_id, "(idle/none)"))


func _clip_label_text(state: Dictionary) -> String:
	var clip := str(state.get("clip", ""))
	if clip.is_empty():
		return "(idle/none)"
	if bool(state.get("is_fallback", false)):
		return "%s* (%s via %s)" % [
			clip,
			str(state.get("requested_kind", "")),
			str(state.get("resolved_kind", "")),
		]
	return clip


func _source_key_for_persona(_persona: String) -> String:
	var manifest = equipment_attachment.get("manifest")
	if typeof(manifest) == TYPE_DICTIONARY:
		var body = (manifest as Dictionary).get("body", {})
		if typeof(body) == TYPE_DICTIONARY:
			return str((body as Dictionary).get("sourceKey", "unknown"))
	return "unknown"


func _showroom_id(persona: String) -> String:
	return "showroom-%s" % persona


func _visible_personas() -> Array:
	return PERSONAS if SHOW_MANIFEST_PERSONAS else []


func _equipment_personas() -> Array:
	if SHOW_EXPERIMENT_PERSONA_VARIANTS:
		return PERSONAS
	return _visible_personas()


func _play_standalone_model_animation(kind: String) -> void:
	for model_id_value in standalone_animation_players.keys():
		var model_id := str(model_id_value)
		var player := standalone_animation_players.get(model_id) as AnimationPlayer
		if player == null:
			standalone_current_clips[model_id] = "(missing %s)" % kind
			continue
		var clip := _first_standalone_model_clip(player, kind)
		if clip.is_empty():
			standalone_current_clips[model_id] = "(missing %s)" % kind
			continue
		player.play(clip)
		standalone_current_clips[model_id] = clip


func _standalone_character_animation_player(root: Node3D) -> AnimationPlayer:
	var direct := root.get_node_or_null("AnimationPlayer") as AnimationPlayer
	if direct != null:
		return direct
	return _largest_clip_count_animation_player(root, null)


func _largest_clip_count_animation_player(node: Node, best: AnimationPlayer) -> AnimationPlayer:
	if node is AnimationPlayer:
		var player := node as AnimationPlayer
		if best == null or player.get_animation_list().size() > best.get_animation_list().size():
			best = player
	for child in node.get_children():
		best = _largest_clip_count_animation_player(child, best)
	return best


func _first_standalone_model_clip(player: AnimationPlayer, kind: String) -> String:
	var candidates = GLITCH_REAPER_CLIP_FALLBACKS.get(kind, GLITCH_REAPER_CLIP_FALLBACKS.get("idle", []))
	for candidate in candidates:
		var clip := str(candidate)
		if player.has_animation(clip):
			return clip
	return ""


func _configure_glitch_reaper_phase_driver(root: Node3D) -> void:
	var before_count := glitch_reaper_phase_nodes.size()
	_collect_glitch_reaper_phase_nodes(root)
	if glitch_reaper_phase_nodes.size() == before_count:
		push_warning("Glitch Reaper phase driver found no phase/cyan nodes under imported GLB.")


func _collect_glitch_reaper_phase_nodes(node: Node) -> void:
	if glitch_reaper_phase_nodes.size() >= GLITCH_REAPER_PHASE_MAX_NODES:
		return
	if node is MeshInstance3D:
		var mesh_node := node as MeshInstance3D
		if _is_glitch_reaper_phase_node(mesh_node.name):
			var index := glitch_reaper_phase_nodes.size()
			var name_lower := mesh_node.name.to_lower()
			var human_phase := name_lower.contains("_phase_human_") or name_lower.contains("phase_skin")
			var cyan_phase := name_lower.contains("cyan") or name_lower.contains("data_tear") or name_lower.contains("scanline")
			var base_visible := mesh_node.visible
			var sideways := -1.0 if index % 2 == 0 else 1.0
			var vertical := -0.5 + float(index % 5) * 0.25
			var depth := -1.0 if index % 4 < 2 else 1.0
			var offset_scale := 0.006 if human_phase else 0.010
			if cyan_phase:
				offset_scale = 0.014
			glitch_reaper_phase_nodes.append({
				"node": mesh_node,
				"position": mesh_node.position,
				"scale": mesh_node.scale,
				"visible": base_visible,
				"phase": float(index) * 0.73,
				"offset": Vector3(sideways * offset_scale, vertical * offset_scale * 0.55, depth * offset_scale * 0.70),
				"human": human_phase,
				"cyan": cyan_phase,
			})
	for child in node.get_children():
		_collect_glitch_reaper_phase_nodes(child)


func _is_glitch_reaper_phase_node(node_name: String) -> bool:
	var name_lower := node_name.to_lower()
	for marker in GLITCH_REAPER_PHASE_MARKERS:
		if name_lower.contains(str(marker)):
			return true
	return false


func _tick_glitch_reaper_phase_driver(delta: float) -> void:
	if glitch_reaper_phase_nodes.is_empty():
		return
	glitch_reaper_phase_time += delta
	for state in glitch_reaper_phase_nodes:
		var node := state.get("node") as Node3D
		if node == null:
			continue
		var base_visible := bool(state.get("visible", true))
		var base_position: Vector3 = state.get("position", Vector3.ZERO)
		var base_scale: Vector3 = state.get("scale", Vector3.ONE)
		var offset: Vector3 = state.get("offset", Vector3.ZERO)
		var phase := float(state.get("phase", 0.0))
		var human_phase := bool(state.get("human", false))
		var cyan_phase := bool(state.get("cyan", false))
		var slow_gate := sin(glitch_reaper_phase_time * (2.35 if human_phase else 3.80) + phase)
		var stutter := sin(glitch_reaper_phase_time * (18.0 if human_phase else 28.0) + phase * 1.91)
		var snap := sin(glitch_reaper_phase_time * 43.0 + phase * 0.63)
		var visible_now := base_visible and (slow_gate > (-0.18 if human_phase else -0.54))
		if snap > 0.78:
			visible_now = not visible_now
		node.visible = visible_now
		var pulse: float = max(0.0, stutter) * (0.18 if human_phase else 0.32)
		var collapse: float = 0.22 if human_phase else 0.48
		var scale_amount: float = (1.0 + pulse) if visible_now else collapse
		if cyan_phase and snap > 0.52:
			scale_amount += 0.20
		var jump_amount: float = abs(slow_gate) + max(0.0, snap) * 0.65
		node.position = base_position + offset * jump_amount
		node.scale = base_scale * scale_amount


func _tick_experiment_skin_flicker(delta: float) -> void:
	if experiment_skin_flicker_materials.is_empty():
		return
	experiment_skin_flicker_time += delta
	for state in experiment_skin_flicker_materials:
		var material := state.get("material") as StandardMaterial3D
		if material == null:
			continue
		var base_color: Color = state.get("color", material.albedo_color)
		var phase := float(state.get("phase", 0.0))
		var min_alpha := float(state.get("min_alpha", 0.72))
		var period := float(state.get("period", 36.0))
		var duration := float(state.get("duration", 1.4))
		var micro_frequency := float(state.get("micro_frequency", 16.0))
		var flicker_depth := float(state.get("depth", 1.0))
		var burst_count := int(state.get("burst_count", 1))
		var burst_gap := float(state.get("burst_gap", 0.34))
		var burst_short_duration := float(state.get("burst_short_duration", 0.18))
		var local_time := fposmod(experiment_skin_flicker_time + phase, period)
		var burst_effect := 0.0
		var alpha := 1.0
		if local_time < duration:
			var progress := clampf(local_time / maxf(duration, 0.001), 0.0, 1.0)
			var envelope := sin(progress * PI)
			var micro_gate := maxf(0.0, sin(experiment_skin_flicker_time * micro_frequency + phase * 0.41))
			burst_effect = maxf(burst_effect, (0.26 + envelope * 0.66 + micro_gate * 0.08) * flicker_depth)
		for burst_index in range(burst_count):
			var burst_start := duration + burst_gap * float(burst_index + 1)
			var burst_time := local_time - burst_start
			if burst_time < 0.0 or burst_time > burst_short_duration:
				continue
			var burst_progress := clampf(burst_time / maxf(burst_short_duration, 0.001), 0.0, 1.0)
			var burst_envelope := sin(burst_progress * PI)
			var burst_micro := maxf(0.0, sin(experiment_skin_flicker_time * (micro_frequency * 1.85) + phase * 0.73))
			burst_effect = maxf(burst_effect, (0.42 + burst_envelope * 0.50 + burst_micro * 0.08) * flicker_depth)
		if burst_effect > 0.0:
			alpha = lerpf(1.0, min_alpha, clampf(burst_effect, 0.0, 1.0))
		base_color.a = alpha
		material.albedo_color = base_color
		if alpha < 0.985:
			material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
			material.cull_mode = BaseMaterial3D.CULL_DISABLED
		else:
			material.transparency = BaseMaterial3D.TRANSPARENCY_DISABLED
			material.cull_mode = BaseMaterial3D.CULL_BACK


func _register_experiment_skin_flicker_material(material: StandardMaterial3D, config: Dictionary, key: String) -> void:
	var skin_flicker := _material_key_uses_skin_flicker(key)
	var gore_flicker := _material_key_uses_gore_flicker(key)
	if not skin_flicker and not gore_flicker:
		return
	var base_color := material.albedo_color
	base_color.a = 1.0
	material.albedo_color = base_color
	material.transparency = BaseMaterial3D.TRANSPARENCY_DISABLED
	material.cull_mode = BaseMaterial3D.CULL_BACK
	var seed := int(config.get("seed", 0))
	var phase_hash := _stable_string_hash("%s:%s" % [str(config.get("id", "variant")), key])
	var phase := float((seed ^ phase_hash) & 0x7fffffff) * 0.00037
	var period := 34.0 + float((phase_hash >> 5) & 1023) / 1023.0 * 24.0
	var duration := 1.15 + float((phase_hash >> 17) & 255) / 255.0 * 0.75
	var micro_frequency := 16.0
	var flicker_depth := 1.0
	var burst_count := 1 + int(abs(phase_hash >> 27) % 3)
	var burst_gap := 0.30 + float((phase_hash >> 9) & 127) / 127.0 * 0.26
	var burst_short_duration := 0.13 + float((phase_hash >> 21) & 127) / 127.0 * 0.14
	var min_alpha := 0.70
	if gore_flicker:
		phase += 19.0 + float((phase_hash >> 11) & 255) / 255.0 * 17.0
		period = 46.0 + float((phase_hash >> 3) & 1023) / 1023.0 * 36.0
		duration = 2.15 + float((phase_hash >> 19) & 255) / 255.0 * 1.15
		micro_frequency = 7.5 + float((phase_hash >> 23) & 127) / 127.0 * 4.5
		flicker_depth = 0.82
		burst_gap *= 1.35
		burst_short_duration *= 1.22
		min_alpha = 0.66
		if key.contains("blood") or key.contains("clotted"):
			min_alpha = 0.58
		elif key.contains("tendon"):
			min_alpha = 0.72
	elif key.contains("phase") or key.contains("transient"):
		min_alpha = 0.54
		period *= 0.82
		duration *= 1.12
	elif key.contains("body_burnished") or key.contains("gunmetal"):
		min_alpha = 0.78
	experiment_skin_flicker_materials.append({
		"material": material,
		"color": base_color,
		"phase": phase,
		"period": period,
		"duration": duration,
		"micro_frequency": micro_frequency,
		"depth": flicker_depth,
		"burst_count": burst_count,
		"burst_gap": burst_gap,
		"burst_short_duration": burst_short_duration,
		"min_alpha": min_alpha,
	})


func _stable_string_hash(text: String) -> int:
	var hash := 2166136261
	for i in range(text.length()):
		hash = int((hash ^ text.unicode_at(i)) & 0xffffffff)
		hash = int((hash * 16777619) & 0xffffffff)
	return hash


func _first_descendant_of_class(node: Node, target_class: String) -> Node:
	if node == null:
		return null
	if node.is_class(target_class):
		return node
	for child in node.get_children():
		var found := _first_descendant_of_class(child, target_class)
		if found != null:
			return found
	return null


func _apply_standalone_material_review_lift(node: Node, model_id: String = "") -> void:
	if node is MeshInstance3D:
		_apply_mesh_material_review_lift(node as MeshInstance3D, model_id)
	for child in node.get_children():
		_apply_standalone_material_review_lift(child, model_id)


func _apply_mesh_material_review_lift(mesh_node: MeshInstance3D, model_id: String) -> void:
	var mesh := mesh_node.mesh
	if mesh == null:
		return
	for surface_index in range(mesh.get_surface_count()):
		var source_material := mesh_node.get_surface_override_material(surface_index)
		if source_material == null:
			source_material = mesh.surface_get_material(surface_index)
		if source_material == null:
			continue
		var source_name := str(source_material.resource_name)
		if source_name.is_empty() and mesh.has_method("surface_get_name"):
			source_name = str(mesh.call("surface_get_name", surface_index))
		if source_name.is_empty():
			source_name = source_material.resource_path.get_file()
		var lifted := StandardMaterial3D.new()
		lifted.resource_name = "%s_showroom_review" % source_name
		if source_material is BaseMaterial3D:
			var source_base := source_material as BaseMaterial3D
			lifted.albedo_color = source_base.albedo_color
			lifted.metallic = source_base.metallic
			lifted.roughness = source_base.roughness
			lifted.emission_enabled = source_base.emission_enabled
			lifted.emission = source_base.emission
			lifted.emission_energy_multiplier = source_base.emission_energy_multiplier
		_lift_base_material_for_review(lifted, source_name, model_id)
		mesh_node.set_surface_override_material(surface_index, lifted)


func _lift_base_material_for_review(material: BaseMaterial3D, source_name: String, model_id: String) -> void:
	var palette := _review_palette_for_material(source_name, model_id)
	if not palette.is_empty():
		material.albedo_texture = null
		material.albedo_color = palette.get("albedo", material.albedo_color)
		material.metallic = float(palette.get("metallic", material.metallic))
		material.roughness = float(palette.get("roughness", material.roughness))
		if palette.has("emission"):
			material.emission_enabled = true
			material.emission = palette.get("emission", Color.BLACK)
			material.emission_energy_multiplier = float(palette.get("emission_energy", 0.0))
		return
	if model_id.to_lower() == "experiment":
		material.albedo_texture = null
		material.albedo_color = _lifted_experiment_review_color(material.albedo_color)
		material.metallic = clamp(material.metallic * 0.42, 0.0, 0.28)
		material.roughness = clamp(material.roughness * 0.72, 0.18, 0.56)
		if material.emission_enabled:
			material.emission = _lifted_review_emission(material.emission)
			material.emission_energy_multiplier = clamp(material.emission_energy_multiplier * 1.14, 0.0, 1.8)
		return
	material.albedo_color = _lifted_review_color(material.albedo_color)
	material.metallic = clamp(material.metallic * 0.58, 0.0, 0.62)
	material.roughness = clamp(material.roughness * 0.88, 0.20, 0.74)
	if material.emission_enabled:
		material.emission = _lifted_review_emission(material.emission)
		material.emission_energy_multiplier = clamp(material.emission_energy_multiplier * 1.18, 0.0, 2.4)


func _lifted_review_color(color: Color) -> Color:
	return Color(
		clamp(max(color.r * 1.55 + 0.085, 0.13), 0.0, 1.0),
		clamp(max(color.g * 1.55 + 0.085, 0.13), 0.0, 1.0),
		clamp(max(color.b * 1.55 + 0.085, 0.13), 0.0, 1.0),
		color.a
	)


func _lifted_experiment_review_color(color: Color) -> Color:
	return Color(
		clamp(max(color.r * 1.45 + 0.055, 0.075), 0.0, 1.0),
		clamp(max(color.g * 1.36 + 0.048, 0.070), 0.0, 1.0),
		clamp(max(color.b * 1.30 + 0.044, 0.065), 0.0, 1.0),
		color.a
	)


func _lifted_review_emission(color: Color) -> Color:
	return Color(
		clamp(color.r * 1.18, 0.0, 1.0),
		clamp(color.g * 1.18, 0.0, 1.0),
		clamp(color.b * 1.18, 0.0, 1.0),
		color.a
	)


func _review_palette_for_material(source_name: String, model_id: String = "") -> Dictionary:
	var key := source_name.to_lower()
	var model_key := model_id.to_lower()
	if model_key == "glitch_reaper":
		if key.contains("blackened_metal"):
			return _review_palette(Color(0.040, 0.045, 0.055, 1.0), 0.60, 0.42)
		if key.contains("body_burnished_gunmetal") or key.contains("dark_gunmetal") or key.contains("gunmetal"):
			return _review_palette(Color(0.085, 0.098, 0.118, 1.0), 0.66, 0.34)
	if model_key == "experiment":
		if key.contains("body_burnished_gunmetal") or key.contains("gunmetal"):
			return _review_palette(Color(0.118, 0.126, 0.122, 1.0), 0.72, 0.36)
		if key.contains("body_deep_joint") or key.contains("deep_joint"):
			return _review_palette(Color(0.050, 0.058, 0.062, 1.0), 0.18, 0.48)
		if key.contains("head_pallid"):
			return _review_palette(Color(0.46, 0.405, 0.340, 1.0), 0.0, 0.62)
		if key.contains("phase_skin") or key.contains("transient_human"):
			return _review_palette(Color(0.245, 0.170, 0.130, 1.0), 0.0, 0.58)
		if key.contains("cyan") or key.contains("green") or key.contains("fissure"):
			return _review_palette(Color(0.006, 0.046, 0.032, 1.0), 0.0, 0.30, Color(0.0, 0.22, 0.12), 0.18)
		if key.contains("necron_oxidized_cybermetal") or key.contains("cybermetal"):
			return _review_palette(Color(0.105, 0.112, 0.110, 1.0), 0.76, 0.34)
		if key.contains("burnished_cut_metal") or key.contains("cut_metal") or key.contains("raw_metal") or key.contains("scraped"):
			return _review_palette(Color(0.42, 0.410, 0.365, 1.0), 0.72, 0.30)
	if key.contains("head_pallid"):
		return _review_palette(Color(0.70, 0.78, 0.76, 1.0), 0.0, 0.58)
	if key.contains("phase_skin") or key.contains("transient_human"):
		return _review_palette(Color(0.46, 0.39, 0.34, 1.0), 0.0, 0.56)
	if key.contains("neck_torn") or key.contains("livid"):
		return _review_palette(Color(0.40, 0.065, 0.050, 1.0), 0.0, 0.40)
	if key.contains("subdermal") or key.contains("gore_flesh"):
		return _review_palette(Color(0.48, 0.070, 0.052, 1.0), 0.0, 0.24)
	if key.contains("clotted") or key.contains("wet_black_blood"):
		return _review_palette(Color(0.22, 0.020, 0.014, 1.0), 0.0, 0.18)
	if key.contains("tendon"):
		return _review_palette(Color(0.38, 0.26, 0.17, 1.0), 0.0, 0.36)
	if key.contains("bone"):
		return _review_palette(Color(0.62, 0.56, 0.42, 1.0), 0.0, 0.68)
	if key.contains("torso_masked"):
		return _review_palette(Color(0.50, 0.160, 0.130, 1.0), 0.12, 0.32)
	if key.contains("burnished_gunmetal") or key.contains("dark_gunmetal") or key.contains("gunmetal"):
		return _review_palette(Color(0.26, 0.33, 0.33, 1.0), 0.40, 0.36)
	if key.contains("deep_joint") or key.contains("dark_cavity") or key.contains("optic_core"):
		return _review_palette(Color(0.060, 0.066, 0.070, 1.0), 0.12, 0.48)
	if key.contains("cut_metal") or key.contains("raw_metal") or key.contains("scraped"):
		return _review_palette(Color(0.46, 0.52, 0.50, 1.0), 0.50, 0.28)
	if key.contains("necron") or key.contains("cybermetal"):
		return _review_palette(Color(0.22, 0.39, 0.37, 1.0), 0.48, 0.30)
	if key.contains("copper") or key.contains("patina"):
		return _review_palette(Color(0.43, 0.22, 0.11, 1.0), 0.34, 0.38)
	if key.contains("cyan") or key.contains("green") or key.contains("fissure"):
		return _review_palette(Color(0.02, 0.42, 0.34, 1.0), 0.0, 0.24, Color(0.00, 0.95, 0.72), 0.75)
	if key.contains("infernal") or key.contains("red_emissive") or key.contains("red_optic"):
		return _review_palette(Color(0.54, 0.030, 0.022, 1.0), 0.0, 0.22, Color(1.0, 0.04, 0.02), 0.95)
	if key.contains("pale_flayed"):
		return _review_palette(Color(0.62, 0.50, 0.42, 1.0), 0.0, 0.48)
	return {}


func _review_palette(albedo: Color, metallic: float, roughness: float, emission := Color.BLACK, emission_energy := 0.0) -> Dictionary:
	var palette := {
		"albedo": albedo,
		"metallic": metallic,
		"roughness": roughness,
	}
	if emission_energy > 0.0:
		palette["emission"] = emission
		palette["emission_energy"] = emission_energy
	return palette


func _apply_experiment_seeded_variant(root: Node, variant_id: String) -> void:
	var config := _experiment_variant_config(variant_id)
	if config.is_empty():
		return
	_apply_experiment_seeded_variant_recursive(root, config)
	_apply_experiment_embedded_decorations(root, config)


func _apply_experiment_seeded_variant_recursive(node: Node, config: Dictionary) -> void:
	if node is MeshInstance3D:
		_apply_experiment_seeded_variant_to_mesh(node as MeshInstance3D, config)
	for child in node.get_children():
		_apply_experiment_seeded_variant_recursive(child, config)


func _apply_experiment_seeded_variant_to_mesh(mesh_node: MeshInstance3D, config: Dictionary) -> void:
	var mesh := mesh_node.mesh
	if mesh == null:
		return
	for surface_index in range(mesh.get_surface_count()):
		var material := mesh_node.get_surface_override_material(surface_index)
		if material == null:
			material = mesh.surface_get_material(surface_index)
		if material is StandardMaterial3D:
			var tuned := (material as StandardMaterial3D).duplicate() as StandardMaterial3D
			_tune_experiment_seeded_material(tuned, config)
			mesh_node.set_surface_override_material(surface_index, tuned)


func _apply_experiment_embedded_decorations(root: Node, config: Dictionary) -> void:
	_clear_experiment_embedded_decorations(root)
	var skeleton := _first_descendant_of_class(root, "Skeleton3D") as Skeleton3D
	if skeleton == null:
		push_warning("Experiment embedded decorations found no skeleton for %s" % str(config.get("id", "")))
		return
	var decorations = config.get("decorations", [])
	if typeof(decorations) != TYPE_ARRAY:
		return
	var index := 0
	for value in (decorations as Array):
		if typeof(value) != TYPE_DICTIONARY:
			continue
		_spawn_experiment_embedded_decoration(skeleton, value as Dictionary, str(config.get("id", "")), index)
		index += 1


func _clear_experiment_embedded_decorations(root: Node) -> void:
	var skeleton := _first_descendant_of_class(root, "Skeleton3D") as Skeleton3D
	if skeleton == null:
		return
	for child in skeleton.get_children():
		if str(child.name).begins_with("embedded_deco_"):
			child.queue_free()


func _spawn_experiment_embedded_decoration(skeleton: Skeleton3D, deco: Dictionary, variant_id: String, index: int) -> void:
	var bone := str(deco.get("bone", ""))
	if bone.is_empty() or skeleton.find_bone(bone) < 0:
		return
	var kind := str(deco.get("kind", "gear"))
	var attachment := BoneAttachment3D.new()
	attachment.name = _experiment_unique_child_name(skeleton, "embedded_deco_%s_%02d_%s" % [variant_id, index, kind])
	attachment.bone_name = bone
	skeleton.add_child(attachment)
	var pivot := Node3D.new()
	pivot.name = "embedded_%s" % kind
	var embedded_sink := clampf(float(deco.get("embeddedSink", 0.044)), 0.0, 0.085)
	pivot.position = _variant_vector3_from_value(deco.get("offset", []), Vector3.ZERO) + Vector3(0.0, 0.0, -embedded_sink)
	pivot.rotation_degrees = _variant_vector3_from_value(deco.get("rotation", []), Vector3.ZERO)
	pivot.scale = Vector3.ONE * clampf(float(deco.get("scale", 1.0)), 0.32, 1.78)
	attachment.add_child(pivot)
	_add_experiment_decoration_socket(pivot, deco)
	if not str(deco.get("assetFile", "")).is_empty() and _add_experiment_decoration_asset(pivot, deco):
		return
	match kind:
		"skull_cog", "gear", "valve_wheel", "saw_blade", "coil", "rusted_hinge":
			_add_experiment_decoration_gear(pivot, deco)
		"cyborg_eye", "processor_chip", "red_status_led", "neural_jack", "servo_eye_cluster":
			_add_experiment_decoration_eye(pivot, deco)
		"vent", "circuit_board", "ram_stick", "spinal_port", "black_box", "mangled_socket":
			_add_experiment_decoration_vent(pivot, deco)
		"wiring", "cable_bundle", "bio_tube", "copper_tendon", "wet_sinew_cable":
			_add_experiment_decoration_wiring(pivot, deco)
		"intestines", "clotted_gore_pin":
			_add_experiment_decoration_intestines(pivot, deco)
		"bone_splinter", "meat_hook", "razor_fin", "bone_rivet":
			_add_experiment_decoration_bone_splinter(pivot, deco)
		"green_fuse", "exhaust_tube", "injector":
			_add_experiment_decoration_green_fuse(pivot, deco)
		"needle_bundle", "piston", "femur_brace":
			_add_experiment_decoration_needle_bundle(pivot, deco)
		"jaw_plate", "bolt_cluster", "clamp", "rib_spreader", "iron_staple":
			_add_experiment_decoration_jaw_plate(pivot, deco)
		_:
			_add_experiment_decoration_gear(pivot, deco)


func _add_experiment_decoration_socket(parent: Node3D, deco: Dictionary) -> void:
	var mesh := SphereMesh.new()
	mesh.radius = 0.060
	mesh.height = 0.026
	var material := _experiment_decoration_socket_material(deco)
	var socket := _add_experiment_decoration_mesh(parent, "embedded_socket", mesh, Vector3(0.0, 0.0, -0.020), Vector3.ZERO, material)
	if socket != null:
		socket.scale = Vector3(1.38, 0.62, 0.48)


func _add_experiment_decoration_gear(parent: Node3D, deco: Dictionary) -> void:
	var material := _experiment_decoration_material(deco)
	var disk := CylinderMesh.new()
	disk.top_radius = 0.046
	disk.bottom_radius = 0.046
	disk.height = 0.016
	var hub := _add_experiment_decoration_mesh(parent, "gear_disk", disk, Vector3(0.0, 0.0, -0.002), Vector3(90.0, 0.0, 0.0), material)
	_track_experiment_decoration_motion(hub, float(deco.get("spin", 0.0)), bool(deco.get("pulse", false)), float(deco.get("emissionEnergy", 0.0)))
	for i in range(8):
		var angle := float(i) * TAU / 8.0
		var tooth := BoxMesh.new()
		tooth.size = Vector3(0.018, 0.028, 0.014)
		var pos := Vector3(cos(angle) * 0.058, sin(angle) * 0.058, 0.000)
		_add_experiment_decoration_mesh(parent, "gear_tooth_%02d" % i, tooth, pos, Vector3(0.0, 0.0, rad_to_deg(angle)), material)
	var core := SphereMesh.new()
	core.radius = 0.016
	core.height = 0.028
	_add_experiment_decoration_mesh(parent, "gear_core", core, Vector3(0.0, 0.0, 0.010), Vector3.ZERO, material)


func _add_experiment_decoration_eye(parent: Node3D, deco: Dictionary) -> void:
	var metal := _experiment_decoration_material(deco)
	var ring := CylinderMesh.new()
	ring.top_radius = 0.042
	ring.bottom_radius = 0.042
	ring.height = 0.014
	_add_experiment_decoration_mesh(parent, "optic_ring", ring, Vector3(0.0, 0.0, -0.004), Vector3(90.0, 0.0, 0.0), metal)
	var eye := SphereMesh.new()
	eye.radius = 0.026
	eye.height = 0.040
	var optic := _add_experiment_decoration_mesh(parent, "optic_lens", eye, Vector3(0.0, 0.0, 0.014), Vector3.ZERO, _experiment_decoration_emissive_material(deco))
	_track_experiment_decoration_motion(optic, 0.0, true, float(deco.get("emissionEnergy", 0.8)))


func _add_experiment_decoration_vent(parent: Node3D, deco: Dictionary) -> void:
	var material := _experiment_decoration_material(deco)
	var body := BoxMesh.new()
	body.size = Vector3(0.102, 0.060, 0.024)
	_add_experiment_decoration_mesh(parent, "vent_body", body, Vector3(0.0, 0.0, -0.008), Vector3.ZERO, material)
	for i in range(4):
		var slat := BoxMesh.new()
		slat.size = Vector3(0.086, 0.007, 0.012)
		_add_experiment_decoration_mesh(parent, "vent_slat_%02d" % i, slat, Vector3(0.0, -0.024 + float(i) * 0.016, 0.008), Vector3(0.0, 0.0, -8.0), material)


func _add_experiment_decoration_wiring(parent: Node3D, deco: Dictionary) -> void:
	var material := _experiment_decoration_material(deco)
	var glow := _experiment_decoration_emissive_material(deco)
	for i in range(4):
		var wire := CylinderMesh.new()
		wire.top_radius = 0.006
		wire.bottom_radius = 0.006
		wire.height = 0.152 + float(i % 2) * 0.044
		var x := (float(i) - 1.5) * 0.016
		var mesh := _add_experiment_decoration_mesh(parent, "wire_%02d" % i, wire, Vector3(x, 0.006 * sin(float(i)), 0.006 + float(i % 2) * 0.004), Vector3(18.0 + float(i) * 8.0, 0.0, -28.0 + float(i) * 18.0), material if i % 2 != 0 else glow)
		_track_experiment_decoration_motion(mesh, 0.0, i % 2 == 0, float(deco.get("emissionEnergy", 0.22)))


func _add_experiment_decoration_intestines(parent: Node3D, deco: Dictionary) -> void:
	var material := _experiment_decoration_material(deco)
	for i in range(7):
		var bead := SphereMesh.new()
		bead.radius = 0.018 + float(i % 3) * 0.003
		bead.height = 0.028
		var pos := Vector3((float(i) - 3.0) * 0.016, sin(float(i) * 1.3) * 0.022, 0.006 + cos(float(i)) * 0.004)
		var mesh := _add_experiment_decoration_mesh(parent, "viscera_loop_%02d" % i, bead, pos, Vector3.ZERO, material)
		if mesh != null:
			mesh.scale = Vector3(1.25, 0.72, 0.82)


func _add_experiment_decoration_bone_splinter(parent: Node3D, deco: Dictionary) -> void:
	var material := _experiment_decoration_material(deco)
	for i in range(2):
		var splinter := CylinderMesh.new()
		splinter.top_radius = 0.0
		splinter.bottom_radius = 0.012 + float(i) * 0.004
		splinter.height = 0.108 + float(i) * 0.032
		_add_experiment_decoration_mesh(parent, "bone_splinter_%02d" % i, splinter, Vector3((float(i) - 0.5) * 0.020, 0.0, 0.026), Vector3(88.0, 0.0, -10.0 + float(i) * 20.0), material)


func _add_experiment_decoration_green_fuse(parent: Node3D, deco: Dictionary) -> void:
	var material := _experiment_decoration_emissive_material(deco)
	var shard := BoxMesh.new()
	shard.size = Vector3(0.034, 0.110, 0.018)
	var mesh := _add_experiment_decoration_mesh(parent, "glitch_fuse", shard, Vector3(0.0, 0.0, 0.016), Vector3(18.0, 0.0, -32.0), material)
	_track_experiment_decoration_motion(mesh, 0.0, true, float(deco.get("emissionEnergy", 0.7)))
	var cap := BoxMesh.new()
	cap.size = Vector3(0.052, 0.014, 0.014)
	_add_experiment_decoration_mesh(parent, "glitch_fuse_cap", cap, Vector3(0.0, -0.056, 0.008), Vector3(0.0, 0.0, -32.0), _experiment_decoration_material(deco))


func _add_experiment_decoration_needle_bundle(parent: Node3D, deco: Dictionary) -> void:
	var material := _experiment_decoration_material(deco)
	for i in range(4):
		var needle := CylinderMesh.new()
		needle.top_radius = 0.0
		needle.bottom_radius = 0.006
		needle.height = 0.118 + float(i % 2) * 0.036
		_add_experiment_decoration_mesh(parent, "needle_%02d" % i, needle, Vector3((float(i) - 1.5) * 0.013, 0.002 * float(i % 2), 0.022), Vector3(86.0, 0.0, -18.0 + float(i) * 12.0), material)


func _add_experiment_decoration_jaw_plate(parent: Node3D, deco: Dictionary) -> void:
	var material := _experiment_decoration_material(deco)
	var plate := BoxMesh.new()
	plate.size = Vector3(0.106, 0.038, 0.018)
	_add_experiment_decoration_mesh(parent, "jaw_plate", plate, Vector3(0.0, 0.0, 0.006), Vector3(0.0, 0.0, -8.0), material)
	for x in [-0.040, 0.040]:
		var rivet := SphereMesh.new()
		rivet.radius = 0.008
		rivet.height = 0.012
		_add_experiment_decoration_mesh(parent, "jaw_plate_rivet", rivet, Vector3(float(x), 0.0, 0.016), Vector3.ZERO, material)


func _add_experiment_decoration_asset(parent: Node3D, deco: Dictionary) -> bool:
	var asset_file := str(deco.get("assetFile", ""))
	if asset_file.is_empty():
		return false
	var resource_path := "res://shared-harness/art-kit/%s" % asset_file
	var scene = load(resource_path)
	if not scene is PackedScene:
		push_warning("Experiment decoration asset did not load: %s" % resource_path)
		return false
	var instance = (scene as PackedScene).instantiate()
	if not instance is Node3D:
		if instance != null:
			instance.queue_free()
		push_warning("Experiment decoration asset is not Node3D: %s" % resource_path)
		return false
	var visual := instance as Node3D
	visual.name = _experiment_unique_child_name(parent, "asset_%s" % str(deco.get("kind", "prop")))
	visual.position = Vector3(0.0, 0.0, clampf(float(deco.get("assetLift", 0.016)), 0.004, 0.040))
	visual.rotation_degrees = _variant_vector3_from_value(deco.get("assetRotation", []), Vector3.ZERO)
	visual.scale = Vector3.ONE
	parent.add_child(visual)
	var raw_scale := clampf(float(deco.get("assetScale", 0.05)), 0.001, 0.22)
	var fit_scale := raw_scale
	var asset_bounds := _combined_visual_local_aabb(visual)
	var max_dimension := maxf(asset_bounds.size.x, maxf(asset_bounds.size.y, asset_bounds.size.z))
	if max_dimension > 0.0001:
		var target_size := clampf(float(deco.get("assetTargetSize", 0.090)), 0.035, 0.150)
		fit_scale = minf(raw_scale, target_size / max_dimension)
	visual.scale = Vector3.ONE * fit_scale
	var material := _experiment_decoration_emissive_material(deco) if bool(deco.get("pulse", false)) else _experiment_decoration_material(deco)
	_apply_experiment_decoration_material_recursive(visual, material)
	var first_mesh := _first_descendant_of_class(visual, "MeshInstance3D") as MeshInstance3D
	if first_mesh != null:
		_track_experiment_decoration_motion(first_mesh, float(deco.get("spin", 0.0)), bool(deco.get("pulse", false)), float(deco.get("emissionEnergy", 0.0)))
	return true


func _combined_visual_local_aabb(root: Node3D) -> AABB:
	var state := {
		"has": false,
		"aabb": AABB(Vector3.ZERO, Vector3.ZERO),
	}
	_accumulate_visual_local_aabb(root, root, state)
	if not bool(state.get("has", false)):
		return AABB(Vector3.ZERO, Vector3.ZERO)
	return state.get("aabb", AABB(Vector3.ZERO, Vector3.ZERO)) as AABB


func _accumulate_visual_local_aabb(root: Node3D, node: Node, state: Dictionary) -> void:
	if node is MeshInstance3D:
		var mesh_instance := node as MeshInstance3D
		if mesh_instance.mesh != null:
			var local_transform := root.global_transform.affine_inverse() * mesh_instance.global_transform
			var local_aabb := _transformed_aabb(mesh_instance.get_aabb(), local_transform)
			if bool(state.get("has", false)):
				state["aabb"] = (state.get("aabb", local_aabb) as AABB).merge(local_aabb)
			else:
				state["aabb"] = local_aabb
				state["has"] = true
	for child in node.get_children():
		_accumulate_visual_local_aabb(root, child, state)


func _transformed_aabb(source: AABB, transform: Transform3D) -> AABB:
	var base := source.position
	var size := source.size
	var points := [
		base,
		base + Vector3(size.x, 0.0, 0.0),
		base + Vector3(0.0, size.y, 0.0),
		base + Vector3(0.0, 0.0, size.z),
		base + Vector3(size.x, size.y, 0.0),
		base + Vector3(size.x, 0.0, size.z),
		base + Vector3(0.0, size.y, size.z),
		base + size,
	]
	var result := AABB(transform * (points[0] as Vector3), Vector3.ZERO)
	for point in points:
		result = result.expand(transform * (point as Vector3))
	return result


func _apply_experiment_decoration_material_recursive(node: Node, material: Material) -> void:
	if node is MeshInstance3D:
		(node as MeshInstance3D).material_override = material
	for child in node.get_children():
		_apply_experiment_decoration_material_recursive(child, material)


func _add_experiment_decoration_mesh(parent: Node3D, node_name: String, mesh: Mesh, position: Vector3, rotation_degrees: Vector3, material: Material) -> MeshInstance3D:
	var mesh_instance := MeshInstance3D.new()
	mesh_instance.name = _experiment_unique_child_name(parent, node_name)
	mesh_instance.mesh = mesh
	mesh_instance.position = position
	mesh_instance.rotation_degrees = rotation_degrees
	mesh_instance.material_override = material
	parent.add_child(mesh_instance)
	return mesh_instance


func _experiment_decoration_material(deco: Dictionary) -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	mat.resource_name = "experiment_embedded_%s" % str(deco.get("kind", "deco"))
	mat.albedo_color = _variant_color_from_value(deco.get("color", []), Color(0.18, 0.18, 0.16, 1.0))
	mat.metallic = clampf(float(deco.get("metallic", 0.65)), 0.0, 1.0)
	mat.roughness = clampf(float(deco.get("roughness", 0.34)), 0.04, 0.90)
	mat.emission_enabled = false
	return mat


func _experiment_decoration_emissive_material(deco: Dictionary) -> StandardMaterial3D:
	var mat := _experiment_decoration_material(deco)
	var emission := _variant_color_from_value(deco.get("emission", []), Color(0.0, 0.55, 0.36, 1.0))
	var energy := float(deco.get("emissionEnergy", 0.45))
	mat.emission_enabled = energy > 0.0
	mat.emission = emission
	mat.emission_energy_multiplier = clampf(energy, 0.0, 1.8)
	mat.resource_name = "%s_emissive" % mat.resource_name
	return mat


func _experiment_decoration_socket_material(deco: Dictionary) -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	mat.resource_name = "experiment_embedded_socket"
	mat.albedo_color = _variant_color_from_value(deco.get("socketColor", []), Color(0.18, 0.018, 0.012, 1.0))
	mat.metallic = 0.0
	mat.roughness = 0.16
	return mat


func _track_experiment_decoration_motion(mesh_instance: MeshInstance3D, spin_speed: float, pulse: bool, base_energy: float) -> void:
	if mesh_instance == null:
		return
	if absf(spin_speed) <= 0.001 and not pulse:
		return
	experiment_embedded_decoration_nodes.append({
		"node": mesh_instance,
		"base_rotation": mesh_instance.rotation_degrees,
		"spin_speed": spin_speed,
		"pulse": pulse,
		"base_energy": base_energy,
		"phase": float(experiment_embedded_decoration_nodes.size()) * 0.83,
	})


func _tick_experiment_embedded_decorations(delta: float) -> void:
	if experiment_embedded_decoration_nodes.is_empty():
		return
	experiment_embedded_decoration_time += delta
	for state in experiment_embedded_decoration_nodes:
		var mesh_instance := state.get("node") as MeshInstance3D
		if mesh_instance == null or not is_instance_valid(mesh_instance):
			continue
		var base_rotation: Vector3 = state.get("base_rotation", mesh_instance.rotation_degrees)
		var spin_speed := float(state.get("spin_speed", 0.0))
		var phase := float(state.get("phase", 0.0))
		if absf(spin_speed) > 0.001:
			mesh_instance.rotation_degrees = base_rotation + Vector3(0.0, 0.0, experiment_embedded_decoration_time * spin_speed)
		if bool(state.get("pulse", false)):
			var material := mesh_instance.material_override as StandardMaterial3D
			if material != null and material.emission_enabled:
				var base_energy := float(state.get("base_energy", material.emission_energy_multiplier))
				var burst := maxf(0.0, sin(experiment_embedded_decoration_time * 7.0 + phase))
				var stutter := 1.0 if sin(experiment_embedded_decoration_time * 31.0 + phase * 0.5) > 0.58 else 0.0
				material.emission_energy_multiplier = base_energy * (0.62 + burst * 0.46 + stutter * 0.32)


func _experiment_unique_child_name(parent: Node, desired_name: String) -> String:
	var clean_name := desired_name.strip_edges()
	if clean_name.is_empty():
		clean_name = "experiment_embedded_deco"
	var candidate := clean_name
	var suffix := 2
	while parent.get_node_or_null(candidate) != null:
		candidate = "%s_%d" % [clean_name, suffix]
		suffix += 1
	return candidate


func _tune_experiment_seeded_material(material: StandardMaterial3D, config: Dictionary) -> void:
	var key := str(material.resource_name).to_lower()
	var metal_brightness := float(config.get("metalBrightness", 1.0))
	var gore_brightness := float(config.get("goreBrightness", 1.0))
	var skin_brightness := float(config.get("skinBrightness", 1.0))
	var blood_boost := float(config.get("bloodBoost", 1.0))
	var green_boost := float(config.get("greenBoost", 1.0))
	var wetness_boost := float(config.get("wetnessBoost", 1.0))
	var metal_roughness_jitter := float(config.get("metalRoughnessJitter", 1.0))
	var gore_wetness_jitter := float(config.get("goreWetnessJitter", 1.0))
	var phase_skin_jitter := float(config.get("phaseSkinJitter", 1.0))
	var skin_flicker_material := _material_key_uses_skin_flicker(key)
	var gore_flicker_material := _material_key_uses_gore_flicker(key)
	var opacity_flicker_material := skin_flicker_material or gore_flicker_material
	var surface_alpha := 1.0 if opacity_flicker_material else _variant_surface_alpha_for_key(config, key)
	var uv_drift := _variant_dictionary(config, "uvDrift")
	if not uv_drift.is_empty():
		material.uv1_offset = Vector3(float(uv_drift.get("x", 0.0)), float(uv_drift.get("y", 0.0)), 0.0)
		material.uv1_scale = Vector3(float(uv_drift.get("scaleX", 1.0)), float(uv_drift.get("scaleY", 1.0)), 1.0)
	if _material_key_is_metal(key):
		material.albedo_color = _variant_tinted_color(material.albedo_color, config, "metalTint", metal_brightness)
		material.metallic = clampf(material.metallic * 1.08, 0.0, 0.92)
		material.roughness = clampf(material.roughness * metal_roughness_jitter, 0.18, 0.76)
	if _material_key_is_gore(key):
		var effective_gore_brightness := gore_brightness * (blood_boost if key.contains("blood") or key.contains("clotted") else 1.0)
		material.albedo_color = _variant_tinted_color(material.albedo_color, config, "goreTint", effective_gore_brightness)
		var wetness := maxf(0.24, wetness_boost * gore_wetness_jitter)
		material.roughness = clampf(material.roughness / wetness, 0.05, 0.62)
	if key.contains("bone"):
		material.albedo_color = _variant_tinted_color(material.albedo_color, config, "skinTint", skin_brightness * 1.04)
		material.roughness = clampf(material.roughness * 1.08, 0.36, 0.82)
	if key.contains("skin") or key.contains("phase"):
		var effective_skin_brightness := skin_brightness * (phase_skin_jitter if key.contains("phase") else 1.0)
		material.albedo_color = _variant_tinted_color(material.albedo_color, config, "skinTint", effective_skin_brightness)
	if key.contains("green") or key.contains("fissure"):
		material.albedo_color = _variant_tinted_color(material.albedo_color, config, "skinTint", maxf(0.42, green_boost))
		material.emission_enabled = true
		material.emission = _variant_emission_color(material.emission, green_boost)
		material.emission_energy_multiplier = clampf(maxf(material.emission_energy_multiplier, 0.18) * green_boost * 1.35, 0.02, 2.8)
	if key.contains("eye") or key.contains("optic"):
		material.emission_enabled = true
		material.emission_energy_multiplier = clampf(maxf(material.emission_energy_multiplier, 0.08) * maxf(0.55, green_boost), 0.02, 1.8)
	if surface_alpha < 0.985:
		var alpha_color := material.albedo_color
		alpha_color.a = clampf(alpha_color.a * surface_alpha, 0.08, 1.0)
		material.albedo_color = alpha_color
		material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		material.cull_mode = BaseMaterial3D.CULL_DISABLED
	if opacity_flicker_material:
		_register_experiment_skin_flicker_material(material, config, key)
	material.resource_name = "%s_%s" % [material.resource_name, str(config.get("id", "variant"))]


func _material_key_is_metal(key: String) -> bool:
	return (
		key.contains("cyber")
		or key.contains("gunmetal")
		or key.contains("metal")
		or key.contains("joint_shadow")
		or key.contains("copper")
		or key.contains("patina")
	)


func _material_key_is_gore(key: String) -> bool:
	return (
		key.contains("muscle")
		or key.contains("blood")
		or key.contains("tendon")
		or key.contains("wound")
		or key.contains("torn")
		or key.contains("neck")
		or key.contains("livid")
	)


func _material_key_uses_skin_flicker(key: String) -> bool:
	return (
		key.contains("body_burnished_gunmetal")
		or key.contains("head_pallid")
		or key.contains("phase_skin")
		or key.contains("transient_human")
	)


func _material_key_uses_gore_flicker(key: String) -> bool:
	return (
		_material_key_is_gore(key)
		or key.contains("bone")
		or key.contains("clot")
		or key.contains("clotted")
		or key.contains("gore_flesh")
		or key.contains("subdermal")
	)


func _variant_surface_alpha_for_key(config: Dictionary, key: String) -> float:
	var surface_alpha := _variant_dictionary(config, "surfaceAlpha")
	if surface_alpha.is_empty():
		return 1.0
	if key.contains("clotted") or key.contains("blood"):
		return float(surface_alpha.get("blood", 1.0))
	if key.contains("subdermal") or key.contains("muscle"):
		return float(surface_alpha.get("muscle", 1.0))
	if key.contains("tendon"):
		return float(surface_alpha.get("tendon", 1.0))
	if key.contains("bone"):
		return float(surface_alpha.get("bone", 1.0))
	if key.contains("copper") or key.contains("patina"):
		return float(surface_alpha.get("patina", 1.0))
	if key.contains("green") or key.contains("fissure"):
		return float(surface_alpha.get("fissure", 1.0))
	if key.contains("phase") or key.contains("transient"):
		return float(surface_alpha.get("phase", 1.0))
	if key.contains("neck") or key.contains("livid") or key.contains("torn") or key.contains("wound"):
		return float(surface_alpha.get("skinTear", 1.0))
	if _material_key_is_metal(key):
		return 1.0
	return 1.0


func _variant_dictionary(config: Dictionary, key: String) -> Dictionary:
	var value = config.get(key, {})
	if typeof(value) != TYPE_DICTIONARY:
		return {}
	return value as Dictionary


func _variant_tinted_color(color: Color, config: Dictionary, tint_key: String, brightness: float) -> Color:
	var tint := _variant_float_array(config, tint_key, [1.0, 1.0, 1.0])
	return Color(
		clampf(color.r * float(tint[0]) * brightness, 0.0, 1.0),
		clampf(color.g * float(tint[1]) * brightness, 0.0, 1.0),
		clampf(color.b * float(tint[2]) * brightness, 0.0, 1.0),
		color.a
	)


func _variant_emission_color(color: Color, green_boost: float) -> Color:
	return Color(
		clampf(maxf(color.r, 0.012) * maxf(0.35, green_boost * 0.62), 0.0, 1.0),
		clampf(maxf(color.g, 0.20) * maxf(0.55, green_boost), 0.0, 1.0),
		clampf(maxf(color.b, 0.10) * maxf(0.40, green_boost * 0.82), 0.0, 1.0),
		1.0
	)


func _variant_float_array(config: Dictionary, key: String, fallback: Array) -> Array:
	var value = config.get(key, fallback)
	if typeof(value) != TYPE_ARRAY:
		return fallback
	var array := value as Array
	if array.size() < fallback.size():
		return fallback
	return array


func _variant_vector3_from_value(value, fallback: Vector3) -> Vector3:
	if typeof(value) != TYPE_ARRAY:
		return fallback
	var array := value as Array
	if array.size() < 3:
		return fallback
	return Vector3(float(array[0]), float(array[1]), float(array[2]))


func _variant_color_from_value(value, fallback: Color) -> Color:
	if typeof(value) != TYPE_ARRAY:
		return fallback
	var array := value as Array
	if array.size() < 3:
		return fallback
	var alpha := fallback.a
	if array.size() >= 4:
		alpha = float(array[3])
	return Color(float(array[0]), float(array[1]), float(array[2]), alpha)


func _experiment_variant_config(variant_id: String) -> Dictionary:
	_load_experiment_variant_configs()
	return experiment_variant_configs.get(variant_id, {})


func _load_experiment_variant_configs() -> void:
	if not experiment_variant_configs.is_empty():
		return
	var text := FileAccess.get_file_as_string(EXPERIMENT_VARIANT_CONFIG_PATH)
	if text.is_empty():
		push_warning("Experiment persona variant config missing: %s" % EXPERIMENT_VARIANT_CONFIG_PATH)
		return
	var parsed = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		push_warning("Experiment persona variant config did not parse as a dictionary")
		return
	var variants = (parsed as Dictionary).get("variants", [])
	if typeof(variants) != TYPE_ARRAY:
		return
	for variant_value in (variants as Array):
		if typeof(variant_value) != TYPE_DICTIONARY:
			continue
		var variant := variant_value as Dictionary
		var variant_id := str(variant.get("id", ""))
		if not variant_id.is_empty():
			experiment_variant_configs[variant_id] = variant


func _make_materials() -> void:
	fallback_material = StandardMaterial3D.new()
	fallback_material.albedo_color = Color(0.025, 0.028, 0.032)
	fallback_material.emission_enabled = true
	fallback_material.emission = Color(0.85, 0.05, 0.04)
	fallback_material.emission_energy_multiplier = 0.08
	fallback_material.metallic = 0.82
	fallback_material.roughness = 0.34


func _on_back_pressed() -> void:
	get_tree().change_scene_to_file("res://scenes/MatchPicker.tscn")
