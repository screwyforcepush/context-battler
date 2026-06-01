shader_type spatial;
render_mode diffuse_lambert, specular_schlick_ggx;

uniform sampler2D albedo_texture : source_color;
uniform sampler2D normal_texture : hint_normal;
uniform sampler2D roughness_texture;
uniform sampler2D metallic_texture;
uniform sampler2D ao_texture;

uniform bool use_albedo_texture = false;
uniform bool use_normal_texture = false;
uniform bool use_roughness_texture = false;
uniform bool use_metallic_texture = false;
uniform bool use_ao_texture = false;

uniform vec4 base_color : source_color = vec4(0.66, 0.66, 0.68, 1.0);
uniform vec4 tint : source_color = vec4(1.0, 1.0, 1.0, 1.0);
uniform vec2 uv2_scale = vec2(1.0, 1.0);
uniform vec2 uv2_offset = vec2(0.0, 0.0);

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

void fragment() {
	vec2 uv2 = UV2 * uv2_scale + uv2_offset;
	vec4 albedo_sample = use_albedo_texture ? texture(albedo_texture, uv2) : base_color;
	float tier_amount = clamp(max(armour_amount, armour_tier / 4.0), 0.0, 1.0);

	ALBEDO = mix(albedo_sample.rgb * tint.rgb, armour_tint.rgb, tier_amount * armour_tint_strength);
	METALLIC = clamp((use_metallic_texture ? texture(metallic_texture, uv2).r : metallic) + tier_amount * armour_metallic_boost, 0.0, 1.0);
	ROUGHNESS = clamp((use_roughness_texture ? texture(roughness_texture, uv2).r : roughness) - tier_amount * armour_roughness_drop, 0.04, 1.0);
	AO = mix(1.0, use_ao_texture ? texture(ao_texture, uv2).r : 1.0, ao_strength);

	if (use_normal_texture) {
		NORMAL_MAP = texture(normal_texture, uv2).rgb;
		NORMAL_MAP_DEPTH = normal_depth;
	}
	if (tier_amount > 0.0 && armour_emission_strength > 0.0) {
		EMISSION = armour_emission.rgb * tier_amount * armour_emission_strength;
	}
}
