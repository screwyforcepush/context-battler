extends SceneTree

const EquipmentMeshAttachmentScript = preload("res://src/EquipmentMeshAttachment.gd")
const EntityRendererScript = preload("res://src/EntityRenderer.gd")

const PERSONAS := ["rat", "duelist", "trader", "opportunist", "paranoid", "camper", "sprinter", "vulture"]
const FORBIDDEN_FACE_PROP_TOKENS := ["face", "eye", "jaw", "mouth", "skull"]


func _init() -> void:
	var equipment := EquipmentMeshAttachmentScript.new()
	equipment.name = "EquipmentMeshAttachmentAudit"
	root.add_child(equipment)
	equipment.configure({})
	var fallback_material := _fallback_material()
	for persona in PERSONAS:
		var character_id := "audit-%s" % persona
		var character := equipment.instantiate_persona_character(
			persona,
			"audit-character-%s" % persona,
			fallback_material,
			EntityRendererScript.CHARACTER_MODEL_SCALE
		)
		root.add_child(character)
		equipment.register_character(character_id, character, persona)
		equipment.apply_neutral_body_material(character_id, fallback_material, 0)
		_assert_body_overlay_material(equipment, character_id, false)
		equipment.apply_persona_skin(character_id, 0)
		_assert_body_overlay_material(equipment, character_id, true)
		_assert_no_face_prop_nodes(equipment, character_id)
	print("PASS audit-hell-cyborg-skin")
	quit(0)


func _fallback_material() -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(0.025, 0.028, 0.032)
	material.emission_enabled = true
	material.emission = Color(0.85, 0.05, 0.04)
	material.emission_energy_multiplier = 0.08
	material.metallic = 0.82
	material.roughness = 0.34
	return material


func _assert_body_overlay_material(equipment: Node, character_id: String, expected_enabled: bool) -> void:
	var registered = equipment.get("registered_characters")
	if typeof(registered) != TYPE_DICTIONARY:
		_fail("%s missing registered character dictionary" % character_id)
	var character: Dictionary = (registered as Dictionary).get(character_id, {})
	var meshes = character.get("bodyMeshes", [])
	if typeof(meshes) != TYPE_ARRAY or (meshes as Array).is_empty():
		_fail("%s has no registered body meshes" % character_id)
	var overlay_mesh_count := 0
	var vertex_color_overlay_count := 0
	var colored_mesh_count := 0
	for mesh_value in meshes:
		var mesh := mesh_value as MeshInstance3D
		if mesh == null or not is_instance_valid(mesh):
			continue
		var material := mesh.material_override as ShaderMaterial
		if material == null:
			continue
		var uses_albedo := bool(material.get_shader_parameter("use_uv_albedo_overlay"))
		var uses_emission := bool(material.get_shader_parameter("use_uv_emission_overlay"))
		var albedo_texture := material.get_shader_parameter("uv_albedo_overlay") as Texture2D
		var emission_texture := material.get_shader_parameter("uv_emission_overlay") as Texture2D
		if uses_albedo and uses_emission and albedo_texture != null and emission_texture != null:
			overlay_mesh_count += 1
		if bool(material.get_shader_parameter("use_vertex_color_overlay")):
			vertex_color_overlay_count += 1
		if _mesh_has_vertex_colors(mesh.mesh):
			colored_mesh_count += 1
	if expected_enabled and overlay_mesh_count <= 0:
		_fail("%s body does not have active hell-cyborg PNG overlay material" % character_id)
	if expected_enabled and vertex_color_overlay_count <= 0:
		_fail("%s body does not have vertex-color face overlay shader enabled" % character_id)
	if expected_enabled and colored_mesh_count <= 0:
		_fail("%s body mesh does not have generated vertex colors" % character_id)
	if not expected_enabled and overlay_mesh_count > 0:
		_fail("%s neutral body still has active hell-cyborg PNG overlay material" % character_id)
	if not expected_enabled and vertex_color_overlay_count > 0:
		_fail("%s neutral body still has vertex-color face overlay shader enabled" % character_id)


func _mesh_has_vertex_colors(mesh: Mesh) -> bool:
	if mesh == null:
		return false
	for surface in range(mesh.get_surface_count()):
		var arrays := mesh.surface_get_arrays(surface)
		if arrays.is_empty():
			continue
		var colors: PackedColorArray = arrays[Mesh.ARRAY_COLOR]
		if colors.size() > 0:
			return true
	return false


func _assert_no_face_prop_nodes(equipment: Node, character_id: String) -> void:
	var nodes_by_character = equipment.get("character_design_nodes_by_character")
	if typeof(nodes_by_character) != TYPE_DICTIONARY:
		return
	var nodes = (nodes_by_character as Dictionary).get(character_id, [])
	if typeof(nodes) != TYPE_ARRAY:
		return
	for node_value in nodes:
		var node := node_value as Node
		if node == null or not is_instance_valid(node):
			continue
		_assert_no_forbidden_face_token(node, character_id)


func _assert_no_forbidden_face_token(node: Node, character_id: String) -> void:
	var lower_name := String(node.name).to_lower()
	for token in FORBIDDEN_FACE_PROP_TOKENS:
		if lower_name.contains(token):
			_fail("%s still has prop-based face node: %s" % [character_id, node.get_path()])
	for child in node.get_children():
		_assert_no_forbidden_face_token(child, character_id)


func _fail(message: String) -> void:
	push_error("FAIL audit-hell-cyborg-skin: %s" % message)
	quit(1)
