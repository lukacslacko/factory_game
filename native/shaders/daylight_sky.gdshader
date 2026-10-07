shader_type sky;
render_mode disable_fog;
uniform float daylight : hint_range(0.0,1.0) = 1.0;
uniform float twilight : hint_range(0.0,1.0) = 0.0;
uniform vec3 sun_direction = vec3(0.0,1.0,0.0);
uniform vec3 moon_direction = vec3(0.0,-1.0,0.0);
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
float clouds(vec2 p) { return noise(p)*.56 + noise(p*2.07+4.3)*.28 + noise(p*4.03+8.1)*.16; }
void sky() {
    vec3 dir=normalize(EYEDIR);
    float up=max(dir.y,0.0);
    vec3 zenith=mix(vec3(.025,.045,.09),vec3(.14,.34,.62),daylight);
    vec3 horizon=mix(vec3(.08,.12,.20),vec3(.77,.85,.94),daylight);
    float toward_sun=pow(max(dot(normalize(vec3(dir.x,.001,dir.z)),normalize(vec3(sun_direction.x,.001,sun_direction.z))),0.0),3.0);
    horizon=mix(horizon,vec3(.80,.33,.13),twilight*(.28+.58*toward_sun));
    vec3 c=mix(horizon,zenith,pow(up,.32));
    vec2 uv=dir.xz/max(up+.14,.18)*2.4;
    float cover=smoothstep(.46,.65,clouds(uv));
    cover*=smoothstep(.025,.22,up);
    vec3 cloud=mix(vec3(.10,.15,.25),vec3(1.62,1.59,1.45),daylight);
    cloud=mix(cloud,vec3(.72,.40,.25),twilight*.45);
    c=mix(c,cloud,cover*.80);
    if (dir.y<0.0) c=mix(mix(vec3(.025,.035,.05),vec3(.24,.20,.13),daylight),horizon,exp(dir.y*12.0)*.4);
    if (sun_direction.y>-.015) {
        float alignment=max(dot(dir,sun_direction),0.0);
        float disc=smoothstep(cos(.007),cos(.003),alignment);
        c+=mix(vec3(1.0,.55,.25),vec3(1.0,.95,.85),daylight)*(disc*34.0+pow(alignment,180.0)*.48);
    }
    float moon_alignment=max(dot(dir,moon_direction),0.0);
    float moon_disc=smoothstep(cos(.010),cos(.008),moon_alignment);
    // The same full disk every night keeps an unlit starter yard readable.
    float crater=.82+.18*noise(dir.xz*950.0);
    c+=vec3(.65,.76,1.0)*(moon_disc*crater*8.0+pow(moon_alignment,250.0)*.10)*(1.0-daylight);
    COLOR=c;
}
