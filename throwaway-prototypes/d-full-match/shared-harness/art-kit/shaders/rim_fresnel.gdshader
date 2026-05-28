shader_type spatial;
render_mode diffuse_lambert, specular_schlick_ggx;

uniform vec4 base_color : source_color = vec4(0.173, 0.176, 0.192, 1.0);
uniform vec4 rim_color : source_color = vec4(0.655, 1.0, 0.31, 1.0);
uniform float rim_power = 2.5;
uniform float rim_energy = 1.35;

void fragment() {
	float rim = pow(1.0 - clamp(dot(normalize(NORMAL), normalize(VIEW)), 0.0, 1.0), rim_power);
	ALBEDO = mix(base_color.rgb, rim_color.rgb, rim * 0.42);
	EMISSION = rim_color.rgb * rim * rim_energy;
	ROUGHNESS = 0.62;
}
