extends SceneTree

const MANIFEST_PATH := "res://shared-harness/art-kit/manifest.json"
const EQUIPMENT_ATTACHMENT_SCRIPT := "res://src/EquipmentMeshAttachment.gd"
const BASE_SCALE := 1.0
const PERSONAS := ["rat", "duelist", "trader", "opportunist", "paranoid", "camper", "sprinter", "vulture"]
const UNIVERSAL_BODY_FILE := "characters/camper-mesh2motion-human-base.glb"
const WEAPON_DYNAMIC := "dynamic_hand_bone"
const WEAPON_STATIC := "static_root_socket"
const ARMOUR_PROP := "modular_submesh_prop"
const ARMOUR_PAINT := "armor_as_paint"

var failures: Array[String] = []
var equipment_attachment: Node
var fallback_material: StandardMaterial3D
var manifest: Dictionary = {}
var character_nodes: Dictionary = {}


func _init() -> void:
	_run.call_deferred()


func _run() -> void:
	manifest = _read_manifest()
	if manifest.is_empty():
		_fail("manifest did not parse")
		_finish()
		return
	_assert_manifest_matrix()
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
	await _spawn_registered_personas()
	await _audit_skin_and_gore_paths()
	await _audit_weapon_modes()
	await _audit_armour_modes()
	for node_value in character_nodes.values():
		var node := node_value as Node
		if node != null and is_instance_valid(node):
			node.queue_free()
	if equipment_attachment != null:
		equipment_attachment.queue_free()
	_finish()


func _read_manifest() -> Dictionary:
	var text := FileAccess.get_file_as_string(MANIFEST_PATH)
	var parsed = JSON.parse_string(text)
	return parsed if typeof(parsed) == TYPE_DICTIONARY else {}


func _assert_manifest_matrix() -> void:
	if int(manifest.get("schemaVersion", -1)) != 8:
		_fail("manifest schemaVersion is not 8")
	var body: Dictionary = manifest.get("body", {})
	if str(body.get("file", "")) != UNIVERSAL_BODY_FILE:
		_fail("manifest body is not the universal mesh2motion file")
	var forbidden_key := _body_substitution_key()
	var skin_families := {}
	var gore_families := {}
	var armour_overlay_count := 0
	for asset in _character_assets():
		var asset_dict := asset as Dictionary
		var persona := str(asset_dict.get("personaSlot", ""))
		if asset_dict.has(forbidden_key):
			_fail("%s declares a forbidden persona body substitution key" % persona)
		_collect_family(skin_families, asset_dict.get("skin", {}), "%s.skin" % persona)
		_collect_family(gore_families, asset_dict.get("corpse", {}), "%s.corpse" % persona)
		var overlay = asset_dict.get("armorOverlay", null)
		if typeof(overlay) == TYPE_DICTIONARY:
			armour_overlay_count += 1
			if str((overlay as Dictionary).get("adherenceApproach", "")) != "modular_submesh":
				_fail("%s armorOverlay is not modular_submesh" % persona)
	if not skin_families.has("uv_painted") or not skin_families.has("bone_attached"):
		_fail("skin layer must cover uv_painted and bone_attached, found %s" % str(skin_families.keys()))
	if not gore_families.has("uv_painted") or not gore_families.has("bone_attached") or not gore_families.has("mesh_baked"):
		_fail("gore layer must cover uv_painted, bone_attached, and mesh_baked, found %s" % str(gore_families.keys()))
	if armour_overlay_count < 3:
		_fail("armour prop approach needs at least 3 modular_submesh overlays, found %d" % armour_overlay_count)
	_assert_weapon_manifest_modes()
	_assert_armour_manifest_modes()
	print("adherence matrix skin=%s gore=%s weapons=[%s,%s] armour=[%s,%s]" % [
		", ".join(PackedStringArray(skin_families.keys())),
		", ".join(PackedStringArray(gore_families.keys())),
		WEAPON_DYNAMIC,
		WEAPON_STATIC,
		ARMOUR_PROP,
		ARMOUR_PAINT,
	])


func _assert_weapon_manifest_modes() -> void:
	var global_modes := _mode_set(_array_from_value(_dictionary_block(manifest, "round9Adherence").get("weaponAttachModes", [])))
	if not global_modes.has(WEAPON_DYNAMIC) or not global_modes.has(WEAPON_STATIC):
		_fail("round9Adherence.weaponAttachModes must declare dynamic and static modes")
	for weapon in _weapon_assets():
		var weapon_dict := weapon as Dictionary
		var weapon_name := str(weapon_dict.get("weaponName", ""))
		var modes := _mode_set(_array_from_value(weapon_dict.get("attachModes", [])))
		if not modes.has(WEAPON_DYNAMIC) or not modes.has(WEAPON_STATIC):
			_fail("%s weapon attachModes must declare dynamic and static modes" % weapon_name)


func _assert_armour_manifest_modes() -> void:
	var round9 := _dictionary_block(manifest, "round9Adherence")
	var armour_modes := _mode_set(_array_from_value(round9.get("armorApproaches", [])))
	if not armour_modes.has(ARMOUR_PROP) or not armour_modes.has(ARMOUR_PAINT):
		_fail("round9Adherence.armorApproaches must declare prop and paint modes")
	var paint := _dictionary_block(manifest, "armorAsPaint")
	if str(paint.get("mode", "")) != ARMOUR_PAINT:
		_fail("manifest.armorAsPaint.mode is not armor_as_paint")
	if str(paint.get("adherenceApproach", "")) != "uv_painted":
		_fail("manifest.armorAsPaint.adherenceApproach is not uv_painted")


func _collect_family(bucket: Dictionary, block_value, label: String) -> void:
	if typeof(block_value) != TYPE_DICTIONARY:
		_fail("%s is not a Dictionary" % label)
		return
	var approach := str((block_value as Dictionary).get("adherenceApproach", ""))
	if approach.is_empty():
		_fail("%s missing adherenceApproach" % label)
		return
	bucket[approach] = true


func _spawn_registered_personas() -> void:
	for persona_value in PERSONAS:
		var persona := str(persona_value)
		var character_id := _character_id(persona)
		var node = equipment_attachment.call("instantiate_persona_character", persona, "audit-adherence-%s" % persona, fallback_material, BASE_SCALE)
		if not node is Node3D:
			_fail("%s instantiate_persona_character did not return Node3D" % persona)
			continue
		get_root().add_child(node)
		character_nodes[character_id] = node
		await process_frame
		equipment_attachment.call("register_character", character_id, node, persona)
		await process_frame
		_assert_animation_state(persona, character_id, "idle")
		_assert_animation_state(persona, character_id, "walk")
		_assert_animation_state(persona, character_id, "death")


func _audit_skin_and_gore_paths() -> void:
	for asset in _character_assets():
		var asset_dict := asset as Dictionary
		var persona := str(asset_dict.get("personaSlot", ""))
		var character_id := _character_id(persona)
		equipment_attachment.call("apply_persona_skin", character_id, 0)
		await process_frame
		_assert_applied_map(character_id, "last_applied_skin_approach", str(_dictionary_block(asset_dict, "skin").get("approach", "")))
		equipment_attachment.call("apply_corpse_skin_to_live_character", character_id)
		await process_frame
		_assert_applied_map(character_id, "last_applied_corpse_approach", str(_dictionary_block(asset_dict, "corpse").get("approach", "")))
		equipment_attachment.call("restore_persona_skin_to_live_character", character_id)
		await process_frame


func _audit_weapon_modes() -> void:
	var weapon_name := _first_weapon_name()
	if weapon_name.is_empty():
		_fail("no weapon asset available for runtime weapon mode audit")
		return
	equipment_attachment.call("set_weapon_attach_mode", WEAPON_DYNAMIC)
	equipment_attachment.call("update_equipment", _equipment_payload(weapon_name, ""))
	await process_frame
	_assert_weapon_mode(WEAPON_DYNAMIC)
	equipment_attachment.call("set_weapon_attach_mode", WEAPON_STATIC)
	await process_frame
	_assert_weapon_mode(WEAPON_STATIC)


func _audit_armour_modes() -> void:
	var armour_name := _first_armour_name()
	if armour_name.is_empty():
		_fail("no armour asset available for runtime armour mode audit")
		return
	equipment_attachment.call("set_armour_render_mode", ARMOUR_PAINT)
	equipment_attachment.call("update_equipment", _equipment_payload("", armour_name))
	await process_frame
	_assert_armour_paint_mode()
	equipment_attachment.call("set_armour_render_mode", ARMOUR_PROP)
	await process_frame
	_assert_armour_prop_mode()


func _assert_weapon_mode(expected_mode: String) -> void:
	for persona_value in PERSONAS:
		var character_id := _character_id(str(persona_value))
		var character := _registered_character(character_id)
		if str(character.get("weaponAttachMode", "")) != expected_mode:
			_fail("%s weaponAttachMode=%s expected %s" % [character_id, str(character.get("weaponAttachMode", "")), expected_mode])
		if str(character.get("weaponSocketKind", "")) != expected_mode:
			_fail("%s weaponSocketKind=%s expected %s" % [character_id, str(character.get("weaponSocketKind", "")), expected_mode])


func _assert_armour_paint_mode() -> void:
	for persona_value in PERSONAS:
		var character_id := _character_id(str(persona_value))
		var character := _registered_character(character_id)
		if str(character.get("armourRenderMode", "")) != ARMOUR_PAINT:
			_fail("%s armourRenderMode is not armor_as_paint" % character_id)
		if not bool(character.get("usesArmourPaint", false)):
			_fail("%s did not record usesArmourPaint in paint mode" % character_id)
		if int(character.get("bodyArmourTier", 0)) <= 0:
			_fail("%s bodyArmourTier did not increase in paint mode" % character_id)


func _assert_armour_prop_mode() -> void:
	for asset in _character_assets():
		var asset_dict := asset as Dictionary
		var persona := str(asset_dict.get("personaSlot", ""))
		var character_id := _character_id(persona)
		var character := _registered_character(character_id)
		if str(character.get("armourRenderMode", "")) != ARMOUR_PROP:
			_fail("%s armourRenderMode is not modular_submesh_prop" % character_id)
		if typeof(asset_dict.get("armorOverlay", null)) == TYPE_DICTIONARY and not bool(character.get("usesModularArmour", false)):
			_fail("%s did not record usesModularArmour for overlay persona in prop mode" % character_id)


func _assert_animation_state(persona: String, character_id: String, kind: String) -> void:
	if not equipment_attachment.call("play_character_animation", character_id, kind):
		_fail("%s did not play %s animation" % [persona, kind])
		return
	var state = equipment_attachment.call("animation_state_for_character", character_id)
	if typeof(state) != TYPE_DICTIONARY or str((state as Dictionary).get("clip", "")).is_empty():
		_fail("%s animation state did not record clip for %s" % [persona, kind])


func _assert_applied_map(character_id: String, property_name: String, expected: String) -> void:
	var value = equipment_attachment.get(property_name)
	if typeof(value) != TYPE_DICTIONARY:
		_fail("EquipmentMeshAttachment.%s is not a Dictionary" % property_name)
		return
	var actual := str((value as Dictionary).get(character_id, ""))
	if actual != expected:
		_fail("%s %s=%s expected %s" % [character_id, property_name, actual, expected])


func _equipment_payload(weapon_name: String, armour_name: String) -> Dictionary:
	var out := {}
	for persona_value in PERSONAS:
		out[_character_id(str(persona_value))] = {
			"weapon": {"name": weapon_name},
			"armour": {"name": armour_name},
		}
	return out


func _first_weapon_name() -> String:
	for weapon in _weapon_assets():
		var name := str((weapon as Dictionary).get("weaponName", ""))
		if not name.is_empty():
			return name
	return ""


func _first_armour_name() -> String:
	for armour in _armour_assets():
		var name := str((armour as Dictionary).get("armourName", ""))
		if not name.is_empty():
			return name
	return ""


func _character_assets() -> Array:
	var out := []
	for asset in manifest.get("assets", []):
		if typeof(asset) == TYPE_DICTIONARY and str((asset as Dictionary).get("category", "")) == "character":
			out.append(asset)
	return out


func _weapon_assets() -> Array:
	var out := []
	for asset in manifest.get("assets", []):
		if typeof(asset) == TYPE_DICTIONARY and str((asset as Dictionary).get("category", "")) == "weapon":
			out.append(asset)
	return out


func _armour_assets() -> Array:
	var out := []
	for asset in manifest.get("assets", []):
		if typeof(asset) == TYPE_DICTIONARY and str((asset as Dictionary).get("category", "")) == "armour":
			out.append(asset)
	return out


func _mode_set(values: Array) -> Dictionary:
	var out := {}
	for value in values:
		if typeof(value) == TYPE_DICTIONARY:
			var mode := str((value as Dictionary).get("mode", ""))
			if not mode.is_empty():
				out[mode] = true
	return out


func _array_from_value(value) -> Array:
	return value if typeof(value) == TYPE_ARRAY else []


func _dictionary_block(source: Dictionary, key: String) -> Dictionary:
	var value = source.get(key, {})
	if typeof(value) == TYPE_DICTIONARY:
		return value as Dictionary
	return {}


func _registered_character(character_id: String) -> Dictionary:
	var registry = equipment_attachment.get("registered_characters")
	if typeof(registry) != TYPE_DICTIONARY:
		return {}
	var character = (registry as Dictionary).get(character_id, {})
	return character if typeof(character) == TYPE_DICTIONARY else {}


func _new_equipment_attachment() -> Node:
	var script = load(EQUIPMENT_ATTACHMENT_SCRIPT)
	if script == null:
		_fail("EquipmentMeshAttachment script did not load")
		return null
	var node = script.new()
	if not node is Node:
		_fail("EquipmentMeshAttachment did not instantiate as Node")
		return null
	(node as Node).name = "AuditAdherenceMatrixEquipmentAttachment"
	return node


func _make_fallback_material() -> void:
	fallback_material = StandardMaterial3D.new()
	fallback_material.albedo_color = Color(0.55, 0.65, 0.72)
	fallback_material.emission_enabled = true
	fallback_material.emission = Color(0.1, 0.7, 0.9)
	fallback_material.emission_energy_multiplier = 0.2


func _character_id(persona: String) -> String:
	return "audit-adherence-%s" % persona


func _body_substitution_key() -> String:
	return "body" + "Override"


func _fail(message: String) -> void:
	failures.append(message)


func _finish() -> void:
	if failures.is_empty():
		print("audit-adherence-matrix PASS")
		quit(0)
		return
	for failure in failures:
		push_error(failure)
	print("audit-adherence-matrix FAIL")
	quit(1)
