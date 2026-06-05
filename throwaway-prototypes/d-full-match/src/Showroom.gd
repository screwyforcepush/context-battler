extends Node3D

const EntityRendererScript = preload("res://src/EntityRenderer.gd")
const PERSONAS := ["rat", "duelist", "trader", "opportunist", "paranoid", "camper", "sprinter", "vulture"]
const GLITCH_REAPER_PROTOTYPE_PATH := "res://shared-harness/art-kit/characters/generated/glitch_reaper.glb"
const EXPERIMENT_MODEL_PATH := "res://shared-harness/art-kit/characters/generated/experiment.glb"
const GLITCH_REAPER_PROTOTYPE_SCALE := 0.93464883
const GLITCH_REAPER_CLIP_FALLBACKS := {
	"idle": ["Idle", "Idle_Loop", "Zombie_Idle"],
	"walk": ["Walk", "Walk_Loop", "Zombie_Walk_Fwd"],
	"run": ["Sprint", "Sprint_Loop", "Jog_Fwd"],
	"attack_unarmed": ["Punch_Jab", "Melee_Hook", "Sword_Attack"],
	"attack_armed": ["Sword_Attack", "Sword_Regular_A", "Melee_Hook"],
	"loot": ["PickUp_Table", "Interact"],
	"take_hit": ["Hit_Chest", "Hit_Head"],
	"death": ["Death01"],
}
const SHOW_MANIFEST_PERSONAS := false
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
var weapon_by_tier := {0: "", 1: "", 2: "", 3: ""}
var armour_by_tier := {0: "", 1: "", 2: "", 3: ""}
var armour_prop_options := []
var clip_labels: Dictionary = {}
var standalone_animation_players: Dictionary = {}
var standalone_clip_labels: Dictionary = {}
var standalone_current_clips: Dictionary = {}
var glitch_reaper_phase_time := 0.0
var glitch_reaper_phase_nodes: Array[Dictionary] = []
var cover_visible := false
var selected_tier_buttons: Dictionary = {}
var layer_enabled := {
	LAYER_SKIN: true,
	LAYER_GORE: false,
	LAYER_WEAPONS: false,
	LAYER_ARMOUR: false,
}
var fallback_material: StandardMaterial3D
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
	if not SHOW_MANIFEST_PERSONAS:
		_spawn_standalone_model_row()
		return
	var total_stations := PERSONAS.size() + 1
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
	var total_stations := STANDALONE_SHOWROOM_MODELS.size()
	var offset := float(total_stations - 1) * STATION_SPACING * 0.5
	for i in range(total_stations):
		var config := STANDALONE_SHOWROOM_MODELS[i] as Dictionary
		var model_id := str(config.get("id", "model_%d" % i))
		var station := Node3D.new()
		station.name = "Station_%s" % model_id
		station.position = Vector3(float(i) * STATION_SPACING - offset, 0.0, 0.0)
		persona_stations.add_child(station)
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
			visual.scale = Vector3.ONE * GLITCH_REAPER_PROTOTYPE_SCALE
			_apply_standalone_material_review_lift(visual, model_id)
			station.add_child(visual)
			standalone_animation_players[model_id] = _first_descendant_of_class(visual, "AnimationPlayer") as AnimationPlayer
			if bool(config.get("phase_driver", false)):
				_configure_glitch_reaper_phase_driver(visual)
	else:
		push_warning("Standalone showroom asset did not load: %s" % model_path)
	var name_label := _make_label("NameLabel", "%s\n%s" % [display_label, source_label], Vector3(0.0, GLITCH_REAPER_NAME_LABEL_HEIGHT, 0.0), 0.0048, 18)
	station.add_child(name_label)
	var clip_label := _make_label("ClipLabel", "(idle/none)", Vector3(0.0, GLITCH_REAPER_CLIP_LABEL_HEIGHT, 0.0), 0.0040, 12)
	station.add_child(clip_label)
	standalone_clip_labels[model_id] = clip_label
	standalone_current_clips[model_id] = "(idle/none)"


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
	camera_rig.yaw = 0.0
	camera_rig.pitch = -0.34
	camera_rig.director_radius = 4.55
	camera_rig.radius = 4.55
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
	var weapon_name := str(weapon_by_tier.get(current_weapon_tier, "")) if _layer_is_enabled(LAYER_WEAPONS) else ""
	var armour_name := str(armour_by_tier.get(current_armour_tier, "")) if _layer_is_enabled(LAYER_ARMOUR) else ""
	var equipped := {}
	for persona in _visible_personas():
		equipped[_showroom_id(str(persona))] = {
			"weapon": {"name": weapon_name},
			"armour": {"name": armour_name},
		}
	equipment_attachment.update_equipment(equipped)


func _apply_surface_layers() -> void:
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


func _build_armour_prop_options() -> void:
	armour_prop_options = [
		{
			"id": ARMOUR_PROP_ALL,
			"label": "All (per-persona)",
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
