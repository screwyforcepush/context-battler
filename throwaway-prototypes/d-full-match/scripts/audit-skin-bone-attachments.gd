extends SceneTree

const MANIFEST_PATH := "res://shared-harness/art-kit/manifest.json"
const EQUIPMENT_ATTACHMENT_SCRIPT := "res://src/EquipmentMeshAttachment.gd"
const BASE_SCALE := 1.0
const PERSONAS := ["rat", "duelist", "trader", "opportunist", "paranoid", "camper", "sprinter", "vulture"]
const SMALL_BONE_ATTACHED_MARKS := "small_bone_attached_marks"
const VISCERA_PROJECTION := "viscera_projection"
const DISMEMBERMENT_BAKED := "dismemberment_baked"
const BONE_HIDE_METHOD := "bone_hide"
const MIN_LIVE_GORE_MARKS := 10
const MIN_CAMPER_VISCERA_DECALS := 7
const MAX_SMALL_BODY_MARK_XY := 0.12
const REQUIRED_LIVE_GORE_MARK_TYPE := "splash"
const CAMPER_ORGAN_COLOR := "#740016"
const ADHERENCE_APPROACHES := ["bone_attached", "mesh_baked", "uv_painted"]
const MESH2MOTION_MARK_BONES := ["spine_01", "spine_02", "spine_03", "upperarm_l", "lowerarm_r", "thigh_l", "head", "hand_l", "hand_r"]
const SKIN_APPROACH_BY_PERSONA := {
	"rat": "palette_flat",
	"duelist": "pbr_texture_atlas",
	"trader": "pattern_texture",
	"opportunist": "pattern_texture",
	"paranoid": "toon_cel_shader",
	"camper": "emissive_trim_shader",
	"sprinter": "multi_material_split",
	"vulture": "rim_fresnel_shader",
}
const LIVE_CORPSE_APPROACH_BY_PERSONA := {
	"rat": SMALL_BONE_ATTACHED_MARKS,
	"duelist": SMALL_BONE_ATTACHED_MARKS,
	"trader": SMALL_BONE_ATTACHED_MARKS,
	"opportunist": SMALL_BONE_ATTACHED_MARKS,
	"paranoid": SMALL_BONE_ATTACHED_MARKS,
	"camper": VISCERA_PROJECTION,
	"sprinter": DISMEMBERMENT_BAKED,
	"vulture": SMALL_BONE_ATTACHED_MARKS,
}
const UV2_SKIN_APPROACHES := ["pbr_texture_atlas", "pattern_texture"]
const SPRINTER_HIDE_BONES := ["thigh_l", "lowerarm_r"]
const SPRINTER_STUMP_SIZE_BY_BONE := {
	"thigh_l": [0.34, 0.28],
	"lowerarm_r": [0.30, 0.24],
}
const UV2_BODY_SHADER_TOKEN := "uv2_body_texture"
const UV2_SHADER_COORD_TOKEN := "UV2"
const SKIN_MARK_KEYS := ["decals", "marks", "stickers", "decalStickers", "decal_stickers"]
const CORPSE_MARK_KEYS := ["decals", "marks"]
const MODULAR_ARMOUR_PROP_APPROACH := "modular_submesh_prop"

var manifest: Dictionary = {}
var failures: Array[String] = []
var warnings: Array[String] = []
var persona_failures: Dictionary = {}
var persona_warnings: Dictionary = {}
var adherence_coverage: Dictionary = {}
var armor_overlay_field_count := 0
var modular_armor_overlay_count := 0
var equipment_attachment: Node
var fallback_material: StandardMaterial3D


func _init() -> void:
	_run.call_deferred()


func _run() -> void:
	manifest = _read_manifest()
	if manifest.is_empty():
		_fail("manifest did not parse")
		_finish()
		return
	_make_fallback_material()
	equipment_attachment = _new_equipment_attachment()
	if equipment_attachment == null:
		_finish()
		return
	get_root().add_child(equipment_attachment)
	if equipment_attachment.has_method("configure"):
		equipment_attachment.configure({})
	else:
		_fail("EquipmentMeshAttachment missing configure")
		_finish()
		return
	if equipment_attachment.has_method("_apply_skin_decal_stickers"):
		_fail("EquipmentMeshAttachment still exposes retired _apply_skin_decal_stickers path")
	if equipment_attachment.has_method(_retired_armour_apply_method()):
		_fail("EquipmentMeshAttachment still exposes retired flat armour apply path")
	if equipment_attachment.has_method(_retired_armour_clear_method()):
		_fail("EquipmentMeshAttachment still exposes retired flat armour clear path")
	await process_frame
	var assets_by_persona := _character_assets_by_persona(manifest)
	for persona in PERSONAS:
		if not assets_by_persona.has(str(persona)):
			_fail_persona(str(persona), "missing character asset in manifest")
	_audit_manifest_round8_fields(assets_by_persona)
	for persona in PERSONAS:
		if not assets_by_persona.has(str(persona)):
			_print_persona_summary(str(persona))
			continue
		await _audit_persona(str(persona), assets_by_persona.get(str(persona), {}))
	_audit_adherence_coverage()
	if equipment_attachment != null:
		equipment_attachment.queue_free()
	_finish()


func _read_manifest() -> Dictionary:
	var text := FileAccess.get_file_as_string(MANIFEST_PATH)
	var parsed = JSON.parse_string(text)
	return parsed if typeof(parsed) == TYPE_DICTIONARY else {}


func _character_assets_by_persona(source_manifest: Dictionary) -> Dictionary:
	var out := {}
	for asset in source_manifest.get("assets", []):
		if typeof(asset) != TYPE_DICTIONARY:
			continue
		var asset_dict := asset as Dictionary
		if str(asset_dict.get("category", "")) != "character":
			continue
		var persona := str(asset_dict.get("personaSlot", ""))
		if not persona.is_empty():
			out[persona] = asset_dict
	return out


func _audit_manifest_round8_fields(assets_by_persona: Dictionary) -> void:
	for persona_value in PERSONAS:
		var persona := str(persona_value)
		if not assets_by_persona.has(persona):
			continue
		var asset: Dictionary = assets_by_persona.get(persona, {})
		if asset.has(_body_substitution_key()):
			_fail_persona(persona, "declares forbidden per-persona body substitution key")
		_audit_skin_consolidation(persona, asset.get("skin", null))
		_audit_adherence_block(persona, "corpse", asset.get("corpse", null), true)
		_audit_live_gore_block(persona, asset.get("corpse", null))
		var corpse = asset.get("corpse", null)
		if typeof(corpse) == TYPE_DICTIONARY and (corpse as Dictionary).has("deathTreatment"):
			_audit_death_treatment_block(persona, (corpse as Dictionary).get("deathTreatment", null))
		if not asset.has("armorOverlay"):
			_fail_persona(persona, "missing armorOverlay field")
		else:
			armor_overlay_field_count += 1
			var overlay = asset.get("armorOverlay", null)
			if typeof(overlay) != TYPE_NIL:
				if typeof(overlay) != TYPE_DICTIONARY:
					_fail_persona(persona, "armorOverlay must be null or a Dictionary")
				else:
					modular_armor_overlay_count += 1
					_audit_modular_armour_overlay(persona, overlay as Dictionary)
		if asset.has(_retired_armour_block_key()):
			_fail_persona(persona, "declares retired flat armour block")


func _audit_skin_consolidation(persona: String, skin_value) -> void:
	if typeof(skin_value) != TYPE_DICTIONARY:
		_fail_persona(persona, "skin block must be a Dictionary")
		return
	var skin := skin_value as Dictionary
	_audit_adherence_block(persona, "skin", skin, true)
	if str(skin.get("adherenceApproach", "")) != "uv_painted":
		_fail_persona(persona, "skin.adherenceApproach must be uv_painted on the locked body")
	var approach := str(skin.get("approach", ""))
	var expected := str(SKIN_APPROACH_BY_PERSONA.get(persona, ""))
	if approach != expected:
		_fail_persona(persona, "skin.approach must preserve Round-10 persona approach %s, got %s" % [expected, approach])
	if str(skin.get("approach", "")) == "decal_stickers":
		_fail_persona(persona, "skin.approach decal_stickers is retired")
	var specs := _mark_specs_from_block(skin, SKIN_MARK_KEYS)
	if not specs.is_empty():
		_fail_persona(persona, "skin declares retired mark/decal sticker specs (%d)" % specs.size())


func _audit_modular_armour_overlay(persona: String, overlay: Dictionary) -> void:
	_audit_adherence_block(persona, "armorOverlay", overlay, true)
	if str(overlay.get("adherenceApproach", "")) != "bone_attached":
		_fail_persona(persona, "armorOverlay.adherenceApproach must be bone_attached")
	if str(overlay.get("approach", "")) != MODULAR_ARMOUR_PROP_APPROACH:
		_fail_persona(persona, "armorOverlay.approach must be %s" % MODULAR_ARMOUR_PROP_APPROACH)
	_assert_fit_scale_and_offset(persona, "armorOverlay", overlay)
	if str(overlay.get("catalogPropId", "")).is_empty():
		_fail_persona(persona, "armorOverlay.catalogPropId must link to the armourProps catalog")


func _audit_live_gore_block(persona: String, corpse_value) -> void:
	if typeof(corpse_value) != TYPE_DICTIONARY:
		_fail_persona(persona, "live gore corpse block must be a Dictionary")
		return
	var corpse := corpse_value as Dictionary
	var approach := str(corpse.get("approach", ""))
	var expected := str(LIVE_CORPSE_APPROACH_BY_PERSONA.get(persona, SMALL_BONE_ATTACHED_MARKS))
	if approach != expected:
		_fail_persona(persona, "corpse.approach must preserve Round-12 persona approach %s, got %s" % [expected, approach])
	if approach == DISMEMBERMENT_BAKED:
		if str(corpse.get("adherenceApproach", "")) != "mesh_baked":
			_fail_persona(persona, "sprinter live dismemberment corpse.adherenceApproach must be mesh_baked")
		var params = corpse.get("params", {})
		_audit_dismemberment_params(persona, "corpse.params", params, true)
		return
	if str(corpse.get("adherenceApproach", "")) != "bone_attached":
		_fail_persona(persona, "live gore corpse.adherenceApproach must be bone_attached")
	var specs := _mark_specs_from_block(corpse, ["decals", "marks"])
	if approach == VISCERA_PROJECTION:
		var params_value = corpse.get("params", {})
		var params: Dictionary = {}
		if typeof(params_value) == TYPE_DICTIONARY:
			params = params_value as Dictionary
		if str(params.get("organColor", "")) != CAMPER_ORGAN_COLOR:
			_fail_persona(persona, "viscera_projection must preserve camper organColor %s" % CAMPER_ORGAN_COLOR)
		if specs.size() < MIN_CAMPER_VISCERA_DECALS:
			_fail_persona(persona, "viscera_projection needs at least %d decals, found %d" % [MIN_CAMPER_VISCERA_DECALS, specs.size()])
		for spec_info in specs:
			_assert_small_localized_gore_spec(persona, spec_info as Dictionary)
		return
	if specs.size() < MIN_LIVE_GORE_MARKS:
		_fail_persona(persona, "live gore needs at least %d small localized marks, found %d" % [MIN_LIVE_GORE_MARKS, specs.size()])
	var has_splash := false
	for spec_info in specs:
		var spec: Dictionary = (spec_info as Dictionary).get("spec", {})
		if str(spec.get("markType", "")) == REQUIRED_LIVE_GORE_MARK_TYPE:
			has_splash = true
		_assert_small_localized_gore_spec(persona, spec_info as Dictionary)
	if not has_splash:
		_fail_persona(persona, "live gore needs at least one %s markType" % REQUIRED_LIVE_GORE_MARK_TYPE)


func _audit_death_treatment_block(persona: String, treatment_value) -> void:
	if typeof(treatment_value) != TYPE_DICTIONARY:
		_fail_persona(persona, "corpse.deathTreatment block must be a Dictionary")
		return
	var treatment := treatment_value as Dictionary
	_audit_adherence_block(persona, "corpse.deathTreatment", treatment, true)
	if str(treatment.get("approach", "")) != DISMEMBERMENT_BAKED:
		_fail_persona(persona, "corpse.deathTreatment.approach must be %s when declared" % DISMEMBERMENT_BAKED)
	if str(treatment.get("adherenceApproach", "")) != "mesh_baked":
		_fail_persona(persona, "corpse.deathTreatment.adherenceApproach must be mesh_baked")
	var rationale := str(treatment.get("rationale", "")).to_lower()
	if rationale.contains("sprinter-tested") or rationale.contains("every persona") or rationale.contains("universal"):
		_fail_persona(persona, "corpse.deathTreatment rationale must not present sprinter as universal validation")
	var params: Dictionary = {}
	var params_value = treatment.get("params", {})
	if typeof(params_value) == TYPE_DICTIONARY:
		params = params_value as Dictionary
	else:
		_fail_persona(persona, "corpse.deathTreatment.params must be a Dictionary")
	if str(params.get("method", "")) != BONE_HIDE_METHOD:
		_fail_persona(persona, "corpse.deathTreatment.params.method must be %s" % BONE_HIDE_METHOD)
	var hide_bones := _array_from_value(params.get("hideBones", []))
	if hide_bones.is_empty():
		_fail_persona(persona, "corpse.deathTreatment.params.hideBones must be non-empty")
	for index in range(hide_bones.size()):
		var bone_name := str(hide_bones[index])
		if not MESH2MOTION_MARK_BONES.has(bone_name):
			_fail_persona(persona, "corpse.deathTreatment.params.hideBones[%d] is outside mesh2motion vocabulary: %s" % [index, bone_name])
	var stump_decals := _array_from_value(params.get("stumpDecals", []))
	if stump_decals.is_empty():
		_fail_persona(persona, "corpse.deathTreatment.params.stumpDecals must be non-empty")
	for index in range(stump_decals.size()):
		var spec_value = stump_decals[index]
		if typeof(spec_value) != TYPE_DICTIONARY:
			_fail_persona(persona, "corpse.deathTreatment.params.stumpDecals[%d] must be a Dictionary" % index)
			continue
		var spec := spec_value as Dictionary
		var bone_name := _bone_name_from_spec(spec)
		if not MESH2MOTION_MARK_BONES.has(bone_name):
			_fail_persona(persona, "corpse.deathTreatment.params.stumpDecals[%d] bone is outside mesh2motion vocabulary: %s" % [index, bone_name])
		if _is_floor_projection(spec):
			_fail_persona(persona, "corpse.deathTreatment.params.stumpDecals[%d] must not be floor-projected" % index)
	if float(params.get("fallbackBoneScale", 0.0)) != 0.01:
		_fail_persona(persona, "corpse.deathTreatment.params.fallbackBoneScale must be 0.01")


func _audit_dismemberment_params(persona: String, label: String, params_value, require_r10_sizes: bool) -> void:
	if typeof(params_value) != TYPE_DICTIONARY:
		_fail_persona(persona, "%s must be a Dictionary" % label)
		return
	var params := params_value as Dictionary
	if str(params.get("method", "")) != BONE_HIDE_METHOD:
		_fail_persona(persona, "%s.method must be %s" % [label, BONE_HIDE_METHOD])
	var hide_bones := _array_from_value(params.get("hideBones", []))
	if hide_bones.is_empty():
		_fail_persona(persona, "%s.hideBones must be non-empty" % label)
	for bone in hide_bones:
		if not MESH2MOTION_MARK_BONES.has(str(bone)):
			_fail_persona(persona, "%s.hideBones contains unknown mesh2motion bone %s" % [label, str(bone)])
	if require_r10_sizes:
		for expected_bone in SPRINTER_HIDE_BONES:
			if not hide_bones.has(expected_bone):
				_fail_persona(persona, "%s.hideBones must include R10 sprinter bone %s" % [label, str(expected_bone)])
	var stump_decals := _array_from_value(params.get("stumpDecals", []))
	if stump_decals.is_empty():
		_fail_persona(persona, "%s.stumpDecals must be non-empty" % label)
	for index in range(stump_decals.size()):
		var spec_value = stump_decals[index]
		if typeof(spec_value) != TYPE_DICTIONARY:
			_fail_persona(persona, "%s.stumpDecals[%d] must be a Dictionary" % [label, index])
			continue
		var spec := spec_value as Dictionary
		var bone_name := _bone_name_from_spec(spec)
		if not MESH2MOTION_MARK_BONES.has(bone_name):
			_fail_persona(persona, "%s.stumpDecals[%d] bone is outside mesh2motion vocabulary: %s" % [label, index, bone_name])
		if _is_floor_projection(spec):
			_fail_persona(persona, "%s.stumpDecals[%d] must not be floor-projected" % [label, index])
	if require_r10_sizes:
		for bone_key in SPRINTER_STUMP_SIZE_BY_BONE.keys():
			var found := false
			var expected_size: Array = SPRINTER_STUMP_SIZE_BY_BONE.get(bone_key, [])
			for spec_value in stump_decals:
				if typeof(spec_value) != TYPE_DICTIONARY:
					continue
				var spec := spec_value as Dictionary
				if str(spec.get("bone", "")) != str(bone_key):
					continue
				found = true
				var size := _array_from_value(spec.get("size", []))
				if size.size() < 2:
					_fail_persona(persona, "%s.stumpDecals %s size must include x/y" % [label, str(bone_key)])
				elif absf(float(size[0]) - float(expected_size[0])) > 0.000001 or absf(float(size[1]) - float(expected_size[1])) > 0.000001:
					_fail_persona(persona, "%s.stumpDecals %s size must preserve R10 %.2f/%.2f, got %.3f/%.3f" % [label, str(bone_key), float(expected_size[0]), float(expected_size[1]), float(size[0]), float(size[1])])
			if not found:
				_fail_persona(persona, "%s.stumpDecals missing R10 sprinter bone %s" % [label, str(bone_key)])
	if float(params.get("fallbackBoneScale", 0.0)) != 0.01:
		_fail_persona(persona, "%s.fallbackBoneScale must be 0.01" % label)


func _assert_fit_scale_and_offset(persona: String, label: String, block: Dictionary) -> void:
	if block.has("propScale"):
		_fail_persona(persona, "%s must use fitScale/propOffset instead of retired propScale" % label)
	var fit_scale := float(block.get("fitScale", 0.0))
	if fit_scale <= 0.0:
		_fail_persona(persona, "%s.fitScale must be > 0" % label)
	var offset := _array_from_value(block.get("propOffset", []))
	if offset.size() != 3:
		_fail_persona(persona, "%s.propOffset must be a 3-axis array" % label)
		return
	for index in range(offset.size()):
		if typeof(offset[index]) != TYPE_INT and typeof(offset[index]) != TYPE_FLOAT:
			_fail_persona(persona, "%s.propOffset[%d] must be numeric" % [label, index])


func _assert_small_localized_gore_spec(persona: String, spec_info: Dictionary) -> void:
	var spec: Dictionary = spec_info.get("spec", {})
	var label := "corpse.%s[%d]" % [str(spec_info.get("key", "marks")), int(spec_info.get("index", 0))]
	if _is_floor_projection(spec):
		_fail_persona(persona, "%s must be a body mark, not a floor projection" % label)
	var bone_name := _bone_name_from_spec(spec)
	if bone_name.is_empty():
		_fail_persona(persona, "%s must declare a mesh2motion bone" % label)
	elif not MESH2MOTION_MARK_BONES.has(bone_name):
		_fail_persona(persona, "%s bone is outside mesh2motion vocabulary: %s" % [label, bone_name])
	var size_value = spec.get("size", [])
	if typeof(size_value) != TYPE_ARRAY:
		_fail_persona(persona, "%s size must be an Array" % label)
		return
	var size_array := size_value as Array
	if size_array.size() < 2:
		_fail_persona(persona, "%s size must include x/y body dimensions" % label)
		return
	var size_x := absf(float(size_array[0]))
	var size_y := absf(float(size_array[1]))
	if size_x > MAX_SMALL_BODY_MARK_XY or size_y > MAX_SMALL_BODY_MARK_XY:
		_fail_persona(persona, "%s body mark x/y %.3f/%.3f exceeds %.2f" % [label, size_x, size_y, MAX_SMALL_BODY_MARK_XY])


func _audit_adherence_block(persona: String, slot: String, block_value, require_source_pack: bool) -> void:
	if typeof(block_value) != TYPE_DICTIONARY:
		_fail_persona(persona, "%s block must be a Dictionary" % slot)
		return
	var block := block_value as Dictionary
	var approach := str(block.get("adherenceApproach", ""))
	if not ADHERENCE_APPROACHES.has(approach):
		_fail_persona(persona, "%s.adherenceApproach invalid: %s" % [slot, approach])
	else:
		adherence_coverage[approach] = true
	if require_source_pack and not _has_source_pack(block.get("sourcePack", null)):
		_fail_persona(persona, "%s.sourcePack missing or empty" % slot)


func _has_source_pack(value) -> bool:
	match typeof(value):
		TYPE_STRING:
			return not str(value).strip_edges().is_empty()
		TYPE_DICTIONARY:
			return not str((value as Dictionary).get("name", "")).strip_edges().is_empty()
		_:
			return false


func _array_from_value(value) -> Array:
	return value if typeof(value) == TYPE_ARRAY else []


func _body_substitution_key() -> String:
	return "body" + "Override"


func _retired_armour_block_key() -> String:
	return "armor" + "Region"


func _retired_armour_apply_method() -> String:
	return "_apply_" + "adhering" + "_region" + "_armour"


func _retired_armour_clear_method() -> String:
	return "_clear_" + "adhering" + "_region" + "_armour"


func _audit_adherence_coverage() -> void:
	if armor_overlay_field_count != PERSONAS.size():
		_fail("armorOverlay field declared on %d/%d personas" % [armor_overlay_field_count, PERSONAS.size()])
	if modular_armor_overlay_count < 3:
		_fail("expected at least 3 non-null armorOverlay entries, found %d" % modular_armor_overlay_count)
	for approach_value in ADHERENCE_APPROACHES:
		var approach := str(approach_value)
		if not adherence_coverage.has(approach):
			_fail("adherenceApproach coverage missing %s" % approach)


func _new_equipment_attachment() -> Node:
	var script = load(EQUIPMENT_ATTACHMENT_SCRIPT)
	if script == null:
		_fail("EquipmentMeshAttachment script did not load")
		return null
	var node = script.new()
	if not node is Node:
		_fail("EquipmentMeshAttachment did not instantiate as Node")
		return null
	(node as Node).name = "AuditSkinBoneEquipmentAttachment"
	return node


func _audit_persona(persona: String, asset: Dictionary) -> void:
	var character_id := "audit-skin-bone-%s" % persona
	var character_node := _instantiate_runtime_character(persona, character_id)
	if character_node == null:
		_print_persona_summary(persona)
		return
	get_root().add_child(character_node)
	await process_frame
	if equipment_attachment.has_method("register_character"):
		equipment_attachment.register_character(character_id, character_node, persona)
	else:
		_fail_persona(persona, "EquipmentMeshAttachment missing register_character")
		character_node.queue_free()
		_print_persona_summary(persona)
		return
	await process_frame
	_apply_live_skin(persona, character_id)
	await process_frame
	var character := _registered_character(character_id)
	if character.is_empty():
		_fail_persona(persona, "missing registered_character record after register_character")
	else:
		_audit_persona_specific_material(persona, character_id, asset)
		_assert_no_live_skin_marks(persona, character_id, asset)
	var corpse_specs := _mark_specs_from_block(asset.get("corpse", {}), CORPSE_MARK_KEYS)
	if not corpse_specs.is_empty():
		if equipment_attachment.has_method("apply_corpse_skin_to_live_character"):
			equipment_attachment.apply_corpse_skin_to_live_character(character_id)
			await process_frame
			_audit_corpse_marks(persona, character_id, asset, corpse_specs)
		else:
			_fail_persona(persona, "EquipmentMeshAttachment missing apply_corpse_skin_to_live_character")
	character_node.queue_free()
	_print_persona_summary(persona)


func _instantiate_runtime_character(persona: String, character_id: String) -> Node3D:
	if not equipment_attachment.has_method("instantiate_persona_character"):
		_fail_persona(persona, "EquipmentMeshAttachment missing instantiate_persona_character")
		return null
	var node = equipment_attachment.instantiate_persona_character(persona, "audit-character-%s" % character_id, fallback_material, BASE_SCALE)
	if not node is Node3D:
		_fail_persona(persona, "instantiate_persona_character did not return Node3D")
		return null
	return node


func _apply_live_skin(persona: String, character_id: String) -> void:
	if equipment_attachment.has_method("apply_persona_skin"):
		equipment_attachment.call("apply_persona_skin", character_id, 0)
		return
	if equipment_attachment.has_method("_apply_persona_skin"):
		equipment_attachment.call("_apply_persona_skin", character_id, 0)
		return
	_fail_persona(persona, "EquipmentMeshAttachment missing apply_persona_skin")


func _audit_persona_specific_material(persona: String, character_id: String, asset: Dictionary) -> void:
	var skin = asset.get("skin", {})
	if typeof(skin) != TYPE_DICTIONARY:
		return
	var approach := str((skin as Dictionary).get("approach", ""))
	if not UV2_SKIN_APPROACHES.has(approach):
		print("OK %s %s live skin uses non-UV2 restored persona shader/path" % [persona, approach])
		return
	_assert_uv2_skin_material(persona, character_id, approach)


func _assert_uv2_skin_material(persona: String, character_id: String, approach: String) -> void:
	var materials := _unique_materials(_body_materials_for_character(character_id))
	if materials.is_empty():
		_fail_persona(persona, "no body materials found after live skin application")
		return
	var checked := 0
	for material in materials:
		if not material is ShaderMaterial:
			_fail_persona(persona, "body material is %s, expected UV2 ShaderMaterial for %s" % [_class_name(material), approach])
			continue
		checked += 1
		var shader_material := material as ShaderMaterial
		var shader := shader_material.shader
		if shader == null:
			_fail_persona(persona, "ShaderMaterial has no shader")
			continue
		var shader_code := str(shader.get("code"))
		var shader_label := "%s %s" % [shader.resource_path, shader.resource_name]
		var combined := ("%s %s" % [shader_label, shader_code]).to_lower()
		if not combined.contains(UV2_BODY_SHADER_TOKEN):
			_fail_persona(persona, "ShaderMaterial is not the UV2 body texture shader: %s" % shader_label)
		if not shader_code.contains(UV2_SHADER_COORD_TOKEN):
			_fail_persona(persona, "UV2 body texture shader does not sample %s" % UV2_SHADER_COORD_TOKEN)
	if checked == materials.size() and not _persona_has_failures(persona):
		print("OK %s %s live skin uses UV2 ShaderMaterial" % [persona, approach])


func _assert_no_live_skin_marks(persona: String, character_id: String, asset: Dictionary) -> void:
	var specs := _mark_specs_from_block(asset.get("skin", {}), SKIN_MARK_KEYS)
	if not specs.is_empty():
		_fail_persona(persona, "skin declares retired live mark specs")
	var tracked_skin_marks := _tracked_mark_nodes(character_id, "skin_mark_nodes_by_character")
	if not tracked_skin_marks.is_empty():
		_fail_persona(persona, "skin_mark_nodes_by_character contains %d retired skin mark nodes" % tracked_skin_marks.size())
	var character := _registered_character(character_id)
	var root := character.get("node") as Node
	var projected_skin_marks := _collect_projected_mark_nodes(root)
	if not projected_skin_marks.is_empty():
		_fail_persona(persona, "live skin produced %d projected mark nodes; Round-12 skins must stay material/shader based" % projected_skin_marks.size())


func _audit_corpse_marks(persona: String, character_id: String, _asset: Dictionary, corpse_specs: Array) -> void:
	_audit_mark_specs(persona, character_id, corpse_specs, "corpse_mark_nodes_by_character", "corpse skin")


func _audit_mark_specs(persona: String, character_id: String, specs: Array, bucket_name: String, label: String) -> void:
	var mark_nodes := _tracked_mark_nodes(character_id, bucket_name)
	if mark_nodes.size() < specs.size():
		var character := _registered_character(character_id)
		var root := character.get("node") as Node
		mark_nodes = _collect_projected_mark_nodes(root)
	if mark_nodes.size() < specs.size():
		_fail_persona(persona, "%s produced %d mark nodes for %d manifest specs" % [label, mark_nodes.size(), specs.size()])
	var character_record := _registered_character(character_id)
	var skeleton := character_record.get("skeleton") as Skeleton3D
	var count: int = min(mark_nodes.size(), specs.size())
	for i in range(count):
		var spec_info := specs[i] as Dictionary
		var spec: Dictionary = spec_info.get("spec", {})
		var mark := mark_nodes[i] as Node
		_assert_mark_parent(persona, label, spec_info, spec, mark, skeleton)
	if mark_nodes.size() >= specs.size() and not _persona_has_failures(persona):
		print("OK %s %s mark count=%d" % [persona, label, specs.size()])


func _assert_mark_parent(persona: String, label: String, spec_info: Dictionary, spec: Dictionary, mark: Node, skeleton: Skeleton3D) -> void:
	var spec_label := "%s.%s[%d]" % [label, str(spec_info.get("key", "marks")), int(spec_info.get("index", 0))]
	if mark == null or not is_instance_valid(mark):
		_fail_persona(persona, "%s produced invalid mark node" % spec_label)
		return
	if _is_floor_projection(spec):
		print("OK %s %s floor/root projection: %s" % [persona, spec_label, mark.get_path()])
		return
	var bone_name := _bone_name_from_spec(spec)
	if bone_name.is_empty():
		_fail_persona(persona, "%s does not declare a mesh2motion bone" % spec_label)
		return
	if not MESH2MOTION_MARK_BONES.has(bone_name):
		_fail_persona(persona, "%s bone is outside mesh2motion vocabulary: %s" % [spec_label, bone_name])
		return
	if skeleton == null:
		_fail_persona(persona, "%s requested bone %s but no Skeleton3D is registered" % [spec_label, bone_name])
		return
	if skeleton.find_bone(bone_name) < 0:
		_fail_persona(persona, "%s requested missing mesh2motion bone %s" % [spec_label, bone_name])
		return
	var attachment := _bone_attachment_in_parent_chain(mark)
	if attachment == null:
		_fail_persona(persona, "%s mark is not parented under BoneAttachment3D for bone %s: %s" % [spec_label, bone_name, mark.get_path()])
		return
	if skeleton != null and not _node_contains(skeleton, attachment):
		_fail_persona(persona, "%s BoneAttachment3D is not under active Skeleton3D: %s" % [spec_label, attachment.get_path()])
		return
	var attached_bone := str(attachment.bone_name)
	if not attached_bone.is_empty() and attached_bone != bone_name:
		_fail_persona(persona, "%s mark parent BoneAttachment3D uses bone %s, expected %s" % [spec_label, attached_bone, bone_name])
		return
	if not _contains_projected_mark_payload(mark):
		_fail_persona(persona, "%s BoneAttachment3D has no Decal/QuadMesh mark payload: %s" % [spec_label, mark.get_path()])
		return
	print("OK %s %s BoneAttachment3D=%s bone=%s" % [persona, spec_label, attachment.get_path(), bone_name])


func _mark_specs_from_block(block_value, keys: Array) -> Array:
	var out := []
	if typeof(block_value) != TYPE_DICTIONARY:
		return out
	var block := block_value as Dictionary
	var params = block.get("params", {})
	if typeof(params) != TYPE_DICTIONARY:
		return out
	var params_dict := params as Dictionary
	for key in keys:
		var values = params_dict.get(str(key), [])
		if typeof(values) != TYPE_ARRAY:
			continue
		var values_array := values as Array
		for i in range(values_array.size()):
			if typeof(values_array[i]) != TYPE_DICTIONARY:
				continue
			out.append({
				"key": str(key),
				"index": i,
				"spec": values_array[i],
			})
	return out


func _tracked_mark_nodes(character_id: String, bucket_name: String) -> Array:
	var out := []
	var bucket = equipment_attachment.get(bucket_name)
	if typeof(bucket) != TYPE_DICTIONARY:
		return out
	var values = (bucket as Dictionary).get(character_id, [])
	if typeof(values) != TYPE_ARRAY:
		return out
	for value in (values as Array):
		var node := value as Node
		if node != null and is_instance_valid(node):
			out.append(node)
	return out


func _collect_projected_mark_nodes(root: Node) -> Array:
	var out := []
	_collect_projected_mark_nodes_recursive(root, out)
	return out


func _collect_projected_mark_nodes_recursive(node: Node, out: Array) -> void:
	if node == null:
		return
	if _is_projected_mark_node(node):
		out.append(node)
	for child in node.get_children():
		_collect_projected_mark_nodes_recursive(child, out)


func _is_projected_mark_node(node: Node) -> bool:
	if node is Decal:
		return true
	if node is MeshInstance3D:
		var mesh := (node as MeshInstance3D).mesh
		return mesh is QuadMesh
	return false


func _contains_projected_mark_payload(node: Node) -> bool:
	if node == null:
		return false
	if _is_projected_mark_node(node):
		return true
	for child in node.get_children():
		if _contains_projected_mark_payload(child):
			return true
	return false


func _bone_attachment_in_parent_chain(node: Node) -> BoneAttachment3D:
	var current := node
	while current != null:
		if current is BoneAttachment3D:
			return current as BoneAttachment3D
		current = current.get_parent()
	return null


func _bone_name_from_spec(spec: Dictionary) -> String:
	for key in ["bone", "boneName", "attachBone"]:
		var value := str(spec.get(str(key), ""))
		if not value.is_empty():
			return value
	return ""


func _is_floor_projection(spec: Dictionary) -> bool:
	return str(spec.get("projection", "")).to_lower() == "floor"


func _body_materials_for_character(character_id: String) -> Array:
	var out := []
	for mesh_value in _body_meshes_for_character(character_id):
		var mesh := mesh_value as MeshInstance3D
		if mesh == null or not is_instance_valid(mesh):
			continue
		if mesh.material_override != null:
			out.append(mesh.material_override)
			continue
		if mesh.mesh == null:
			continue
		for surface in range(mesh.mesh.get_surface_count()):
			var override := mesh.get_surface_override_material(surface)
			if override != null:
				out.append(override)
				continue
			var active := mesh.get_active_material(surface)
			if active != null:
				out.append(active)
				continue
			var source := mesh.mesh.surface_get_material(surface)
			if source != null:
				out.append(source)
	return out


func _body_meshes_for_character(character_id: String) -> Array:
	var character := _registered_character(character_id)
	var meshes = character.get("bodyMeshes", [])
	if typeof(meshes) == TYPE_ARRAY and not (meshes as Array).is_empty():
		return meshes as Array
	var out := []
	var visual := character.get("visual") as Node
	_collect_body_meshes(visual, out)
	return out


func _collect_body_meshes(node: Node, out: Array) -> void:
	if node == null:
		return
	if node is MeshInstance3D and not _is_projected_mark_node(node):
		out.append(node)
	for child in node.get_children():
		_collect_body_meshes(child, out)


func _unique_materials(materials: Array) -> Array:
	var out := []
	for material in materials:
		if material == null:
			continue
		if not out.has(material):
			out.append(material)
	return out


func _registered_character(character_id: String) -> Dictionary:
	var registry = equipment_attachment.get("registered_characters")
	if typeof(registry) != TYPE_DICTIONARY:
		return {}
	var character = (registry as Dictionary).get(character_id, {})
	return character if typeof(character) == TYPE_DICTIONARY else {}


func _node_contains(root: Node, candidate: Node) -> bool:
	if root == null or candidate == null or not is_instance_valid(root) or not is_instance_valid(candidate):
		return false
	return root == candidate or root.is_ancestor_of(candidate)


func _contains_any_token(value: String, tokens: Array) -> bool:
	for token in tokens:
		if value.contains(str(token)):
			return true
	return false


func _class_name(value) -> String:
	if value == null:
		return "<null>"
	if value is Object:
		return (value as Object).get_class()
	return type_string(typeof(value))


func _make_fallback_material() -> void:
	fallback_material = StandardMaterial3D.new()
	fallback_material.albedo_color = Color(0.45, 0.56, 0.64)
	fallback_material.emission_enabled = true
	fallback_material.emission = Color(0.08, 0.48, 0.9)
	fallback_material.emission_energy_multiplier = 0.16


func _fail(message: String) -> void:
	failures.append(message)


func _fail_persona(persona: String, message: String) -> void:
	var full := "%s: %s" % [persona, message]
	failures.append(full)
	var persona_messages: Array = persona_failures.get(persona, [])
	persona_messages.append(message)
	persona_failures[persona] = persona_messages


func _warn_persona(persona: String, message: String) -> void:
	var full := "%s: %s" % [persona, message]
	warnings.append(full)
	var persona_messages: Array = persona_warnings.get(persona, [])
	persona_messages.append(message)
	persona_warnings[persona] = persona_messages
	push_warning(full)


func _persona_has_failures(persona: String) -> bool:
	var persona_messages: Array = persona_failures.get(persona, [])
	return not persona_messages.is_empty()


func _print_persona_summary(persona: String) -> void:
	var persona_fail_count := (persona_failures.get(persona, []) as Array).size()
	var persona_warn_count := (persona_warnings.get(persona, []) as Array).size()
	if persona_fail_count > 0:
		print("FAIL %s (%d fail, %d warn)" % [persona, persona_fail_count, persona_warn_count])
	elif persona_warn_count > 0:
		print("WARN %s (%d warn)" % [persona, persona_warn_count])
	else:
		print("OK %s" % persona)


func _finish() -> void:
	for warning in warnings:
		print("WARN %s" % warning)
	if failures.is_empty():
		print("audit-skin-bone-attachments PASS")
		quit(0)
		return
	for failure in failures:
		push_error(failure)
	print("audit-skin-bone-attachments FAIL")
	quit(1)
