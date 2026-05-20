extends CanvasLayer

var snapshot: Dictionary = {}
var clock: Node
var camera_rig: Node
var panel: PanelContainer
var title_label: Label
var body_label: RichTextLabel
var mode := 0
var anchor_id := ""


func configure(root: Dictionary, playback_clock: Node, rig: Node) -> void:
	snapshot = root
	clock = playback_clock
	camera_rig = rig
	_ensure_ui()
	if not clock.turn_changed.is_connected(_on_turn_changed):
		clock.turn_changed.connect(_on_turn_changed)
	if not camera_rig.anchor_changed.is_connected(_on_anchor_changed):
		camera_rig.anchor_changed.connect(_on_anchor_changed)
	if not camera_rig.mode_changed.is_connected(_on_mode_changed):
		camera_rig.mode_changed.connect(_on_mode_changed)
	if camera_rig.has_method("get_anchor_id"):
		anchor_id = camera_rig.get_anchor_id()
	if camera_rig.has_method("get_mode"):
		mode = camera_rig.get_mode()
	_refresh()


func _on_turn_changed(_turn: int) -> void:
	_refresh()


func _on_anchor_changed(character_id: String) -> void:
	anchor_id = character_id
	_refresh()


func _on_mode_changed(next_mode: int) -> void:
	mode = next_mode
	_refresh()


func _ensure_ui() -> void:
	if panel != null:
		return
	panel = PanelContainer.new()
	panel.name = "AnchoredSidePanel"
	panel.anchor_left = 1.0
	panel.anchor_right = 1.0
	panel.anchor_top = 0.0
	panel.anchor_bottom = 1.0
	panel.offset_left = -376
	panel.offset_top = 92
	panel.offset_right = -16
	panel.offset_bottom = -96
	add_child(panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 10)
	panel.add_child(box)
	title_label = Label.new()
	title_label.text = "Director"
	title_label.add_theme_font_size_override("font_size", 20)
	box.add_child(title_label)
	body_label = RichTextLabel.new()
	body_label.bbcode_enabled = true
	body_label.fit_content = false
	body_label.scroll_active = true
	body_label.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body_label.custom_minimum_size = Vector2(330, 420)
	box.add_child(body_label)


func _refresh() -> void:
	if panel == null:
		return
	var turn := int(clock.get_current_turn()) if clock != null else 1
	if mode == 0:
		title_label.text = "Director"
		panel.custom_minimum_size = Vector2(260, 120)
		body_label.text = _director_summary(turn)
		return
	panel.custom_minimum_size = Vector2(360, 520)
	var character := _character(anchor_id)
	title_label.text = str(character.get("displayName", anchor_id))
	body_label.text = _anchored_body(character, turn)


func _director_summary(turn: int) -> String:
	var source: Dictionary = snapshot.get("source", {})
	var characters: Array = snapshot.get("characters", [])
	var sample := _frame_for_turn(turn)
	var alive_count := 0
	for character in sample.get("characters", []):
		if typeof(character) == TYPE_DICTIONARY and bool(character.get("alive", true)) and character.get("extractedAtTurn", null) == null:
			alive_count += 1
	return "[b]Map[/b] %s\n[b]Turn[/b] %d\n[b]Alive[/b] %d / %d" % [
		str(source.get("mapId", "unknown")),
		turn,
		alive_count,
		characters.size(),
	]


func _anchored_body(character: Dictionary, turn: int) -> String:
	var character_id := str(character.get("characterId", anchor_id))
	var status := _status_for(character_id, turn)
	var equipment := _equipment_for(character_id, turn)
	var trace := _latest_trace(character_id, turn)
	var prompt := str(character.get("prompts", {}).get("persona", ""))
	var lines := []
	lines.append("[b]Identity[/b]\n%s  /  %s\n%s" % [
		str(character.get("displayName", character_id)),
		str(character.get("personaId", "")),
		status,
	])
	lines.append("[b]Equipment[/b]\n%s" % equipment)
	lines.append("[b]Scratchpad[/b]\n[code]%s[/code]" % str(trace.get("scratchpadAfter", "")))
	lines.append("[b]Prompt[/b]\n%s" % (prompt if not prompt.is_empty() else "No prompt text in snapshot."))
	lines.append("[b]Speech[/b]\n%s" % _character_lines(character_id))
	return "\n\n".join(lines)


func _status_for(character_id: String, turn: int) -> String:
	var sample := _frame_for_turn(turn)
	for character in sample.get("characters", []):
		if typeof(character) == TYPE_DICTIONARY and str(character.get("characterId", "")) == character_id:
			if character.get("extractedAtTurn", null) != null:
				return "extracted at turn %d" % int(character.get("extractedAtTurn", 0))
			if not bool(character.get("alive", true)):
				return "dead at turn %d" % int(character.get("diedAtTurn", turn))
			return "alive"
	return "not present"


func _equipment_for(character_id: String, turn: int) -> String:
	var frame := _contract_frame_for_turn(turn)
	var equipped = frame.get("equippedByCharacter", {}).get(character_id, null)
	var hp = frame.get("hpByCharacter", {}).get(character_id, "?")
	if typeof(equipped) != TYPE_DICTIONARY:
		return "HP: %s\nunarmed / unarmoured / no consumable" % str(hp)
	return "HP: %s\nWeapon: %s\nArmour: %s\nConsumable: %s" % [
		str(hp),
		_item_label(equipped.get("weapon", null), "unarmed"),
		_item_label(equipped.get("armour", null), "unarmoured"),
		_item_label(equipped.get("consumable", null), "none"),
	]


func _item_label(item, fallback: String) -> String:
	if typeof(item) != TYPE_DICTIONARY:
		return fallback
	return "%s %s" % [str(item.get("name", fallback)), str(item.get("category", ""))]


func _latest_trace(character_id: String, turn: int) -> Dictionary:
	var latest := {}
	for trace in snapshot.get("agentTraces", []):
		if typeof(trace) != TYPE_DICTIONARY:
			continue
		if str(trace.get("characterId", "")) == character_id and int(trace.get("turn", 0)) <= turn:
			latest = trace
	return latest


func _character_lines(character_id: String) -> String:
	var out := []
	for entry in snapshot.get("speechLog", []):
		if typeof(entry) != TYPE_DICTIONARY:
			continue
		if str(entry.get("characterId", "")) == character_id:
			out.append("Turn %d: %s" % [int(entry.get("turn", 0)), str(entry.get("text", ""))])
	return "\n".join(out) if not out.is_empty() else "No lines."


func _character(character_id: String) -> Dictionary:
	for character in snapshot.get("characters", []):
		if typeof(character) == TYPE_DICTIONARY and str(character.get("characterId", "")) == character_id:
			return character
	return {}


func _frame_for_turn(turn: int) -> Dictionary:
	var frame := _contract_frame_for_turn(turn)
	var sample = frame.get("snapshot", {})
	return sample if typeof(sample) == TYPE_DICTIONARY else {}


func _contract_frame_for_turn(turn: int) -> Dictionary:
	var timeline: Dictionary = snapshot.get("timeline", {})
	var frames: Array = timeline.get("frames", [])
	var selected := {}
	for frame in frames:
		if typeof(frame) != TYPE_DICTIONARY:
			continue
		if int(frame.get("turn", 0)) <= turn:
			selected = frame
		else:
			break
	return selected
