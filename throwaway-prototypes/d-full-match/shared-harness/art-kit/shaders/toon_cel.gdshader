shader_type spatial;
render_mode diffuse_lambert, specular_schlick_ggx;

uniform vec4 base_color : source_color = vec4(0.125, 0.137, 0.22, 1.0);
uniform vec4 accent_color : source_color = vec4(0.792, 0.651, 1.0, 1.0);
uniform vec4 shadow_color : source_color = vec4(0.039, 0.051, 0.118, 1.0);
uniform float ramp_steps = 3.0;

void fragment() {
	float light_level = clamp(dot(normalize(NORMAL), normalize(vec3(0.35, 0.8, 0.45))), 0.0, 1.0);
	float stepped = floor(light_level * ramp_steps) / max(ramp_steps - 1.0, 1.0);
	vec3 lit = mix(shadow_color.rgb, base_color.rgb, stepped);
	ALBEDO = mix(lit, accent_color.rgb, stepped * 0.24);
	ROUGHNESS = 0.88;
}
