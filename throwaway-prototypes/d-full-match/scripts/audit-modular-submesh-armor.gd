extends SceneTree

const MANIFEST_PATH := "res://shared-harness/art-kit/manifest.json"
const ART_ROOT := "res://shared-harness/art-kit/"
const EQUIPMENT_ATTACHMENT_SCRIPT := "res://src/EquipmentMeshAttachment.gd"
const BASE_SCALE := 1.0
const PERSONAS := ["rat", "duelist", "trader", "opportunist", "paranoid", "camper", "sprinter", "vulture"]
const MIN_MODULAR_ARMOR_OVERLAYS := 3
const MIN_ARMOUR_PROP_CATALOG_ENTRIES := 6
const MESH2MOTION_ARMOR_BIND_BONES := ["spine_03", "spine_02", "spine_01", "head", "hand_l", "hand_r"]
const MODULAR_ARMOUR_PROP_APPROACH := "modular_submesh_prop"
const ARMOUR_PROP_SELECTION_ALL := "all"
const RETIRED_ARMOUR_FLAT := "adhering" + "_region"
const ROUND11_BUCKET_HELMET_PROP_ID := "armour_prop.round11.oga_bucket_helmet"
const ROUND11_STAGED_ARMOUR_PROP_IDS := [
	"armour_prop.round11.quaternius_leather_cuirass",
	"armour_prop.round11.quaternius_black_cuirass",
	"armour_prop.round11.oga_bucket_helmet",
]
const EXISTING_PINNED_ARMOUR_PROP_IDS := [
	"armour_prop.existing.quaternius_metal_cuirass",
	"armour_prop.existing.quaternius_crown_helmet",
	"armour_prop.existing.quaternius_left_gauntlet",
]
const EXISTING_PINNED_FIT_SCALE := 0.38

var failures: Array[String] = []
var equipment_attachment: Node
var fallback_material: StandardMaterial3D


func _init() -> void:
	_run.call_deferred()


func _run() -> void:
	var manifest := _read_manifest()
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
	if equipment_attachment.has_method("_ensure_modular_armor_skin"):
		_fail("EquipmentMeshAttachment still exposes retired _ensure_modular_armor_skin Skin-bind path")
	if equipment_attachment.has_method(_retired_armour_apply_method()):
		_fail("EquipmentMeshAttachment still exposes retired flat armour apply path")
	if equipment_attachment.has_method(_retired_armour_clear_method()):
		_fail("EquipmentMeshAttachment still exposes retired flat armour clear path")
	if not equipment_attachment.has_method("set_armour_prop_selection"):
		_fail("EquipmentMeshAttachment missing set_armour_prop_selection")
	await process_frame
	_assert_armour_manifest_modes(manifest)
	var armour_props := _armour_prop_catalog(manifest)
	_assert_armour_prop_catalog(armour_props)
	var overlay_count := 0
	var declared_count := 0
	for asset in _character_assets(manifest):
		if typeof(asset) != TYPE_DICTIONARY:
			continue
		var asset_dict := asset as Dictionary
		var persona := str(asset_dict.get("personaSlot", asset_dict.get("id", "")))
		if not asset_dict.has("armorOverlay"):
			_fail("%s missing armorOverlay field" % persona)
			continue
		declared_count += 1
		var overlay_value = asset_dict.get("armorOverlay", null)
		if typeof(overlay_value) == TYPE_NIL:
			continue
		if typeof(overlay_value) != TYPE_DICTIONARY:
			_fail("%s armorOverlay must be null or a Dictionary" % persona)
			continue
		var armor_overlay := overlay_value as Dictionary
		overlay_count += 1
		await _audit_persona(asset_dict, armor_overlay)
	if declared_count != PERSONAS.size():
		_fail("armorOverlay field declared on %d/%d character personas" % [declared_count, PERSONAS.size()])
	if overlay_count < MIN_MODULAR_ARMOR_OVERLAYS:
		_fail("expected at least %d non-null modular armorOverlay entries, found %d" % [MIN_MODULAR_ARMOR_OVERLAYS, overlay_count])
	await _audit_catalog_prop_selection(manifest, armour_props)
	if equipment_attachment != null:
		equipment_attachment.queue_free()
	_finish()


func _read_manifest() -> Dictionary:
	var text := FileAccess.get_file_as_string(MANIFEST_PATH)
	var parsed = JSON.parse_string(text)
	return parsed if typeof(parsed) == TYPE_DICTIONARY else {}


func _character_assets(manifest: Dictionary) -> Array:
	var out := []
	for asset in manifest.get("assets", []):
		if typeof(asset) != TYPE_DICTIONARY:
			continue
		var asset_dict := asset as Dictionary
		if str(asset_dict.get("category", "")) == "character":
			out.append(asset_dict)
	return out


func _armour_prop_catalog(manifest: Dictionary) -> Array:
	var value = manifest.get("armourProps", [])
	if typeof(value) == TYPE_ARRAY:
		return value as Array
	return []


func _catalog_prop_by_id(armour_props: Array, prop_id: String) -> Dictionary:
	for value in armour_props:
		if typeof(value) != TYPE_DICTIONARY:
			continue
		var prop := value as Dictionary
		if str(prop.get("id", "")) == prop_id:
			return prop
	return {}


func _assert_armour_prop_catalog(armour_props: Array) -> void:
	if armour_props.size() < MIN_ARMOUR_PROP_CATALOG_ENTRIES:
		_fail("manifest armourProps expected at least %d entries, found %d" % [MIN_ARMOUR_PROP_CATALOG_ENTRIES, armour_props.size()])
	var seen := {}
	for staged_id in ROUND11_STAGED_ARMOUR_PROP_IDS:
		seen[staged_id] = false
	for value in armour_props:
		if typeof(value) != TYPE_DICTIONARY:
			_fail("manifest armourProps entry is not a Dictionary")
			continue
		var prop := value as Dictionary
		var prop_id := str(prop.get("id", ""))
		if prop_id.is_empty():
			_fail("manifest armourProps entry missing id")
		elif not prop_id.begins_with("armour_prop."):
			_fail("manifest armourProps id must begin with armour_prop.: %s" % prop_id)
		if seen.has(prop_id):
			seen[prop_id] = true
		if str(prop.get("approach", "")) != MODULAR_ARMOUR_PROP_APPROACH:
			_fail("%s approach is not %s" % [prop_id, MODULAR_ARMOUR_PROP_APPROACH])
		if str(prop.get("adherenceApproach", "")) != "bone_attached":
			_fail("%s adherenceApproach is not bone_attached" % prop_id)
		if str(prop.get("bindBone", "")).is_empty():
			_fail("%s bindBone is empty" % prop_id)
		elif not MESH2MOTION_ARMOR_BIND_BONES.has(str(prop.get("bindBone", ""))):
			_fail("%s bindBone is outside mesh2motion vocabulary: %s" % [prop_id, str(prop.get("bindBone", ""))])
		_assert_fit_scale_block(prop_id, prop, true)
		if EXISTING_PINNED_ARMOUR_PROP_IDS.has(prop_id):
			var scale := _fit_scale_value(prop)
			if abs(scale - EXISTING_PINNED_FIT_SCALE) > 0.000001:
				_fail("%s existing validated prop fitScale must remain %.2f, got %.6f" % [prop_id, EXISTING_PINNED_FIT_SCALE, scale])
		var file := str(prop.get("file", ""))
		if file.is_empty() or not file.begins_with("armour/"):
			_fail("%s file must live under art-kit/armour/: %s" % [prop_id, file])
		else:
			var resource_path := "%s%s" % [ART_ROOT, file]
			if not ResourceLoader.exists(resource_path):
				_fail("%s resource does not exist: %s" % [prop_id, resource_path])
			if file.get_extension().to_lower() in ["glb", "gltf", "fbx"] and not FileAccess.file_exists("%s.import" % resource_path):
				_fail("%s missing Godot import sidecar: %s.import" % [prop_id, resource_path])
		var source = prop.get("source", {})
		if typeof(source) != TYPE_DICTIONARY or str((source as Dictionary).get("pageUrl", "")).is_empty():
			_fail("%s source.pageUrl missing" % prop_id)
		var license = prop.get("license", {})
		if typeof(license) != TYPE_DICTIONARY or str((license as Dictionary).get("spdx", "")) != "CC0-1.0":
			_fail("%s license.spdx is not CC0-1.0" % prop_id)
		if not str(prop.get("sha256", "")).length() == 64:
			_fail("%s sha256 must be recorded" % prop_id)
	for staged_id in ROUND11_STAGED_ARMOUR_PROP_IDS:
		if not bool(seen.get(staged_id, false)):
			_fail("manifest armourProps missing staged Round-11 prop %s" % staged_id)


func _assert_armour_manifest_modes(manifest: Dictionary) -> void:
	var round9_value = manifest.get("round9Adherence", {})
	if typeof(round9_value) != TYPE_DICTIONARY:
		_fail("manifest missing round9Adherence block")
		return
	var approaches = (round9_value as Dictionary).get("armorApproaches", [])
	if typeof(approaches) != TYPE_ARRAY:
		_fail("round9Adherence.armorApproaches must be an Array")
		return
	var modes := {}
	var approach_array := approaches as Array
	for value in approach_array:
		if typeof(value) != TYPE_DICTIONARY:
			continue
		var mode := str((value as Dictionary).get("mode", ""))
		if not mode.is_empty():
			modes[mode] = true
	if modes.size() != 1 or not modes.has(MODULAR_ARMOUR_PROP_APPROACH):
		_fail("round9Adherence.armorApproaches must declare modular_submesh_prop only")
	if modes.has(RETIRED_ARMOUR_FLAT):
		_fail("round9Adherence.armorApproaches still declares retired flat armour mode")


func _audit_persona(asset: Dictionary, armor_overlay: Dictionary) -> void:
	var persona := str(asset.get("personaSlot", asset.get("id", "")))
	_assert_overlay_manifest_shape(asset, persona, armor_overlay)
	var character_id := "audit-modular-armor-%s" % persona
	var character_node := _instantiate_runtime_character(persona, character_id)
	if character_node == null:
		return
	get_root().add_child(character_node)
	await process_frame
	if equipment_attachment.has_method("register_character"):
		equipment_attachment.register_character(character_id, character_node, persona)
	else:
		_fail("%s EquipmentMeshAttachment missing register_character" % persona)
		character_node.queue_free()
		return
	await process_frame
	if not equipment_attachment.has_method("_apply_modular_submesh_armor"):
		_fail("%s EquipmentMeshAttachment missing _apply_modular_submesh_armor" % persona)
		character_node.queue_free()
		return
	var applied := bool(equipment_attachment.call("_apply_modular_submesh_armor", character_id, armor_overlay, 1))
	await process_frame
	if not applied:
		_fail("%s _apply_modular_submesh_armor returned false" % persona)
		character_node.queue_free()
		return
	var character := _registered_character(character_id)
	var skeleton := character.get("skeleton") as Skeleton3D
	if skeleton == null:
		_fail("%s registered character has no Skeleton3D" % persona)
	var expected_bind_bone := _expected_armour_bind_bone(asset, armor_overlay)
	if skeleton != null and not expected_bind_bone.is_empty() and skeleton.find_bone(expected_bind_bone) < 0:
		_fail("%s expected armour bind bone does not resolve on active body: %s" % [persona, expected_bind_bone])
	var armor_nodes := _tracked_armor_nodes(character_id)
	if armor_nodes.is_empty():
		_fail("%s no tracked armor_overlay_nodes_by_character entries" % persona)
	for node in armor_nodes:
		var socket := node as BoneAttachment3D
		if socket == null or not is_instance_valid(socket):
			_fail("%s tracked armor node is not a valid BoneAttachment3D: %s" % [persona, _class_name(node)])
			continue
		if skeleton != null:
			_assert_socket_matches_skeleton(persona, socket, skeleton, expected_bind_bone)
	if equipment_attachment.has_method("_clear_modular_submesh_armor"):
		equipment_attachment.call("_clear_modular_submesh_armor", character_id)
		await process_frame
		_assert_cleared(persona, armor_nodes, character_id)
	else:
		_fail("%s EquipmentMeshAttachment missing _clear_modular_submesh_armor" % persona)
	character_node.queue_free()


func _audit_catalog_prop_selection(_manifest: Dictionary, armour_props: Array) -> void:
	if equipment_attachment == null or not equipment_attachment.has_method("set_armour_prop_selection"):
		return
	var selected_prop := _catalog_prop_by_id(armour_props, ROUND11_BUCKET_HELMET_PROP_ID)
	if selected_prop.is_empty():
		_fail("cannot audit selected armour prop; catalog missing %s" % ROUND11_BUCKET_HELMET_PROP_ID)
		return
	equipment_attachment.call("set_armour_prop_selection", str(selected_prop.get("id", "")))
	for persona in PERSONAS:
		var character_id := "audit-armour-prop-selection-%s" % persona
		var character_node := _instantiate_runtime_character(persona, character_id)
		if character_node == null:
			continue
		get_root().add_child(character_node)
		await process_frame
		equipment_attachment.register_character(character_id, character_node, persona)
		await process_frame
		equipment_attachment.update_equipment({
			character_id: {
				"armour": {"name": "plate"},
			},
		})
		await process_frame
		var character := _registered_character(character_id)
		if str(character.get("armourPropSelection", "")) != str(selected_prop.get("id", "")):
			_fail("%s did not record selected armour prop id" % persona)
		if str(character.get("armourPropId", "")) != str(selected_prop.get("id", "")):
			_fail("%s did not apply selected armour prop id" % persona)
		_assert_selection_socket(persona, character_id, selected_prop)
		if equipment_attachment.has_method("_clear_modular_submesh_armor"):
			equipment_attachment.call("_clear_modular_submesh_armor", character_id)
		character_node.queue_free()
	equipment_attachment.call("set_armour_prop_selection", ARMOUR_PROP_SELECTION_ALL)
	var default_id := "audit-armour-prop-selection-default"
	var default_node := _instantiate_runtime_character("duelist", default_id)
	if default_node != null:
		get_root().add_child(default_node)
		await process_frame
		equipment_attachment.register_character(default_id, default_node, "duelist")
		await process_frame
		equipment_attachment.update_equipment({
			default_id: {
				"armour": {"name": "plate"},
			},
		})
		await process_frame
		var default_character := _registered_character(default_id)
		if str(default_character.get("armourPropSelection", "")) != ARMOUR_PROP_SELECTION_ALL:
			_fail("all/default armour prop selection was not recorded")
		_assert_selection_socket("duelist default", default_id, _catalog_prop_by_id(armour_props, "armour_prop.existing.quaternius_metal_cuirass"))
		if equipment_attachment.has_method("_clear_modular_submesh_armor"):
			equipment_attachment.call("_clear_modular_submesh_armor", default_id)
		default_node.queue_free()


func _assert_selection_socket(persona: String, character_id: String, prop: Dictionary) -> void:
	var armor_nodes := _tracked_armor_nodes(character_id)
	if armor_nodes.is_empty():
		_fail("%s selected armour prop created no tracked socket" % persona)
		return
	var character := _registered_character(character_id)
	var skeleton := character.get("skeleton") as Skeleton3D
	var expected_bind_bone := str(prop.get("bindBone", ""))
	for node in armor_nodes:
		var socket := node as BoneAttachment3D
		if socket == null or not is_instance_valid(socket):
			_fail("%s selected armour prop node is not a BoneAttachment3D" % persona)
			continue
		if skeleton != null:
			_assert_socket_matches_skeleton(persona, socket, skeleton, expected_bind_bone)


func _assert_overlay_manifest_shape(asset: Dictionary, persona: String, armor_overlay: Dictionary) -> void:
	if str(armor_overlay.get("adherenceApproach", "")) != "bone_attached":
		_fail("%s armorOverlay.adherenceApproach is not bone_attached" % persona)
	if str(armor_overlay.get("approach", "")) != MODULAR_ARMOUR_PROP_APPROACH:
		_fail("%s armorOverlay.approach is not %s" % [persona, MODULAR_ARMOUR_PROP_APPROACH])
	var bind_bone := str(armor_overlay.get("bindBone", ""))
	if bind_bone.is_empty():
		_fail("%s armorOverlay.bindBone is required for the universal mesh2motion skeleton" % persona)
	elif not MESH2MOTION_ARMOR_BIND_BONES.has(bind_bone):
		_fail("%s armorOverlay.bindBone is outside mesh2motion vocabulary: %s" % [persona, bind_bone])
	if not _has_source_pack(armor_overlay.get("sourcePack", null)):
		_fail("%s armorOverlay.sourcePack missing or empty" % persona)
	_assert_fit_scale_block("%s armorOverlay" % persona, armor_overlay, true)
	var catalog_prop_id := str(armor_overlay.get("catalogPropId", ""))
	if EXISTING_PINNED_ARMOUR_PROP_IDS.has(catalog_prop_id):
		var overlay_scale := _fit_scale_value(armor_overlay)
		if abs(overlay_scale - EXISTING_PINNED_FIT_SCALE) > 0.000001:
			_fail("%s armorOverlay existing validated prop fitScale must remain %.2f, got %.6f" % [persona, EXISTING_PINNED_FIT_SCALE, overlay_scale])
	if catalog_prop_id.is_empty():
		_fail("%s armorOverlay.catalogPropId is empty" % persona)
	var file := str(armor_overlay.get("file", ""))
	if file.is_empty():
		_fail("%s armorOverlay.file is empty" % persona)
		return
	if file.begins_with("res://") or file.begins_with("/") or file.contains(".."):
		_fail("%s armorOverlay.file must be art-kit-relative: %s" % [persona, file])
	if not file.begins_with("armour/"):
		_fail("%s armorOverlay.file must live under art-kit/armour/: %s" % [persona, file])
	var resource_path := "%s%s" % [ART_ROOT, file]
	if not ResourceLoader.exists(resource_path):
		_fail("%s armorOverlay.file resource does not exist: %s" % [persona, resource_path])
	if file.get_extension().to_lower() in ["glb", "gltf", "fbx"] and not FileAccess.file_exists("%s.import" % resource_path):
		_fail("%s armorOverlay.file is missing .import sidecar: %s.import" % [persona, resource_path])


func _assert_fit_scale_block(context: String, block: Dictionary, require_offset: bool) -> void:
	if not block.has("fitScale"):
		_fail("%s missing fitScale" % context)
	var scale := _fit_scale_value(block)
	if scale <= 0.0 or scale > 3.0:
		_fail("%s fitScale must be > 0 and <= 3, got %s" % [context, str(block.get("fitScale", null))])
	if require_offset and not _has_vector3_array(block.get("propOffset", null)):
		_fail("%s propOffset must be [x,y,z]" % context)


func _fit_scale_value(block: Dictionary) -> float:
	var value = block.get("fitScale", block.get("propScale", null))
	if typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT:
		return float(value)
	return -1.0


func _has_vector3_array(value) -> bool:
	return typeof(value) == TYPE_ARRAY and (value as Array).size() >= 3


func _has_source_pack(value) -> bool:
	match typeof(value):
		TYPE_STRING:
			return not str(value).strip_edges().is_empty()
		TYPE_DICTIONARY:
			return not str((value as Dictionary).get("name", "")).strip_edges().is_empty()
		_:
			return false


func _assert_socket_matches_skeleton(persona: String, socket: BoneAttachment3D, skeleton: Skeleton3D, expected_bind_bone: String) -> void:
	if not _node_contains(skeleton, socket):
		_fail("%s armor socket is not parented under active Skeleton3D: %s" % [persona, socket.get_path()])
	if socket.get_parent() != skeleton:
		_fail("%s armor socket must be a direct child of the active Skeleton3D: %s" % [persona, socket.get_path()])
	var actual_bone := str(socket.bone_name)
	if actual_bone.is_empty():
		_fail("%s armor socket has empty bone_name" % persona)
	elif not expected_bind_bone.is_empty() and actual_bone != expected_bind_bone:
		_fail("%s armor socket bone_name=%s expected %s" % [persona, actual_bone, expected_bind_bone])
	if not actual_bone.is_empty() and skeleton.find_bone(actual_bone) < 0:
		_fail("%s armor socket bone_name does not resolve on active Skeleton3D: %s" % [persona, actual_bone])
	var prop_meshes := _mesh_descendants(socket)
	if prop_meshes.is_empty():
		_fail("%s armor socket has no child prop MeshInstance3D nodes: %s" % [persona, socket.get_path()])
	for mesh_value in prop_meshes:
		var mesh := mesh_value as MeshInstance3D
		if mesh == null or not is_instance_valid(mesh):
			continue
		_assert_prop_mesh_uses_socket_transform(persona, socket, mesh)
	if not prop_meshes.is_empty():
		print("OK %s modular armour socket=%s bone=%s prop_meshes=%d" % [persona, socket.get_path(), actual_bone, prop_meshes.size()])


func _assert_prop_mesh_uses_socket_transform(persona: String, socket: BoneAttachment3D, mesh: MeshInstance3D) -> void:
	if not _node_contains(socket, mesh):
		_fail("%s armour prop mesh is not under tracked BoneAttachment3D: %s" % [persona, mesh.get_path()])
	if mesh.mesh == null:
		_fail("%s armour prop mesh has no Mesh resource: %s" % [persona, mesh.get_path()])
	if mesh.skin != null:
		_fail("%s armour prop mesh still has old Skin bind path: %s" % [persona, mesh.get_path()])
	if not str(mesh.skeleton).is_empty():
		_fail("%s armour prop mesh should not require MeshInstance3D.skeleton Skin path: %s" % [persona, str(mesh.skeleton)])


func _expected_armour_bind_bone(asset: Dictionary, armor_overlay: Dictionary) -> String:
	var bind_bone := str(armor_overlay.get("bindBone", ""))
	return bind_bone if not bind_bone.is_empty() else "spine_03"


func _instantiate_runtime_character(persona: String, character_id: String) -> Node3D:
	if not equipment_attachment.has_method("instantiate_persona_character"):
		_fail("EquipmentMeshAttachment missing instantiate_persona_character")
		return null
	var node = equipment_attachment.instantiate_persona_character(persona, "audit-character-%s" % character_id, fallback_material, BASE_SCALE)
	if not node is Node3D:
		_fail("%s instantiate_persona_character did not return Node3D" % persona)
		return null
	return node


func _new_equipment_attachment() -> Node:
	var script = load(EQUIPMENT_ATTACHMENT_SCRIPT)
	if script == null:
		_fail("EquipmentMeshAttachment script did not load")
		return null
	var node = script.new()
	if not node is Node:
		_fail("EquipmentMeshAttachment did not instantiate as Node")
		return null
	(node as Node).name = "AuditModularSubmeshArmorEquipmentAttachment"
	return node


func _registered_character(character_id: String) -> Dictionary:
	var registry = equipment_attachment.get("registered_characters")
	if typeof(registry) != TYPE_DICTIONARY:
		return {}
	var character = (registry as Dictionary).get(character_id, {})
	return character if typeof(character) == TYPE_DICTIONARY else {}


func _tracked_armor_nodes(character_id: String) -> Array:
	var out := []
	var bucket = equipment_attachment.get("armor_overlay_nodes_by_character")
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


func _mesh_descendants(root: Node) -> Array:
	var out := []
	_collect_mesh_descendants(root, out)
	return out


func _collect_mesh_descendants(node: Node, out: Array) -> void:
	if node == null:
		return
	if node is MeshInstance3D:
		out.append(node)
	for child in node.get_children():
		_collect_mesh_descendants(child, out)


func _assert_cleared(persona: String, previous_nodes: Array, character_id: String) -> void:
	var bucket_after_clear := _tracked_armor_nodes(character_id)
	if not bucket_after_clear.is_empty():
		_fail("%s armor_overlay_nodes_by_character still has nodes after clear" % persona)
	for node_value in previous_nodes:
		if node_value != null and is_instance_valid(node_value):
			var node := node_value as Node
			if node != null:
				_fail("%s armor node still valid after clear: %s" % [persona, node.get_path()])


func _node_contains(root: Node, candidate: Node) -> bool:
	if root == null or candidate == null or not is_instance_valid(root) or not is_instance_valid(candidate):
		return false
	return root == candidate or root.is_ancestor_of(candidate)


func _class_name(value) -> String:
	if value == null:
		return "<null>"
	if value is Object:
		return (value as Object).get_class()
	return type_string(typeof(value))


func _retired_armour_apply_method() -> String:
	return "_apply_" + "adhering" + "_region" + "_armour"


func _retired_armour_clear_method() -> String:
	return "_clear_" + "adhering" + "_region" + "_armour"


func _make_fallback_material() -> void:
	fallback_material = StandardMaterial3D.new()
	fallback_material.albedo_color = Color(0.45, 0.56, 0.64)
	fallback_material.emission_enabled = true
	fallback_material.emission = Color(0.08, 0.48, 0.9)
	fallback_material.emission_energy_multiplier = 0.16


func _fail(message: String) -> void:
	failures.append(message)


func _finish() -> void:
	if failures.is_empty():
		print("audit-modular-submesh-armor PASS")
		quit(0)
		return
	for failure in failures:
		push_error(failure)
	print("audit-modular-submesh-armor FAIL")
	quit(1)
