extends SceneTree

const MANIFEST_PATH := "res://shared-harness/art-kit/manifest.json"
const ART_ROOT := "res://shared-harness/art-kit/"
const EQUIPMENT_ATTACHMENT_SCRIPT := "res://src/EquipmentMeshAttachment.gd"
const BASE_SCALE := 0.21
const PERSONAS := ["rat", "duelist", "trader", "opportunist", "paranoid", "camper", "sprinter", "vulture"]
const REQUIRED_BONES := ["hand_r"]
const REQUIRED_ANIMATION_KINDS := ["idle", "walk", "attack", "attack_unarmed", "attack_armed", "take_hit", "death", "loot"]

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
	_assert_manifest_shape(manifest)
	_make_fallback_material()
	equipment_attachment = _new_equipment_attachment()
	if equipment_attachment != null:
		get_root().add_child(equipment_attachment)
		if equipment_attachment.has_method("configure"):
			equipment_attachment.configure({})
	var characters := _character_assets(manifest)
	if characters.size() != 8:
		_fail("expected 8 character assets, found %d" % characters.size())
	var seen_personas := {}
	for asset in characters:
		if typeof(asset) != TYPE_DICTIONARY:
			continue
		var asset_dict := asset as Dictionary
		var persona := str(asset_dict.get("personaSlot", ""))
		seen_personas[persona] = true
		_verify_manifest_character(manifest, asset_dict)
	for persona in PERSONAS:
		if not seen_personas.has(str(persona)):
			_fail("missing persona in manifest assets: %s" % persona)
	for asset in characters:
		if typeof(asset) == TYPE_DICTIONARY and equipment_attachment != null:
			await _exercise_runtime_persona(asset as Dictionary)
	if equipment_attachment != null:
		equipment_attachment.queue_free()
	_finish()


func _read_manifest() -> Dictionary:
	var text := FileAccess.get_file_as_string(MANIFEST_PATH)
	var parsed = JSON.parse_string(text)
	return parsed if typeof(parsed) == TYPE_DICTIONARY else {}


func _assert_manifest_shape(manifest: Dictionary) -> void:
	if int(manifest.get("schemaVersion", -1)) != 5:
		_fail("manifest schemaVersion is not 5")
	var body: Dictionary = manifest.get("body", {})
	if body.is_empty():
		_fail("manifest.body is missing")
	elif str(body.get("armourAttachBone", "")) != "spine":
		_fail('manifest.body.armourAttachBone reserved field is not "spine"')
	var corpse_body: Dictionary = manifest.get("corpseBody", {})
	if corpse_body.is_empty():
		_fail("manifest.corpseBody is missing")


func _character_assets(manifest: Dictionary) -> Array:
	var out := []
	for asset in manifest.get("assets", []):
		if typeof(asset) != TYPE_DICTIONARY:
			continue
		var asset_dict := asset as Dictionary
		if str(asset_dict.get("category", "")) == "character":
			out.append(asset_dict)
	return out


func _verify_manifest_character(manifest: Dictionary, asset: Dictionary) -> void:
	var persona := str(asset.get("personaSlot", asset.get("id", "")))
	var skin: Dictionary = asset.get("skin", {})
	var corpse: Dictionary = asset.get("corpse", {})
	if skin.is_empty():
		_fail("%s missing skin block" % persona)
	else:
		_assert_block_params(persona, "skin", skin)
	if corpse.is_empty():
		_fail("%s missing corpse block" % persona)
	else:
		_assert_block_params(persona, "corpse", corpse)
	var body: Dictionary = manifest.get("body", {})
	var body_file := str(body.get("file", ""))
	if body_file.is_empty():
		_fail("%s cannot resolve empty manifest.body.file" % persona)
		return
	var root := _instantiate_scene("%s%s" % [ART_ROOT, body_file], persona)
	if root == null:
		return
	var state := {
		"skeleton": null,
		"player": null,
	}
	_scan_scene(root, state)
	var skeleton := state["skeleton"] as Skeleton3D
	if skeleton == null:
		_fail("%s mesh2motion body has no Skeleton3D" % persona)
	else:
		for bone_name in REQUIRED_BONES:
			if skeleton.find_bone(str(bone_name)) < 0:
				_fail("%s mesh2motion body missing bone %s" % [persona, bone_name])
		_verify_corpse_hide_bones(persona, asset, skeleton)
	var player := state["player"] as AnimationPlayer
	if player == null:
		_fail("%s mesh2motion body has no AnimationPlayer" % persona)
	else:
		print("%s clip inventory: %s" % [persona, ", ".join(PackedStringArray(player.get_animation_list()))])
		var animation: Dictionary = body.get("animation", {})
		for kind in REQUIRED_ANIMATION_KINDS:
			_verify_clip(persona, player, animation, str(kind))
		var corpse_body: Dictionary = manifest.get("corpseBody", {})
		var death_pose_clip := str(corpse_body.get("deathPoseClip", ""))
		if death_pose_clip.is_empty() or not player.has_animation(death_pose_clip):
			_fail("%s corpseBody deathPoseClip does not resolve: %s" % [persona, death_pose_clip])
	root.queue_free()


func _assert_block_params(persona: String, block_name: String, block: Dictionary) -> void:
	var approach := str(block.get("approach", ""))
	if approach.is_empty():
		_fail("%s %s.approach is empty" % [persona, block_name])
	var params = block.get("params", null)
	if typeof(params) != TYPE_DICTIONARY:
		_fail("%s %s.params is not a Dictionary" % [persona, block_name])
		return
	_assert_nested_param_paths("%s.%s.params" % [persona, block_name], params)


func _verify_corpse_hide_bones(persona: String, asset: Dictionary, skeleton: Skeleton3D) -> void:
	var corpse: Dictionary = asset.get("corpse", {})
	var params = corpse.get("params", {})
	if typeof(params) != TYPE_DICTIONARY:
		return
	for bone_value in (params as Dictionary).get("hideBones", []):
		var bone_name := str(bone_value)
		if bone_name.is_empty():
			continue
		if skeleton.find_bone(bone_name) < 0:
			_fail("%s corpse hideBone does not resolve on mesh2motion body: %s" % [persona, bone_name])


func _assert_nested_param_paths(label: String, value) -> void:
	if typeof(value) == TYPE_STRING:
		var text := str(value)
		if text.ends_with(".png") or text.ends_with(".gdshader"):
			_assert_art_path(label, text)
		return
	if typeof(value) == TYPE_ARRAY:
		var values := value as Array
		for i in range(values.size()):
			_assert_nested_param_paths("%s[%d]" % [label, i], values[i])
		return
	if typeof(value) == TYPE_DICTIONARY:
		var dict := value as Dictionary
		for key in dict.keys():
			_assert_nested_param_paths("%s.%s" % [label, str(key)], dict[key])


func _assert_art_path(label: String, relative_path: String) -> void:
	if relative_path.begins_with("res://") or relative_path.begins_with("/") or relative_path.contains(".."):
		_fail("%s is not art-kit-relative: %s" % [label, relative_path])
		return
	var resource_path := "%s%s" % [ART_ROOT, relative_path]
	if not ResourceLoader.exists(resource_path):
		_fail("%s resource does not exist: %s" % [label, resource_path])


func _verify_clip(label: String, player: AnimationPlayer, animation: Dictionary, clip_kind: String) -> void:
	var clip := str(animation.get(clip_kind, ""))
	if clip.is_empty():
		_fail("%s missing body animation clip name: %s" % [label, clip_kind])
		return
	if not player.has_animation(clip):
		_fail("%s clip does not resolve: %s=%s" % [label, clip_kind, clip])


func _instantiate_scene(resource_path: String, label: String) -> Node:
	if not ResourceLoader.exists(resource_path):
		_fail("%s resource does not exist: %s" % [label, resource_path])
		return null
	var resource = load(resource_path)
	if not resource is PackedScene:
		_fail("%s resource is not a PackedScene: %s" % [label, resource_path])
		return null
	var root = (resource as PackedScene).instantiate()
	if root == null:
		_fail("%s resource did not instantiate: %s" % [label, resource_path])
	return root


func _new_equipment_attachment() -> Node:
	var script = load(EQUIPMENT_ATTACHMENT_SCRIPT)
	if script == null:
		_fail("EquipmentMeshAttachment script did not load")
		return null
	var node = script.new()
	if not node is Node:
		_fail("EquipmentMeshAttachment did not instantiate as Node")
		return null
	(node as Node).name = "AuditEquipmentMeshAttachment"
	return node


func _exercise_runtime_persona(asset: Dictionary) -> void:
	var persona := str(asset.get("personaSlot", ""))
	var character_id := "audit-%s" % persona
	var character_node := _instantiate_runtime_character(persona, character_id)
	if character_node == null:
		return
	get_root().add_child(character_node)
	await process_frame
	if equipment_attachment.has_method("register_character"):
		equipment_attachment.register_character(character_id, character_node, persona)
	else:
		_fail("EquipmentMeshAttachment missing register_character")
		return
	await process_frame
	_apply_skin_if_possible(character_id)
	if _skin_apply_method_exists():
		_assert_applied_field(character_id, "last_applied_skin_approach", _approach_for(asset, "skin"))
	if equipment_attachment.has_method("play_character_animation"):
		equipment_attachment.play_character_animation(character_id, "death")
	if equipment_attachment.has_method("apply_corpse_skin_to_live_character"):
		equipment_attachment.apply_corpse_skin_to_live_character(character_id)
		_assert_applied_field(character_id, "last_applied_corpse_approach", _approach_for(asset, "corpse"))
	if equipment_attachment.has_method("play_character_animation"):
		equipment_attachment.play_character_animation(character_id, "idle")
	if equipment_attachment.has_method("restore_persona_skin_to_live_character"):
		equipment_attachment.restore_persona_skin_to_live_character(character_id)
		_assert_applied_field(character_id, "last_applied_skin_approach", _approach_for(asset, "skin"))
	if equipment_attachment.has_method("play_character_animation"):
		equipment_attachment.play_character_animation(character_id, "death")
	if equipment_attachment.has_method("apply_corpse_skin_to_live_character"):
		equipment_attachment.apply_corpse_skin_to_live_character(character_id)
		_assert_applied_field(character_id, "last_applied_corpse_approach", _approach_for(asset, "corpse"))
	if equipment_attachment.has_method("instantiate_persona_corpse"):
		var corpse_node = equipment_attachment.instantiate_persona_corpse(persona, "audit-corpse-%s" % persona, fallback_material, BASE_SCALE)
		if not corpse_node is Node3D:
			_fail("%s instantiate_persona_corpse did not return Node3D" % persona)
		else:
			get_root().add_child(corpse_node)
			await process_frame
			(corpse_node as Node3D).queue_free()
	character_node.queue_free()


func _instantiate_runtime_character(persona: String, character_id: String) -> Node3D:
	if not equipment_attachment.has_method("instantiate_persona_character"):
		_fail("EquipmentMeshAttachment missing instantiate_persona_character")
		return null
	var node = equipment_attachment.instantiate_persona_character(persona, "audit-character-%s" % character_id, fallback_material, BASE_SCALE)
	if not node is Node3D:
		_fail("%s instantiate_persona_character did not return Node3D" % persona)
		return null
	return node


func _apply_skin_if_possible(character_id: String) -> void:
	if equipment_attachment.has_method("apply_persona_skin"):
		equipment_attachment.call("apply_persona_skin", character_id, 0)
	elif equipment_attachment.has_method("_apply_persona_skin"):
		equipment_attachment.call("_apply_persona_skin", character_id, 0)


func _approach_for(asset: Dictionary, block_name: String) -> String:
	var block = asset.get(block_name, {})
	if typeof(block) != TYPE_DICTIONARY:
		return ""
	return str((block as Dictionary).get("approach", ""))


func _skin_apply_method_exists() -> bool:
	return equipment_attachment.has_method("apply_persona_skin") or equipment_attachment.has_method("_apply_persona_skin")


func _assert_applied_field(character_id: String, field_name: String, expected: String) -> void:
	if expected.is_empty():
		return
	var instrumented = equipment_attachment.get(field_name)
	if typeof(instrumented) == TYPE_DICTIONARY:
		var actual_from_map := str((instrumented as Dictionary).get(character_id, ""))
		if actual_from_map != expected:
			_fail("%s %s=%s, expected %s" % [character_id, field_name, actual_from_map, expected])
		return
	var character := _registered_character(character_id)
	if character.is_empty():
		_fail("%s missing registered character record" % character_id)
		return
	if not character.has(field_name):
		_fail("%s did not record %s" % [character_id, field_name])
		return
	var actual := str(character.get(field_name, ""))
	if actual != expected:
		_fail("%s %s=%s, expected %s" % [character_id, field_name, actual, expected])


func _registered_character(character_id: String) -> Dictionary:
	var registry = equipment_attachment.get("registered_characters")
	if typeof(registry) != TYPE_DICTIONARY:
		return {}
	var character = (registry as Dictionary).get(character_id, {})
	return character if typeof(character) == TYPE_DICTIONARY else {}


func _scan_scene(node: Node, state: Dictionary) -> void:
	if node is Skeleton3D and state["skeleton"] == null:
		state["skeleton"] = node
	if node is AnimationPlayer and state["player"] == null:
		state["player"] = node
	for child in node.get_children():
		_scan_scene(child, state)


func _make_fallback_material() -> void:
	fallback_material = StandardMaterial3D.new()
	fallback_material.albedo_color = Color(0.55, 0.65, 0.72)
	fallback_material.emission_enabled = true
	fallback_material.emission = Color(0.1, 0.7, 0.9)
	fallback_material.emission_energy_multiplier = 0.2


func _fail(message: String) -> void:
	failures.append(message)


func _finish() -> void:
	if failures.is_empty():
		print("verify-character-rigs PASS")
		quit(0)
		return
	for failure in failures:
		push_error(failure)
	print("verify-character-rigs FAIL")
	quit(1)
