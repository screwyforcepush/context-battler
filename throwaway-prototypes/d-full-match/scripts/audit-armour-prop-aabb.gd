extends SceneTree

const EQUIPMENT_ATTACHMENT_SCRIPT := "res://src/EquipmentMeshAttachment.gd"
const EPSILON := 0.0001
const BASE_SCALE := 1.0
const PERSONA := "duelist"
const ARMOUR_ITEM_NAME := "plate"
const ROUND12_ARMOUR_PROP_IDS := [
	"armour_prop.round11.quaternius_leather_cuirass",
	"armour_prop.round11.quaternius_black_cuirass",
	"armour_prop.round11.oga_bucket_helmet",
]

var failures: Array[String] = []
var equipment_attachment: Node
var fallback_material: StandardMaterial3D


func _init() -> void:
	_run.call_deferred()


func _run() -> void:
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
	await process_frame
	var armour_props := _equipment_dictionary("armour_prop_catalog_by_id")
	for prop_id in ROUND12_ARMOUR_PROP_IDS:
		var prop = armour_props.get(prop_id, {})
		if typeof(prop) != TYPE_DICTIONARY:
			_fail("manifest armourProps missing %s" % prop_id)
			continue
		var prop_dict := prop as Dictionary
		_assert_round12_schema(prop_id, prop_dict)
		await _audit_prop_visibility(prop_id, prop_dict)
	if equipment_attachment != null:
		equipment_attachment.queue_free()
	_finish()


func _assert_round12_schema(prop_id: String, prop: Dictionary) -> void:
	var fit_value = prop.get("fitScale", null)
	if not _is_number(fit_value):
		_fail("%s missing numeric fitScale" % prop_id)
	elif float(fit_value) <= 0.0 or float(fit_value) > 3.0:
		_fail("%s fitScale %.4f outside (0, 3]" % [prop_id, float(fit_value)])
	var offset = prop.get("propOffset", null)
	if typeof(offset) != TYPE_ARRAY or (offset as Array).size() < 3:
		_fail("%s missing propOffset [x,y,z]" % prop_id)


func _audit_prop_visibility(prop_id: String, prop: Dictionary) -> void:
	if not equipment_attachment.has_method("set_armour_prop_selection"):
		_fail("EquipmentMeshAttachment missing set_armour_prop_selection")
		return
	equipment_attachment.call("set_armour_prop_selection", prop_id)
	var character_id := "audit-armour-aabb-%s" % prop_id.replace(".", "-")
	var character_node := _instantiate_runtime_character(PERSONA, character_id)
	if character_node == null:
		return
	get_root().add_child(character_node)
	await process_frame
	equipment_attachment.register_character(character_id, character_node, PERSONA)
	await process_frame
	equipment_attachment.update_equipment({
		character_id: {
			"armour": {"name": ARMOUR_ITEM_NAME},
		},
	})
	await process_frame
	var character := _registered_character(character_id)
	if str(character.get("armourPropSelection", "")) != prop_id:
		_fail("%s runtime did not record selected prop id" % prop_id)
	if str(character.get("armourPropId", "")) != prop_id:
		_fail("%s runtime did not apply selected prop id" % prop_id)
	var body_record := _body_world_aabb(character)
	var prop_record := _prop_world_aabb(character_id)
	if not bool(body_record.get("has_aabb", false)):
		_fail("%s body world AABB was empty" % prop_id)
	if not bool(prop_record.get("has_aabb", false)):
		_fail("%s prop world AABB was empty" % prop_id)
	if bool(body_record.get("has_aabb", false)) and bool(prop_record.get("has_aabb", false)):
		var body_aabb: AABB = body_record["aabb"]
		var prop_aabb: AABB = prop_record["aabb"]
		_assert_prop_against_body(prop_id, str(prop.get("slot", "")), body_aabb, prop_aabb, int(prop_record.get("mesh_count", 0)))
	if equipment_attachment.has_method("_clear_modular_submesh_armor"):
		equipment_attachment.call("_clear_modular_submesh_armor", character_id)
	character_node.queue_free()
	await process_frame


func _assert_prop_against_body(prop_id: String, slot: String, body_aabb: AABB, prop_aabb: AABB, mesh_count: int) -> void:
	var body_height: float = max(body_aabb.size.y, EPSILON)
	var prop_extent: float = _max_extent(prop_aabb.size)
	var extent_ratio: float = prop_extent / body_height
	var ratio_limits: Vector2 = _slot_extent_ratio_limits(slot)
	if extent_ratio < ratio_limits.x:
		_fail("%s %s prop/body extent ratio %.4f below %.4f (tiny or buried)" % [prop_id, slot, extent_ratio, ratio_limits.x])
	if extent_ratio > ratio_limits.y:
		_fail("%s %s prop/body extent ratio %.4f above %.4f (gigantic)" % [prop_id, slot, extent_ratio, ratio_limits.y])
	var near_shell: AABB = body_aabb.grow(_slot_near_surface_tolerance(slot, body_height))
	if not prop_aabb.intersects(near_shell):
		_fail("%s %s prop AABB is not near body surface" % [prop_id, slot])
	var core: AABB = _slot_core_aabb(body_aabb, slot)
	var prop_volume: float = _volume(prop_aabb)
	var core_ratio: float = _intersection_volume(prop_aabb, core) / max(prop_volume, EPSILON)
	if core_ratio > _slot_max_core_ratio(slot):
		_fail("%s %s prop AABB is %.2f inside body core (buried)" % [prop_id, slot, core_ratio])
	var center := _aabb_center(prop_aabb)
	var expected_center := _slot_expected_center(body_aabb, slot)
	var allowed_delta := _slot_center_allowance(body_aabb, slot)
	var delta := center - expected_center
	if abs(delta.x) > allowed_delta.x or abs(delta.y) > allowed_delta.y or abs(delta.z) > allowed_delta.z:
		_fail("%s %s center %s is not near expected slot center %s (delta %s, allowed %s)" % [prop_id, slot, str(center), str(expected_center), str(delta), str(allowed_delta)])
	print("OK %s slot=%s meshes=%d prop_extent=%.4f body_h=%.4f ratio=%.4f core_ratio=%.3f center=%s" % [prop_id, slot, mesh_count, prop_extent, body_height, extent_ratio, core_ratio, str(center)])


func _slot_extent_ratio_limits(slot: String) -> Vector2:
	match slot:
		"chest":
			return Vector2(0.08, 0.55)
		"helmet":
			return Vector2(0.04, 0.32)
		"gauntlet":
			return Vector2(0.03, 0.22)
		_:
			return Vector2(0.04, 0.55)


func _slot_near_surface_tolerance(slot: String, body_height: float) -> float:
	match slot:
		"helmet":
			return body_height * 0.08
		"chest":
			return body_height * 0.07
		_:
			return body_height * 0.08


func _slot_max_core_ratio(slot: String) -> float:
	match slot:
		"helmet":
			return 0.96
		"chest":
			return 0.94
		_:
			return 0.96


func _slot_expected_center(body_aabb: AABB, slot: String) -> Vector3:
	var base := body_aabb.position
	var size := body_aabb.size
	match slot:
		"helmet":
			return base + Vector3(size.x * 0.5, size.y * 0.88, size.z * 0.5)
		"chest":
			return base + Vector3(size.x * 0.5, size.y * 0.59, size.z * 0.5)
		"gauntlet":
			return base + Vector3(size.x * 0.25, size.y * 0.48, size.z * 0.5)
		_:
			return base + size * 0.5


func _slot_center_allowance(body_aabb: AABB, slot: String) -> Vector3:
	var size := body_aabb.size
	match slot:
		"helmet":
			return Vector3(max(size.x * 0.65, 0.09), max(size.y * 0.16, 0.14), max(size.z * 1.10, 0.10))
		"chest":
			return Vector3(max(size.x * 0.80, 0.12), max(size.y * 0.22, 0.18), max(size.z * 1.45, 0.14))
		"gauntlet":
			return Vector3(max(size.x * 0.90, 0.12), max(size.y * 0.24, 0.16), max(size.z * 1.30, 0.12))
		_:
			return size * 0.4


func _slot_core_aabb(body_aabb: AABB, slot: String) -> AABB:
	var center := _aabb_center(body_aabb)
	var size := body_aabb.size
	var core_size := Vector3(max(size.x * 0.42, 0.06), size.y, max(size.z * 0.42, 0.06))
	if slot == "helmet":
		core_size = Vector3(max(size.x * 0.34, 0.05), size.y, max(size.z * 0.34, 0.05))
	return AABB(center - core_size * 0.5, core_size)


func _body_world_aabb(character: Dictionary) -> Dictionary:
	var meshes = character.get("bodyMeshes", [])
	if typeof(meshes) != TYPE_ARRAY:
		return {"has_aabb": false, "aabb": AABB(), "mesh_count": 0}
	return _merge_mesh_world_aabbs(meshes as Array)


func _prop_world_aabb(character_id: String) -> Dictionary:
	var meshes := []
	for node in _tracked_armor_nodes(character_id):
		_collect_mesh_descendants(node, meshes)
	return _merge_mesh_world_aabbs(meshes)


func _merge_mesh_world_aabbs(meshes: Array) -> Dictionary:
	var has_aabb := false
	var merged := AABB()
	var mesh_count := 0
	for value in meshes:
		var mesh := value as MeshInstance3D
		if mesh == null or not is_instance_valid(mesh) or mesh.mesh == null:
			continue
		var local_aabb := mesh.get_aabb()
		if not _has_volume(local_aabb):
			continue
		var world_aabb: AABB = mesh.global_transform * local_aabb
		if not _has_volume(world_aabb):
			continue
		merged = merged.merge(world_aabb) if has_aabb else world_aabb
		has_aabb = true
		mesh_count += 1
	return {
		"has_aabb": has_aabb,
		"aabb": merged,
		"mesh_count": mesh_count,
	}


func _tracked_armor_nodes(character_id: String) -> Array:
	var out := []
	var bucket := _equipment_dictionary("armor_overlay_nodes_by_character")
	var values = bucket.get(character_id, [])
	if typeof(values) != TYPE_ARRAY:
		return out
	for value in values as Array:
		var node := value as Node
		if node != null and is_instance_valid(node):
			out.append(node)
	return out


func _collect_mesh_descendants(node: Node, out: Array) -> void:
	if node == null:
		return
	if node is MeshInstance3D:
		out.append(node)
	for child in node.get_children():
		_collect_mesh_descendants(child, out)


func _instantiate_runtime_character(persona: String, character_id: String) -> Node3D:
	if not equipment_attachment.has_method("instantiate_persona_character"):
		_fail("EquipmentMeshAttachment missing instantiate_persona_character")
		return null
	var node = equipment_attachment.instantiate_persona_character(persona, "audit-character-%s" % character_id, fallback_material, BASE_SCALE)
	if not node is Node3D:
		_fail("%s instantiate_persona_character did not return Node3D" % persona)
		return null
	return node as Node3D


func _new_equipment_attachment() -> Node:
	var script = load(EQUIPMENT_ATTACHMENT_SCRIPT)
	if script == null:
		_fail("EquipmentMeshAttachment script did not load")
		return null
	var node = script.new()
	if not node is Node:
		_fail("EquipmentMeshAttachment did not instantiate as Node")
		return null
	(node as Node).name = "AuditArmourPropAabbEquipmentAttachment"
	return node as Node


func _registered_character(character_id: String) -> Dictionary:
	var registry := _equipment_dictionary("registered_characters")
	var character = registry.get(character_id, {})
	return character if typeof(character) == TYPE_DICTIONARY else {}


func _equipment_dictionary(property_name: String) -> Dictionary:
	if equipment_attachment == null:
		return {}
	var value = equipment_attachment.get(property_name)
	return value if typeof(value) == TYPE_DICTIONARY else {}


func _has_volume(aabb: AABB) -> bool:
	return aabb.size.x > EPSILON and aabb.size.y > EPSILON and aabb.size.z > EPSILON


func _volume(aabb: AABB) -> float:
	if not _has_volume(aabb):
		return 0.0
	return aabb.size.x * aabb.size.y * aabb.size.z


func _intersection_volume(a: AABB, b: AABB) -> float:
	if not a.intersects(b):
		return 0.0
	return _volume(a.intersection(b))


func _max_extent(size: Vector3) -> float:
	return max(size.x, max(size.y, size.z))


func _aabb_center(aabb: AABB) -> Vector3:
	return aabb.position + aabb.size * 0.5


func _is_number(value) -> bool:
	return typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT


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
		print("audit-armour-prop-aabb PASS")
		quit(0)
		return
	for failure in failures:
		push_error(failure)
	print("audit-armour-prop-aabb FAIL")
	quit(1)
