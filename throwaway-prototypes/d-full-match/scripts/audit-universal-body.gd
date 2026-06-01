extends SceneTree

const MANIFEST_PATH := "res://shared-harness/art-kit/manifest.json"
const ART_ROOT := "res://shared-harness/art-kit/"
const EXPECTED_SCHEMA_VERSION := 10
const UNIVERSAL_BODY_FILE := "characters/camper-mesh2motion-human-base.glb"
const UNIVERSAL_SOURCE_KEY := "mesh2motion"
const PERSONAS := ["rat", "duelist", "trader", "opportunist", "paranoid", "camper", "sprinter", "vulture"]
const REQUIRED_SHARED_CLIPS := ["idle", "death"]
const REQUIRED_SHARED_BONES := ["hand_r", "hand_l", "head", "spine_01", "spine_02", "spine_03"]
const FORBIDDEN_CHARACTER_BODY_KEYS := [
	"sourceKey",
	"file",
	"modelScaleMultiplier",
	"pivotYOffset",
	"attachBone",
	"animation",
	"source",
	"license",
	"extraction",
	"sha256",
	"sizeBytes",
	"palette",
]

var failures: Array[String] = []


func _init() -> void:
	_run.call_deferred()


func _run() -> void:
	var manifest := _read_manifest()
	if manifest.is_empty():
		_fail("manifest did not parse")
		_finish()
		return
	_assert_manifest_universal_body(manifest)
	var body: Dictionary = manifest.get("body", {})
	var resource_path := "%s%s" % [ART_ROOT, str(body.get("file", ""))]
	var root := _instantiate_scene(resource_path, "universal body")
	if root == null:
		_finish()
		return
	get_root().add_child(root)
	await process_frame
	var skeleton := _first_descendant_of_class(root, "Skeleton3D") as Skeleton3D
	var player := _first_descendant_of_class(root, "AnimationPlayer") as AnimationPlayer
	if skeleton == null:
		_fail("universal body has no Skeleton3D: %s" % resource_path)
	else:
		_assert_required_bones(skeleton)
	if player == null:
		_fail("universal body has no AnimationPlayer: %s" % resource_path)
	else:
		_assert_required_clips(manifest, player)
	_assert_character_assets_use_universal_body(manifest)
	root.queue_free()
	_finish()


func _read_manifest() -> Dictionary:
	var text := FileAccess.get_file_as_string(MANIFEST_PATH)
	var parsed = JSON.parse_string(text)
	return parsed if typeof(parsed) == TYPE_DICTIONARY else {}


func _assert_manifest_universal_body(manifest: Dictionary) -> void:
	if int(manifest.get("schemaVersion", -1)) != EXPECTED_SCHEMA_VERSION:
		_fail("manifest schemaVersion is not %d" % EXPECTED_SCHEMA_VERSION)
	var body: Dictionary = manifest.get("body", {})
	if body.is_empty():
		_fail("manifest.body is missing")
		return
	if str(body.get("sourceKey", "")) != UNIVERSAL_SOURCE_KEY:
		_fail("manifest.body.sourceKey is not %s" % UNIVERSAL_SOURCE_KEY)
	if str(body.get("file", "")) != UNIVERSAL_BODY_FILE:
		_fail("manifest.body.file is not %s" % UNIVERSAL_BODY_FILE)
	if str(body.get("armourAttachBone", "")) != "spine":
		_fail('manifest.body.armourAttachBone reserved field is not "spine"')
	var animation: Dictionary = body.get("animation", {})
	for kind_value in REQUIRED_SHARED_CLIPS:
		var kind := str(kind_value)
		if str(animation.get(kind, "")).is_empty():
			_fail("manifest.body.animation.%s is empty" % kind)
	var corpse_body: Dictionary = manifest.get("corpseBody", {})
	if corpse_body.is_empty():
		_fail("manifest.corpseBody is missing")
		return
	if str(corpse_body.get("file", "")) != UNIVERSAL_BODY_FILE:
		_fail("manifest.corpseBody.file is not %s" % UNIVERSAL_BODY_FILE)
	if str(corpse_body.get("deathPoseClip", "")).is_empty():
		_fail("manifest.corpseBody.deathPoseClip is empty")


func _assert_required_bones(skeleton: Skeleton3D) -> void:
	for bone_value in REQUIRED_SHARED_BONES:
		var bone_name := str(bone_value)
		if skeleton.find_bone(bone_name) < 0:
			_fail("universal mesh2motion body missing Skeleton3D bone: %s" % bone_name)
		else:
			print("universal body bone %s OK" % bone_name)


func _assert_required_clips(manifest: Dictionary, player: AnimationPlayer) -> void:
	var body: Dictionary = manifest.get("body", {})
	var animation: Dictionary = body.get("animation", {})
	for kind_value in REQUIRED_SHARED_CLIPS:
		var kind := str(kind_value)
		var clip := str(animation.get(kind, ""))
		_assert_clip(player, "manifest.body.animation.%s" % kind, clip)
	var corpse_body: Dictionary = manifest.get("corpseBody", {})
	_assert_clip(player, "manifest.corpseBody.deathPoseClip", str(corpse_body.get("deathPoseClip", "")))


func _assert_character_assets_use_universal_body(manifest: Dictionary) -> void:
	var seen_personas := {}
	var character_count := 0
	var forbidden_key := _body_substitution_key()
	for asset in manifest.get("assets", []):
		if typeof(asset) != TYPE_DICTIONARY:
			continue
		var asset_dict := asset as Dictionary
		if str(asset_dict.get("category", "")) != "character":
			continue
		character_count += 1
		var persona := str(asset_dict.get("personaSlot", ""))
		if persona.is_empty():
			_fail("character asset has empty personaSlot: %s" % str(asset_dict.get("id", "<unknown>")))
			continue
		seen_personas[persona] = true
		if asset_dict.has(forbidden_key):
			_fail("%s declares forbidden per-persona body substitution key" % persona)
		for key_value in FORBIDDEN_CHARACTER_BODY_KEYS:
			var key := str(key_value)
			if asset_dict.has(key):
				_fail("%s declares per-character body field %s" % [persona, key])
		print("universal body %s sourceKey=%s file=%s" % [persona, UNIVERSAL_SOURCE_KEY, UNIVERSAL_BODY_FILE])
	if character_count != PERSONAS.size():
		_fail("expected %d character assets, found %d" % [PERSONAS.size(), character_count])
	for persona_value in PERSONAS:
		var persona := str(persona_value)
		if not seen_personas.has(persona):
			_fail("missing persona in manifest assets: %s" % persona)


func _body_substitution_key() -> String:
	return "body" + "Override"


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


func _assert_clip(player: AnimationPlayer, label: String, clip: String) -> void:
	if clip.is_empty():
		_fail("%s is empty" % label)
	elif not player.has_animation(clip):
		_fail("%s does not resolve on universal body AnimationPlayer: %s" % [label, clip])
	else:
		print("universal body clip %s=%s OK" % [label, clip])


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
		print("audit-universal-body PASS")
		quit(0)
		return
	for failure in failures:
		push_error(failure)
	print("audit-universal-body FAIL")
	quit(1)
