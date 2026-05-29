extends SceneTree

const MANIFEST_PATH := "res://shared-harness/art-kit/manifest.json"
const ART_ROOT := "res://shared-harness/art-kit/"
const PERSONAS := ["rat", "duelist", "trader", "opportunist", "paranoid", "camper", "sprinter", "vulture"]

var failures: Array[String] = []


func _init() -> void:
	_run.call_deferred()


func _run() -> void:
	var manifest := _read_manifest()
	if manifest.is_empty():
		_fail("manifest did not parse")
		_finish()
		return
	var root_body: Dictionary = manifest.get("body", {})
	var source_counts := {
		"mesh2motion": 0,
		"quaternius": 0,
		"warrior_alternate": 0,
		"kenney": 0,
	}
	var body_files := {}
	for asset in _character_assets(manifest):
		var asset_dict := asset as Dictionary
		var persona := str(asset_dict.get("personaSlot", ""))
		var body_override := _dictionary_block(asset_dict, "bodyOverride")
		var effective_body := root_body.duplicate(true)
		if not body_override.is_empty():
			effective_body.merge(body_override, true)
		effective_body.merge(asset_dict, true)
		_count_source(persona, body_override, effective_body, source_counts, body_files)
		await _audit_persona_body(persona, asset_dict, body_override, effective_body)
	_assert_counts(source_counts, body_files)
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
	if out.size() != PERSONAS.size():
		_fail("expected %d character assets, found %d" % [PERSONAS.size(), out.size()])
	return out


func _count_source(persona: String, body_override: Dictionary, effective_body: Dictionary, source_counts: Dictionary, body_files: Dictionary) -> void:
	var file := str(effective_body.get("file", ""))
	if not file.is_empty():
		body_files[file] = true
	if body_override.is_empty():
		source_counts["mesh2motion"] = int(source_counts.get("mesh2motion", 0)) + 1
		return
	var source_pack := str(body_override.get("sourcePack", ""))
	if source_pack == "Quaternius-ModularCharacterOutfitsFantasy-CC0" or source_pack == "Quaternius-PolyPizzaIndividual-CC0":
		source_counts["quaternius"] = int(source_counts.get("quaternius", 0)) + 1
	elif source_pack == "OGA-BlackScorp-LowPolyWarrior-CC0" or source_pack == "Kaykit-Adventurers-CC0":
		source_counts["warrior_alternate"] = int(source_counts.get("warrior_alternate", 0)) + 1
	elif source_pack.begins_with("Kenney-"):
		source_counts["kenney"] = int(source_counts.get("kenney", 0)) + 1
	else:
		_fail("%s bodyOverride.sourcePack is not in an approved Round-8.1 body category: %s" % [persona, source_pack])


func _assert_counts(source_counts: Dictionary, body_files: Dictionary) -> void:
	if int(source_counts.get("mesh2motion", 0)) != 1:
		_fail("expected exactly 1 mesh2motion control, found %d" % int(source_counts.get("mesh2motion", 0)))
	if int(source_counts.get("quaternius", 0)) < 4:
		_fail("expected at least 4 Quaternius override bodies, found %d" % int(source_counts.get("quaternius", 0)))
	if int(source_counts.get("warrior_alternate", 0)) < 1:
		_fail("expected at least 1 OGA BlackScorp or rigged warrior alternate body, found %d" % int(source_counts.get("warrior_alternate", 0)))
	if int(source_counts.get("kenney", 0)) < 2:
		_fail("expected at least 2 Kenney override bodies, found %d" % int(source_counts.get("kenney", 0)))
	if body_files.size() < 4:
		_fail("expected at least 4 distinct effective body GLB files, found %d" % body_files.size())
	print("body-source counts mesh2motion=%d quaternius=%d warrior_alternate=%d kenney=%d distinct_files=%d" % [
		int(source_counts.get("mesh2motion", 0)),
		int(source_counts.get("quaternius", 0)),
		int(source_counts.get("warrior_alternate", 0)),
		int(source_counts.get("kenney", 0)),
		body_files.size(),
	])


func _audit_persona_body(persona: String, asset: Dictionary, body_override: Dictionary, effective_body: Dictionary) -> void:
	if not body_override.is_empty():
		_assert_body_override_shape(persona, asset, body_override)
	var file := str(effective_body.get("file", ""))
	var resource_path := "%s%s" % [ART_ROOT, file]
	var root := _instantiate_scene(resource_path, persona)
	if root == null:
		return
	get_root().add_child(root)
	await process_frame
	var skeleton := _first_descendant_of_class(root, "Skeleton3D") as Skeleton3D
	var player := _first_descendant_of_class(root, "AnimationPlayer") as AnimationPlayer
	if skeleton == null:
		_fail("%s effective body has no Skeleton3D: %s" % [persona, file])
	if player == null:
		_fail("%s effective body has no AnimationPlayer: %s" % [persona, file])
	if skeleton != null:
		_assert_bone(persona, skeleton, str(effective_body.get("attachBone", "")), "attachBone")
		if asset.get("armorOverlay", null) != null and not body_override.is_empty():
			_assert_bone(persona, skeleton, str(body_override.get("armourAttachBone", "")), "bodyOverride.armourAttachBone")
	if player != null:
		var animation := _dictionary_block(effective_body, "animation")
		_assert_clip(persona, player, str(animation.get("idle", "")), "animation.idle")
		if not body_override.is_empty() and _dictionary_block(asset, "corpseOverride").is_empty():
			var death_clip := str(animation.get("death", ""))
			var death_pose_clip := str(effective_body.get("deathPoseClip", ""))
			if death_clip.is_empty() and death_pose_clip.is_empty():
				_fail("%s bodyOverride must declare animation.death or deathPoseClip for implicit corpse fallback" % persona)
			if not death_clip.is_empty():
				_assert_clip(persona, player, death_clip, "animation.death")
			if not death_pose_clip.is_empty():
				_assert_clip(persona, player, death_pose_clip, "deathPoseClip")
		print("body provenance %s sourceKey=%s sourcePack=%s file=%s idle=%s death=%s armourAttachBone=%s" % [
			persona,
			str(effective_body.get("sourceKey", "")),
			str(effective_body.get("sourcePack", "mesh2motion")),
			file,
			str(_dictionary_block(effective_body, "animation").get("idle", "")),
			str(_dictionary_block(effective_body, "animation").get("death", effective_body.get("deathPoseClip", ""))),
			str(body_override.get("armourAttachBone", "")),
		])
	root.queue_free()


func _assert_body_override_shape(persona: String, asset: Dictionary, body_override: Dictionary) -> void:
	for key in ["file", "sourceKey", "sourcePack", "attachBone", "sha256"]:
		if str(body_override.get(key, "")).is_empty():
			_fail("%s bodyOverride.%s is required" % [persona, key])
	for key in ["modelScaleMultiplier", "targetWorldHeight", "sizeBytes"]:
		var value = body_override.get(key, null)
		if typeof(value) != TYPE_INT and typeof(value) != TYPE_FLOAT:
			_fail("%s bodyOverride.%s must be numeric" % [persona, key])
	var animation := _dictionary_block(body_override, "animation")
	if str(animation.get("idle", "")).is_empty():
		_fail("%s bodyOverride.animation.idle is required" % persona)
	if asset.get("armorOverlay", null) != null and str(body_override.get("armourAttachBone", "")).is_empty():
		_fail("%s bodyOverride.armourAttachBone is required for armorOverlay preservation" % persona)
	var file := str(body_override.get("file", ""))
	if not file.is_empty():
		var resource_path := "%s%s" % [ART_ROOT, file]
		if not ResourceLoader.exists(resource_path):
			_fail("%s bodyOverride.file resource does not exist: %s" % [persona, resource_path])
		if not FileAccess.file_exists("%s.import" % resource_path):
			_fail("%s bodyOverride.file missing .import sidecar: %s.import" % [persona, resource_path])


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


func _assert_bone(persona: String, skeleton: Skeleton3D, bone_name: String, label: String) -> void:
	if bone_name.is_empty():
		_fail("%s %s is empty" % [persona, label])
	elif skeleton.find_bone(bone_name) < 0:
		_fail("%s %s does not resolve on Skeleton3D: %s" % [persona, label, bone_name])


func _assert_clip(persona: String, player: AnimationPlayer, clip_name: String, label: String) -> void:
	if clip_name.is_empty():
		_fail("%s %s is empty" % [persona, label])
	elif not player.has_animation(clip_name):
		_fail("%s %s does not resolve on AnimationPlayer: %s" % [persona, label, clip_name])


func _dictionary_block(source: Dictionary, key: String) -> Dictionary:
	var value = source.get(key, {})
	if typeof(value) == TYPE_DICTIONARY:
		return value as Dictionary
	return {}


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


func _fail(message: String) -> void:
	failures.append(message)


func _finish() -> void:
	if failures.is_empty():
		print("audit-body-source-provenance PASS")
		quit(0)
		return
	for failure in failures:
		push_error(failure)
	print("audit-body-source-provenance FAIL")
	quit(1)
