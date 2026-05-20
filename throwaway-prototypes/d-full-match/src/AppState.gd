extends Node

const BUILT_IN_DEFAULT_CONVEX_URL := "http://127.0.0.1:3210"

var selected_match_id: String = ""
var convex_url: String = ""
var snapshot_cache: Dictionary = {}
var current_snapshot: Dictionary = {}


func _ready() -> void:
	resolve_convex_url()


func resolve_convex_url(force := false) -> String:
	if not force and not convex_url.is_empty():
		return convex_url

	var from_hash := _read_convex_url_from_hash()
	if not from_hash.is_empty():
		convex_url = _normalise_url(from_hash)
		return convex_url

	var from_build_config := _read_default_convex_url_from_js()
	if not from_build_config.is_empty():
		convex_url = _normalise_url(from_build_config)
		return convex_url

	if OS.has_environment("DEFAULT_CONVEX_URL"):
		convex_url = _normalise_url(OS.get_environment("DEFAULT_CONVEX_URL"))
	elif OS.has_environment("CONVEX_URL"):
		convex_url = _normalise_url(OS.get_environment("CONVEX_URL"))
	else:
		convex_url = _normalise_url(BUILT_IN_DEFAULT_CONVEX_URL)
	return convex_url


func get_convex_url() -> String:
	return resolve_convex_url()


func select_match(match_id: String) -> void:
	selected_match_id = match_id


func get_cached_snapshot(match_id: String) -> Variant:
	if snapshot_cache.has(match_id):
		return snapshot_cache[match_id]
	return null


func cache_snapshot(match_id: String, snapshot: Dictionary) -> void:
	snapshot_cache[match_id] = snapshot
	current_snapshot = snapshot


func set_current_snapshot(snapshot: Dictionary) -> void:
	current_snapshot = snapshot


func signal_boot_state(state: String) -> void:
	if not OS.has_feature("web"):
		return
	var script := """
(() => {
  window.__d_full_match_ready = true;
  window.__d_full_match_state = %s;
  window.__d_full_match_ready_at = performance.now();
})()
""" % JSON.stringify(state)
	JavaScriptBridge.eval(script, false)


func _read_convex_url_from_hash() -> String:
	if not OS.has_feature("web"):
		return ""
	var script := """
(() => {
  const hash = window.location.hash || "";
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const query = raw.startsWith("?") ? raw.slice(1) : raw;
  const params = new URLSearchParams(query);
  return params.get("convex") || "";
})()
"""
	var result = JavaScriptBridge.eval(script, true)
	return "" if result == null else str(result).strip_edges()


func _read_default_convex_url_from_js() -> String:
	if not OS.has_feature("web"):
		return ""
	var script := """
(() => {
  return (window.__d_full_match_config && window.__d_full_match_config.defaultConvexUrl) || "";
})()
"""
	var result = JavaScriptBridge.eval(script, true)
	return "" if result == null else str(result).strip_edges()


func _normalise_url(raw_url: String) -> String:
	var value := raw_url.strip_edges()
	while value.ends_with("/") and value.length() > 0:
		value = value.substr(0, value.length() - 1)
	return value
