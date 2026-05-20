extends Node3D

@onready var scene_builder: Node3D = %SceneBuilder
@onready var entity_renderer: Node3D = %EntityRenderer
@onready var playback_clock: Node = %PlaybackClock
@onready var timeline_hud: CanvasLayer = %TimelineHud
@onready var camera_rig: Node3D = %CameraRig
@onready var kill_feed_overlay: CanvasLayer = %KillFeedOverlay
@onready var side_panel: CanvasLayer = %SidePanel

var status_label: Label
var retry_button: Button
var back_button: Button
var snapshot: Dictionary = {}


func _ready() -> void:
	RenderingServer.set_default_clear_color(Color(0.006, 0.008, 0.012, 1.0))
	_make_status_ui()
	back_button.pressed.connect(_on_back_pressed)
	retry_button.pressed.connect(_load_snapshot)
	camera_rig.anchor_changed.connect(_on_camera_anchor_changed)
	camera_rig.mode_changed.connect(_on_camera_mode_changed)
	AppState.signal_boot_state("player_ready")
	_load_snapshot()


func _process(_delta: float) -> void:
	if snapshot.is_empty():
		return
	entity_renderer.update_to_turn(playback_clock.get_current_turn())
	camera_rig.update_camera(get_process_delta_time())
	timeline_hud.sync_from_clock()


func _input(event: InputEvent) -> void:
	if event is InputEventKey:
		var key := event as InputEventKey
		if key.pressed and not key.echo and key.keycode == KEY_ESCAPE:
			_on_back_pressed()


func get_current_turn() -> float:
	return playback_clock.get_current_turn()


func _load_snapshot() -> void:
	var match_id := AppState.selected_match_id
	retry_button.visible = false
	status_label.text = "Match: %s" % (match_id if not match_id.is_empty() else "none selected")
	if match_id.is_empty():
		_show_error("No match selected. Use Back to choose a completed match.")
		return

	var cached = AppState.get_cached_snapshot(match_id)
	if typeof(cached) == TYPE_DICTIONARY:
		_start_replay(cached, true)
		return

	_set_status("Fetching snapshot from Convex...", false)
	var loaded = await ConvexClient.fetch_json("/replay/exportMatch?matchId=%s" % match_id.uri_encode())
	if typeof(loaded) != TYPE_DICTIONARY:
		_show_error("Could not load match snapshot. %s" % ConvexClient.last_error)
		return

	AppState.cache_snapshot(match_id, loaded)
	_start_replay(loaded, false)


func _start_replay(loaded_snapshot: Dictionary, from_cache: bool) -> void:
	snapshot = loaded_snapshot
	AppState.set_current_snapshot(snapshot)
	scene_builder.build_from_snapshot(snapshot)
	entity_renderer.configure(snapshot, scene_builder)
	playback_clock.configure(snapshot.get("playback", {}))
	camera_rig.configure(snapshot, entity_renderer, scene_builder, playback_clock)
	timeline_hud.configure(playback_clock, snapshot)
	kill_feed_overlay.configure(snapshot, playback_clock)
	side_panel.configure(snapshot, playback_clock, camera_rig)
	entity_renderer.update_to_turn(playback_clock.get_current_turn())
	camera_rig.update_camera(1.0)
	_set_status("Loaded turnCount %d from %s" % [_turn_count_from_snapshot(snapshot), "cache" if from_cache else "network"], false)


func _turn_count_from_snapshot(root: Dictionary) -> int:
	var playback = root.get("playback", {})
	if typeof(playback) == TYPE_DICTIONARY:
		return int(playback.get("turnCount", playback.get("endTurn", 0)))
	var timeline = root.get("timeline", {})
	if typeof(timeline) == TYPE_DICTIONARY and typeof(timeline.get("frames", [])) == TYPE_ARRAY:
		return timeline.get("frames", []).size()
	return 0


func _make_status_ui() -> void:
	var layer := CanvasLayer.new()
	layer.name = "StatusOverlay"
	add_child(layer)
	var panel := PanelContainer.new()
	panel.position = Vector2(16, 14)
	panel.custom_minimum_size = Vector2(330, 64)
	layer.add_child(panel)
	var box := HBoxContainer.new()
	box.add_theme_constant_override("separation", 10)
	panel.add_child(box)
	back_button = Button.new()
	back_button.text = "Back"
	box.add_child(back_button)
	retry_button = Button.new()
	retry_button.text = "Retry"
	retry_button.visible = false
	box.add_child(retry_button)
	status_label = Label.new()
	status_label.text = "Loading match"
	status_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	status_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	box.add_child(status_label)


func _show_error(message: String) -> void:
	_set_status(message, true)
	retry_button.visible = true


func _set_status(message: String, is_error: bool) -> void:
	status_label.text = message
	var color := Color(1.0, 0.45, 0.50) if is_error else Color(0.78, 0.95, 1.0)
	status_label.add_theme_color_override("font_color", color)


func _on_camera_anchor_changed(_character_id: String) -> void:
	pass


func _on_camera_mode_changed(_mode: int) -> void:
	pass


func _on_back_pressed() -> void:
	get_tree().change_scene_to_file("res://scenes/MatchPicker.tscn")
