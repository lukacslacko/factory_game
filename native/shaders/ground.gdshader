shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx;

uniform int surface_kind = 0;
uniform bool show_grid = false;
uniform vec4 color_a : source_color = vec4(0.43, 0.39, 0.26, 1.0);
uniform vec4 color_b : source_color = vec4(0.65, 0.56, 0.38, 1.0);
uniform sampler2D dirt_normal : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D cover_texture : filter_linear;
uniform bool use_cover_texture = false;
varying vec3 world_position;
varying vec4 instance_tint;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
}
float fbm(vec2 p) { return noise(p) * .55 + noise(p * 2.03 + 8.7) * .27 + noise(p * 4.19 + 1.9) * .13 + noise(p * 8.1) * .05; }
float strip(float x, float center, float width) { return 1.0 - smoothstep(width, width + .11, abs(x - center)); }
void vertex() {
    world_position = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
    instance_tint = COLOR;
}
void fragment() {
    vec2 p = world_position.xz;
    float footprint = max(length(dFdx(p)), length(dFdy(p)));
    // Subpixel grains must become their average, rather than sparkle as the camera moves.
    float grain_visibility = 1.0 - smoothstep(.006, .034, footprint);
    vec3 c = color_a.rgb;
    vec3 mapped_normal = vec3(.5, .5, 1.0);
    if (surface_kind == 0) {
        float ruts = max(strip(p.y, 1.8, .12), strip(p.y, 3.6, .12)) * (1.0 - smoothstep(10.0, 12.0, abs(p.x + 8.0)));
        float crossing_ruts = max(strip(p.x, -11.0, .16), strip(p.x, -9.4, .16)) * (1.0 - smoothstep(9.0, 11.0, abs(p.y - 2.0)));
        float traveled = 0.0;
        if (use_cover_texture) {
            vec2 cover_uv = (p + vec2(50.0, 40.0)) / vec2(300.0, 190.0);
            if (cover_uv.x >= 0.0 && cover_uv.x <= 1.0 && cover_uv.y >= 0.0 && cover_uv.y <= 1.0) {
                float cover = texture(cover_texture, cover_uv).r;
                traveled = clamp((1.0 - cover) / .88, 0.0, 1.0);
            }
        }
        // Damp, nearly uniform soil: actual 3D foliage supplies the green and
        // patchiness. Texture is only fine close-range relief, never a painted meadow.
        c = color_a.rgb;
        float close_detail = 1.0 - smoothstep(.025, .12, footprint);
        vec2 uv = p * .33;
        vec3 soil_normal = texture(dirt_normal, uv).rgb;
        mapped_normal = mix(vec3(.5, .5, 1.0), soil_normal, close_detail * .34);
        c += (noise(p * 15.0) - .5) * .009 * close_detail;
        c *= 1.0 - traveled * .19;
        c *= 1.0 - max(ruts, crossing_ruts) * .07;
        float tracks = max(ruts, crossing_ruts) * (1.0 - smoothstep(.11, .2, abs(fract(p.x * 4.2) - .5)));
        c *= 1.0 - tracks * .025;
    } else if (surface_kind == 1) {
        float broad = fbm(p * .17);
        float grit = mix(.5, noise(p * 72.0), grain_visibility);
        c = mix(color_a.rgb, color_b.rgb, smoothstep(.20, .75, broad));
        mapped_normal = vec3(.5 + (noise(p * 60.0) - .5) * .085 * grain_visibility, .5 + (noise(p * 60.0 + 3.0) - .5) * .085 * grain_visibility, 1.0);
        c += (grit - .5) * .047;
        c *= (.94 + noise(p * 2.2) * .095) * instance_tint.rgb;
        c += (noise(p * 7.0) - .5) * .021;
        float stains = smoothstep(.65, .83, fbm(p * .65 + 7.0));
        c *= 1.0 - stains * .1;
    } else {
        c = mix(color_a.rgb,color_b.rgb,.45 + (noise(p*.45)-.5)*.12);
        float asphalt_detail = 1.0-smoothstep(.025,.09,footprint);
        float asphalt_grain = noise(p*12.0+61.2);
        c += (asphalt_grain-.5)*.009*asphalt_detail;
        c *= .985 + noise(p*1.2)*.03;
        float roadside_edge = abs(abs(p.y+23.0)-4.0);
        float entrance_edge = abs(abs(p.x+23.0)-3.0);
        float in_entrance = step(-19.0,p.y)*(1.0-step(5.7,p.y));
        float edge_distance = min(roadside_edge,mix(10.0,entrance_edge,in_entrance));
        float wear = (1.0-smoothstep(.08,.44,edge_distance))*(.5+.5*noise(p*3.0));
        c *= 1.0+wear*.14;
        mapped_normal = vec3(.5+(asphalt_grain-.5)*.055*asphalt_detail,.5+(noise(p*12.0+7.1)-.5)*.055*asphalt_detail,1.0);
    }
    if (show_grid && surface_kind != 2) {
        vec2 d = abs(fract(p + .5) - .5);
        vec2 width = max(fwidth(p), vec2(.001));
        // Pixel-filtered world-space lines stay readable on soil and paving.
        // Fade the 1 m lattice before it aliases; the 10 m guides remain.
        vec2 lines = 1.0 - smoothstep(width * .30, width * 1.05, d);
        float minor = max(lines.x, lines.y) * (1.0 - smoothstep(.35, .75, footprint));
        vec2 major_d = abs(fract(p / 10.0 + .5) - .5) * 10.0;
        vec2 major_lines = 1.0 - smoothstep(width * .50, width * 1.30, major_d);
        float major = max(major_lines.x, major_lines.y);
        c = mix(c, vec3(.14, .19, .14), max(minor * .48, major * .68));
    }
    ALBEDO = c;
    ROUGHNESS = surface_kind == 2 ? .91 : .96;
    SPECULAR = .15;
    NORMAL_MAP = mapped_normal;
    NORMAL_MAP_DEPTH = surface_kind == 0 ? .58 : .32;
}
