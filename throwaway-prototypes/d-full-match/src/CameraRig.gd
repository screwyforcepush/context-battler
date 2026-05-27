extends Node3D

signal anchor_changed(character_id: String)
signal mode_changed(mode: int)

const MODE_FREE := 0
const MODE_ANCHORED := 1
const DEFAULT_DIRECTOR_RADIUS := 26.0
const DEFAULT_ANCHORED_RADIUS := 14.0
const MIN_ZOOM_RADIUS := 5.0
const MAX_DIRECTOR_ZOOM := 62.0
const MAX_ANCHORED_ZOOM := 32.0

var snapshot: Dictionary = {}
var entity_renderer: Node
var scene_builder: Node
var clock: Node
var camera: Camera3D
var mode := MODE_FREE
var anchor_index := 0
var anchor_id := ""
var yaw := -0.72
var pitch := -0.72
var radius := DEFAULT_DIRECTOR_RADIUS
var director_radius := DEFAULT_DIRECTOR_RADIUS
var anchored_radius := DEFAULT_ANCHORED_RADIUS
var free_anchor := Vector3.ZERO
var smooth_anchor := Vector3.ZERO
var dragging := false
var panning := false
var last_pointer := Vector2.ZERO
var punch_offset := Vector3.ZERO
var punch_velocity := Vector3.ZERO
@export var lock_free_mode := false
var mode_button: Button
var prev_button: Button
var next_button: Button


func _ready() -> void:
	camera = Camera3D.new()
	camera.name = "director-camera"
	camera.fov = 48.0
	camera.near = 0.05
	camera.far = 180.0
	add_child(camera)
	camera.make_current()
	_make_controls()


func configure(root: Dictionary, renderer: Node, builder: Node, playback_clock: Node) -> void:
	snapshot = root
	entity_renderer = renderer
	scene_builder = builder
	clock = playback_clock
	var characters: Array = snapshot.get("characters", [])
	anchor_index = 0
	anchor_id = str(characters[0].get("characterId", "")) if not characters.is_empty() and typeof(characters[0]) == TYPE_DICTIONARY else ""
	director_radius = DEFAULT_DIRECTOR_RADIUS
	anchored_radius = DEFAULT_ANCHORED_RADIUS
	if lock_free_mode:
		mode = MODE_FREE
	radius = _radius_for_mode()
	free_anchor = Vector3.ZERO
	smooth_anchor = _anchor_world()
	# Anchor cycling intentionally includes every roster entry, including dead/extracted characters.
	anchor_changed.emit(anchor_id)
	mode_changed.emit(mode)
	_update_button_text()
	_apply_lock_free_controls()


func update_camera(delta: float) -> void:
	if camera == null:
		return
	_update_screen_punch(delta)
	var target := free_anchor
	if mode == MODE_ANCHORED:
		target = _anchor_world()
	smooth_anchor = smooth_anchor.lerp(target, clamp(delta * 6.0, 0.0, 1.0))
	var offset := Vector3(
		cos(pitch) * sin(yaw),
		-sin(pitch),
		cos(pitch) * cos(yaw)
	) * radius
	camera.position = smooth_anchor + offset + punch_offset
	camera.look_at(smooth_anchor, Vector3.UP)


func _input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var button := event as InputEventMouseButton
		if button.button_index == MOUSE_BUTTON_LEFT:
			dragging = button.pressed
			last_pointer = button.position
		elif button.button_index == MOUSE_BUTTON_RIGHT:
			panning = button.pressed
			last_pointer = button.position
		elif button.pressed and button.button_index == MOUSE_BUTTON_WHEEL_UP:
			radius = max(MIN_ZOOM_RADIUS, radius - 1.2)
			_store_radius_for_mode()
		elif button.pressed and button.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			radius = min(_max_zoom_for_mode(), radius + 1.2)
			_store_radius_for_mode()
	elif event is InputEventMouseMotion:
		var motion := event as InputEventMouseMotion
		var delta := motion.position - last_pointer
		last_pointer = motion.position
		if dragging:
			yaw -= delta.x * 0.007
			pitch = clamp(pitch - delta.y * 0.006, -1.24, -0.18)
		elif panning and mode == MODE_FREE:
			free_anchor += Vector3(-delta.x * 0.03, 0.0, -delta.y * 0.03)
	elif event is InputEventKey:
		var key := event as InputEventKey
		if key.pressed and not key.echo:
			if key.keycode == KEY_C and not lock_free_mode:
				toggle_mode()
			elif key.keycode == KEY_BRACKETLEFT:
				cycle_anchor(-1)
			elif key.keycode == KEY_BRACKETRIGHT:
				cycle_anchor(1)


func toggle_mode() -> void:
	if lock_free_mode:
		mode = MODE_FREE
		free_anchor = smooth_anchor
		radius = _radius_for_mode()
		mode_changed.emit(mode)
		_update_button_text()
		return
	_store_radius_for_mode()
	if mode == MODE_FREE:
		mode = MODE_ANCHORED
	else:
		mode = MODE_FREE
		free_anchor = smooth_anchor
	radius = _radius_for_mode()
	mode_changed.emit(mode)
	_update_button_text()


func cycle_anchor(delta_int: int) -> void:
	if lock_free_mode:
		return
	var characters: Array = snapshot.get("characters", [])
	if characters.is_empty():
		return
	anchor_index = posmod(anchor_index + delta_int, characters.size())
	var character: Dictionary = characters[anchor_index]
	anchor_id = str(character.get("characterId", ""))
	anchor_changed.emit(anchor_id)
	if mode == MODE_FREE:
		_store_radius_for_mode()
		mode = MODE_ANCHORED
		radius = _radius_for_mode()
		mode_changed.emit(mode)
	_update_button_text()


func get_anchor_id() -> String:
	return anchor_id


func get_mode() -> int:
	return mode


func screen_punch(direction: Vector3, magnitude: float) -> void:
	var flat := direction
	flat.y = 0.0
	var impulse := flat.normalized() if flat.length() > 0.001 else Vector3(0.0, 0.0, -1.0)
	punch_velocity += (impulse + Vector3.UP * 0.42) * clamp(magnitude, 0.0, 0.16)


func _anchor_world() -> Vector3:
	if entity_renderer != null and entity_renderer.has_method("get_anchor_world"):
		return entity_renderer.get_anchor_world(anchor_id)
	return Vector3.ZERO


func _store_radius_for_mode() -> void:
	if mode == MODE_ANCHORED:
		anchored_radius = clamp(radius, MIN_ZOOM_RADIUS, MAX_ANCHORED_ZOOM)
	else:
		director_radius = clamp(radius, MIN_ZOOM_RADIUS, MAX_DIRECTOR_ZOOM)


func _radius_for_mode() -> float:
	return clamp(anchored_radius, MIN_ZOOM_RADIUS, MAX_ANCHORED_ZOOM) if mode == MODE_ANCHORED else clamp(director_radius, MIN_ZOOM_RADIUS, MAX_DIRECTOR_ZOOM)


func _max_zoom_for_mode() -> float:
	return MAX_ANCHORED_ZOOM if mode == MODE_ANCHORED else MAX_DIRECTOR_ZOOM


func _update_screen_punch(delta: float) -> void:
	punch_offset += punch_velocity
	punch_velocity = punch_velocity.lerp(Vector3.ZERO, clamp(delta * 13.0, 0.0, 1.0))
	punch_offset = punch_offset.lerp(Vector3.ZERO, clamp(delta * 9.0, 0.0, 1.0))
	if punch_offset.length() < 0.0005:
		punch_offset = Vector3.ZERO
	if punch_velocity.length() < 0.0005:
		punch_velocity = Vector3.ZERO


func _make_controls() -> void:
	var layer := CanvasLayer.new()
	layer.name = "CameraControls"
	add_child(layer)
	var row := HBoxContainer.new()
	row.position = Vector2(16, 88)
	row.add_theme_constant_override("separation", 8)
	layer.add_child(row)
	mode_button = Button.new()
	mode_button.text = "Director"
	mode_button.pressed.connect(toggle_mode)
	row.add_child(mode_button)
	prev_button = Button.new()
	prev_button.text = "["
	prev_button.pressed.connect(func() -> void: cycle_anchor(-1))
	row.add_child(prev_button)
	next_button = Button.new()
	next_button.text = "]"
	next_button.pressed.connect(func() -> void: cycle_anchor(1))
	row.add_child(next_button)
	_apply_lock_free_controls()


func _update_button_text() -> void:
	if mode_button == null:
		return
	mode_button.text = "Anchored" if mode == MODE_ANCHORED else "Director"


func _apply_lock_free_controls() -> void:
	if mode_button != null:
		mode_button.visible = not lock_free_mode
	if prev_button != null:
		prev_button.visible = not lock_free_mode
	if next_button != null:
		next_button.visible = not lock_free_mode
