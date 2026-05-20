extends CanvasLayer

var snapshot: Dictionary = {}
var clock: Node
var container: VBoxContainer
var last_turn := -1


func configure(root: Dictionary, playback_clock: Node) -> void:
	snapshot = root
	clock = playback_clock
	_ensure_ui()
	if not clock.turn_changed.is_connected(_on_turn_changed):
		clock.turn_changed.connect(_on_turn_changed)
	_rebuild_for_turn(int(clock.get_current_turn()))


func _on_turn_changed(turn: int) -> void:
	_rebuild_for_turn(turn)


func _rebuild_for_turn(turn: int) -> void:
	if container == null:
		return
	last_turn = turn
	for child in container.get_children():
		child.queue_free()
	var seconds_per_turn := float(snapshot.get("playback", {}).get("secondsPerTurn", 0.6))
	var window_turns: int = max(1, int(ceil(6.0 / max(0.05, seconds_per_turn))))
	for event in snapshot.get("killFeed", []):
		if typeof(event) != TYPE_DICTIONARY:
			continue
		var event_turn := int(event.get("turn", -999))
		if event_turn <= turn and event_turn >= turn - window_turns:
			_add_banner(event)


func _add_banner(event: Dictionary) -> void:
	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(330, 38)
	var label := Label.new()
	label.text = "T%d  %s" % [int(event.get("turn", 0)), str(event.get("text", "kill"))]
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.add_theme_color_override("font_color", Color(1.0, 0.92, 0.82))
	panel.add_child(label)
	container.add_child(panel)


func _ensure_ui() -> void:
	if container != null:
		return
	container = VBoxContainer.new()
	container.name = "KillFeedBanners"
	container.anchor_left = 1.0
	container.anchor_right = 1.0
	container.anchor_top = 0.0
	container.anchor_bottom = 0.0
	container.offset_left = -380
	container.offset_top = 18
	container.offset_right = -18
	container.offset_bottom = 260
	container.add_theme_constant_override("separation", 6)
	add_child(container)
