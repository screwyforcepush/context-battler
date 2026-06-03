shader_type spatial;
render_mode diffuse_lambert, specular_schlick_ggx;

uniform sampler2D albedo_texture : source_color, repeat_enable;
uniform sampler2D normal_texture : hint_normal, repeat_enable;
uniform sampler2D roughness_texture : repeat_enable;
uniform sampler2D metallic_texture : repeat_enable;
uniform sampler2D ao_texture : repeat_enable;
uniform sampler2D uv_albedo_overlay : source_color, repeat_disable;
uniform sampler2D uv_emission_overlay : source_color, repeat_disable;

uniform bool use_albedo_texture = false;
uniform bool use_normal_texture = false;
uniform bool use_roughness_texture = false;
uniform bool use_metallic_texture = false;
uniform bool use_ao_texture = false;
uniform bool use_uv_albedo_overlay = false;
uniform bool use_uv_emission_overlay = false;
uniform bool use_procedural_human_face = false;
uniform bool use_vertex_color_overlay = false;

uniform vec4 base_color : source_color = vec4(0.66, 0.66, 0.68, 1.0);
uniform vec4 tint : source_color = vec4(1.0, 1.0, 1.0, 1.0);
uniform vec2 uv2_scale = vec2(1.0, 1.0);
uniform vec2 uv2_offset = vec2(0.0, 0.0);
uniform float uv_overlay_strength : hint_range(0.0, 2.0) = 1.0;
uniform float uv_emission_energy : hint_range(0.0, 8.0) = 1.0;
uniform float vertex_color_overlay_strength : hint_range(0.0, 2.0) = 1.0;

uniform float roughness : hint_range(0.02, 1.0) = 0.68;
uniform float metallic : hint_range(0.0, 1.0) = 0.0;
uniform float normal_depth : hint_range(0.0, 2.0) = 1.0;
uniform float ao_strength : hint_range(0.0, 1.0) = 1.0;

uniform float armour_tier : hint_range(0.0, 4.0) = 0.0;
uniform float armour_amount : hint_range(0.0, 1.0) = 0.0;
uniform vec4 armour_tint : source_color = vec4(0.68, 0.72, 0.78, 1.0);
uniform float armour_tint_strength : hint_range(0.0, 1.0) = 0.28;
uniform float armour_metallic_boost : hint_range(0.0, 1.0) = 0.56;
uniform float armour_roughness_drop : hint_range(0.0, 1.0) = 0.28;
uniform vec4 armour_emission : source_color = vec4(0.45, 0.92, 1.0, 1.0);
uniform float armour_emission_strength : hint_range(0.0, 2.0) = 0.45;

varying vec3 local_vertex_position;

void vertex() {
	local_vertex_position = VERTEX;
}

float band_mask(float value, float low, float high, float feather) {
	return smoothstep(low - feather, low + feather, value) * (1.0 - smoothstep(high - feather, high + feather, value));
}

float ellipse_mask(vec2 point, vec2 center, vec2 radius) {
	vec2 delta = (point - center) / radius;
	return 1.0 - smoothstep(0.72, 1.0, dot(delta, delta));
}

vec3 procedural_human_face(vec3 current_albedo) {
	vec3 pos = local_vertex_position;
	vec2 face_point = pos.xy;
	float front = smoothstep(0.026, 0.074, pos.z);
	float face_y = band_mask(pos.y, 1.405, 1.820, 0.020);
	float face_x = 1.0 - smoothstep(0.112, 0.165, abs(pos.x));
	float face = front * face_y * face_x;
	vec3 albedo = mix(current_albedo, vec3(0.820, 0.545, 0.405), face * 0.42);

	float left_eye_white = ellipse_mask(face_point, vec2(-0.056, 1.656), vec2(0.039, 0.026)) * front;
	float right_eye_white = ellipse_mask(face_point, vec2(0.056, 1.656), vec2(0.039, 0.026)) * front;
	albedo = mix(albedo, vec3(0.960, 0.900, 0.810), clamp(left_eye_white + right_eye_white, 0.0, 1.0));

	float left_pupil = ellipse_mask(face_point, vec2(-0.056, 1.654), vec2(0.014, 0.017)) * front;
	float right_pupil = ellipse_mask(face_point, vec2(0.056, 1.654), vec2(0.014, 0.017)) * front;
	albedo = mix(albedo, vec3(0.020, 0.012, 0.008), clamp(left_pupil + right_pupil, 0.0, 1.0));

	float brow_l = ellipse_mask(face_point, vec2(-0.057, 1.704), vec2(0.052, 0.012)) * front;
	float brow_r = ellipse_mask(face_point, vec2(0.057, 1.704), vec2(0.052, 0.012)) * front;
	albedo = mix(albedo, vec3(0.175, 0.085, 0.052), clamp((brow_l + brow_r) * 0.85, 0.0, 1.0));

	float nose = ellipse_mask(face_point, vec2(0.000, 1.585), vec2(0.018, 0.060)) * front;
	albedo = mix(albedo, vec3(0.690, 0.335, 0.245), nose * 0.58);

	float upper_lip = ellipse_mask(face_point, vec2(0.000, 1.503), vec2(0.082, 0.013)) * front;
	float lower_lip = ellipse_mask(face_point, vec2(0.000, 1.484), vec2(0.071, 0.012)) * front;
	albedo = mix(albedo, vec3(0.450, 0.110, 0.105), clamp(upper_lip + lower_lip * 0.75, 0.0, 1.0));

	float cheek_l = ellipse_mask(face_point, vec2(-0.094, 1.570), vec2(0.036, 0.050)) * front;
	float cheek_r = ellipse_mask(face_point, vec2(0.094, 1.570), vec2(0.036, 0.050)) * front;
	albedo = mix(albedo, vec3(0.900, 0.390, 0.330), clamp((cheek_l + cheek_r) * 0.22, 0.0, 1.0));
	return albedo;
}

void fragment() {
	vec2 uv2 = UV2 * uv2_scale + uv2_offset;
	vec4 albedo_sample = use_albedo_texture ? texture(albedo_texture, uv2) : base_color;
	if (use_uv_albedo_overlay) {
		vec4 uv_overlay = texture(uv_albedo_overlay, UV);
		albedo_sample.rgb = mix(albedo_sample.rgb, uv_overlay.rgb, clamp(uv_overlay.a * uv_overlay_strength, 0.0, 1.0));
	}
	if (use_procedural_human_face) {
		albedo_sample.rgb = procedural_human_face(albedo_sample.rgb);
	}
	if (use_vertex_color_overlay) {
		albedo_sample.rgb = mix(albedo_sample.rgb, COLOR.rgb, clamp(COLOR.a * vertex_color_overlay_strength, 0.0, 1.0));
	}
	float tier_amount = clamp(max(armour_amount, armour_tier / 4.0), 0.0, 1.0);

	ALBEDO = mix(albedo_sample.rgb * tint.rgb, armour_tint.rgb, tier_amount * armour_tint_strength);
	METALLIC = clamp((use_metallic_texture ? texture(metallic_texture, uv2).r : metallic) + tier_amount * armour_metallic_boost, 0.0, 1.0);
	ROUGHNESS = clamp((use_roughness_texture ? texture(roughness_texture, uv2).r : roughness) - tier_amount * armour_roughness_drop, 0.04, 1.0);
	AO = mix(1.0, use_ao_texture ? texture(ao_texture, uv2).r : 1.0, ao_strength);

	if (use_normal_texture) {
		NORMAL_MAP = texture(normal_texture, uv2).rgb;
		NORMAL_MAP_DEPTH = normal_depth;
	}
	vec3 emission_out = vec3(0.0);
	if (use_uv_emission_overlay) {
		vec4 uv_emission = texture(uv_emission_overlay, UV);
		emission_out += uv_emission.rgb * uv_emission.a * uv_emission_energy;
	}
	if (tier_amount > 0.0 && armour_emission_strength > 0.0) {
		emission_out += armour_emission.rgb * tier_amount * armour_emission_strength;
	}
	EMISSION = emission_out;
}
