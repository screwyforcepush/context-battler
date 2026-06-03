extends SceneTree

const SOURCE_PATH := "res://shared-harness/art-kit/characters/generated/glitch_reaper.glb"
const IMPORT_FILE_PATH := "res://shared-harness/art-kit/characters/generated/glitch_reaper.glb.import"
const IMPORTED_SCENE_PATH := "res://.godot/imported/glitch_reaper.glb-961de7f31ef5651a3020967d88190103.scn"
const IMPORT_UID := "uid://d4j7yf1qwy7mh"

var failures: Array[String] = []


func _init() -> void:
	_run.call_deferred()


func _run() -> void:
	var document := GLTFDocument.new()
	var state := GLTFState.new()
	var err := document.append_from_file(SOURCE_PATH, state)
	if err != OK:
		_fail("GLTFDocument could not append %s: %s" % [SOURCE_PATH, err])
		_finish()
		return

	var scene := document.generate_scene(state)
	if scene == null:
		_fail("GLTFDocument did not generate a scene for %s" % SOURCE_PATH)
		_finish()
		return

	var packed := PackedScene.new()
	err = packed.pack(scene)
	scene.queue_free()
	if err != OK:
		_fail("PackedScene.pack failed: %s" % err)
		_finish()
		return

	err = ResourceSaver.save(packed, IMPORTED_SCENE_PATH)
	if err != OK:
		_fail("ResourceSaver.save failed for %s: %s" % [IMPORTED_SCENE_PATH, err])
		_finish()
		return

	_write_import_file()
	print("import-glitch-reaper-prototype PASS")
	_finish()


func _write_import_file() -> void:
	var text := """[remap]

importer="scene"
importer_version=1
type="PackedScene"
uid="%s"
path="%s"

[deps]

source_file="%s"
dest_files=["%s"]

[params]

nodes/root_type=""
nodes/root_name=""
nodes/root_script=null
nodes/apply_root_scale=true
nodes/root_scale=1.0
nodes/import_as_skeleton_bones=false
nodes/use_name_suffixes=true
nodes/use_node_type_suffixes=true
meshes/ensure_tangents=true
meshes/generate_lods=true
meshes/create_shadow_meshes=true
meshes/light_baking=1
meshes/lightmap_texel_size=0.2
meshes/force_disable_compression=false
skins/use_named_skins=true
animation/import=true
animation/fps=30
animation/trimming=false
animation/remove_immutable_tracks=true
animation/import_rest_as_RESET=false
import_script/path=""
materials/extract=0
materials/extract_format=0
materials/extract_path=""
_subresources={}
gltf/naming_version=2
gltf/embedded_image_handling=1
""" % [IMPORT_UID, IMPORTED_SCENE_PATH, SOURCE_PATH, IMPORTED_SCENE_PATH]
	var abs_path := ProjectSettings.globalize_path(IMPORT_FILE_PATH)
	var file := FileAccess.open(abs_path, FileAccess.WRITE)
	if file == null:
		_fail("Could not write import file: %s" % IMPORT_FILE_PATH)
		return
	file.store_string(text)


func _finish() -> void:
	if failures.is_empty():
		quit(0)
		return
	for failure in failures:
		push_error(failure)
	print("import-glitch-reaper-prototype FAIL")
	quit(1)


func _fail(message: String) -> void:
	failures.append(message)
