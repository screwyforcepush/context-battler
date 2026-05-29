extends Node

const MANIFEST_PATH := "res://shared-harness/art-kit/manifest.json"
const ART_ROOT := "res://shared-harness/art-kit/"
const WEAPON_SOCKET_NAME := "weapon_socket"
const ARMOUR_SOCKET_NAME := "armour_socket"
const WEAPON_ATTACHMENT_SCALE := 0.22
const FALLBACK_CHARACTER_HALF_HEIGHT := 0.17
const ADHERENCE_BONE_ATTACHED := "adherence_bone_attached"
const ADHERENCE_MESH_BAKED := "adherence_mesh_baked"
const ADHERENCE_UV_PAINTED := "adherence_uv_painted"
const ADHERENCE_MODULAR_SUBMESH := "adherence_modular_submesh"

var manifest: Dictionary = {}
var character_assets_by_persona: Dictionary = {}
var weapon_assets_by_name: Dictionary = {}
var armour_assets_by_name: Dictionary = {}
var environment_assets_by_role: Dictionary = {}
var corpse_body_asset: Dictionary = {}
var loaded_scenes: Dictionary = {}
var registered_characters: Dictionary = {}
var equipped_state_by_character: Dictionary = {}
var body_materials_by_character: Dictionary = {}
var skin_mark_nodes_by_character: Dictionary = {}
var corpse_mark_nodes_by_character: Dictionary = {}
var corpse_bone_mutations_by_character: Dictionary = {}
var armor_overlay_nodes_by_character: Dictionary = {}
var last_applied_skin_approach: Dictionary = {}
var last_applied_corpse_approach: Dictionary = {}
var mat_weapon_low: StandardMaterial3D
var mat_weapon_mid: StandardMaterial3D
var mat_weapon_high: StandardMaterial3D
var mat_armour_low: StandardMaterial3D
var mat_armour_mid: StandardMaterial3D
var mat_armour_high: StandardMaterial3D
var mat_swap_flash: StandardMaterial3D


func configure(_root: Dictionary = {}) -> void:
	registered_characters.clear()
	equipped_state_by_character.clear()
	body_materials_by_character.clear()
	skin_mark_nodes_by_character.clear()
	corpse_mark_nodes_by_character.clear()
	corpse_bone_mutations_by_character.clear()
	armor_overlay_nodes_by_character.clear()
	last_applied_skin_approach.clear()
	last_applied_corpse_approach.clear()
	_make_materials()
	_load_manifest()


func character_scene_for_persona(persona: String) -> PackedScene:
	return _scene_for_asset(character_assets_by_persona.get(persona, {}))


func pivot_y_for_persona(persona: String) -> float:
	var asset: Dictionary = character_assets_by_persona.get(persona, {})
	return float(asset.get("pivotYOffset", 0.0))


func scale_multiplier_for_persona(persona: String) -> float:
	var asset: Dictionary = character_assets_by_persona.get(persona, {})
	var value = asset.get("modelScaleMultiplier", 1.0)
	if typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT:
		return float(value)
	return 1.0


func instantiate_persona_character(persona: String, label: String, fallback_material: Material, base_scale: float) -> Node3D:
	var asset: Dictionary = character_assets_by_persona.get(persona, {})
	var root := Node3D.new()
	root.name = label
	var scene := _scene_for_asset(asset)
	var multiplier := scale_multiplier_for_persona(persona)
	var pivot_y := float(asset.get("pivotYOffset", 0.0))
	if scene != null:
		var instance = scene.instantiate()
		if instance is Node3D:
			var visual := instance as Node3D
			visual.name = "visual"
			visual.scale = Vector3.ONE * base_scale * multiplier
			visual.position.y = pivot_y
			_apply_material(visual, fallback_material)
			root.add_child(visual)
			return root
		if instance != null:
			instance.queue_free()
	var fallback := MeshInstance3D.new()
	fallback.name = "visual"
	var mesh := CapsuleMesh.new()
	mesh.radius = 0.09
	mesh.height = FALLBACK_CHARACTER_HALF_HEIGHT * 2.0
	fallback.mesh = mesh
	fallback.material_override = fallback_material
	fallback.position.y = FALLBACK_CHARACTER_HALF_HEIGHT
	root.add_child(fallback)
	return root


func instantiate_persona_corpse(persona: String, label: String, fallback_material: Material, base_scale: float) -> Node3D:
	var persona_asset: Dictionary = character_assets_by_persona.get(persona, {})
	var body_asset := _corpse_body_asset_for_persona(persona_asset)
	var root := Node3D.new()
	root.name = label
	var scene := _scene_for_asset(body_asset)
	var multiplier := _scale_multiplier_from_asset(body_asset, scale_multiplier_for_persona(persona))
	var pivot_y := float(body_asset.get("pivotYOffset", persona_asset.get("pivotYOffset", 0.0)))
	if scene != null:
		var instance = scene.instantiate()
		if instance is Node3D:
			var visual := instance as Node3D
			visual.name = "visual"
			visual.scale = Vector3.ONE * base_scale * multiplier
			visual.position.y = pivot_y
			_apply_material(visual, fallback_material)
			root.add_child(visual)
			_register_character_record(label, root, persona, persona_asset, visual, null, 0)
			_apply_death_pose(label, body_asset)
			_apply_persona_corpse_skin(label, persona_asset.get("corpse", {}), 0)
			return root
		if instance != null:
			instance.queue_free()
	var fallback := MeshInstance3D.new()
	fallback.name = "visual"
	var mesh := CapsuleMesh.new()
	mesh.radius = 0.12
	mesh.height = FALLBACK_CHARACTER_HALF_HEIGHT * 2.2
	fallback.mesh = mesh
	fallback.material_override = fallback_material
	fallback.position.y = FALLBACK_CHARACTER_HALF_HEIGHT
	root.add_child(fallback)
	_register_character_record(label, root, persona, persona_asset, fallback, null, 0)
	_apply_persona_corpse_skin(label, persona_asset.get("corpse", {}), 0)
	return root


func environment_scene_for_role(role: String) -> PackedScene:
	return _scene_for_asset(environment_assets_by_role.get(role, {}))


func pivot_y_for_environment_role(role: String) -> float:
	var asset: Dictionary = environment_assets_by_role.get(role, {})
	return float(asset.get("pivotYOffset", 0.0))


func corpse_scene() -> PackedScene:
	return _scene_for_asset(corpse_body_asset)


func corpse_pivot_y() -> float:
	return float(corpse_body_asset.get("pivotYOffset", 0.0))


func register_character(character_id: String, character_node: Node3D, persona: String) -> void:
	if character_id.is_empty() or character_node == null:
		return
	var asset: Dictionary = character_assets_by_persona.get(persona, {})
	var visual := _visual_root(character_node)
	var skeleton := _first_descendant_of_class(visual, "Skeleton3D") as Skeleton3D
	var weapon_socket := _ensure_weapon_socket(character_node, skeleton, str(asset.get("attachBone", "")))
	_register_character_record(character_id, character_node, persona, asset, visual, weapon_socket, 0)
	_apply_persona_skin(character_id, 0)


func _register_character_record(character_id: String, character_node: Node3D, persona: String, asset: Dictionary, visual: Node3D, weapon_socket: Node3D, armour_tier: int) -> void:
	var animation_player := _first_descendant_of_class(visual, "AnimationPlayer") as AnimationPlayer
	var skeleton := _first_descendant_of_class(visual, "Skeleton3D") as Skeleton3D
	registered_characters[character_id] = {
		"node": character_node,
		"persona": persona,
		"asset": asset,
		"visual": visual,
		"skeleton": skeleton,
		"animationPlayer": animation_player,
		"animationClips": asset.get("animation", {}),
		"currentClip": "",
		"animationState": _empty_animation_state("idle"),
		"attachBone": str(asset.get("attachBone", "")),
		"weaponSocket": weapon_socket,
		"armorOverlay": asset.get("armorOverlay", null),
		"bodyMeshes": _mesh_descendants(visual),
		"flashAge": 999.0,
		"armourTier": armour_tier,
		"skinMode": "skin",
	}


func update_equipment(equipped_by_character: Dictionary) -> void:
	for character_id in registered_characters.keys():
		var slots = equipped_by_character.get(character_id, null)
		var weapon_name := _slot_name(slots, "weapon")
		var armour_name := _slot_name(slots, "armour")
		var previous: Dictionary = equipped_state_by_character.get(character_id, {})
		if str(previous.get("weapon", "")) != weapon_name:
			_swap_weapon(character_id, weapon_name)
		if str(previous.get("armour", "")) != armour_name:
			_swap_armour(character_id, armour_name)
		equipped_state_by_character[character_id] = {
			"weapon": weapon_name,
			"armour": armour_name,
		}


func play_loot_swap(character_id: String, item: Dictionary) -> void:
	if not registered_characters.has(character_id):
		return
	var category := str(item.get("category", ""))
	var character: Dictionary = registered_characters.get(character_id, {})
	if category == "armour":
		character["flashAge"] = 0.0
		registered_characters[character_id] = character
		return
	var socket := _weapon_socket_for_character(character_id)
	if socket != null:
		socket.scale = Vector3.ONE * 1.28
	var flash := _swap_flash_for_character(character_id)
	if flash != null:
		flash.visible = true


func play_character_clip(character_id: String, kind: String) -> bool:
	var resolution := resolve_animation_clip(character_id, kind)
	var clip := str(resolution.get("clip", ""))
	_store_animation_state(character_id, resolution)
	if clip.is_empty():
		return false
	var character: Dictionary = registered_characters.get(character_id, {})
	var player := character.get("animationPlayer") as AnimationPlayer
	if player == null or not player.has_animation(clip):
		return false
	if str(character.get("currentClip", "")) != clip or not player.is_playing():
		player.play(clip)
		character["currentClip"] = clip
		character["animationState"] = resolution
		registered_characters[character_id] = character
		var finish_callable := _handle_animation_finished.bind(player, character_id, clip, kind)
		if not player.animation_finished.is_connected(finish_callable):
			player.animation_finished.connect(finish_callable, Object.CONNECT_ONE_SHOT)
	return true


func has_event_clip(character_id: String, kind: String) -> bool:
	var clip := clip_name_for_character(character_id, kind)
	if clip.is_empty():
		return false
	var character: Dictionary = registered_characters.get(character_id, {})
	var player := character.get("animationPlayer") as AnimationPlayer
	return player != null and player.has_animation(clip)


func clip_name_for_character(character_id: String, kind: String) -> String:
	return str(resolve_animation_clip(character_id, kind).get("clip", ""))


func resolve_animation_clip(character_id: String, kind: String) -> Dictionary:
	var character: Dictionary = registered_characters.get(character_id, {})
	var animation = character.get("animationClips", {})
	if typeof(animation) != TYPE_DICTIONARY:
		return _empty_animation_state(kind)
	var animation_dict := animation as Dictionary
	for candidate_kind in _fallback_chain_for_kind(kind):
		var clip := str(animation_dict.get(candidate_kind, ""))
		if not clip.is_empty():
			return {
				"clip": clip,
				"requested_kind": kind,
				"resolved_kind": candidate_kind,
				"is_fallback": candidate_kind != kind,
			}
	return _empty_animation_state(kind)


func play_character_animation(character_id: String, kind: String) -> bool:
	return play_character_clip(character_id, kind)


func has_rigged_animation(character_id: String, kind: String) -> bool:
	return has_event_clip(character_id, kind)


func animation_clip_for_character(character_id: String, kind: String) -> String:
	return clip_name_for_character(character_id, kind)


func animation_state_for_character(character_id: String) -> Dictionary:
	if not registered_characters.has(character_id):
		return {}
	var character: Dictionary = registered_characters.get(character_id, {})
	var state: Dictionary = character.get("animationState", {})
	var out := state.duplicate(true)
	var player := character.get("animationPlayer") as AnimationPlayer
	out["is_playing"] = player != null and player.is_playing()
	return out


func weapon_socket_for_character(character_id: String) -> Node3D:
	return _weapon_socket_for_character(character_id)


func tick(delta: float) -> void:
	for character_id in registered_characters.keys():
		var character: Dictionary = registered_characters.get(character_id, {})
		var socket := _weapon_socket_for_character(character_id)
		if socket != null:
			socket.scale = socket.scale.lerp(Vector3.ONE, clamp(delta * 9.0, 0.0, 1.0))
		var flash_age := float(character.get("flashAge", 999.0)) + delta
		character["flashAge"] = flash_age
		registered_characters[character_id] = character
		var flash := _swap_flash_for_character(character_id)
		if flash != null:
			flash.visible = flash_age < 0.36 or (socket != null and socket.scale.x > 1.04)
			flash.scale = Vector3.ONE * (0.92 + max(0.0, 1.0 - flash_age / 0.36) * 0.45)


func _load_manifest() -> void:
	character_assets_by_persona.clear()
	weapon_assets_by_name.clear()
	armour_assets_by_name.clear()
	environment_assets_by_role.clear()
	corpse_body_asset.clear()
	var text := FileAccess.get_file_as_string(MANIFEST_PATH)
	var parsed = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		manifest = {}
		return
	manifest = parsed
	var shared_body := {}
	if typeof(manifest.get("body", {})) == TYPE_DICTIONARY:
		shared_body = (manifest.get("body", {}) as Dictionary).duplicate(true)
	if typeof(manifest.get("corpseBody", {})) == TYPE_DICTIONARY:
		corpse_body_asset = (manifest.get("corpseBody", {}) as Dictionary).duplicate(true)
	if corpse_body_asset.is_empty() and not shared_body.is_empty():
		corpse_body_asset = shared_body.duplicate(true)
	for asset in manifest.get("assets", []):
		if typeof(asset) != TYPE_DICTIONARY:
			continue
		var category := str(asset.get("category", ""))
		match category:
			"character":
				var persona := str(asset.get("personaSlot", ""))
				if not persona.is_empty():
					var source_asset := asset as Dictionary
					var character_asset := _character_body_asset_for_manifest(source_asset, shared_body)
					character_asset.merge(source_asset, true)
					if not character_asset.has("skin") and character_asset.has("palette"):
						character_asset["skin"] = {
							"approach": "palette_flat",
							"params": {"palette": character_asset.get("palette", {})},
						}
					if not character_asset.has("corpse"):
						character_asset["corpse"] = {
							"approach": "blood_saturation_overlay",
							"params": {},
						}
					character_assets_by_persona[persona] = character_asset
			"weapon":
				var weapon_name := str(asset.get("weaponName", ""))
				if not weapon_name.is_empty():
					weapon_assets_by_name[weapon_name] = asset
			"armour":
				var armour_name := str(asset.get("armourName", ""))
				if not armour_name.is_empty():
					armour_assets_by_name[armour_name] = asset
			"environment":
				var role := str(asset.get("environmentRole", ""))
				var file := str(asset.get("file", ""))
				if not role.is_empty() and file.ends_with(".glb") and not environment_assets_by_role.has(role):
					environment_assets_by_role[role] = asset


func _character_body_asset_for_manifest(asset: Dictionary, shared_body: Dictionary) -> Dictionary:
	var character_asset := shared_body.duplicate(true)
	var body_override := _dictionary_block(asset, "bodyOverride")
	if not body_override.is_empty():
		character_asset.merge(body_override, true)
	if character_asset.is_empty():
		character_asset = asset.duplicate(true)
	return character_asset


func _corpse_body_asset_for_persona(persona_asset: Dictionary) -> Dictionary:
	var corpse_override := _dictionary_block(persona_asset, "corpseOverride")
	if not corpse_override.is_empty():
		var explicit_body_asset := corpse_body_asset.duplicate(true)
		if explicit_body_asset.is_empty():
			explicit_body_asset = persona_asset.duplicate(true)
		explicit_body_asset.merge(corpse_override, true)
		return explicit_body_asset
	if not _dictionary_block(persona_asset, "bodyOverride").is_empty():
		return persona_asset.duplicate(true)
	var body_asset := corpse_body_asset.duplicate(true)
	if body_asset.is_empty():
		body_asset = persona_asset.duplicate(true)
	return body_asset


func _dictionary_block(source: Dictionary, key: String) -> Dictionary:
	var value = source.get(key, {})
	if typeof(value) == TYPE_DICTIONARY:
		return value as Dictionary
	return {}


func _scene_for_asset(asset) -> PackedScene:
	if typeof(asset) != TYPE_DICTIONARY:
		return null
	var file := str(asset.get("file", ""))
	if file.is_empty():
		return null
	var resource_path := "%s%s" % [ART_ROOT, file]
	if loaded_scenes.has(resource_path):
		return loaded_scenes[resource_path]
	if not ResourceLoader.exists(resource_path):
		return null
	var resource = load(resource_path)
	if resource is PackedScene:
		loaded_scenes[resource_path] = resource
		return resource
	return null


func _swap_weapon(character_id: String, weapon_name: String) -> void:
	var socket := _weapon_socket_for_character(character_id)
	if socket == null:
		var character: Dictionary = registered_characters.get(character_id, {})
		var character_node: Node3D = character.get("node")
		if character_node == null:
			return
		socket = _ensure_socket(character_node, WEAPON_SOCKET_NAME, Vector3(0.15, 0.31, -0.10))
	_clear_visual(socket, "weapon_visual")
	if weapon_name.is_empty():
		return
	var asset: Dictionary = weapon_assets_by_name.get(weapon_name, {})
	var visual := _instance_asset_or_fallback(asset, "weapon", weapon_name)
	visual.name = "weapon_visual"
	_apply_attachment_transform(visual, asset, "weapon")
	_apply_tier_material(visual, int(asset.get("tier", 1)), "weapon")
	socket.add_child(visual)


func _fallback_chain_for_kind(kind: String) -> Array[String]:
	match kind:
		"attack_armed":
			return ["attack_armed", "attack", "generic"]
		"attack_unarmed":
			return ["attack_unarmed", "attack", "generic"]
		"take_hit":
			return ["take_hit", "generic", "idle"]
		"death":
			return ["death", "take_hit", "generic", "idle"]
		"loot":
			return ["loot", "generic"]
		"attack":
			return ["attack", "generic"]
		_:
			return [kind]


func _empty_animation_state(kind: String) -> Dictionary:
	return {
		"clip": "",
		"requested_kind": kind,
		"resolved_kind": "",
		"is_fallback": true,
	}


func _store_animation_state(character_id: String, state: Dictionary) -> void:
	if not registered_characters.has(character_id):
		return
	var character: Dictionary = registered_characters.get(character_id, {})
	character["animationState"] = state
	registered_characters[character_id] = character


func _handle_animation_finished(animation_name: StringName, player: AnimationPlayer, character_id: String, expected_clip: String, requested_kind: String) -> void:
	if player == null or not is_instance_valid(player) or str(animation_name) != expected_clip:
		return
	var character: Dictionary = registered_characters.get(character_id, {})
	if str(character.get("currentClip", "")) != expected_clip:
		return
	if requested_kind == "death":
		player.pause()
	else:
		player.play(expected_clip)


func _swap_armour(character_id: String, armour_name: String) -> void:
	var tier := 0
	if armour_name.is_empty():
		_clear_modular_submesh_armor(character_id)
		_apply_persona_skin(character_id, tier)
		return
	var asset: Dictionary = armour_assets_by_name.get(armour_name, {})
	tier = int(asset.get("tier", 1))
	var armor_overlay := _armor_overlay_for_character(character_id)
	if not armor_overlay.is_empty():
		_apply_persona_skin(character_id, 0)
		if _apply_modular_submesh_armor(character_id, armor_overlay, tier):
			var modular_character: Dictionary = registered_characters.get(character_id, {})
			modular_character["armourTier"] = tier
			modular_character["usesModularArmour"] = true
			modular_character["flashAge"] = 0.0
			registered_characters[character_id] = modular_character
			return
	_clear_modular_submesh_armor(character_id)
	_apply_persona_skin(character_id, tier)
	var character: Dictionary = registered_characters.get(character_id, {})
	character["usesModularArmour"] = false
	character["flashAge"] = 0.0
	registered_characters[character_id] = character


func _armor_overlay_for_character(character_id: String) -> Dictionary:
	var character: Dictionary = registered_characters.get(character_id, {})
	var overlay = character.get("armorOverlay", null)
	if typeof(overlay) == TYPE_DICTIONARY:
		return overlay as Dictionary
	return {}


func _apply_modular_submesh_armor(character_id: String, armor_overlay_block: Dictionary, armour_tier: int = 0) -> bool:
	# adherence_modular_submesh: separately skinned armor meshes share the character Skeleton3D.
	_clear_modular_submesh_armor(character_id)
	if armor_overlay_block.is_empty() or not registered_characters.has(character_id):
		return false
	var scene := _scene_for_asset(armor_overlay_block)
	if scene == null:
		push_warning("armorOverlay.file did not resolve for %s: %s" % [character_id, str(armor_overlay_block.get("file", ""))])
		return false
	var source_instance = scene.instantiate()
	if not source_instance is Node3D:
		if source_instance != null:
			source_instance.queue_free()
		push_warning("armorOverlay.file did not instantiate as Node3D for %s" % character_id)
		return false
	var source_root := source_instance as Node3D
	var meshes := _mesh_descendants(source_root)
	if meshes.is_empty():
		source_root.queue_free()
		push_warning("armorOverlay.file had no MeshInstance3D descendants for %s" % character_id)
		return false
	var character: Dictionary = registered_characters.get(character_id, {})
	var skeleton := character.get("skeleton") as Skeleton3D
	var visual := character.get("visual") as Node3D
	var attach_parent: Node3D = skeleton if skeleton != null and is_instance_valid(skeleton) else visual
	if attach_parent == null or not is_instance_valid(attach_parent):
		source_root.queue_free()
		push_warning("armorOverlay has no valid Skeleton3D or visual parent for %s" % character_id)
		return false
	var attached_meshes := []
	for mesh_value in meshes:
		var mesh := mesh_value as MeshInstance3D
		if mesh == null or not is_instance_valid(mesh):
			continue
		var local_transform := _source_local_transform_for_mesh(mesh, source_root)
		var parent := mesh.get_parent()
		if parent != null:
			parent.remove_child(mesh)
		mesh.name = _unique_child_name(attach_parent, "armor_overlay_%s" % str(mesh.name))
		mesh.owner = null
		attach_parent.add_child(mesh)
		mesh.transform = local_transform
		if skeleton != null and is_instance_valid(skeleton):
			mesh.skeleton = mesh.get_path_to(skeleton)
			_ensure_modular_armor_skin(mesh, skeleton, armor_overlay_block, character_id)
		_apply_tier_material(mesh, armour_tier, "armour")
		attached_meshes.append(mesh)
	source_root.queue_free()
	if attached_meshes.is_empty():
		return false
	armor_overlay_nodes_by_character[character_id] = attached_meshes
	return true


func _clear_modular_submesh_armor(character_id: String) -> void:
	var nodes: Array = armor_overlay_nodes_by_character.get(character_id, [])
	for node_value in nodes:
		var node := node_value as Node
		if node != null and is_instance_valid(node):
			node.queue_free()
	armor_overlay_nodes_by_character.erase(character_id)
	if registered_characters.has(character_id):
		var character: Dictionary = registered_characters.get(character_id, {})
		character["usesModularArmour"] = false
		registered_characters[character_id] = character


func _source_local_transform_for_mesh(mesh: MeshInstance3D, source_root: Node3D) -> Transform3D:
	var transform := mesh.transform
	var parent := mesh.get_parent()
	while parent != null and parent != source_root:
		if parent is Node3D:
			transform = (parent as Node3D).transform * transform
		parent = parent.get_parent()
	return transform


func _unique_child_name(parent: Node, desired_name: String) -> String:
	var clean_name := desired_name.strip_edges()
	if clean_name.is_empty():
		clean_name = "armor_overlay_mesh"
	var candidate := clean_name
	var suffix := 2
	while parent.get_node_or_null(candidate) != null:
		candidate = "%s_%d" % [clean_name, suffix]
		suffix += 1
	return candidate


func _ensure_modular_armor_skin(mesh: MeshInstance3D, skeleton: Skeleton3D, armor_overlay_block: Dictionary, character_id: String) -> void:
	if mesh == null or skeleton == null:
		return
	if mesh.skin != null and int(mesh.skin.call("get_bind_count")) > 0:
		return
	var bind_bone := _armor_bind_bone_for_character(character_id, armor_overlay_block)
	if bind_bone.is_empty() or skeleton.find_bone(bind_bone) < 0:
		for candidate in ["Torso", "Chest", "spine", "chest", "head", "Head", "Middle1.L", "hand.l", "handslot.l", "arm-left", "spine_03", "spine_02", "spine_01", "hand_l", "hand_r"]:
			if skeleton.find_bone(str(candidate)) >= 0:
				bind_bone = str(candidate)
				break
	if bind_bone.is_empty() or skeleton.find_bone(bind_bone) < 0:
		return
	var skin := Skin.new()
	if skin.has_method("add_named_bind"):
		skin.call("add_named_bind", bind_bone, Transform3D.IDENTITY)
	elif skin.has_method("add_bind"):
		skin.call("add_bind", skeleton.find_bone(bind_bone), Transform3D.IDENTITY)
	if int(skin.call("get_bind_count")) <= 0:
		return
	if skin.has_method("set_bind_bone"):
		skin.call("set_bind_bone", 0, skeleton.find_bone(bind_bone))
	if skin.has_method("set_bind_name"):
		skin.call("set_bind_name", 0, bind_bone)
	mesh.skin = skin


func _armor_bind_bone_for_character(character_id: String, armor_overlay_block: Dictionary) -> String:
	var character: Dictionary = registered_characters.get(character_id, {})
	var asset = character.get("asset", {})
	if typeof(asset) == TYPE_DICTIONARY:
		var body_override = (asset as Dictionary).get("bodyOverride", {})
		if typeof(body_override) == TYPE_DICTIONARY:
			var override_bone := str((body_override as Dictionary).get("armourAttachBone", ""))
			if not override_bone.is_empty():
				return override_bone
	var overlay_bone := str(armor_overlay_block.get("bindBone", ""))
	if not overlay_bone.is_empty():
		return overlay_bone
	return "spine_03"


func _ensure_weapon_socket(character_node: Node3D, skeleton: Skeleton3D, attach_bone: String) -> Node3D:
	var existing := character_node.get_node_or_null(WEAPON_SOCKET_NAME) as Node3D
	if existing != null:
		return existing
	var attachment: Node3D = null
	if not attach_bone.is_empty():
		attachment = _first_descendant_named(character_node, attach_bone) as Node3D
	if attachment != null:
		return attachment
	if skeleton != null and not attach_bone.is_empty() and skeleton.find_bone(attach_bone) >= 0:
		var bone_socket := BoneAttachment3D.new()
		bone_socket.name = WEAPON_SOCKET_NAME
		bone_socket.bone_name = attach_bone
		skeleton.add_child(bone_socket)
		return bone_socket
	return _ensure_socket(character_node, WEAPON_SOCKET_NAME, Vector3(0.15, 0.31, -0.10))


func _weapon_socket_for_character(character_id: String) -> Node3D:
	var character: Dictionary = registered_characters.get(character_id, {})
	var socket := character.get("weaponSocket") as Node3D
	if socket != null and is_instance_valid(socket):
		return socket
	var character_node: Node3D = character.get("node")
	if character_node == null:
		return null
	return character_node.get_node_or_null(WEAPON_SOCKET_NAME) as Node3D


func _swap_flash_for_character(character_id: String) -> MeshInstance3D:
	var character: Dictionary = registered_characters.get(character_id, {})
	var character_node: Node3D = character.get("node")
	if character_node == null:
		return null
	var flash := character_node.get_node_or_null("swap_flash") as MeshInstance3D
	if flash == null:
		flash = MeshInstance3D.new()
		flash.name = "swap_flash"
		var mesh := SphereMesh.new()
		mesh.radius = 0.12
		mesh.height = 0.16
		flash.mesh = mesh
		flash.material_override = mat_swap_flash
		flash.position = Vector3(0.0, 0.34, 0.0)
		character_node.add_child(flash)
	return flash


func _ensure_socket(character_node: Node3D, socket_name: String, fallback_position: Vector3) -> Node3D:
	var socket := character_node.get_node_or_null(socket_name) as Node3D
	if socket != null:
		return socket
	socket = Node3D.new()
	socket.name = socket_name
	socket.position = fallback_position
	character_node.add_child(socket)
	return socket


func _clear_visual(socket: Node3D, visual_name: String) -> void:
	var existing := socket.get_node_or_null(visual_name)
	if existing != null:
		existing.queue_free()


func _instance_asset_or_fallback(asset: Dictionary, slot: String, item_name: String) -> Node3D:
	var scene := _scene_for_asset(asset)
	if scene != null:
		var instance = scene.instantiate()
		if instance is Node3D:
			return instance
		instance.queue_free()
	var root := Node3D.new()
	var mesh_instance := MeshInstance3D.new()
	mesh_instance.name = "%s_fallback_mesh" % slot
	if slot == "weapon":
		var weapon_mesh := BoxMesh.new()
		weapon_mesh.size = Vector3(0.08, 0.55, 0.05) if item_name in ["greatsword", "warhammer"] else Vector3(0.05, 0.34, 0.04)
		mesh_instance.mesh = weapon_mesh
		mesh_instance.position.y = 0.16
	else:
		var armour_mesh := BoxMesh.new()
		armour_mesh.size = Vector3(0.24, 0.30, 0.10)
		mesh_instance.mesh = armour_mesh
	root.add_child(mesh_instance)
	return root


func _apply_attachment_transform(visual: Node3D, asset: Dictionary, slot: String) -> void:
	var offset: Dictionary = asset.get("handOffset", {})
	var default_position := Vector3(0.15, 0.31, -0.10)
	visual.position = _vector3_from_array(offset.get("position", []), default_position)
	visual.rotation_degrees = _vector3_from_array(offset.get("rotationDeg", []), Vector3.ZERO)
	var scale_value := float(offset.get("scale", 1.0))
	visual.scale = Vector3.ONE * scale_value * WEAPON_ATTACHMENT_SCALE


func _apply_tier_material(node: Node, tier: int, slot: String) -> void:
	var material := _material_for_tier(tier, slot)
	if node is MeshInstance3D:
		(node as MeshInstance3D).material_override = material
	for child in node.get_children():
		_apply_tier_material(child, tier, slot)


func _apply_material(node: Node, material: Material) -> void:
	if node is MeshInstance3D:
		(node as MeshInstance3D).material_override = material
	for child in node.get_children():
		_apply_material(child, material)


func _material_for_tier(tier: int, slot: String) -> StandardMaterial3D:
	if slot == "weapon":
		if tier >= 3:
			return mat_weapon_high
		if tier >= 2:
			return mat_weapon_mid
		return mat_weapon_low
	if tier >= 3:
		return mat_armour_high
	if tier >= 2:
		return mat_armour_mid
	return mat_armour_low


func apply_persona_skin(character_id: String, armour_tier: int) -> void:
	_apply_persona_skin(character_id, armour_tier)


func apply_corpse_skin_to_live_character(character_id: String) -> void:
	if not registered_characters.has(character_id):
		return
	var character: Dictionary = registered_characters.get(character_id, {})
	var asset: Dictionary = character.get("asset", {})
	var corpse_block: Dictionary = asset.get("corpse", {})
	var armour_tier := int(character.get("armourTier", 0))
	_clear_mark_nodes(character_id, skin_mark_nodes_by_character)
	_apply_persona_corpse_skin(character_id, corpse_block, armour_tier)
	character = registered_characters.get(character_id, {})
	character["skinMode"] = "corpse"
	registered_characters[character_id] = character


func restore_persona_skin_to_live_character(character_id: String) -> void:
	if not registered_characters.has(character_id):
		return
	var character: Dictionary = registered_characters.get(character_id, {})
	var armour_tier := int(character.get("armourTier", 0))
	_clear_corpse_skin_effects(character_id)
	_apply_persona_skin(character_id, armour_tier)
	character = registered_characters.get(character_id, {})
	character["skinMode"] = "skin"
	registered_characters[character_id] = character


func _apply_persona_skin(character_id: String, armour_tier: int) -> void:
	if not registered_characters.has(character_id):
		return
	_clear_mark_nodes(character_id, skin_mark_nodes_by_character)
	_clear_corpse_skin_effects(character_id)
	var character: Dictionary = registered_characters.get(character_id, {})
	var asset: Dictionary = character.get("asset", {})
	var skin: Dictionary = asset.get("skin", {})
	var approach := str(skin.get("approach", "palette_flat"))
	var applied_approach := approach
	match approach:
		"palette_flat":
			_apply_skin_palette_flat(character_id, skin, armour_tier)
		"pbr_texture_atlas":
			_apply_skin_pbr_texture(character_id, skin, armour_tier)
		"pattern_texture":
			_apply_skin_pattern_texture(character_id, skin, armour_tier)
		"decal_stickers":
			_apply_skin_decal_stickers(character_id, skin, armour_tier)
		"toon_cel_shader":
			_apply_skin_toon_cel(character_id, skin, armour_tier)
		"emissive_trim_shader":
			_apply_skin_emissive_trim(character_id, skin, armour_tier)
		"multi_material_split":
			_apply_skin_multi_material(character_id, skin, armour_tier)
		"rim_fresnel_shader":
			_apply_skin_rim_fresnel(character_id, skin, armour_tier)
		_:
			push_warning("unknown skin.approach: %s; falling back to palette_flat" % approach)
			applied_approach = "palette_flat"
			_apply_skin_palette_flat(character_id, skin, armour_tier)
	last_applied_skin_approach[character_id] = applied_approach
	character = registered_characters.get(character_id, {})
	character["armourTier"] = armour_tier
	character["skinMode"] = "skin"
	registered_characters[character_id] = character


func _apply_skin_palette_flat(character_id: String, skin: Dictionary, armour_tier: int) -> void:
	var character: Dictionary = registered_characters.get(character_id, {})
	var asset: Dictionary = character.get("asset", {})
	var params := _params_from_block(skin)
	var palette: Dictionary = params.get("palette", {})
	if palette.is_empty():
		palette = asset.get("palette", {})
	var meshes: Array = character.get("bodyMeshes", [])
	for i in range(meshes.size()):
		var mesh := meshes[i] as MeshInstance3D
		if mesh == null or not is_instance_valid(mesh):
			continue
		mesh.material_override = _palette_material(palette, i, armour_tier)
	character["armourTier"] = armour_tier
	registered_characters[character_id] = character


func _apply_skin_pbr_texture(character_id: String, skin: Dictionary, armour_tier: int) -> void:
	var params := _params_from_block(skin)
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(0.66, 0.66, 0.68)
	var albedo := _load_art_texture(str(params.get("albedo", "")))
	if albedo != null:
		material.albedo_texture = albedo
	var normal := _load_art_texture(str(params.get("normal", "")))
	if normal != null:
		material.normal_enabled = true
		material.normal_texture = normal
	var roughness := _load_art_texture(str(params.get("roughness", "")))
	if roughness != null:
		material.roughness_texture = roughness
	var metallic := _load_art_texture(str(params.get("metallic", "")))
	if metallic != null:
		material.metallic_texture = metallic
	var ao := _load_art_texture(str(params.get("ao", "")))
	if ao != null:
		material.ao_enabled = true
		material.ao_texture = ao
	_apply_armour_tier_to_standard_material(material, armour_tier)
	_apply_material_to_body_meshes(character_id, material)


func _apply_skin_pattern_texture(character_id: String, skin: Dictionary, armour_tier: int) -> void:
	var params := _params_from_block(skin)
	var material := StandardMaterial3D.new()
	material.albedo_color = _color_from_hex(str(params.get("tint", "#8df0ff")), Color(0.55, 0.94, 1.0))
	var texture := _load_art_texture(str(params.get("albedo", "")))
	if texture != null:
		material.albedo_texture = texture
	var sampling_mode := str(params.get("samplingMode", "uv"))
	material.uv1_triplanar = sampling_mode == "triplanar"
	material.uv1_scale = _triplanar_scale_from_params(params, Vector3(1.0, 1.0, 1.0))
	if material.uv1_triplanar:
		material.uv1_triplanar_sharpness = clamp(float(params.get("triplanarSharpness", params.get("uv1_triplanar_sharpness", 1.0))), 0.01, 150.0)
	_apply_armour_tier_to_standard_material(material, armour_tier)
	_apply_material_to_body_meshes(character_id, material)


func _apply_skin_decal_stickers(character_id: String, skin: Dictionary, armour_tier: int) -> void:
	var params := _params_from_block(skin)
	_apply_skin_palette_flat(character_id, {"params": {"palette": params.get("basePalette", {})}}, armour_tier)
	var visual := _visual_for_character(character_id)
	if visual == null:
		return
	for decal_spec in _array_from_value(params.get("decals", [])):
		if typeof(decal_spec) != TYPE_DICTIONARY:
			continue
		var mark := _apply_projected_mark(visual, decal_spec as Dictionary)
		_track_mark_node(character_id, mark, skin_mark_nodes_by_character)


func _apply_skin_toon_cel(character_id: String, skin: Dictionary, armour_tier: int) -> void:
	var params := _params_from_block(skin)
	var material := _shader_material_or_fallback(params, "shaders/toon_cel.gdshader", _color_from_hex(str(params.get("outlineColor", "#111111")), Color(0.08, 0.08, 0.10)), armour_tier)
	_apply_material_to_body_meshes(character_id, material)


func _apply_skin_emissive_trim(character_id: String, skin: Dictionary, armour_tier: int) -> void:
	var params := _params_from_block(skin)
	var material := _shader_material_or_fallback(params, "shaders/emissive_trim.gdshader", _color_from_hex(str(params.get("baseColor", "#1d241f")), Color(0.12, 0.16, 0.14)), armour_tier)
	_apply_material_to_body_meshes(character_id, material)


func _apply_skin_multi_material(character_id: String, skin: Dictionary, armour_tier: int) -> void:
	# adherence_uv_painted: body-region masks wrap effects through the mesh UVs.
	var params := _params_from_block(skin)
	var region_material := _body_region_shader_material(params, armour_tier)
	if region_material != null:
		_apply_material_to_body_meshes(character_id, region_material)
		return
	var body_parts: Dictionary = params.get("bodyParts", {})
	var assignments := _array_from_value(params.get("partAssignmentByMeshIndex", []))
	var default_order := ["head", "chest", "legs", "arms"]
	var meshes := _body_meshes_for_character(character_id)
	if meshes.size() <= 1:
		_apply_material_to_body_meshes(character_id, _standard_material_from_body_regions(params, armour_tier))
		return
	for i in range(meshes.size()):
		var mesh := meshes[i] as MeshInstance3D
		if mesh == null or not is_instance_valid(mesh):
			continue
		var part_key := str(default_order[i % default_order.size()])
		if i < assignments.size():
			var assigned = assignments[i]
			if typeof(assigned) == TYPE_STRING:
				part_key = str(assigned)
			elif typeof(assigned) == TYPE_INT or typeof(assigned) == TYPE_FLOAT:
				part_key = str(default_order[int(assigned) % default_order.size()])
		var part_spec: Dictionary = body_parts.get(part_key, {})
		mesh.material_override = _standard_material_from_part(part_spec, armour_tier)


func _apply_skin_rim_fresnel(character_id: String, skin: Dictionary, armour_tier: int) -> void:
	var params := _params_from_block(skin)
	var material := _shader_material_or_fallback(params, "shaders/rim_fresnel.gdshader", _color_from_hex(str(params.get("baseColor", "#24262d")), Color(0.14, 0.15, 0.18)), armour_tier)
	_apply_material_to_body_meshes(character_id, material)


func _apply_persona_corpse_skin(character_id: String, corpse_block: Dictionary, armour_tier: int) -> void:
	if not registered_characters.has(character_id):
		return
	_clear_corpse_skin_effects(character_id)
	var approach := str(corpse_block.get("approach", "blood_saturation_overlay"))
	var applied_approach := approach
	match approach:
		"blood_saturation_overlay":
			_apply_corpse_blood_saturation(character_id, corpse_block, armour_tier)
		"wound_cluster_decals":
			_apply_corpse_wound_decals(character_id, corpse_block, armour_tier)
		"gore_pool_decal":
			_apply_corpse_gore_pool(character_id, corpse_block, armour_tier)
		"charred_burned_texture":
			_apply_corpse_charred(character_id, corpse_block, armour_tier)
		"exposed_bone_decals":
			_apply_corpse_exposed_bone(character_id, corpse_block, armour_tier)
		"viscera_projection":
			_apply_corpse_viscera(character_id, corpse_block, armour_tier)
		"dismemberment_baked":
			_apply_corpse_dismemberment(character_id, corpse_block, armour_tier)
		"decay_desaturation":
			_apply_corpse_decay(character_id, corpse_block, armour_tier)
		_:
			push_warning("unknown corpse.approach: %s; falling back to blood_saturation_overlay" % approach)
			applied_approach = "blood_saturation_overlay"
			_apply_corpse_blood_saturation(character_id, corpse_block, armour_tier)
	last_applied_corpse_approach[character_id] = applied_approach
	var character: Dictionary = registered_characters.get(character_id, {})
	character["armourTier"] = armour_tier
	character["skinMode"] = "corpse"
	registered_characters[character_id] = character


func _apply_corpse_blood_saturation(character_id: String, corpse_block: Dictionary, armour_tier: int) -> void:
	var params := _params_from_block(corpse_block)
	var tint := _color_from_hex(str(params.get("tint", "#5a0008")), Color(0.35, 0.0, 0.03))
	var factor: float = clamp(float(params.get("factor", 0.85)), 0.0, 1.0)
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(0.12, 0.02, 0.02).lerp(tint, factor)
	material.emission_enabled = true
	material.emission = tint
	material.emission_energy_multiplier = 0.08 + clamp(float(params.get("saturation", 0.92)), 0.0, 1.0) * 0.28
	material.roughness = 0.88
	_apply_armour_tier_to_standard_material(material, armour_tier)
	_apply_material_to_body_meshes(character_id, material)


func _apply_corpse_wound_decals(character_id: String, corpse_block: Dictionary, armour_tier: int) -> void:
	_apply_corpse_blood_saturation(character_id, {"params": {"tint": "#3b0006", "factor": 0.55, "saturation": 0.6}}, armour_tier)
	_apply_corpse_mark_specs(character_id, corpse_block, "decals", false)


func _apply_corpse_gore_pool(character_id: String, corpse_block: Dictionary, armour_tier: int) -> void:
	_apply_corpse_blood_saturation(character_id, {"params": {"tint": "#260006", "factor": 0.45, "saturation": 0.4}}, armour_tier)
	_apply_corpse_mark_specs(character_id, corpse_block, "decals", true)


func _apply_corpse_charred(character_id: String, corpse_block: Dictionary, armour_tier: int) -> void:
	var params := _params_from_block(corpse_block)
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(0.035, 0.032, 0.030)
	var albedo := _load_art_texture(str(params.get("albedo", "")))
	if albedo != null:
		material.albedo_texture = albedo
	var emission := _color_from_hex(str(params.get("emission", "#ff4b19")), Color(1.0, 0.26, 0.08))
	material.emission_enabled = true
	material.emission = emission
	material.emission_energy_multiplier = float(params.get("emissionEnergy", 0.6))
	material.metallic = 0.18
	material.roughness = 0.92
	_apply_armour_tier_to_standard_material(material, armour_tier)
	_apply_material_to_body_meshes(character_id, material)


func _apply_corpse_exposed_bone(character_id: String, corpse_block: Dictionary, armour_tier: int) -> void:
	_apply_corpse_blood_saturation(character_id, {"params": {"tint": "#4a000b", "factor": 0.62, "saturation": 0.76}}, armour_tier)
	_apply_corpse_mark_specs(character_id, corpse_block, "decals", false)


func _apply_corpse_viscera(character_id: String, corpse_block: Dictionary, armour_tier: int) -> void:
	_apply_corpse_blood_saturation(character_id, {"params": {"tint": "#32000a", "factor": 0.7, "saturation": 0.9}}, armour_tier)
	_apply_corpse_mark_specs(character_id, corpse_block, "decals", false)


func _apply_corpse_dismemberment(character_id: String, corpse_block: Dictionary, armour_tier: int) -> void:
	# adherence_mesh_baked: whole-body corpse state is baked into skeleton/mesh transforms.
	_apply_corpse_blood_saturation(character_id, {"params": {"tint": "#4d0007", "factor": 0.68, "saturation": 0.85}}, armour_tier)
	var params := _params_from_block(corpse_block)
	var visual := _visual_for_character(character_id)
	var character: Dictionary = registered_characters.get(character_id, {})
	var skeleton := character.get("skeleton") as Skeleton3D
	var mutations := []
	for bone_value in _array_from_value(params.get("hideBones", [])):
		var bone_name := str(bone_value)
		if bone_name.is_empty():
			continue
		if skeleton != null:
			var bone_index := skeleton.find_bone(bone_name)
			if bone_index >= 0:
				mutations.append({
					"type": "bone_scale",
					"skeleton": skeleton,
					"bone": bone_index,
					"scale": skeleton.get_bone_pose_scale(bone_index),
				})
				skeleton.set_bone_pose_scale(bone_index, Vector3.ONE * 0.001)
		var node := _first_descendant_named(visual, bone_name) as Node3D
		if node != null:
			mutations.append({
				"type": "node3d",
				"node": node,
				"visible": node.visible,
				"scale": node.scale,
			})
			node.visible = false
			node.scale = Vector3.ONE * 0.001
	corpse_bone_mutations_by_character[character_id] = mutations
	_apply_corpse_mark_specs(character_id, corpse_block, "stumpDecals", false)


func _apply_corpse_decay(character_id: String, corpse_block: Dictionary, armour_tier: int) -> void:
	var params := _params_from_block(corpse_block)
	var material := _shader_material_or_fallback(params, "shaders/decay_desaturation.gdshader", _color_from_hex(str(params.get("tint", "#8aa09b")), Color(0.50, 0.60, 0.58)), armour_tier)
	_apply_material_to_body_meshes(character_id, material)


func _apply_projected_mark(parent: Node3D, mark_spec: Dictionary) -> Node3D:
	# adherence_bone_attached: projected marks can pin to a BoneAttachment3D when a bone is declared.
	if parent == null:
		return null
	var target_parent := _projected_mark_parent(parent, mark_spec)
	var renderer := str(ProjectSettings.get_setting("rendering/renderer/rendering_method", "")).to_lower()
	var force_quad := bool(mark_spec.get("forceQuad", false))
	var use_quad := force_quad or renderer.contains("compatibility") or renderer.contains("gl_compatibility")
	if use_quad:
		var mark := MeshInstance3D.new()
		mark.name = str(mark_spec.get("name", "projected_mark"))
		var quad := QuadMesh.new()
		var size := _vector3_from_array(mark_spec.get("size", []), Vector3(0.24, 0.24, 0.06))
		var projection := str(mark_spec.get("projection", "body"))
		quad.size = Vector2(max(size.x, 0.01), max(size.z if projection == "floor" else size.y, 0.01))
		mark.mesh = quad
		mark.material_override = _projected_mark_material(mark_spec)
		mark.position = _vector3_from_array(mark_spec.get("offset", []), Vector3.ZERO)
		mark.rotation_degrees = _vector3_from_array(mark_spec.get("rotationDeg", []), Vector3.ZERO)
		if projection == "floor":
			mark.rotation_degrees.x -= 90.0
		target_parent.add_child(mark)
		return target_parent if target_parent != parent else mark
	var decal := Decal.new()
	decal.name = str(mark_spec.get("name", "projected_mark"))
	decal.size = _vector3_from_array(mark_spec.get("size", []), Vector3(0.24, 0.24, 0.12))
	decal.position = _vector3_from_array(mark_spec.get("offset", []), Vector3.ZERO)
	decal.rotation_degrees = _vector3_from_array(mark_spec.get("rotationDeg", []), Vector3.ZERO)
	var texture := _load_art_texture(str(mark_spec.get("file", "")))
	if texture != null:
		decal.texture_albedo = texture
	target_parent.add_child(decal)
	return target_parent if target_parent != parent else decal


func _params_from_block(block: Dictionary) -> Dictionary:
	var params = block.get("params", {})
	if typeof(params) == TYPE_DICTIONARY:
		return params
	return {}


func _array_from_value(value) -> Array:
	if typeof(value) == TYPE_ARRAY:
		return value
	return []


func _triplanar_scale_from_params(params: Dictionary, fallback: Vector3) -> Vector3:
	var value = params.get("triplanarScale", params.get("uv1_scale", fallback))
	var scale := fallback
	match typeof(value):
		TYPE_INT, TYPE_FLOAT:
			var scalar: float = max(float(value), 0.01)
			scale = Vector3.ONE * scalar
		TYPE_VECTOR2:
			var vector2: Vector2 = value
			scale = Vector3(vector2.x, vector2.y, (vector2.x + vector2.y) * 0.5)
		TYPE_VECTOR3:
			scale = value
		TYPE_ARRAY:
			var values := _array_from_value(value)
			if values.size() >= 3:
				scale = Vector3(float(values[0]), float(values[1]), float(values[2]))
			elif values.size() >= 2:
				var x := float(values[0])
				var y := float(values[1])
				scale = Vector3(x, y, (x + y) * 0.5)
			elif values.size() == 1:
				scale = Vector3.ONE * float(values[0])
	return Vector3(max(scale.x, 0.01), max(scale.y, 0.01), max(scale.z, 0.01))


func _projected_mark_parent(parent: Node3D, mark_spec: Dictionary) -> Node3D:
	var bone_name := str(mark_spec.get("bone", ""))
	if bone_name.is_empty():
		return parent
	var skeleton := _skeleton_for_projected_mark(parent, mark_spec)
	if skeleton == null or not is_instance_valid(skeleton) or skeleton.find_bone(bone_name) < 0:
		return parent
	var attachment := BoneAttachment3D.new()
	attachment.name = "%s_%s_attachment" % [str(mark_spec.get("name", "projected_mark")), bone_name]
	attachment.bone_name = bone_name
	skeleton.add_child(attachment)
	return attachment


func _skeleton_for_projected_mark(parent: Node3D, mark_spec: Dictionary) -> Skeleton3D:
	var spec_skeleton := mark_spec.get("skeleton", null) as Skeleton3D
	if spec_skeleton != null and is_instance_valid(spec_skeleton):
		return spec_skeleton
	var character_id := str(mark_spec.get("characterId", mark_spec.get("character_id", "")))
	if not character_id.is_empty() and registered_characters.has(character_id):
		var explicit_character: Dictionary = registered_characters.get(character_id, {})
		var explicit_skeleton := explicit_character.get("skeleton") as Skeleton3D
		if explicit_skeleton != null and is_instance_valid(explicit_skeleton):
			return explicit_skeleton
	var descendant_skeleton := _first_descendant_of_class(parent, "Skeleton3D") as Skeleton3D
	if descendant_skeleton != null and is_instance_valid(descendant_skeleton):
		return descendant_skeleton
	for registered_id in registered_characters.keys():
		var character: Dictionary = registered_characters.get(registered_id, {})
		var root := character.get("node") as Node
		var visual := character.get("visual") as Node
		if _node_contains(root, parent) or _node_contains(visual, parent):
			var registered_skeleton := character.get("skeleton") as Skeleton3D
			if registered_skeleton != null and is_instance_valid(registered_skeleton):
				return registered_skeleton
	var cursor: Node = parent
	while cursor != null:
		if cursor is Skeleton3D:
			return cursor as Skeleton3D
		cursor = cursor.get_parent()
	return null


func _node_contains(root: Node, candidate: Node) -> bool:
	if root == null or candidate == null or not is_instance_valid(root) or not is_instance_valid(candidate):
		return false
	return root == candidate or root.is_ancestor_of(candidate)


func _body_meshes_for_character(character_id: String) -> Array:
	var character: Dictionary = registered_characters.get(character_id, {})
	var meshes: Array = character.get("bodyMeshes", [])
	return meshes


func _visual_for_character(character_id: String) -> Node3D:
	var character: Dictionary = registered_characters.get(character_id, {})
	var visual := character.get("visual") as Node3D
	if visual != null and is_instance_valid(visual):
		return visual
	return null


func _root_for_character(character_id: String) -> Node3D:
	var character: Dictionary = registered_characters.get(character_id, {})
	var node := character.get("node") as Node3D
	if node != null and is_instance_valid(node):
		return node
	return null


func _apply_material_to_body_meshes(character_id: String, material: Material) -> void:
	for mesh in _body_meshes_for_character(character_id):
		var mesh_instance := mesh as MeshInstance3D
		if mesh_instance == null or not is_instance_valid(mesh_instance):
			continue
		mesh_instance.material_override = material


func _body_region_shader_material(params: Dictionary, armour_tier: int) -> Material:
	var mask_path := _string_param_from_aliases(params, ["bodyRegionMask", "regionMask", "body_region_mask", "region_mask"])
	var shader_path := str(params.get("shader", ""))
	if shader_path.is_empty() and not mask_path.is_empty():
		shader_path = "shaders/multi_material_split.gdshader"
	if shader_path.is_empty() or mask_path.is_empty():
		return null
	var shader := _load_art_shader(shader_path)
	var mask := _load_art_texture(mask_path)
	if shader == null or mask == null:
		return null
	var material := ShaderMaterial.new()
	material.shader = shader
	_set_shader_parameters_from_dictionary(material, params)
	_set_shader_texture_aliases(material, ["bodyRegionMask", "body_region_mask", "regionMask", "region_mask"], mask)
	_set_shader_color_aliases(material, "head", _body_region_color(params, "head", Color(0.27, 0.13, 0.11)))
	_set_shader_color_aliases(material, "chest", _body_region_color(params, "chest", Color(1.0, 0.31, 0.22)))
	_set_shader_color_aliases(material, "legs", _body_region_color(params, "legs", Color(0.10, 0.20, 0.25)))
	_set_shader_color_aliases(material, "arms", _body_region_color(params, "arms", Color(1.0, 0.88, 0.29)))
	material.set_shader_parameter("armour_tier", armour_tier)
	material.set_shader_parameter("armour_amount", clamp(float(armour_tier) / 4.0, 0.0, 1.0))
	return material


func _standard_material_from_body_regions(params: Dictionary, armour_tier: int) -> StandardMaterial3D:
	var head := _body_region_color(params, "head", Color(0.27, 0.13, 0.11))
	var chest := _body_region_color(params, "chest", Color(1.0, 0.31, 0.22))
	var legs := _body_region_color(params, "legs", Color(0.10, 0.20, 0.25))
	var arms := _body_region_color(params, "arms", Color(1.0, 0.88, 0.29))
	var material := StandardMaterial3D.new()
	material.albedo_color = chest.lerp(legs, 0.32).lerp(head, 0.16)
	material.metallic = clamp((_body_region_float(params, "head", "metallic", 0.15) + _body_region_float(params, "chest", "metallic", 0.45) + _body_region_float(params, "legs", "metallic", 0.25) + _body_region_float(params, "arms", "metallic", 0.62)) * 0.25, 0.0, 1.0)
	material.roughness = clamp((_body_region_float(params, "head", "roughness", 0.70) + _body_region_float(params, "chest", "roughness", 0.38) + _body_region_float(params, "legs", "roughness", 0.50) + _body_region_float(params, "arms", "roughness", 0.32)) * 0.25, 0.02, 1.0)
	var mask := _load_art_texture(_string_param_from_aliases(params, ["bodyRegionMask", "regionMask", "body_region_mask", "region_mask"]))
	if mask != null:
		material.albedo_texture = mask
	material.emission_enabled = true
	material.emission = arms.lerp(chest, 0.25)
	material.emission_energy_multiplier = 0.22
	material.next_pass = _body_region_accent_pass(head, legs, arms)
	_apply_armour_tier_to_standard_material(material, armour_tier)
	return material


func _standard_material_from_part(part_spec: Dictionary, armour_tier: int) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = _color_from_hex(str(part_spec.get("base", "#666666")), Color(0.42, 0.42, 0.42))
	material.metallic = clamp(float(part_spec.get("metallic", 0.15)), 0.0, 1.0)
	material.roughness = clamp(float(part_spec.get("roughness", 0.62)), 0.02, 1.0)
	if part_spec.has("emissive"):
		material.emission_enabled = true
		material.emission = _color_from_hex(str(part_spec.get("emissive", "#ff304d")), Color(1.0, 0.18, 0.3))
		material.emission_energy_multiplier = float(part_spec.get("emissionEnergy", 0.35))
	_apply_armour_tier_to_standard_material(material, armour_tier)
	return material


func _body_region_accent_pass(head: Color, legs: Color, arms: Color) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(arms.r, arms.g, arms.b, 0.18)
	material.emission_enabled = true
	material.emission = head.lerp(legs, 0.5)
	material.emission_energy_multiplier = 0.32
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.cull_mode = BaseMaterial3D.CULL_DISABLED
	return material


func _body_region_color(params: Dictionary, region: String, fallback: Color) -> Color:
	var camel_key := "%sColor" % region
	var snake_key := "%s_color" % region
	if params.has(camel_key):
		return _color_from_param(params.get(camel_key), fallback)
	if params.has(snake_key):
		return _color_from_param(params.get(snake_key), fallback)
	var part_spec := _body_region_part_spec(params, region)
	return _color_from_param(part_spec.get("base", fallback), fallback)


func _body_region_float(params: Dictionary, region: String, key: String, fallback: float) -> float:
	var part_spec := _body_region_part_spec(params, region)
	var value = part_spec.get(key, fallback)
	if typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT:
		return float(value)
	return fallback


func _body_region_part_spec(params: Dictionary, region: String) -> Dictionary:
	var body_parts = params.get("bodyParts", {})
	if typeof(body_parts) != TYPE_DICTIONARY:
		return {}
	var part_spec = (body_parts as Dictionary).get(region, {})
	if typeof(part_spec) == TYPE_DICTIONARY:
		return part_spec as Dictionary
	return {}


func _string_param_from_aliases(params: Dictionary, keys: Array[String]) -> String:
	for key in keys:
		var value = params.get(key, "")
		if typeof(value) == TYPE_STRING:
			var text := str(value).strip_edges()
			if not text.is_empty():
				return text
	return ""


func _color_from_param(value, fallback: Color) -> Color:
	match typeof(value):
		TYPE_COLOR:
			return value
		TYPE_STRING:
			return _color_from_hex(str(value), fallback)
		TYPE_ARRAY:
			var values := _array_from_value(value)
			if values.size() >= 4:
				return Color(float(values[0]), float(values[1]), float(values[2]), float(values[3]))
			if values.size() >= 3:
				return Color(float(values[0]), float(values[1]), float(values[2]))
	return fallback


func _set_shader_texture_aliases(material: ShaderMaterial, keys: Array[String], texture: Texture2D) -> void:
	for key in keys:
		material.set_shader_parameter(key, texture)


func _set_shader_color_aliases(material: ShaderMaterial, region: String, color: Color) -> void:
	material.set_shader_parameter("%sColor" % region, color)
	material.set_shader_parameter("%s_color" % region, color)


func _shader_material_or_fallback(params: Dictionary, fallback_shader: String, fallback_color: Color, armour_tier: int) -> Material:
	var shader := _load_art_shader(str(params.get("shader", fallback_shader)))
	if shader == null:
		var fallback := StandardMaterial3D.new()
		fallback.albedo_color = fallback_color
		fallback.emission_enabled = true
		fallback.emission = _color_from_hex(str(params.get("rimColor", params.get("trimColor", "#44faff"))), Color(0.26, 0.98, 1.0))
		fallback.emission_energy_multiplier = float(params.get("trimEnergy", 0.35))
		_apply_armour_tier_to_standard_material(fallback, armour_tier)
		return fallback
	var material := ShaderMaterial.new()
	material.shader = shader
	_set_shader_parameters_from_dictionary(material, params)
	material.set_shader_parameter("armour_tier", armour_tier)
	material.set_shader_parameter("armour_amount", clamp(float(armour_tier) / 4.0, 0.0, 1.0))
	return material


func _set_shader_parameters_from_dictionary(material: ShaderMaterial, params: Dictionary) -> void:
	for key in params.keys():
		var key_string := str(key)
		if key_string == "shader":
			continue
		var value = params.get(key)
		if key_string == "params" and typeof(value) == TYPE_DICTIONARY:
			_set_shader_parameters_from_dictionary(material, value as Dictionary)
			continue
		var converted = _shader_parameter_value(value)
		if converted == null:
			continue
		material.set_shader_parameter(key_string, converted)
		var alias := _shader_parameter_alias(key_string)
		if not alias.is_empty():
			material.set_shader_parameter(alias, converted)


func _shader_parameter_value(value):
	match typeof(value):
		TYPE_BOOL, TYPE_INT, TYPE_FLOAT, TYPE_VECTOR2, TYPE_VECTOR3, TYPE_COLOR:
			return value
		TYPE_STRING:
			var text := str(value)
			if text.begins_with("#"):
				return _color_from_hex(text, Color.WHITE)
			if text.ends_with(".png") or text.ends_with(".jpg") or text.ends_with(".jpeg") or text.ends_with(".webp"):
				return _load_art_texture(text)
			return null
		TYPE_ARRAY:
			var values := _array_from_value(value)
			if values.size() >= 4:
				return Color(float(values[0]), float(values[1]), float(values[2]), float(values[3]))
			if values.size() >= 3:
				return Vector3(float(values[0]), float(values[1]), float(values[2]))
			if values.size() >= 2:
				return Vector2(float(values[0]), float(values[1]))
	return null


func _shader_parameter_alias(key: String) -> String:
	match key:
		"baseColor":
			return "base_color"
		"outlineColor":
			return "outline_color"
		"trimMask":
			return "trim_mask"
		"trimColor":
			return "trim_color"
		"trimEnergy":
			return "trim_energy"
		"trimTileScale":
			return "trim_tile_scale"
		"bodyRegionMask":
			return "body_region_mask"
		"regionMask":
			return "region_mask"
		"headColor":
			return "head_color"
		"chestColor":
			return "chest_color"
		"legsColor":
			return "legs_color"
		"armsColor":
			return "arms_color"
		"rimColor":
			return "rim_color"
		"rimPower":
			return "rim_power"
		"desatAmount":
			return "desat_amount"
		"darkenAmount":
			return "darken_amount"
	return ""


func _apply_armour_tier_to_standard_material(material: StandardMaterial3D, armour_tier: int) -> void:
	var tier_amount: float = clamp(float(armour_tier) / 4.0, 0.0, 1.0)
	material.albedo_color = material.albedo_color.lerp(Color(0.68, 0.72, 0.78, material.albedo_color.a), tier_amount * 0.28)
	material.metallic = clamp(material.metallic + tier_amount * 0.56, 0.0, 1.0)
	material.roughness = clamp(material.roughness - tier_amount * 0.28, 0.04, 1.0)
	if material.emission_enabled:
		material.emission_energy_multiplier += tier_amount * 0.75
	elif armour_tier > 0:
		material.emission_enabled = true
		material.emission = Color(0.45, 0.92, 1.0)
		material.emission_energy_multiplier = tier_amount * 0.45


func _projected_mark_material(mark_spec: Dictionary) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	var texture := _load_art_texture(str(mark_spec.get("file", "")))
	if texture != null:
		material.albedo_texture = texture
	material.albedo_color = _color_from_hex(str(mark_spec.get("tint", "#ffffff")), Color(1.0, 1.0, 1.0, float(mark_spec.get("alpha", 1.0))))
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.cull_mode = BaseMaterial3D.CULL_DISABLED
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	return material


func _track_mark_node(character_id: String, mark: Node3D, bucket: Dictionary) -> void:
	if mark == null:
		return
	if not bucket.has(character_id):
		bucket[character_id] = []
	var nodes: Array = bucket.get(character_id, [])
	nodes.append(mark)
	bucket[character_id] = nodes


func _clear_mark_nodes(character_id: String, bucket: Dictionary) -> void:
	var nodes: Array = bucket.get(character_id, [])
	for node_value in nodes:
		var node := node_value as Node
		if node != null and is_instance_valid(node):
			node.queue_free()
	bucket.erase(character_id)


func _clear_corpse_skin_effects(character_id: String) -> void:
	_clear_mark_nodes(character_id, corpse_mark_nodes_by_character)
	_restore_corpse_bone_mutations(character_id)


func _restore_corpse_bone_mutations(character_id: String) -> void:
	var mutations: Array = corpse_bone_mutations_by_character.get(character_id, [])
	for mutation_value in mutations:
		if typeof(mutation_value) != TYPE_DICTIONARY:
			continue
		var mutation: Dictionary = mutation_value
		match str(mutation.get("type", "")):
			"bone_scale":
				var skeleton := mutation.get("skeleton") as Skeleton3D
				if skeleton != null and is_instance_valid(skeleton):
					skeleton.set_bone_pose_scale(int(mutation.get("bone", -1)), mutation.get("scale", Vector3.ONE))
			"node3d":
				var node := mutation.get("node") as Node3D
				if node != null and is_instance_valid(node):
					node.visible = bool(mutation.get("visible", true))
					node.scale = mutation.get("scale", Vector3.ONE)
	corpse_bone_mutations_by_character.erase(character_id)


func _apply_corpse_mark_specs(character_id: String, corpse_block: Dictionary, key: String, floor_projection: bool) -> void:
	var params := _params_from_block(corpse_block)
	var parent := _root_for_character(character_id) if floor_projection else _visual_for_character(character_id)
	if parent == null:
		return
	for spec_value in _array_from_value(params.get(key, [])):
		if typeof(spec_value) != TYPE_DICTIONARY:
			continue
		var spec: Dictionary = (spec_value as Dictionary).duplicate(true)
		if floor_projection:
			spec["projection"] = "floor"
		var mark := _apply_projected_mark(parent, spec)
		_track_mark_node(character_id, mark, corpse_mark_nodes_by_character)


func _load_art_texture(relative_path: String) -> Texture2D:
	# Use Godot's resource loader so the .pck path works in web export.
	# Image.load() reads the host filesystem, which doesn't exist in the browser.
	var resource := _load_art_resource(relative_path)
	return resource as Texture2D


func _load_art_shader(relative_path: String) -> Shader:
	var resource := _load_art_resource(relative_path)
	return resource as Shader


func _load_art_resource(relative_path: String) -> Resource:
	var resource_path := _art_resource_path(relative_path)
	if resource_path.is_empty() or not ResourceLoader.exists(resource_path):
		return null
	return load(resource_path)


func _art_resource_path(relative_path: String) -> String:
	var clean := relative_path.strip_edges().trim_prefix("/")
	if clean.is_empty():
		return ""
	if clean.begins_with(ART_ROOT):
		return clean
	if clean.begins_with("res://shared-harness/art-kit/"):
		return "%s%s" % [ART_ROOT, clean.trim_prefix("res://shared-harness/art-kit/")]
	if clean.begins_with("res://"):
		push_warning("art resource path must be art-kit-relative: %s" % relative_path)
		return ""
	return "%s%s" % [ART_ROOT, clean]


func _scale_multiplier_from_asset(asset: Dictionary, fallback: float) -> float:
	var value = asset.get("modelScaleMultiplier", fallback)
	if typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT:
		return float(value)
	return fallback


func _apply_death_pose(character_id: String, body_asset: Dictionary) -> void:
	var character: Dictionary = registered_characters.get(character_id, {})
	var player := character.get("animationPlayer") as AnimationPlayer
	if player == null:
		return
	var clip := str(body_asset.get("deathPoseClip", ""))
	if clip.is_empty():
		var animation = body_asset.get("animation", {})
		if typeof(animation) == TYPE_DICTIONARY:
			clip = str((animation as Dictionary).get("death", ""))
	if clip.is_empty() or not player.has_animation(clip):
		return
	player.play(clip)
	var animation_resource := player.get_animation(clip)
	if animation_resource != null:
		player.seek(max(animation_resource.length - 0.001, 0.0), true)
	player.pause()
	var state := {
		"clip": clip,
		"requested_kind": "death",
		"resolved_kind": "death",
		"is_fallback": false,
	}
	character["currentClip"] = clip
	character["animationState"] = state
	registered_characters[character_id] = character


func _palette_material(palette: Dictionary, index: int, armour_tier: int) -> StandardMaterial3D:
	var base := _color_from_hex(str(palette.get("base", "#666666")), Color(0.45, 0.45, 0.45))
	var accent := _color_from_hex(str(palette.get("accent", "#00e5ff")), Color(0.0, 0.9, 1.0))
	var emissive := _color_from_hex(str(palette.get("emissive", "#ff3050")), Color(1.0, 0.18, 0.3))
	var tier_amount: float = clamp(float(armour_tier) / 4.0, 0.0, 1.0)
	var channel := base
	if index % 3 == 1:
		channel = accent
	elif index % 3 == 2:
		channel = base.lerp(accent, 0.45)
	var material := StandardMaterial3D.new()
	material.albedo_color = channel.lerp(Color(0.68, 0.72, 0.78), tier_amount * 0.28)
	material.emission_enabled = true
	material.emission = emissive
	material.emission_energy_multiplier = 0.18 + tier_amount * 0.95
	material.metallic = 0.04 + tier_amount * 0.56
	material.roughness = 0.62 - tier_amount * 0.28
	material.next_pass = _palette_accent_pass(accent, emissive, tier_amount)
	return material


func _palette_accent_pass(accent: Color, emissive: Color, tier_amount: float) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(accent.r, accent.g, accent.b, 0.16 + tier_amount * 0.10)
	material.emission_enabled = true
	material.emission = emissive
	material.emission_energy_multiplier = 0.35 + tier_amount * 0.75
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.cull_mode = BaseMaterial3D.CULL_DISABLED
	return material


func _color_from_hex(value: String, fallback: Color) -> Color:
	var hex := value.strip_edges().trim_prefix("#")
	if hex.length() < 6:
		return fallback
	var r := float(hex.substr(0, 2).hex_to_int()) / 255.0
	var g := float(hex.substr(2, 2).hex_to_int()) / 255.0
	var b := float(hex.substr(4, 2).hex_to_int()) / 255.0
	return Color(r, g, b)


func _visual_root(character_node: Node3D) -> Node3D:
	var visual := character_node.get_node_or_null("visual") as Node3D
	return visual if visual != null else character_node


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


func _first_descendant_named(node: Node, node_name: String) -> Node:
	if node == null or node_name.is_empty():
		return null
	if node.name == node_name:
		return node
	for child in node.get_children():
		var found := _first_descendant_named(child, node_name)
		if found != null:
			return found
	return null


func _mesh_descendants(node: Node) -> Array:
	var out := []
	_collect_mesh_descendants(node, out)
	return out


func _collect_mesh_descendants(node: Node, out: Array) -> void:
	if node == null:
		return
	if node is MeshInstance3D:
		out.append(node)
	for child in node.get_children():
		_collect_mesh_descendants(child, out)


func _slot_name(slots, slot: String) -> String:
	if typeof(slots) != TYPE_DICTIONARY:
		return ""
	var item = slots.get(slot, null)
	if typeof(item) != TYPE_DICTIONARY:
		return ""
	return str(item.get("name", ""))


func _vector3_from_array(values, fallback: Vector3) -> Vector3:
	if typeof(values) != TYPE_ARRAY or values.size() < 3:
		return fallback
	return Vector3(float(values[0]), float(values[1]), float(values[2]))


func _vector2_from_array(values, fallback: Vector2) -> Vector2:
	if typeof(values) != TYPE_ARRAY or values.size() < 2:
		return fallback
	return Vector2(float(values[0]), float(values[1]))


func _make_materials() -> void:
	if mat_weapon_low != null:
		return
	mat_weapon_low = _mat(Color(0.45, 0.18, 0.11), Color(0.9, 0.20, 0.05), 0.35)
	mat_weapon_mid = _mat(Color(0.08, 0.50, 0.62), Color(0.0, 0.95, 1.0), 0.75)
	mat_weapon_high = _mat(Color(0.72, 0.03, 0.09), Color(1.0, 0.03, 0.12), 1.2)
	mat_armour_low = _mat(Color(0.25, 0.16, 0.10), Color(0.20, 0.06, 0.02), 0.2)
	mat_armour_mid = _mat(Color(0.24, 0.34, 0.38), Color(0.25, 0.88, 1.0), 0.55)
	mat_armour_high = _mat(Color(0.52, 0.08, 0.12), Color(1.0, 0.05, 0.16), 0.95)
	mat_swap_flash = _mat(Color(0.0, 0.95, 1.0, 0.38), Color(0.2, 1.0, 1.0), 1.4)
	mat_swap_flash.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA


func _mat(albedo: Color, emission: Color, energy: float) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = albedo
	material.emission_enabled = true
	material.emission = emission
	material.emission_energy_multiplier = energy
	material.roughness = 0.48
	return material
