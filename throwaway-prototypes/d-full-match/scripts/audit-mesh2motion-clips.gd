extends SceneTree

const MANIFEST_PATH := "res://shared-harness/art-kit/manifest.json"
const ART_ROOT := "res://shared-harness/art-kit/"
const UNIVERSAL_BODY_FILE := "characters/camper-mesh2motion-human-base.glb"
const UNIVERSAL_SOURCE_KEY := "mesh2motion"
const PERSONAS := ["rat", "duelist", "trader", "opportunist", "paranoid", "camper", "sprinter", "vulture"]
const REQUIRED_BONES := ["hand_r"]
const REQUIRED_ANIMATION_KINDS := ["idle", "walk", "attack", "attack_unarmed", "attack_armed", "take_hit", "death", "loot"]

var failures: Array[String] = []


func _init() -> void:
	_run.call_deferred()


func _run() -> void:
	var manifest := _read_manifest()
	if manifest.is_empty():
		_fail("manifest did not parse")
		_finish()
		return
	_audit_universal_persona_count(manifest)
	var body: Dictionary = manifest.get("body", {})
	if str(body.get("sourceKey", "")) != UNIVERSAL_SOURCE_KEY:
		_fail("manifest.body.sourceKey is not %s" % UNIVERSAL_SOURCE_KEY)
	if str(body.get("file", "")) != UNIVERSAL_BODY_FILE:
		_fail("manifest.body.file is not %s" % UNIVERSAL_BODY_FILE)
	if str(body.get("armourAttachBone", "")) != "spine":
		_fail('manifest.body.armourAttachBone reserved field is not "spine"')
	var body_file := str(body.get("file", ""))
	if body_file.is_empty():
		_fail("manifest.body.file is empty")
		_finish()
		return
	var resource_path := "%s%s" % [ART_ROOT, body_file]
	var root := _instantiate_scene(resource_path)
	if root == null:
		_finish()
		return
	var player := _first_descendant_of_class(root, "AnimationPlayer") as AnimationPlayer
	if player == null:
		_fail("mesh2motion body has no AnimationPlayer: %s" % resource_path)
	else:
		_audit_clips(manifest, player)
	var skeleton := _first_descendant_of_class(root, "Skeleton3D") as Skeleton3D
	if skeleton == null:
		_fail("mesh2motion body has no Skeleton3D: %s" % resource_path)
	else:
		for bone_name in REQUIRED_BONES:
			if skeleton.find_bone(str(bone_name)) < 0:
				_fail("mesh2motion body missing Skeleton3D bone: %s" % bone_name)
			else:
				print("bone coverage %s OK" % bone_name)
	root.queue_free()
	_finish()


func _read_manifest() -> Dictionary:
	var text := FileAccess.get_file_as_string(MANIFEST_PATH)
	var parsed = JSON.parse_string(text)
	return parsed if typeof(parsed) == TYPE_DICTIONARY else {}


func _audit_universal_persona_count(manifest: Dictionary) -> void:
	var count := 0
	var seen := {}
	var forbidden_key := _body_substitution_key()
	for asset in manifest.get("assets", []):
		if typeof(asset) != TYPE_DICTIONARY:
			continue
		var asset_dict := asset as Dictionary
		if str(asset_dict.get("category", "")) != "character":
			continue
		count += 1
		var persona := str(asset_dict.get("personaSlot", ""))
		seen[persona] = true
		if asset_dict.has(forbidden_key):
			_fail("%s declares forbidden per-persona body substitution key" % persona)
	if count != PERSONAS.size():
		_fail("expected %d universal mesh2motion personas, found %d" % [PERSONAS.size(), count])
	for persona_value in PERSONAS:
		var persona := str(persona_value)
		if not seen.has(persona):
			_fail("missing mesh2motion persona: %s" % persona)


func _body_substitution_key() -> String:
	return "body" + "Override"


func _instantiate_scene(resource_path: String) -> Node:
	if not ResourceLoader.exists(resource_path):
		_fail("resource does not exist: %s" % resource_path)
		return null
	var resource = load(resource_path)
	if not resource is PackedScene:
		_fail("resource is not a PackedScene: %s" % resource_path)
		return null
	var root = (resource as PackedScene).instantiate()
	if root == null:
		_fail("resource did not instantiate: %s" % resource_path)
	return root


func _audit_clips(manifest: Dictionary, player: AnimationPlayer) -> void:
	var clip_inventory := PackedStringArray(player.get_animation_list())
	print("mesh2motion clip inventory: %s" % ", ".join(clip_inventory))
	var body: Dictionary = manifest.get("body", {})
	var animation: Dictionary = body.get("animation", {})
	for kind in REQUIRED_ANIMATION_KINDS:
		var clip := str(animation.get(str(kind), ""))
		if clip.is_empty():
			_fail("manifest.body.animation.%s is empty" % kind)
			continue
		_assert_clip(player, "manifest.body.animation.%s" % kind, clip)
	var corpse_body: Dictionary = manifest.get("corpseBody", {})
	var death_pose_clip := str(corpse_body.get("deathPoseClip", ""))
	if death_pose_clip.is_empty():
		_fail("manifest.corpseBody.deathPoseClip is empty")
	else:
		_assert_clip(player, "manifest.corpseBody.deathPoseClip", death_pose_clip)


func _assert_clip(player: AnimationPlayer, label: String, clip: String) -> void:
	if player.has_animation(clip):
		print("clip coverage %s=%s OK" % [label, clip])
	else:
		_fail("missing clip %s=%s" % [label, clip])


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
		print("audit-mesh2motion-clips PASS")
		quit(0)
		return
	for failure in failures:
		push_error(failure)
	print("audit-mesh2motion-clips FAIL")
	quit(1)
