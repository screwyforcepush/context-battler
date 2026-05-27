extends Node

const MANIFEST_PATH := "res://shared-harness/art-kit/manifest.json"
const ART_ROOT := "res://shared-harness/art-kit/"
const WEAPON_SOCKET_NAME := "weapon_socket"
const ARMOUR_SOCKET_NAME := "armour_socket"
const WEAPON_ATTACHMENT_SCALE := 0.22
const FALLBACK_CHARACTER_HALF_HEIGHT := 0.17

var manifest: Dictionary = {}
var character_assets_by_persona: Dictionary = {}
var weapon_assets_by_name: Dictionary = {}
var armour_assets_by_name: Dictionary = {}
var environment_assets_by_role: Dictionary = {}
var corpse_asset: Dictionary = {}
var loaded_scenes: Dictionary = {}
var registered_characters: Dictionary = {}
var equipped_state_by_character: Dictionary = {}
var body_materials_by_character: Dictionary = {}
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


func environment_scene_for_role(role: String) -> PackedScene:
	return _scene_for_asset(environment_assets_by_role.get(role, {}))


func pivot_y_for_environment_role(role: String) -> float:
	var asset: Dictionary = environment_assets_by_role.get(role, {})
	return float(asset.get("pivotYOffset", 0.0))


func corpse_scene() -> PackedScene:
	return _scene_for_asset(corpse_asset)


func corpse_pivot_y() -> float:
	return float(corpse_asset.get("pivotYOffset", 0.0))


func register_character(character_id: String, character_node: Node3D, persona: String) -> void:
	if character_id.is_empty() or character_node == null:
		return
	var asset: Dictionary = character_assets_by_persona.get(persona, {})
	var visual := _visual_root(character_node)
	var skeleton := _first_descendant_of_class(visual, "Skeleton3D") as Skeleton3D
	var animation_player := _first_descendant_of_class(visual, "AnimationPlayer") as AnimationPlayer
	var body_meshes := _mesh_descendants(visual)
	var weapon_socket := _ensure_weapon_socket(character_node, skeleton, str(asset.get("attachBone", "")))
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
		"bodyMeshes": body_meshes,
		"flashAge": 999.0,
		"armourTier": 0,
	}
	_apply_persona_palette(character_id, 0)


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
	corpse_asset.clear()
	var text := FileAccess.get_file_as_string(MANIFEST_PATH)
	var parsed = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		manifest = {}
		return
	manifest = parsed
	for asset in manifest.get("assets", []):
		if typeof(asset) != TYPE_DICTIONARY:
			continue
		var category := str(asset.get("category", ""))
		match category:
			"character":
				var persona := str(asset.get("personaSlot", ""))
				if not persona.is_empty():
					character_assets_by_persona[persona] = asset
			"weapon":
				var weapon_name := str(asset.get("weaponName", ""))
				if not weapon_name.is_empty():
					weapon_assets_by_name[weapon_name] = asset
			"armour":
				var armour_name := str(asset.get("armourName", ""))
				if not armour_name.is_empty():
					armour_assets_by_name[armour_name] = asset
			"corpse":
				if corpse_asset.is_empty():
					corpse_asset = asset
			"environment":
				var role := str(asset.get("environmentRole", ""))
				var file := str(asset.get("file", ""))
				if not role.is_empty() and file.ends_with(".glb") and not environment_assets_by_role.has(role):
					environment_assets_by_role[role] = asset


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
		_apply_persona_palette(character_id, tier)
		return
	var asset: Dictionary = armour_assets_by_name.get(armour_name, {})
	tier = int(asset.get("tier", 1))
	_apply_persona_palette(character_id, tier)
	var character: Dictionary = registered_characters.get(character_id, {})
	character["flashAge"] = 0.0
	registered_characters[character_id] = character


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


func _apply_persona_palette(character_id: String, armour_tier: int) -> void:
	var character: Dictionary = registered_characters.get(character_id, {})
	var asset: Dictionary = character.get("asset", {})
	var palette: Dictionary = asset.get("palette", {})
	var meshes: Array = character.get("bodyMeshes", [])
	for i in range(meshes.size()):
		var mesh := meshes[i] as MeshInstance3D
		if mesh == null or not is_instance_valid(mesh):
			continue
		mesh.material_override = _palette_material(palette, i, armour_tier)
	character["armourTier"] = armour_tier
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
