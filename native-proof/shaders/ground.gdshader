shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx;

uniform int surface_kind = 0;
uniform bool show_grid = false;
uniform vec4 color_a : source_color = vec4(0.43, 0.39, 0.26, 1.0);
uniform vec4 color_b : source_color = vec4(0.65, 0.56, 0.38, 1.0);
uniform sampler2D dirt_diffuse : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D dirt_normal : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D grass_diffuse : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D grass_normal : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
varying vec3 world_position;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
}
float fbm(vec2 p) { return noise(p) * .55 + noise(p * 2.03 + 8.7) * .27 + noise(p * 4.19 + 1.9) * .13 + noise(p * 8.1) * .05; }
float strip(float x, float center, float width) { return 1.0 - smoothstep(width, width + .11, abs(x - center)); }
void vertex() { world_position = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; }
void fragment() {
    vec2 p = world_position.xz;
    float footprint = max(length(dFdx(p)), length(dFdy(p)));
    // Subpixel grains must become their average, rather than sparkle as the camera moves.
    float grain_visibility = 1.0 - smoothstep(.006, .034, footprint);
    float pebble_visibility = 1.0 - smoothstep(.016, .065, footprint);
    float broad = fbm(p * .17);
    float grit = mix(.5, noise(p * 72.0), grain_visibility);
    vec3 c = mix(color_a.rgb, color_b.rgb, smoothstep(.20, .75, broad));
    vec3 mapped_normal = vec3(.5 + (noise(p * 60.0) - .5) * .085 * grain_visibility, .5 + (noise(p * 60.0 + 3.0) - .5) * .085 * grain_visibility, 1.0);
    if (surface_kind == 0) {
        float patches = fbm(p * .29 + 63.1);
        float ruts = max(strip(p.y, 1.8, .12), strip(p.y, 3.6, .12)) * (1.0 - smoothstep(10.0, 12.0, abs(p.x + 8.0)));
        float crossing_ruts = max(strip(p.x, -11.0, .16), strip(p.x, -9.4, .16)) * (1.0 - smoothstep(9.0, 11.0, abs(p.y - 2.0)));
        float worn = max(max(ruts, crossing_ruts), strip(p.x, -10.2, .62) * (1.0 - smoothstep(9.0, 12.0, abs(p.y - 2.0))) * .64);
        float grass_coverage = smoothstep(.32, .65, patches) * (1.0 - worn * .96);
        float working_yard = (1.0 - smoothstep(22.0, 29.0, abs(p.x))) * (1.0 - smoothstep(11.0, 16.0, abs(p.y - 7.0)));
        grass_coverage *= 1.0 - working_yard * .47;
        // Two incommensurate orientations and a slow organic warp suppress an obvious tile grid.
        vec2 warp = vec2(fbm(p * .067), fbm(p * .061 + 28.4)) * .20;
        vec2 uv_a = p * .5 + warp;
        vec2 uv_b = vec2(p.x * .8 + p.y * .6, -p.x * .6 + p.y * .8) * .513 + vec2(.39, .73) + warp;
        float texture_blend = smoothstep(.12, .84, fbm(p * .31 + 91.0));
        vec3 dirt = mix(texture(dirt_diffuse, uv_a).rgb, texture(dirt_diffuse, uv_b).rgb, texture_blend);
        vec3 grass = mix(texture(grass_diffuse, uv_a).rgb, texture(grass_diffuse, uv_b).rgb, texture_blend);
        vec3 photographic = mix(dirt, grass, grass_coverage);
        vec3 macro_tint = mix(vec3(.83, .91, .77), vec3(1.17, 1.10, .99), broad);
        c = mix(photographic * macro_tint, c, .12);
        vec3 dirt_a = texture(dirt_normal, uv_a).rgb * 2.0 - 1.0;
        vec3 dirt_b = texture(dirt_normal, uv_b).rgb * 2.0 - 1.0;
        vec3 grass_a = texture(grass_normal, uv_a).rgb * 2.0 - 1.0;
        vec3 grass_b = texture(grass_normal, uv_b).rgb * 2.0 - 1.0;
        dirt_b.xy = vec2(dirt_b.x * .8 - dirt_b.y * .6, dirt_b.x * .6 + dirt_b.y * .8);
        grass_b.xy = vec2(grass_b.x * .8 - grass_b.y * .6, grass_b.x * .6 + grass_b.y * .8);
        vec3 surface_normal = normalize(mix(mix(dirt_a, dirt_b, texture_blend), mix(grass_a, grass_b, texture_blend), grass_coverage));
        mapped_normal = surface_normal * .5 + .5;
        c *= 1.0 - max(ruts, crossing_ruts) * .12;
        float tracks = max(ruts, crossing_ruts) * (1.0 - smoothstep(.11, .2, abs(fract(p.x * 4.2) - .5)));
        c *= 1.0 - tracks * .035;
    } else if (surface_kind == 1) {
        c += (grit - .5) * .047;
        c *= .96 + noise(p * 2.2) * .075;
        float stains = smoothstep(.65, .83, fbm(p * .65 + 7.0));
        c *= 1.0 - stains * .1;
    } else {
        c += (grit - .5) * .041;
        c *= .96 + broad * .08;
    }
    if (show_grid && surface_kind == 0) {
        vec2 d = abs(fract(p + .5) - .5);
        float grid = 1.0 - smoothstep(.009, .024, min(d.x, d.y));
        c = mix(c, vec3(.79, .77, .61), grid * .48);
    }
    ALBEDO = c;
    ROUGHNESS = surface_kind == 2 ? .91 : .96;
    SPECULAR = .15;
    NORMAL_MAP = mapped_normal;
    NORMAL_MAP_DEPTH = surface_kind == 0 ? .48 : .32;
}
