shader_type spatial;
render_mode diffuse_lambert, specular_schlick_ggx;

uniform vec4 base_color : source_color = vec4(0.137, 0.208, 0.118, 1.0);
uniform vec4 trim_color : source_color = vec4(1.0, 0.56, 0.18, 1.0);
uniform sampler2D trim_mask;
uniform float trim_energy = 1.8;
uniform float trim_tile_scale : hint_range(0.02, 1.0) = 0.18;

void fragment() {
	float mask = texture(trim_mask, UV * trim_tile_scale).r;
	ALBEDO = mix(base_color.rgb, trim_color.rgb * 0.35, mask);
	EMISSION = trim_color.rgb * mask * trim_energy;
	ROUGHNESS = 0.52;
	METALLIC = 0.18;
}
