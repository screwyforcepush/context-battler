extends CanvasLayer

var clock: Node
var root_panel: PanelContainer
var play_button: Button
var slider: HSlider
var turn_label: Label
var speed_select: OptionButton
var _dragging := false


func configure(playback_clock: Node, _snapshot: Dictionary) -> void:
	clock = playback_clock
	_ensure_ui()
	slider.min_value = float(clock.start_turn)
	slider.max_value = float(clock.end_turn)
	slider.step = 0.01
	slider.value = clock.get_current_turn()
	clock.turn_changed.connect(_on_turn_changed)
	_on_turn_changed(int(clock.get_current_turn()))


func sync_from_clock() -> void:
	if clock == null or slider == null:
		return
	if not _dragging:
		slider.value = clock.get_current_turn()
	_update_labels()


func _ensure_ui() -> void:
	if root_panel != null:
		return
	root_panel = PanelContainer.new()
	root_panel.name = "TimelinePanel"
	root_panel.anchor_left = 0.14
	root_panel.anchor_right = 0.72
	root_panel.anchor_top = 1.0
	root_panel.anchor_bottom = 1.0
	root_panel.offset_top = -78
	root_panel.offset_bottom = -14
	add_child(root_panel)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	root_panel.add_child(row)
	play_button = Button.new()
	play_button.text = "Play"
	play_button.custom_minimum_size = Vector2(72, 34)
	play_button.pressed.connect(_on_play_pressed)
	row.add_child(play_button)
	slider = HSlider.new()
	slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	slider.drag_started.connect(func() -> void: _dragging = true)
	slider.drag_ended.connect(_on_slider_drag_ended)
	slider.value_changed.connect(_on_slider_value_changed)
	row.add_child(slider)
	turn_label = Label.new()
	turn_label.custom_minimum_size = Vector2(118, 34)
	turn_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	row.add_child(turn_label)
	speed_select = OptionButton.new()
	speed_select.add_item("0.5x")
	speed_select.add_item("1x")
	speed_select.add_item("2x")
	speed_select.select(1)
	speed_select.item_selected.connect(_on_speed_selected)
	row.add_child(speed_select)


func _on_play_pressed() -> void:
	if clock == null:
		return
	clock.toggle_playing()
	_update_labels()


func _on_slider_value_changed(value: float) -> void:
	if clock == null:
		return
	if _dragging:
		clock.scrub_to(value)
	_update_labels()


func _on_slider_drag_ended(_value_changed: bool) -> void:
	_dragging = false
	if clock != null:
		clock.scrub_to(float(slider.value))
	_update_labels()


func _on_speed_selected(index: int) -> void:
	if clock == null:
		return
	var speeds := [0.5, 1.0, 2.0]
	clock.set_speed(float(speeds[index]))


func _on_turn_changed(_turn: int) -> void:
	sync_from_clock()


func _update_labels() -> void:
	if clock == null:
		return
	play_button.text = "Pause" if clock.is_playing else "Play"
	turn_label.text = "Turn %d / %d" % [int(round(clock.get_current_turn())), clock.end_turn]
