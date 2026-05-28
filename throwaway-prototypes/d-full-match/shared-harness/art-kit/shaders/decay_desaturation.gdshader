shader_type spatial;
render_mode diffuse_lambert, specular_schlick_ggx;

uniform vec4 base_color : source_color = vec4(0.18, 0.18, 0.19, 1.0);
uniform vec4 tint : source_color = vec4(0.435, 0.482, 0.4, 1.0);
uniform vec4 bruise_color : source_color = vec4(0.169, 0.09, 0.188, 1.0);
uniform float desat_amount = 0.85;
uniform float darken_amount = 0.4;

void fragment() {
	vec3 gray = vec3(dot(base_color.rgb, vec3(0.299, 0.587, 0.114)));
	vec3 drained = mix(base_color.rgb, gray, desat_amount);
	ALBEDO = mix(drained * (1.0 - darken_amount), tint.rgb, 0.22);
	EMISSION = bruise_color.rgb * 0.08;
	ROUGHNESS = 0.94;
}
