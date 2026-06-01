extends SceneTree

const MANIFEST_PATH := "res://shared-harness/art-kit/manifest.json"
const ART_ROOT := "res://shared-harness/art-kit/"
const EQUIPMENT_ATTACHMENT_SCRIPT := "res://src/EquipmentMeshAttachment.gd"
const BASE_SCALE := 1.0
const PERSONAS := ["rat", "duelist", "trader", "opportunist", "paranoid", "camper", "sprinter", "vulture"]
const MIN_MODULAR_ARMOR_OVERLAYS := 3
const MESH2MOTION_ARMOR_BIND_BONES := ["spine_03", "spine_02", "spine_01", "head", "hand_l", "hand_r"]
const MODULAR_ARMOUR_PROP_APPROACH := "modular_submesh_prop"

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
	await process_frame
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
