extends SceneTree

const MANIFEST_PATH := "res://shared-harness/art-kit/manifest.json"
const EQUIPMENT_ATTACHMENT_SCRIPT := "res://src/EquipmentMeshAttachment.gd"
const BASE_SCALE := 1.0
const EXPECTED_SCHEMA_VERSION := 9
const PERSONAS := ["rat", "duelist", "trader", "opportunist", "paranoid", "camper", "sprinter", "vulture"]
const UNIVERSAL_BODY_FILE := "characters/camper-mesh2motion-human-base.glb"
const SKIN_UV_PAINTED := "uv_painted"
const GORE_BONE_ATTACHED := "bone_attached"
const GORE_MESH_BAKED := "mesh_baked"
const RETIRED_SKIN_DECAL := "decal_stickers"
const WEAPON_DYNAMIC := "dynamic_hand_bone"
const RETIRED_WEAPON_STATIC := "static_root_socket"
const ARMOUR_PROP := "modular_submesh_prop"
const ARMOUR_REGION := "adhering_region"
const RETIRED_ARMOUR_PAINT := "armor_as_paint"
const ARMED_ATTACK_KIND := "attack_armed"
const DONOR_GORE_PERSONAS := ["duelist", "paranoid", "camper"]
const MIN_DONOR_GORE_MARKS := 6
const MAX_DONOR_GORE_MARK_AXIS := 0.12
const MIN_ARMOUR_REGION_MARKS := 2

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
	await _audit_armed_attack_composition()
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
	if int(manifest.get("schemaVersion", -1)) != EXPECTED_SCHEMA_VERSION:
		_fail("manifest schemaVersion is not %d" % EXPECTED_SCHEMA_VERSION)
	var body: Dictionary = manifest.get("body", {})
	if str(body.get("file", "")) != UNIVERSAL_BODY_FILE:
		_fail("manifest body is not the universal mesh2motion file")
	var forbidden_key := _body_substitution_key()
	var skin_families := {}
	var gore_families := {}
	var armour_overlay_count := 0
	var armour_region_count := 0
	for asset in _character_assets():
		var asset_dict := asset as Dictionary
		var persona := str(asset_dict.get("personaSlot", ""))
		if asset_dict.has(forbidden_key):
			_fail("%s declares a forbidden persona body substitution key" % persona)
		var skin := _dictionary_block(asset_dict, "skin")
		_collect_family(skin_families, skin, "%s.skin" % persona)
		if str(skin.get("adherenceApproach", "")) != SKIN_UV_PAINTED:
			_fail("%s skin is not uv_painted-only" % persona)
		if str(skin.get("approach", "")) == RETIRED_SKIN_DECAL:
			_fail("%s still declares retired decal_stickers skin" % persona)
		var corpse := _dictionary_block(asset_dict, "corpse")
		_collect_family(gore_families, corpse, "%s.corpse" % persona)
		if _is_donor_gore_persona(persona):
			_assert_donor_gore_shape(persona, corpse)
		var overlay = asset_dict.get("armorOverlay", null)
		if typeof(overlay) == TYPE_DICTIONARY:
			armour_overlay_count += 1
			_assert_armour_overlay_metadata(persona, overlay as Dictionary)
		var region = asset_dict.get("armorRegion", null)
		if typeof(region) == TYPE_DICTIONARY:
			armour_region_count += 1
			_assert_armour_region_metadata(persona, region as Dictionary)
		elif _is_donor_gore_persona(persona):
			_fail("%s donor persona is missing donated armorRegion" % persona)
	if skin_families.size() != 1 or not skin_families.has(SKIN_UV_PAINTED):
		_fail("skin layer must be uv_painted-only, found %s" % str(skin_families.keys()))
	if not gore_families.has(SKIN_UV_PAINTED) or not gore_families.has(GORE_BONE_ATTACHED) or not gore_families.has(GORE_MESH_BAKED):
		_fail("gore layer must cover uv_painted, bone_attached, and mesh_baked, found %s" % str(gore_families.keys()))
	if armour_overlay_count < 3:
		_fail("armour prop approach needs at least 3 modular_submesh_prop overlays, found %d" % armour_overlay_count)
	if armour_region_count < DONOR_GORE_PERSONAS.size():
		_fail("armour region approach needs donor armorRegion blocks for %s, found %d" % [str(DONOR_GORE_PERSONAS), armour_region_count])
	_assert_weapon_manifest_modes()
	_assert_armour_manifest_modes()
	print("adherence matrix schema=%d skin=%s gore=%s weapons=[%s] armour=[%s,%s]" % [
		EXPECTED_SCHEMA_VERSION,
		", ".join(PackedStringArray(skin_families.keys())),
		", ".join(PackedStringArray(gore_families.keys())),
		WEAPON_DYNAMIC,
		ARMOUR_PROP,
		ARMOUR_REGION,
	])


func _assert_weapon_manifest_modes() -> void:
	var global_modes := _mode_set(_array_from_value(_dictionary_block(manifest, "round9Adherence").get("weaponAttachModes", [])))
	if global_modes.size() != 1 or not global_modes.has(WEAPON_DYNAMIC):
		_fail("round9Adherence.weaponAttachModes must declare dynamic_hand_bone only")
	if global_modes.has(RETIRED_WEAPON_STATIC):
		_fail("round9Adherence.weaponAttachModes still declares retired static_root_socket")
	for weapon in _weapon_assets():
		var weapon_dict := weapon as Dictionary
		var weapon_name := str(weapon_dict.get("weaponName", ""))
		var modes := _mode_set(_array_from_value(weapon_dict.get("attachModes", [])))
		if modes.size() != 1 or not modes.has(WEAPON_DYNAMIC):
			_fail("%s weapon attachModes must declare dynamic_hand_bone only" % weapon_name)
		if modes.has(RETIRED_WEAPON_STATIC):
			_fail("%s weapon attachModes still declares retired static_root_socket" % weapon_name)


func _assert_armour_manifest_modes() -> void:
	var round9 := _dictionary_block(manifest, "round9Adherence")
	var armour_modes := _mode_set(_array_from_value(round9.get("armorApproaches", [])))
	if armour_modes.size() != 2 or not armour_modes.has(ARMOUR_PROP) or not armour_modes.has(ARMOUR_REGION):
		_fail("round9Adherence.armorApproaches must declare prop and adhering_region modes only")
	if armour_modes.has(RETIRED_ARMOUR_PAINT):
		_fail("round9Adherence.armorApproaches still declares retired armor_as_paint")
	if manifest.has("armorAsPaint"):
		_fail("manifest still declares retired armorAsPaint user mode")


func _collect_family(bucket: Dictionary, block_value, label: String) -> void:
	if typeof(block_value) != TYPE_DICTIONARY:
		_fail("%s is not a Dictionary" % label)
		return
	var approach := str((block_value as Dictionary).get("adherenceApproach", ""))
	if approach.is_empty():
		_fail("%s missing adherenceApproach" % label)
		return
	bucket[approach] = true


func _assert_donor_gore_shape(persona: String, corpse: Dictionary) -> void:
	if str(corpse.get("adherenceApproach", "")) != GORE_BONE_ATTACHED:
		_fail("%s donor gore is not bone_attached" % persona)
	var params := _dictionary_block(corpse, "params")
	var decals := _array_from_value(params.get("decals", []))
	if decals.size() < MIN_DONOR_GORE_MARKS:
		_fail("%s donor gore has %d marks, expected at least %d small localized marks" % [persona, decals.size(), MIN_DONOR_GORE_MARKS])
	for index in range(decals.size()):
		var spec_value = decals[index]
		if typeof(spec_value) != TYPE_DICTIONARY:
			_fail("%s donor gore decal %d is not a Dictionary" % [persona, index])
			continue
		var spec := spec_value as Dictionary
		if str(spec.get("bone", "")).is_empty():
			_fail("%s donor gore decal %d missing bone" % [persona, index])
		var max_axis := _max_numeric_axis(spec.get("size", []))
		if max_axis > MAX_DONOR_GORE_MARK_AXIS:
			_fail("%s donor gore decal %d size axis %.3f exceeds %.3f" % [persona, index, max_axis, MAX_DONOR_GORE_MARK_AXIS])


func _assert_armour_overlay_metadata(persona: String, overlay: Dictionary) -> void:
	if str(overlay.get("approach", "")) != ARMOUR_PROP:
		_fail("%s armorOverlay.approach is not modular_submesh_prop" % persona)
	if str(overlay.get("adherenceApproach", "")) != GORE_BONE_ATTACHED:
		_fail("%s armorOverlay.adherenceApproach is not bone_attached" % persona)
	if str(overlay.get("bindBone", "")).is_empty():
		_fail("%s armorOverlay.bindBone is empty" % persona)


func _assert_armour_region_metadata(persona: String, region: Dictionary) -> void:
	if str(region.get("approach", "")) != ARMOUR_REGION:
		_fail("%s armorRegion.approach is not adhering_region" % persona)
	if str(region.get("adherenceApproach", "")) != GORE_BONE_ATTACHED:
		_fail("%s armorRegion.adherenceApproach is not bone_attached" % persona)
	var params := _dictionary_block(region, "params")
	var decals := _array_from_value(params.get("decals", []))
	if decals.size() < MIN_ARMOUR_REGION_MARKS:
		_fail("%s armorRegion needs at least %d broad region marks, found %d" % [persona, MIN_ARMOUR_REGION_MARKS, decals.size()])


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
	if equipment_attachment.has_method("set_weapon_attach_mode"):
		_fail("EquipmentMeshAttachment still exposes retired set_weapon_attach_mode")
	var weapon_name := _first_weapon_name()
	if weapon_name.is_empty():
		_fail("no weapon asset available for runtime weapon mode audit")
		return
	equipment_attachment.call("update_equipment", _equipment_payload(weapon_name, ""))
	await process_frame
	_assert_weapon_mode(WEAPON_DYNAMIC)


func _audit_armour_modes() -> void:
	var armour_name := _first_armour_name()
	if armour_name.is_empty():
		_fail("no armour asset available for runtime armour mode audit")
		return
	equipment_attachment.call("set_armour_render_mode", ARMOUR_REGION)
	equipment_attachment.call("update_equipment", _equipment_payload("", armour_name))
	await process_frame
	_assert_armour_region_mode()
	equipment_attachment.call("set_armour_render_mode", ARMOUR_PROP)
	await process_frame
	_assert_armour_prop_mode()


func _audit_armed_attack_composition() -> void:
	var weapon_name := _first_weapon_name()
	var armour_name := _first_armour_name()
	if weapon_name.is_empty():
		_fail("no weapon asset available for armed attack composition audit")
		return
	if armour_name.is_empty():
		_fail("no armour asset available for armed attack composition audit")
		return
	equipment_attachment.call("set_armour_render_mode", ARMOUR_PROP)
	equipment_attachment.call("update_equipment", _equipment_payload(weapon_name, armour_name))
	await process_frame
	await process_frame
	for persona_value in PERSONAS:
		var persona := str(persona_value)
		var character_id := _character_id(persona)
		if not bool(equipment_attachment.call("play_character_animation", character_id, ARMED_ATTACK_KIND)):
			_fail("%s did not play %s with weapon+armour enabled" % [persona, ARMED_ATTACK_KIND])
			continue
		var state = equipment_attachment.call("animation_state_for_character", character_id)
		if typeof(state) != TYPE_DICTIONARY:
			_fail("%s did not record an animation state for weapon+armour %s" % [persona, ARMED_ATTACK_KIND])
			continue
		var state_dict := state as Dictionary
		if str(state_dict.get("requested_kind", "")) != ARMED_ATTACK_KIND:
			_fail("%s requested_kind=%s expected %s" % [persona, str(state_dict.get("requested_kind", "")), ARMED_ATTACK_KIND])
		if str(state_dict.get("resolved_kind", "")) != ARMED_ATTACK_KIND:
			_fail("%s resolved_kind=%s expected direct %s clip" % [persona, str(state_dict.get("resolved_kind", "")), ARMED_ATTACK_KIND])
		if str(state_dict.get("clip", "")).is_empty():
			_fail("%s %s clip was empty with weapon+armour enabled" % [persona, ARMED_ATTACK_KIND])
	await process_frame
	_assert_weapon_mode(WEAPON_DYNAMIC)
	_assert_weapon_equipped(weapon_name)
	_assert_armour_prop_mode()
	_assert_armour_equipped(armour_name)
	print("adherence armed attack weapon=%s armour=%s clip=%s" % [weapon_name, armour_name, ARMED_ATTACK_KIND])


func _assert_weapon_mode(expected_mode: String) -> void:
	for persona_value in PERSONAS:
		var character_id := _character_id(str(persona_value))
		var character := _registered_character(character_id)
		if str(character.get("weaponAttachMode", "")) != expected_mode:
			_fail("%s weaponAttachMode=%s expected %s" % [character_id, str(character.get("weaponAttachMode", "")), expected_mode])
		if str(character.get("weaponSocketKind", "")) != expected_mode:
			_fail("%s weaponSocketKind=%s expected %s" % [character_id, str(character.get("weaponSocketKind", "")), expected_mode])
		var socket := character.get("weaponSocket") as Node3D
		if not (socket is BoneAttachment3D):
			_fail("%s weapon socket is not a BoneAttachment3D dynamic hand-bone socket" % character_id)


func _assert_weapon_equipped(weapon_name: String) -> void:
	for persona_value in PERSONAS:
		var character_id := _character_id(str(persona_value))
		var character := _registered_character(character_id)
		if str(character.get("weaponName", "")) != weapon_name:
			_fail("%s weaponName=%s expected armed audit weapon %s" % [character_id, str(character.get("weaponName", "")), weapon_name])
		var socket := character.get("weaponSocket") as Node3D
		if socket == null or not is_instance_valid(socket):
			_fail("%s weapon socket is invalid during armed audit" % character_id)
			continue
		var visual := socket.get_node_or_null("weapon_visual")
		if visual == null or not is_instance_valid(visual):
			_fail("%s weapon visual was not attached during armed audit" % character_id)


func _assert_armour_region_mode() -> void:
	var region_nodes := _equipment_dictionary("armor_region_nodes_by_character")
	for asset in _character_assets():
		var asset_dict := asset as Dictionary
		var persona := str(asset_dict.get("personaSlot", ""))
		var character_id := _character_id(persona)
		var character := _registered_character(character_id)
		if str(character.get("armourRenderMode", "")) != ARMOUR_REGION:
			_fail("%s armourRenderMode is not adhering_region" % character_id)
		if bool(character.get("usesArmourPaint", false)):
			_fail("%s recorded retired usesArmourPaint in region mode" % character_id)
		var has_region := typeof(asset_dict.get("armorRegion", null)) == TYPE_DICTIONARY
		if has_region:
			if not bool(character.get("usesArmourRegion", false)):
				_fail("%s did not record usesArmourRegion for donor armorRegion persona" % character_id)
			_assert_tracked_nodes(region_nodes, character_id, "%s armorRegion" % persona, true)
		elif bool(character.get("usesArmourRegion", false)):
			_fail("%s recorded usesArmourRegion without an armorRegion manifest block" % character_id)


func _assert_armour_prop_mode() -> void:
	var overlay_nodes := _equipment_dictionary("armor_overlay_nodes_by_character")
	for asset in _character_assets():
		var asset_dict := asset as Dictionary
		var persona := str(asset_dict.get("personaSlot", ""))
		var character_id := _character_id(persona)
		var character := _registered_character(character_id)
		if str(character.get("armourRenderMode", "")) != ARMOUR_PROP:
			_fail("%s armourRenderMode is not modular_submesh_prop" % character_id)
		if bool(character.get("usesArmourPaint", false)):
			_fail("%s recorded retired usesArmourPaint in prop mode" % character_id)
		if typeof(asset_dict.get("armorOverlay", null)) == TYPE_DICTIONARY:
			if not bool(character.get("usesModularArmour", false)):
				_fail("%s did not record usesModularArmour for overlay persona in prop mode" % character_id)
			_assert_tracked_nodes(overlay_nodes, character_id, "%s armorOverlay" % persona, true)


func _assert_armour_equipped(armour_name: String) -> void:
	var active_overlay_count := 0
	for asset in _character_assets():
		var asset_dict := asset as Dictionary
		var persona := str(asset_dict.get("personaSlot", ""))
		var character_id := _character_id(persona)
		var character := _registered_character(character_id)
		if str(character.get("armourName", "")) != armour_name:
			_fail("%s armourName=%s expected armed audit armour %s" % [character_id, str(character.get("armourName", "")), armour_name])
		if str(character.get("armourRenderMode", "")) != ARMOUR_PROP:
			_fail("%s armourRenderMode=%s expected %s during armed audit" % [character_id, str(character.get("armourRenderMode", "")), ARMOUR_PROP])
		if bool(character.get("usesModularArmour", false)):
			active_overlay_count += 1
	if active_overlay_count == 0:
		_fail("armed attack audit did not activate any modular armour overlays")


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


func _equipment_dictionary(property_name: String) -> Dictionary:
	var value = equipment_attachment.get(property_name)
	if typeof(value) != TYPE_DICTIONARY:
		_fail("EquipmentMeshAttachment.%s is not a Dictionary" % property_name)
		return {}
	return value as Dictionary


func _assert_tracked_nodes(nodes_by_character: Dictionary, character_id: String, label: String, require_bone_attachment: bool) -> void:
	var nodes := _array_from_value(nodes_by_character.get(character_id, []))
	if nodes.is_empty():
		_fail("%s did not register any runtime nodes for %s" % [character_id, label])
		return
	var live_count := 0
	var bone_attachment_count := 0
	for node_value in nodes:
		var node := node_value as Node
		if node == null or not is_instance_valid(node):
			continue
		live_count += 1
		if node is BoneAttachment3D:
			bone_attachment_count += 1
	if live_count == 0:
		_fail("%s registered only invalid runtime nodes for %s" % [character_id, label])
	if require_bone_attachment and bone_attachment_count == 0:
		_fail("%s %s did not register a BoneAttachment3D node" % [character_id, label])


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


func _is_donor_gore_persona(persona: String) -> bool:
	return DONOR_GORE_PERSONAS.has(persona)


func _max_numeric_axis(value) -> float:
	if typeof(value) != TYPE_ARRAY:
		return 999999.0
	var values := value as Array
	if values.is_empty():
		return 999999.0
	var max_axis := 0.0
	for axis_value in values:
		if typeof(axis_value) == TYPE_INT or typeof(axis_value) == TYPE_FLOAT:
			max_axis = max(max_axis, abs(float(axis_value)))
		else:
			return 999999.0
	return max_axis


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
