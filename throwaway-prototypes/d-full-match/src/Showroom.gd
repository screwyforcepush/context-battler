extends Node3D

const EntityRendererScript = preload("res://src/EntityRenderer.gd")
const PERSONAS := ["rat", "duelist", "trader", "opportunist", "paranoid", "camper", "sprinter", "vulture"]
const STATION_SPACING := 1.6
const SAMPLE_MAP_WIDTH := 32
const SAMPLE_MAP_HEIGHT := 12
const LAYER_SKIN := "skin"
const LAYER_GORE := "gore"
const LAYER_WEAPONS := "weapons"
const LAYER_ARMOUR := "armour"
const ARMOUR_RENDER_PROP := "modular_submesh_prop"
const ARMOUR_RENDER_REGION := "adhering_region"

var current_weapon_tier := 0
var current_armour_tier := 0
var current_armour_render_mode := ARMOUR_RENDER_PROP
var weapon_by_tier := {0: "", 1: "", 2: "", 3: ""}
var armour_by_tier := {0: "", 1: "", 2: "", 3: ""}
var clip_labels: Dictionary = {}
var selected_tier_buttons: Dictionary = {}
var layer_enabled := {
	LAYER_SKIN: true,
	LAYER_GORE: true,
	LAYER_WEAPONS: true,
	LAYER_ARMOUR: true,
}
var fallback_material: StandardMaterial3D
var armour_render_mode_switch: CheckButton

@onready var scene_builder: Node3D = %SceneBuilder
@onready var equipment_attachment: Node = %EquipmentMeshAttachment
@onready var camera_rig = %CameraRig
@onready var persona_stations: Node3D = %PersonaStations
@onready var ui: CanvasLayer = %UI


func _ready() -> void:
	RenderingServer.set_default_clear_color(Color(0.006, 0.008, 0.012, 1.0))
	_make_materials()
	equipment_attachment.configure({})
	_build_sample_environment()
	_build_tier_maps()
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


func _spawn_persona_row() -> void:
	var offset := float(PERSONAS.size() - 1) * STATION_SPACING * 0.5
	for i in range(PERSONAS.size()):
		var persona := str(PERSONAS[i])
		var station := Node3D.new()
		station.name = "Station_%s" % persona
		station.position = Vector3(float(i) * STATION_SPACING - offset, 0.0, 0.0)
		persona_stations.add_child(station)
		_spawn_persona_station(station, persona)


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
	var name_label := _make_label("NameLabel", "%s\n%s" % [persona, source_key], Vector3(0.0, 1.28, 0.0), 0.0048, 18)
	station.add_child(name_label)
	var clip_label := _make_label("ClipLabel", "(idle/none)", Vector3(0.0, 1.06, 0.0), 0.0040, 12)
	station.add_child(clip_label)
	clip_labels[showroom_id] = clip_label


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
	camera_rig.yaw = 2.45
	camera_rig.pitch = -0.46
	camera_rig.director_radius = 10.0
	camera_rig.radius = 10.0
	camera_rig.free_anchor = Vector3(0.0, 0.52, 0.0)
	camera_rig.smooth_anchor = camera_rig.free_anchor


func _make_ui() -> void:
	var panel := PanelContainer.new()
	panel.name = "ShowroomPanel"
	panel.position = Vector2(16, 14)
	panel.custom_minimum_size = Vector2(1030, 186)
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
	title.text = "Showroom - Round 10 adherence consolidation"
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
	var modes_bar := HBoxContainer.new()
	modes_bar.name = "AdherenceModeBar"
	modes_bar.add_theme_constant_override("separation", 8)
	root.add_child(modes_bar)
	armour_render_mode_switch = CheckButton.new()
	armour_render_mode_switch.name = "ArmourModeSwitch"
	armour_render_mode_switch.button_pressed = current_armour_render_mode == ARMOUR_RENDER_REGION
	armour_render_mode_switch.toggled.connect(_set_armour_render_region)
	modes_bar.add_child(armour_render_mode_switch)
	_update_mode_switch_labels()
	var tier_box := VBoxContainer.new()
	tier_box.name = "EquipmentTierBar"
	tier_box.add_theme_constant_override("separation", 4)
	root.add_child(tier_box)
	_make_tier_row(tier_box, "Weapon", "weapon")
	_make_tier_row(tier_box, "Armour", "armour")


func _make_layer_toggle(parent: Node, label_text: String, layer: String) -> void:
	var button := CheckButton.new()
	button.name = "%sLayerToggle" % label_text
	button.text = label_text
	button.button_pressed = bool(layer_enabled.get(layer, true))
	button.toggled.connect(_set_layer_enabled.bind(layer))
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


func _trigger_animation(kind: String) -> void:
	for persona in PERSONAS:
		var showroom_id := _showroom_id(str(persona))
		equipment_attachment.play_character_animation(showroom_id, kind)
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


func _set_armour_render_region(use_region: bool) -> void:
	current_armour_render_mode = ARMOUR_RENDER_REGION if use_region else ARMOUR_RENDER_PROP
	_update_mode_switch_labels()
	_reapply_showroom_layers()


func _reapply_showroom_layers() -> void:
	_apply_runtime_modes()
	_apply_equipment_layers()
	_apply_surface_layers()


func _apply_runtime_modes() -> void:
	if equipment_attachment.has_method("set_armour_render_mode"):
		equipment_attachment.call("set_armour_render_mode", current_armour_render_mode)


func _apply_equipment_layers() -> void:
	var weapon_name := str(weapon_by_tier.get(current_weapon_tier, "")) if _layer_is_enabled(LAYER_WEAPONS) else ""
	var armour_name := str(armour_by_tier.get(current_armour_tier, "")) if _layer_is_enabled(LAYER_ARMOUR) else ""
	var equipped := {}
	for persona in PERSONAS:
		equipped[_showroom_id(str(persona))] = {
			"weapon": {"name": weapon_name},
			"armour": {"name": armour_name},
		}
	equipment_attachment.update_equipment(equipped)


func _apply_surface_layers() -> void:
	var armour_tier := _surface_armour_tier()
	for persona in PERSONAS:
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


func _build_tier_maps() -> void:
	weapon_by_tier = _numeric_tier_map_for_assets("weapon_assets_by_name")
	armour_by_tier = _armour_visual_tier_map()
	current_weapon_tier = _default_visible_tier(weapon_by_tier)
	current_armour_tier = _default_visible_tier(armour_by_tier)


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


func _update_mode_switch_labels() -> void:
	if armour_render_mode_switch != null:
		armour_render_mode_switch.text = "Armour mode: Adhering region" if current_armour_render_mode == ARMOUR_RENDER_REGION else "Armour mode: Modular prop"


func _update_tier_buttons(slot: String, selected_tier: int) -> void:
	for tier in [0, 1, 2, 3]:
		var key := "%s:%d" % [slot, tier]
		var button := selected_tier_buttons.get(key) as Button
		if button != null:
			button.button_pressed = tier == selected_tier


func _update_clip_labels() -> void:
	for persona in PERSONAS:
		var showroom_id := _showroom_id(str(persona))
		var clip_label := clip_labels.get(showroom_id) as Label3D
		if clip_label == null:
			continue
		var state: Dictionary = equipment_attachment.animation_state_for_character(showroom_id)
		clip_label.text = _clip_label_text(state)


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


func _make_materials() -> void:
	fallback_material = StandardMaterial3D.new()
	fallback_material.albedo_color = Color(0.62, 0.76, 0.82)
	fallback_material.emission_enabled = true
	fallback_material.emission = Color(0.2, 0.85, 1.0)
	fallback_material.emission_energy_multiplier = 0.18


func _on_back_pressed() -> void:
	get_tree().change_scene_to_file("res://scenes/MatchPicker.tscn")
