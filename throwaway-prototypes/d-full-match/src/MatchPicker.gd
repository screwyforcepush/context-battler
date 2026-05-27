extends Control

var matches: Array = []
var loading := false

@onready var convex_url_label: Label = %ConvexUrlLabel
@onready var status_label: Label = %StatusLabel
@onready var retry_button: Button = %RetryButton
@onready var refresh_button: Button = %RefreshButton
@onready var showroom_button: Button = %ShowroomButton
@onready var match_list: ItemList = %MatchList


func _ready() -> void:
	RenderingServer.set_default_clear_color(Color(0.006, 0.008, 0.012, 1.0))
	AppState.resolve_convex_url(true)
	convex_url_label.text = "Convex: %s" % AppState.get_convex_url()
	retry_button.pressed.connect(_load_matches)
	refresh_button.pressed.connect(_load_matches)
	showroom_button.pressed.connect(_on_showroom_pressed)
	match_list.item_activated.connect(_on_item_activated)
	AppState.signal_boot_state("picker_ready")
	_load_matches()


func _load_matches() -> void:
	if loading:
		return
	loading = true
	match_list.clear()
	retry_button.visible = false
	refresh_button.disabled = true
	_set_status("Loading completed matches...", false)

	var response = await ConvexClient.fetch_json("/replay/listMatches")
	loading = false
	refresh_button.disabled = false

	if response == null:
		_show_error("Could not load completed matches. %s" % ConvexClient.last_error)
		return

	matches = _normalise_matches(response)
	matches.sort_custom(_compare_match_desc)
	_render_matches()


func _normalise_matches(response) -> Array:
	var rows: Array = []
	if typeof(response) == TYPE_ARRAY:
		rows = response
	elif typeof(response) == TYPE_DICTIONARY:
		if response.has("matches") and typeof(response.get("matches")) == TYPE_ARRAY:
			rows = response.get("matches")
		elif response.has("page") and typeof(response.get("page")) == TYPE_ARRAY:
			rows = response.get("page")

	var completed_rows: Array = []
	for row in rows:
		if typeof(row) != TYPE_DICTIONARY:
			continue
		if row.has("status") and str(row.get("status")) != "completed":
			continue
		completed_rows.append(row)
	return completed_rows


func _render_matches() -> void:
	match_list.clear()
	if matches.is_empty():
		_set_status("no completed matches - run `npm run harness` to seed one", false)
		retry_button.text = "Retry"
		retry_button.visible = true
		return

	_set_status("Loaded %d completed matches. Activate a row to inspect its snapshot stub." % matches.size(), false)
	retry_button.visible = false
	for match_row in matches:
		match_list.add_item(_format_row(match_row))
		var index := match_list.get_item_count() - 1
		match_list.set_item_metadata(index, match_row)


func _show_error(message: String) -> void:
	_set_status(message, true)
	retry_button.text = "Retry"
	retry_button.visible = true


func _set_status(message: String, is_error: bool) -> void:
	status_label.text = message
	var color: Color = Color(1.0, 0.45, 0.50) if is_error else Color(0.78, 0.95, 1.0)
	status_label.add_theme_color_override("font_color", color)


func _on_item_activated(index: int) -> void:
	if index < 0 or index >= match_list.get_item_count():
		return
	var metadata = match_list.get_item_metadata(index)
	if typeof(metadata) != TYPE_DICTIONARY:
		return
	var match_id := str(metadata.get("matchId", metadata.get("_id", "")))
	if match_id.is_empty():
		_show_error("Selected row did not include a matchId.")
		return
	AppState.select_match(match_id)
	get_tree().change_scene_to_file("res://scenes/MatchPlayer.tscn")


func _on_showroom_pressed() -> void:
	get_tree().change_scene_to_file("res://scenes/Showroom.tscn")


func _compare_match_desc(a, b) -> bool:
	var a_completed := _completion_ms(a)
	var b_completed := _completion_ms(b)
	if a_completed == b_completed:
		return str(a.get("matchId", "")) > str(b.get("matchId", ""))
	return a_completed > b_completed


func _format_row(match_row: Dictionary) -> String:
	var map_id := str(match_row.get("mapId", "unknown-map"))
	var completed_at := _format_completed_at(match_row)
	var character_count := _character_count(match_row)
	var turn_count := _turn_count(match_row)
	var outcome := _format_outcome(match_row)
	return "%s | %s | %d chars | %d turns | %s" % [map_id, completed_at, character_count, turn_count, outcome]


func _completion_ms(match_row: Dictionary) -> int:
	for key in ["completedAt", "endedAt", "createdAt", "startedAt"]:
		if not match_row.has(key):
			continue
		var value = match_row.get(key)
		if typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT:
			return int(value)
		if typeof(value) == TYPE_STRING and str(value).is_valid_int():
			return int(str(value))
	return 0


func _format_completed_at(match_row: Dictionary) -> String:
	var timestamp := _completion_ms(match_row)
	if timestamp <= 0:
		return "unknown time"
	var unix_seconds: int = int(timestamp / 1000) if timestamp > 100000000000 else timestamp
	return Time.get_datetime_string_from_unix_time(unix_seconds, true)


func _character_count(match_row: Dictionary) -> int:
	if match_row.has("characterCount"):
		return int(match_row.get("characterCount", 0))
	if match_row.has("characterIds") and typeof(match_row.get("characterIds")) == TYPE_ARRAY:
		return match_row.get("characterIds").size()
	return 0


func _turn_count(match_row: Dictionary) -> int:
	if match_row.has("turnCount"):
		return int(match_row.get("turnCount", 0))
	if match_row.has("currentTurn"):
		return int(match_row.get("currentTurn", 0))
	return 0


func _format_outcome(match_row: Dictionary) -> String:
	var outcome = match_row.get("outcome", {})
	if typeof(outcome) != TYPE_DICTIONARY:
		return "outcome pending"
	var extracted_count := int(outcome.get("extractedCount", 0))
	var last_survivor := str(outcome.get("lastSurvivor", ""))
	if last_survivor.is_empty() or last_survivor == "<null>":
		return "%d extracted" % extracted_count
	return "%d extracted, survivor %s" % [extracted_count, last_survivor]
