extends SceneTree

const MANIFEST_PATH := "res://shared-harness/art-kit/manifest.json"
const ART_ROOT := "res://shared-harness/art-kit/"

var failures: Array[String] = []


func _init() -> void:
	var manifest := _read_manifest()
	if manifest.is_empty():
		_fail("manifest did not parse")
	var fallback_count := 0
	for asset in manifest.get("assets", []):
		if typeof(asset) != TYPE_DICTIONARY or str(asset.get("category", "")) != "character":
			continue
		var asset_dict := asset as Dictionary
		var fallback := _is_translation_only_fallback(asset_dict)
		if fallback:
			fallback_count += 1
		_verify_character(asset_dict, fallback)
	if fallback_count > 1:
		_fail("translation-only fallback count exceeds 1")
	if failures.is_empty():
		print("verify-character-rigs PASS")
		quit(0)
	else:
		for failure in failures:
			push_error(failure)
		print("verify-character-rigs FAIL")
		quit(1)


func _read_manifest() -> Dictionary:
	var text := FileAccess.get_file_as_string(MANIFEST_PATH)
	var parsed = JSON.parse_string(text)
	return parsed if typeof(parsed) == TYPE_DICTIONARY else {}


func _verify_character(asset: Dictionary, fallback: bool) -> void:
	var label := str(asset.get("personaSlot", asset.get("id", "")))
	var file := str(asset.get("file", ""))
	if file.is_empty():
		_fail("%s has empty character file" % label)
		return
	var resource_path := "%s%s" % [ART_ROOT, file]
	if not ResourceLoader.exists(resource_path):
		_fail("%s resource does not exist: %s" % [label, resource_path])
		return
	var resource = load(resource_path)
	if not resource is PackedScene:
		_fail("%s resource is not a PackedScene: %s" % [label, resource_path])
		return
	var root := (resource as PackedScene).instantiate()
	var state := {
		"skeleton": null,
		"player": null,
	}
	_scan_scene(root, state)
	if not fallback and state["skeleton"] == null:
		_fail("%s scene has no Skeleton3D" % label)
	if not fallback and state["player"] == null:
		_fail("%s scene has no AnimationPlayer" % label)
	var skeleton := state["skeleton"] as Skeleton3D
	if skeleton != null:
		_verify_attach_bone(label, asset, skeleton)
	var player := state["player"] as AnimationPlayer
	var animation: Dictionary = asset.get("animation", {})
	for clip_kind in ["idle", "walk", "attack"]:
		_verify_clip(label, player, animation, clip_kind, fallback)
	if not animation.has("loot") and not animation.has("generic"):
		_fail("%s has neither loot nor generic action clip in manifest" % label)
	if animation.has("loot"):
		_verify_clip(label, player, animation, "loot", fallback)
	else:
		_verify_clip(label, player, animation, "generic", fallback)
	root.queue_free()


func _verify_attach_bone(label: String, asset: Dictionary, skeleton: Skeleton3D) -> void:
	var attach_bone = asset.get("attachBone", null)
	if attach_bone == null:
		return
	var bone_name := str(attach_bone)
	if bone_name.is_empty():
		_fail("%s attachBone is empty" % label)
		return
	if skeleton.find_bone(bone_name) < 0:
		_fail("%s attachBone does not resolve: %s" % [label, bone_name])


func _verify_clip(label: String, player: AnimationPlayer, animation: Dictionary, clip_kind: String, fallback: bool) -> void:
	var clip := str(animation.get(clip_kind, ""))
	if clip.is_empty():
		if not fallback:
			_fail("%s missing %s clip name" % [label, clip_kind])
		return
	if player == null:
		return
	if not player.has_animation(clip):
		_fail("%s clip does not resolve: %s=%s" % [label, clip_kind, clip])


func _scan_scene(node: Node, state: Dictionary) -> void:
	if node is Skeleton3D and state["skeleton"] == null:
		state["skeleton"] = node
	if node is AnimationPlayer and state["player"] == null:
		state["player"] = node
	for child in node.get_children():
		_scan_scene(child, state)


func _is_translation_only_fallback(asset: Dictionary) -> bool:
	var notes := str(asset.get("notes", "")).to_lower()
	return notes.contains("translation-only fallback")


func _fail(message: String) -> void:
	failures.append(message)
