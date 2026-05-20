extends Node

signal turn_changed(turn: int)

var current_turn: float = 1.0
var is_playing: bool = false
var speed: float = 1.0
var seconds_per_turn: float = 0.6
var start_turn: int = 1
var end_turn: int = 1
var _last_emitted_turn: int = -1


func configure(playback: Dictionary) -> void:
	start_turn = int(playback.get("startTurn", 1))
	end_turn = int(playback.get("endTurn", playback.get("turnCount", start_turn)))
	seconds_per_turn = max(0.05, float(playback.get("secondsPerTurn", 0.6)))
	current_turn = float(start_turn)
	speed = 1.0
	is_playing = false
	_emit_turn_if_changed(true)


func _process(delta: float) -> void:
	if not is_playing:
		return
	current_turn += (delta * speed) / seconds_per_turn
	if current_turn >= float(end_turn):
		current_turn = float(end_turn)
		is_playing = false
	current_turn = clamp(current_turn, float(start_turn), float(end_turn))
	_emit_turn_if_changed(false)


func play() -> void:
	if current_turn >= float(end_turn):
		current_turn = float(start_turn)
	is_playing = true


func pause() -> void:
	is_playing = false


func toggle_playing() -> void:
	if is_playing:
		pause()
	else:
		play()


func scrub_to(turn: float) -> void:
	is_playing = false
	current_turn = clamp(turn, float(start_turn), float(end_turn))
	_emit_turn_if_changed(true)


func set_speed(multiplier: float) -> void:
	if multiplier == 0.5 or multiplier == 1.0 or multiplier == 2.0:
		speed = multiplier


func get_current_turn() -> float:
	return current_turn


func get_turn_count() -> int:
	return end_turn


func _emit_turn_if_changed(force: bool) -> void:
	var turn_int := int(floor(current_turn))
	if force or turn_int != _last_emitted_turn:
		_last_emitted_turn = turn_int
		turn_changed.emit(turn_int)
