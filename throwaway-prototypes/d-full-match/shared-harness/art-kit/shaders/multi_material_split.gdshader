shader_type spatial;
render_mode diffuse_lambert, specular_schlick_ggx;

uniform sampler2D body_region_mask;
uniform vec4 head_color : source_color = vec4(0.263, 0.129, 0.110, 1.0);
uniform vec4 chest_color : source_color = vec4(1.0, 0.306, 0.220, 1.0);
uniform vec4 legs_color : source_color = vec4(0.102, 0.204, 0.251, 1.0);
uniform vec4 arms_color : source_color = vec4(1.0, 0.882, 0.290, 1.0);
uniform float head_metallic : hint_range(0.0, 1.0) = 0.15;
uniform float chest_metallic : hint_range(0.0, 1.0) = 0.45;
uniform float legs_metallic : hint_range(0.0, 1.0) = 0.25;
uniform float arms_metallic : hint_range(0.0, 1.0) = 0.62;
uniform float head_roughness : hint_range(0.02, 1.0) = 0.70;
uniform float chest_roughness : hint_range(0.02, 1.0) = 0.38;
uniform float legs_roughness : hint_range(0.02, 1.0) = 0.50;
uniform float arms_roughness : hint_range(0.02, 1.0) = 0.32;
uniform float region_blend_softness : hint_range(0.0, 0.20) = 0.025;
uniform float armour_amount : hint_range(0.0, 1.0) = 0.0;

void fragment() {
	vec4 region = texture(body_region_mask, UV);
	region = max(region - vec4(region_blend_softness), vec4(0.0));
	float total = region.r + region.g + region.b + region.a;
	vec4 weights = total > 0.001 ? region / total : vec4(0.0, 1.0, 0.0, 0.0);

	ALBEDO =
		head_color.rgb * weights.r +
		chest_color.rgb * weights.g +
		legs_color.rgb * weights.b +
		arms_color.rgb * weights.a;
	METALLIC = clamp(
		head_metallic * weights.r +
		chest_metallic * weights.g +
		legs_metallic * weights.b +
		arms_metallic * weights.a +
		armour_amount * 0.12,
		0.0,
		1.0
	);
	ROUGHNESS = clamp(
		head_roughness * weights.r +
		chest_roughness * weights.g +
		legs_roughness * weights.b +
		arms_roughness * weights.a -
		armour_amount * 0.08,
		0.02,
		1.0
	);
}
