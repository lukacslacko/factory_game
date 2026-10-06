shader_type sky;
render_mode disable_fog;
uniform bool dusk = false;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
float clouds(vec2 p) { return noise(p)*.56 + noise(p*2.07+4.3)*.28 + noise(p*4.03+8.1)*.16; }
void sky() {
    vec3 dir=normalize(EYEDIR);
    float up=max(dir.y,0.0);
    vec3 zenith=dusk ? vec3(.025,.045,.10) : vec3(.14,.34,.62);
    vec3 horizon=dusk ? vec3(.56,.23,.10) : vec3(.77,.85,.94);
    vec3 c=mix(horizon,zenith,pow(up,.32));
    vec2 uv=dir.xz/max(up+.14,.18)*2.4;
    float cover=smoothstep(.46,.65,clouds(uv));
    cover*=smoothstep(.025,.22,up);
    vec3 cloud=dusk ? vec3(.40,.24,.17) : vec3(1.62,1.59,1.45);
    c=mix(c,cloud,cover*.80);
    if (dir.y<0.0) c=mix(dusk ? vec3(.08,.07,.06) : vec3(.24,.20,.13),horizon,exp(dir.y*12.0)*.4);
    if (LIGHT0_ENABLED) {
        float alignment=max(dot(dir,LIGHT0_DIRECTION),0.0);
        float disc=smoothstep(cos(.007),cos(.003),alignment);
        c+=LIGHT0_COLOR*(disc*(dusk ? 12.0:34.0)+pow(alignment,180.0)*(dusk ? .24:.48));
    }
    COLOR=c;
}
