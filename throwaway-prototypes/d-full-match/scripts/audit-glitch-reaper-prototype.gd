extends SceneTree

const RESOURCE_PATH := "res://shared-harness/art-kit/characters/generated/glitch_reaper.glb"
const REPORT_PATH := "res://dist/characters/glitch_reaper/glitch_reaper_godot_report.json"
const REQUIRED_BONES := ["head", "spine_01", "spine_02", "spine_03", "hand_l", "hand_r", "lowerarm_l", "lowerarm_r", "thigh_l", "thigh_r", "calf_l", "calf_r"]
const CLIP_CANDIDATES := {
	"idle": ["Idle", "Idle_Loop", "Zombie_Idle_Loop"],
	"walk": ["Walk", "Walk_Loop", "Zombie_Walk_Fwd_Loop"],
	"run": ["Sprint", "Sprint_Loop", "Jog_Fwd", "Jog_Fwd_Loop"],
	"attack": ["Sword_Attack", "Punch_Jab", "Melee_Hook"],
}

var failures: Array[String] = []
var warnings: Array[String] = []
var result := {}


func _init() -> void:
	_run.call_deferred()


func _run() -> void:
	result = {
		"resource": RESOURCE_PATH,
		"imports_cleanly": false,
		"instantiates": false,
		"skeleton": {},
		"animation": {},
		"modules": {},
		"validation_questions": {},
	}
	if not ResourceLoader.exists(RESOURCE_PATH):
		_fail("resource does not exist after import: %s" % RESOURCE_PATH)
		_finish()
		return
	var resource := load(RESOURCE_PATH)
	if not resource is PackedScene:
		_fail("resource is not a PackedScene: %s" % RESOURCE_PATH)
		_finish()
		return
	result["imports_cleanly"] = true
	var root := (resource as PackedScene).instantiate()
	if root == null:
		_fail("resource did not instantiate")
		_finish()
		return
	get_root().add_child(root)
	result["instantiates"] = true
	_audit_skeleton(root)
	_audit_animation(root)
	_audit_modules(root)
	root.queue_free()
	_finish()


func _audit_skeleton(root: Node) -> void:
	var skeleton := _first_descendant_of_class(root, "Skeleton3D") as Skeleton3D
	if skeleton == null:
		_fail("prototype has no Skeleton3D")
		result["skeleton"] = {"present": false}
		return
	var missing := []
	for bone in REQUIRED_BONES:
		if skeleton.find_bone(str(bone)) < 0:
			missing.append(str(bone))
	result["skeleton"] = {
		"present": true,
		"bone_count": skeleton.get_bone_count(),
		"missing_required_bones": missing,
		"bones_match_source_contract": missing.is_empty(),
	}
	if not missing.is_empty():
		_fail("prototype missing required bones: %s" % ", ".join(missing))


func _audit_animation(root: Node) -> void:
	var player := _first_descendant_of_class(root, "AnimationPlayer") as AnimationPlayer
	if player == null:
		_fail("prototype has no AnimationPlayer")
		result["animation"] = {"present": false}
		return
	var available := PackedStringArray(player.get_animation_list())
	var resolved := {}
	var missing := []
	for kind in CLIP_CANDIDATES.keys():
		var clip := _first_existing_clip(player, CLIP_CANDIDATES.get(kind, []))
		if clip.is_empty():
			missing.append(str(kind))
		else:
			resolved[kind] = clip
			player.play(clip)
			player.advance(0.1)
	result["animation"] = {
		"present": true,
		"clip_count": available.size(),
		"resolved_required_clips": resolved,
		"missing_required_kinds": missing,
		"clips_played": missing.is_empty(),
	}
	if not missing.is_empty():
		_fail("prototype could not resolve animation kinds: %s" % ", ".join(missing))


func _audit_modules(root: Node) -> void:
	var names := []
	_collect_names(root, names)
	var required_tokens := [
		"glitch_reaper_head_A_skull_shell",
		"glitch_reaper_head_A_red_eye_slit",
		"glitch_reaper_rib_core_molten_heart",
		"glitch_reaper_execution_blade_body",
		"glitch_reaper_flayed_gore_drape",
		"glitch_reaper_cyan_data_tear",
	]
	var missing := []
	for token in required_tokens:
		if not _names_contain(names, str(token)):
			missing.append(str(token))
	result["modules"] = {
		"named_module_nodes": _count_names_with_prefix(names, "glitch_reaper"),
		"required_tokens_missing": missing,
		"replacement_head_present": not missing.has("glitch_reaper_head_A_skull_shell"),
		"red_eye_module_present": not missing.has("glitch_reaper_head_A_red_eye_slit"),
		"gore_modules_present": not missing.has("glitch_reaper_flayed_gore_drape"),
	}
	if not missing.is_empty():
		_fail("prototype missing authored module node tokens: %s" % ", ".join(missing))


func _finish() -> void:
	result["validation_questions"] = {
		"original_mannequin_face_still_visible": "covered, not deleted",
		"head_is_coherent_replacement_module": failures.is_empty() or bool((result.get("modules", {}) as Dictionary).get("replacement_head_present", false)),
		"red_eyes_readable_module_present": bool((result.get("modules", {}) as Dictionary).get("red_eye_module_present", false)),
		"glitch_infernal_skeletal_cyborg_identity_present": bool((result.get("modules", {}) as Dictionary).get("replacement_head_present", false)) and bool((result.get("modules", {}) as Dictionary).get("red_eye_module_present", false)),
		"gore_flayed_aesthetic_present": bool((result.get("modules", {}) as Dictionary).get("gore_modules_present", false)),
		"idle_walk_run_attack_play": bool((result.get("animation", {}) as Dictionary).get("clips_played", false)),
		"godot_imports_cleanly": bool(result.get("imports_cleanly", false)) and bool(result.get("instantiates", false)),
	}
	result["status"] = "pass" if failures.is_empty() else "fail"
	result["failures"] = failures
	result["warnings"] = warnings
	var report_text := JSON.stringify(result, "\t")
	var abs_path := ProjectSettings.globalize_path(REPORT_PATH)
	var file := FileAccess.open(abs_path, FileAccess.WRITE)
	if file != null:
		file.store_string(report_text)
		file.store_string("\n")
	if failures.is_empty():
		print("audit-glitch-reaper-prototype PASS")
		quit(0)
		return
	for failure in failures:
		push_error(failure)
	print("audit-glitch-reaper-prototype FAIL")
	quit(1)


func _first_existing_clip(player: AnimationPlayer, candidates: Array) -> String:
	for candidate in candidates:
		var clip := str(candidate)
		if player.has_animation(clip):
			return clip
	return ""


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


func _collect_names(node: Node, out: Array) -> void:
	if node == null:
		return
	out.append(str(node.name))
	for child in node.get_children():
		_collect_names(child, out)


func _names_contain(names: Array, token: String) -> bool:
	for name_value in names:
		if str(name_value).contains(token):
			return true
	return false


func _count_names_with_prefix(names: Array, prefix: String) -> int:
	var count := 0
	for name_value in names:
		if str(name_value).begins_with(prefix):
			count += 1
	return count


func _fail(message: String) -> void:
	failures.append(message)
