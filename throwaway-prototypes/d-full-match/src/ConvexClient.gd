extends Node

var last_error: String = ""


func fetch_json(path: String) -> Variant:
	last_error = ""
	var url := _join_url(path)
	if url.is_empty():
		last_error = "Convex URL is empty. Set #convex=... in the page hash or rebuild with DEFAULT_CONVEX_URL."
		push_warning(last_error)
		return null

	var http := HTTPRequest.new()
	http.timeout = 30.0
	add_child(http)

	var headers := PackedStringArray([
		"Accept: application/json",
		"Cache-Control: no-store",
	])
	var request_error := http.request(url, headers, HTTPClient.METHOD_GET)
	if request_error != OK:
		http.queue_free()
		last_error = "HTTPRequest setup failed with code %d for %s" % [request_error, url]
		push_warning(last_error)
		return null

	var completed = await http.request_completed
	http.queue_free()
	if typeof(completed) != TYPE_ARRAY or completed.size() < 4:
		last_error = "HTTPRequest returned an unexpected signal payload."
		push_warning(last_error)
		return null

	var result_code := int(completed[0])
	var response_code := int(completed[1])
	var body: PackedByteArray = completed[3]
	if result_code != HTTPRequest.RESULT_SUCCESS:
		last_error = "Request failed before response with result %d for %s" % [result_code, url]
		push_warning(last_error)
		return null
	if response_code < 200 or response_code >= 300:
		last_error = "Request returned HTTP %d for %s" % [response_code, url]
		push_warning(last_error)
		return null

	var text := body.get_string_from_utf8()
	var parsed = JSON.parse_string(text)
	if parsed == null:
		last_error = "Response was not valid JSON from %s" % url
		push_warning(last_error)
		return null
	return parsed


func _join_url(path: String) -> String:
	if path.begins_with("http://") or path.begins_with("https://"):
		return path
	var base_url := AppState.get_convex_url()
	if base_url.is_empty():
		return ""
	var suffix := path.substr(1) if path.begins_with("/") else path
	return "%s/%s" % [base_url, suffix]
