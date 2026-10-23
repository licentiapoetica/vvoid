// GLSL shared by the sky, the cube structures and the light points.
import { LOOK_GLSL } from "./look.js";

// Helpers available to a sector's field function (and to Claude, who writes it).
// Simplex noise after Ian McEwan / Stefan Gustavson (webgl-noise, MIT: see THIRD-PARTY-NOTICES.md).
export const NOISE_LIB = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1./6.,1./3.); const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.; vec4 s1=floor(b1)*2.+1.; vec4 sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.); m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float hash(vec3 p){p=fract(p*0.3183099+vec3(.1,.2,.3)); p*=17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float fbm(vec3 p){float a=.5,s=0.; for(int i=0;i<4;i++){s+=a*snoise(p); p=p*2.02+vec3(11.3,7.7,3.1); a*=.5;} return s;}
float ridged(vec3 p){float a=.5,s=0.; for(int i=0;i<4;i++){float n=1.-abs(snoise(p)); s+=a*n*n; p=p*2.03+vec3(5.2,1.3,9.4); a*=.5;} return s;}
float worley(vec3 p){
  vec3 c=floor(p), f=fract(p); float d=1.;
  for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++) for(int z=-1;z<=1;z++){
    vec3 o=vec3(float(x),float(y),float(z));
    vec3 r=o+vec3(hash(c+o),hash(c+o+17.3),hash(c+o+41.7))-f;
    d=min(d,dot(r,r));
  }
  return sqrt(d);
}
`;

export const DEFAULT_FIELD = `vec3 q = p * 0.7 + vec3(0.0, t * 0.015, 0.0); float n = fbm(q + 0.6 * snoise(q * 0.5)); return smoothstep(0.05, 0.75, n);`;

const fieldFn = (body) => `float field(vec3 p, float t){\n${body}\n}`;

// Compile a candidate field body on its own so a bad one never reaches the scene.
// Whether a sector's field compiles, asked without stalling the frame: where the browser compiles in
// the background (KHR_parallel_shader_compile) the answer is waited for, not demanded. Each field
// is only ever compiled once for this.
const fieldChecks = new Map();
export function fieldCompiles(gl, body) {
  if (fieldChecks.has(body)) return fieldChecks.get(body);
  const shader = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(
    shader,
    `#version 300 es\nprecision highp float;\n${NOISE_LIB}\n${fieldFn(body)}\nout vec4 o;\nvoid main(){ o = vec4(field(gl_FragCoord.xyz, 0.)); }`
  );
  gl.compileShader(shader);
  const parallel = gl.getExtension("KHR_parallel_shader_compile");
  const check = new Promise((resolve) => {
    const answer = () => {
      if (parallel && !gl.getShaderParameter(shader, parallel.COMPLETION_STATUS_KHR)) return void setTimeout(answer, 16);
      const ok = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
      const log = ok ? "" : gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      resolve({ ok, log });
    };
    setTimeout(answer, 0);
  });
  if (fieldChecks.size > 64) fieldChecks.delete(fieldChecks.keys().next().value);
  fieldChecks.set(body, check);
  return check;
}

// The light far off (see skyFrag): one place in the sky (in the void, where you face the hub's clock as
// you arrive), not wherever you look; how much of it there is along d. And the one light the blocks are
// lit by, from above and from behind you as you face it, so each side of a block keeps its own shade
// whichever way you turn (and the side turned from it is near black). See World.enter.
const HAZE = /* glsl */ `
${LOOK_GLSL}
uniform vec3 uHazeDir, uKeyLight;
#define KEY_LIGHT uKeyLight
float hazeAhead(vec3 d){ return max(dot(d, uHazeDir), 0.); }
float hazeDark(float ahead){ return 1. - LOOK_HAZE_DARK + LOOK_HAZE_DARK * pow(ahead, 3.); }
float hazeGlow(float ahead){ return (0.05 * pow(ahead, 3.) + 0.12 * pow(ahead, 16.) + 0.12 * pow(ahead, 120.)) * LOOK_HAZE_GLOW; }
vec3 hazeColour(vec3 own){ return mix(own, LOOK_HAZE_COLOUR, LOOK_HAZE_COLOUR_MIX); } // (an admin's colour over it, if any)
float keyLight(vec3 n){ return 0.06 + 0.94 * max(dot(n, KEY_LIGHT), 0.) + 0.18 * max(-dot(n, KEY_LIGHT), 0.); }`;

// The blocks in the sky: a few pale blocks far off in the haze, painted into the nebula and never there.
// A ray is walked cell by cell through a grid (each cell holds at most a block per axis, kept apart so
// they never meet) from a long way out, and what it meets is mostly haze: they are seen, not noticed,
// and slide past only very slowly as you fly. Now and then one fades out a while, and back.
const SCAFFOLD = /* glsl */ `
uniform float uBlocksMany, uBlocksLit; // (how many of them, x1; and how far a light show lights them, 0..1)
// the light show, as five groups of lights (a plugin's stage may have them: lasers behind, rings, left,
// right, centre), each as bright as it is now (0..~2) and in its colour; each block answers one of them
uniform float uBlocksLights[5];
uniform vec3 uBlocksColours[5];
const vec3 BLOCK_AT[3] = vec3[3](vec3(0., -0.25, 0.25), vec3(0.25, 0., -0.25), vec3(-0.25, 0.25, 0.));
#define BLOCK_W LOOK_BLOCKS_SIZE
#define BLOCKS_FROM LOOK_BLOCKS_FROM
#define BLOCKS_TO LOOK_BLOCKS_TO
vec3 farBlocks(vec3 d, vec3 sky){
  vec3 ro = uOrigin * 2. * LOOK_BLOCKS_DRIFT + d * BLOCKS_FROM;
  vec3 rd = d + vec3(equal(d, vec3(0.))) * 1e-5;
  vec3 inv = 1. / rd, stp = sign(rd);
  vec3 cell = floor(ro);
  vec3 tMax = (cell + 0.5 + 0.5 * stp - ro) * inv, tDelta = abs(inv);
  for (int i = 0; i < 200; i++) {
    if (min(min(tMax.x, tMax.y), tMax.z) > BLOCKS_TO) break;
    // a few here and there, a handful together, long stretches of nothing
    float dense = uBlocksMany * LOOK_BLOCKS_DENSITY;
    float many = (hash(floor(cell / 4.) + 0.5) < 0.1 * dense ? 0.05 : 0.0006) * dense;
    vec3 next = step(tMax, tMax.yzx) * step(tMax, tMax.zxy);
    // (most cells hold nothing, and are passed on one look)
    if (hash(cell + 0.37) > many * 3.) { cell += next * stp; tMax += next * tDelta; continue; }
    float best = 1e9, fade = 0.;
    int face = -1, group = 0;
    vec3 lo = vec3(0.), size = vec3(1.);
    for (int a = 0; a < 3; a++) {
      vec3 seed = cell + float(a) * vec3(17.1, 31.7, 7.3);
      if (hash(seed) > many) continue;
      vec3 half_ = vec3(BLOCK_W * 0.5);
      half_[a] *= hash(seed + 5.1) < 0.6 ? 1. : 2. + floor(hash(seed + 6.3) * 2.); // a cube, or a short beam
      vec3 centre = cell + 0.5 + BLOCK_AT[a];
      centre[a] = cell[a] + 0.5 + (hash(seed + 9.7) - 0.5) * (0.96 - half_[a] * 2.);
      vec3 t0 = (centre - half_ - ro) * inv, t1 = (centre + half_ - ro) * inv;
      vec3 tn = min(t0, t1), tf = max(t0, t1);
      float near = max(max(tn.x, tn.y), tn.z), far = min(min(tf.x, tf.y), tf.z);
      if (near < far && far > 0. && near < best) {
        best = max(near, 0.); lo = centre - half_; size = half_ * 2.;
        group = int(hash(seed + 4.4) * 4.999);
        face = tn.x >= near ? 0 : tn.y >= near ? 1 : 2;
        fade = smoothstep(-0.5, 0.3, sin(uTime * 0.04 + hash(seed + 2.3) * 40.));
      }
    }
    if (face >= 0) {
      float dist = BLOCKS_FROM + best;
      vec3 n = vec3(0.);
      n[face] = -sign(rd[face]);
      // each side its own shade, and lighter toward the top, as the near ones are
      float up = clamp((ro.y + rd.y * best - lo.y) / size.y, 0., 1.);
      // the further, the darker: row after row of them going down into the black
      float lamp = keyLight(n) * (0.75 + 0.4 * up) * LOOK_BLOCKS_BRIGHT / (1. + pow(dist / LOOK_BLOCKS_FALLOFF, 2.)) * (1. + uPulse * 0.25);
      vec3 stone = vec3(0.52, 0.56, 0.66) * mix(vec3(1.), uGlow / max(max(uGlow.r, uGlow.g), max(uGlow.b, 0.001)), 0.35);
      stone = mix(stone, LOOK_BLOCKS_COLOUR, LOOK_BLOCKS_COLOUR_MIX);
      float near = 1. - smoothstep(BLOCKS_FROM, max(30., BLOCKS_FROM + 1.), dist);
      float seen = smoothstep(BLOCKS_FROM, BLOCKS_FROM + 5., dist) * fade * (1. - smoothstep(BLOCKS_TO * 0.6, BLOCKS_TO, dist)) * LOOK_BLOCKS_OPACITY;
      // (lit through by the sky a little while near, so their dark sides are never holes in it; far off,
      // they are what darkens it)
      vec3 lit = (stone * lamp + uFogColor * near) * uLight + sky * 0.6 * near;
      // a light show (a plugin's) brings them up out of the haze and glows in them, the near ones most: in its
      // lights' colours, or as far as the look's colour overrides theirs, in that
      float show = uBlocksLit * uBlocksLights[group] * (0.35 + 0.65 * (1. - smoothstep(BLOCKS_FROM, BLOCKS_TO * 0.8, dist)));
      lit += mix(uBlocksColours[group], LOOK_BLOCKS_COLOUR, LOOK_BLOCKS_COLOUR_MIX) * show * (0.45 + 0.55 * up) * LOOK_BLOCKS_SHOW_GLOW;
      return mix(sky, lit, min(seen * (1. + show * LOOK_BLOCKS_SHOW_OPACITY), 0.97));
    }
    cell += next * stp;
    tMax += next * tDelta;
  }
  return sky;
}`;

export const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
}`;

export const skyFrag = (body) => /* glsl */ `
uniform float uTime, uOpacity, uLight, uBass, uPulse, uSolid;
uniform vec3 uOrigin, uFogColor, uDeep, uGlow, uAccent;
varying vec3 vDir;
${NOISE_LIB}
${HAZE}
${SCAFFOLD}
${fieldFn(body)}
void main(){
  vec3 d = normalize(vDir);
  float acc = 0., peak = 0.;
  for (int i = 0; i < 3; i++) {
    // (and on a song's beat it leans in at you a little: see uPulse)
    // (how deep it is, how fast it moves and how far it drifts as you fly: an admin's, see look.js)
    float f = clamp(field(uOrigin * LOOK_NEBULA_DRIFT + d * (1.4 + float(i) * 1.6) * LOOK_NEBULA_DEPTH * (1. - uPulse * 0.05), uTime * LOOK_NEBULA_SPEED), 0., 1.);
    acc += f; peak = max(peak, f);
  }
  acc /= 3.;
  vec3 col = mix(uDeep, uFogColor, 0.55 + 0.3 * d.y) * LOOK_NEBULA_BASE;
  vec3 glow = mix(uGlow, LOOK_NEBULA_COLOUR, LOOK_NEBULA_COLOUR_MIX), accent = mix(uAccent, LOOK_NEBULA_ACCENT_COLOUR, LOOK_NEBULA_ACCENT_COLOUR_MIX);
  // the nebula is a rumour of light, not a sky
  // bass swells the nebula, and a song's beat does
  col = mix(col, glow, min(acc * 0.3 * LOOK_NEBULA_STRENGTH * uLight * (1. + uBass * 1.3 + uPulse * 0.9), 1.));
  col += accent * pow(peak, 4.) * 0.2 * LOOK_NEBULA_ACCENT * uLight * (1. + uPulse * 1.5);
  // and far off, the light the blocks stand against: a blue haze in one part of the sky, the rest of it
  // darker (the PS2's own towers, seen from among them)
  float ahead = hazeAhead(d);
  col *= mix(1., hazeDark(ahead), uSolid);
  col += hazeColour(uGlow) * hazeGlow(ahead) * uSolid * uLight * (1. + uBass * 0.6);
  if (uSolid > 0.5) col = farBlocks(d, col);
  gl_FragColor = vec4(col, uOpacity);
}`;

const FOG = /* glsl */ `float fogAmount(float dist, float density){ float f = dist * density; return 1. - exp(-f * f); }`;


// Structures. Cubes light their edges from box coordinates; faceted solids (BARY) from barycentrics.
export const BOX_VERT = /* glsl */ `
attribute float aSeed, aTint;
#ifdef BARY
attribute vec3 aBary;
varying vec3 vBary;
#endif
uniform float uMat, uTime, uWarp, uBeat;
varying vec3 vLocal, vNormal, vLocalNormal, vView, vScale;
varying float vTint, vFlash, vDist, vChan;
void main(){
  vChan = floor(aSeed * 17.99);
  // each piece grows in at its own moment as the sector materializes
  float m = smoothstep(aSeed * 0.7, aSeed * 0.7 + 0.3, uMat);
  // every piece swells on the beat, each by its own amount
  float grow = m * m * (3. - 2. * m) * (1. + uBeat * 0.1 * (0.3 + aSeed));
  vLocal = position; vLocalNormal = normal; vTint = aTint;
  vFlash = (1. - m) * step(0.001, m) + smoothstep(0.75, 1., m) * (1. - m) * 4.;
#ifdef BARY
  vBary = aBary;
#endif
  mat4 world = modelMatrix * instanceMatrix;
  vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vec4 wp = world * vec4(position * grow, 1.);
  // dreamt things do not hold still: the whole form sways and breathes, slowly, like something seen through water
  vec3 sway = sin(wp.yzx * 0.021 + uTime * vec3(0.23, 0.17, 0.29)) + 0.5 * sin(wp.zxy * 0.047 - uTime * 0.31);
  wp.xyz += sway * uWarp;
  vNormal = normalize(mat3(world) * (normal / (vScale * vScale)));
  vView = cameraPosition - wp.xyz;
  vDist = length(vView);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

export const BOX_FRAG = /* glsl */ `
uniform vec3 uFogColor, uDeep, uGlow, uAccent;
uniform vec3 uHaze;
uniform float uFogDensity, uBands, uLight, uMid, uBeat, uUnit, uRainbow, uTime, uRainbowAll, uSolid;
uniform float uChan[18]; // a sequencer for rainbow pieces: one brightness per channel, eighteen of them
varying float vChan;
#ifdef FRACTAL
uniform float uNear;
#endif
varying vec3 vLocal, vNormal, vLocalNormal, vView, vScale;
varying float vTint, vFlash, vDist;
#ifdef BARY
varying vec3 vBary;
#endif
vec3 hue(float h){ return clamp(abs(fract(h + vec3(0., 2. / 3., 1. / 3.)) * 6. - 3.) - 1., 0., 1.); }
float grainAt(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
${FOG}
${HAZE}
void main(){
#ifdef BARY
  float b = min(min(vBary.x, vBary.y), vBary.z);
  float edge = 1. - smoothstep(0., fwidth(b) * 1.5 + 0.004, b);
  float rim = edge;
#else
  // glowing edges, kept a constant world width whatever the box proportions
  float w = (0.5 + vDist * 0.0035) / uUnit;
  vec3 e = smoothstep(vec3(0.5) - w / vScale, vec3(0.5), abs(vLocal));
  float edge = max(max(e.x * e.y, e.y * e.z), e.x * e.z);
  float rim = edge; // (the outline alone, without the rows: see solid below)
  // tall columns read as stacks of cubes
  float rows = (vLocal.y + 0.5) * vScale.y / max(vScale.x, 0.001) * uBands;
  float band = smoothstep(0.5 - w / vScale.x, 0.5, abs(fract(rows) - 0.5));
  edge = max(edge, band * step(0.5, uBands) * (1. - step(0.5, abs(vLocalNormal.y))));
#endif
  float fres = pow(max(1. - abs(dot(normalize(vNormal), normalize(vView))), 0.), 2.5);
  vec3 tint = mix(uGlow, uAccent, vTint);
  // a rainbow place (or the whole void, taken over): every piece an LED on a running rainbow
  vec3 where = cameraPosition - vView;
  float rainbow = max(uRainbow, uRainbowAll);
  tint = mix(tint, hue(dot(where, vec3(0.0011, 0.0017, 0.0013)) + uTime * 0.12 + vTint * 0.33), rainbow);
  // faces stay close to black: the void is lit by edges, not surfaces
  vec3 col = mix(uDeep, uGlow, 0.02 + 0.08 * fres) * (0.5 + 0.5 * vNormal.y);
  // mid frequencies brighten every edge; the beat lights the accent pieces
  float lit = 1. + uMid * 0.6 + uBeat * vTint * 1.0;
#ifdef FRACTAL
  // how far you can see shrinks with your distance to the centre, so every depth looks like the last
  lit *= 1. - smoothstep(12. * uNear, 40. * uNear, vDist);
  // and what is right against the eye is dim, or the inside of the thing would be all glare
  lit *= 0.25 + 0.75 * smoothstep(0.3 * uNear, 2.5 * uNear, vDist);
#endif
  lit *= mix(1., 0.3 + 1.4 * uChan[int(vChan)], rainbow);
  col += (tint * edge * 1.1 + tint * fres * 0.1) * lit;
  // Or solid: clean pale blocks, the PS2's own towers, each side in its own shade of the one light (see
  // HAZE), lighter toward the top, dimmer the further off, the far ones going into the haze. (A rainbow
  // place keeps its lit edges.)
  float solid = uSolid * (1. - rainbow);
  if (solid > 0.) {
    vec3 n = normalize(vNormal);
    float lamp = keyLight(n) * (0.82 + 0.3 * clamp(vLocal.y + 0.5, 0., 1.));
    lamp *= LOOK_SOLID_LIGHT / (1. + pow(vDist / (LOOK_SOLID_REACH * uUnit), 2.));
    // the faintest grain, the piece's own, gone where it would only shimmer
    vec3 gp = floor(vLocal * vScale * 1.5);
    float fine = 1. - smoothstep(0.35, 0.9, length(fwidth(vLocal * vScale * 1.5)));
    float grain = 1. + (grainAt(gp) - 0.5) * LOOK_SOLID_GRAIN * fine;
    // pale, and only leaning toward the place's colours: its accent pieces a little more
    vec3 shade = tint / max(max(tint.r, tint.g), max(tint.b, 0.001));
    vec3 stone = vec3(0.52, 0.55, 0.64) * mix(vec3(1.), shade, 0.28 + 0.3 * vTint);
    stone = mix(stone, LOOK_SOLID_COLOUR, LOOK_SOLID_COLOUR_MIX) * grain;
    // (and what the lamp no longer reaches is the dark blue of the air, not black); only a faint
    // line where two faces meet, so a block keeps its shape against another
    vec3 face = (stone * lamp + uFogColor * 1.5) * (1. - rim * LOOK_SOLID_EDGE);
    face += tint * vTint * (0.05 + uBeat * 0.25 + uMid * 0.06);
#ifdef FRACTAL
    face *= (1. - smoothstep(12. * uNear, 40. * uNear, vDist)) * (0.25 + 0.75 * smoothstep(0.3 * uNear, 2.5 * uNear, vDist));
#endif
    col = mix(col, face, solid);
  }
  col = col * uLight + tint * vFlash * (0.08 + edge);
  // what is far goes into the air as the sky behind it has it: into the haze where it is, not to black
  float ahead = hazeAhead(-normalize(vView));
  col = mix(col, uFogColor * mix(1., hazeDark(ahead), uSolid) + hazeColour(uHaze) * hazeGlow(ahead) * uSolid * uLight, fogAmount(vDist, uFogDensity));
  gl_FragColor = vec4(col, 1.);
}`;

export const MOTE_VERT = /* glsl */ `
attribute float aSeed;
uniform float uTime, uSize, uCell, uOrbit, uPx, uFogDensity, uMat, uLight, uHigh, uSolid;
uniform vec3 uDrift;
varying float vAlpha, vHue, vLed;
${FOG}
void main(){
  vHue = aSeed * 3. + uTime * 0.1;
  // one in thirty is not a mote but a tiny lamp, red, green or violet, steady where the others twinkle
  vLed = step(0.967, fract(aSeed * 31.7)) * (1. + floor(fract(aSeed * 7.3) * 3.)) * step(0.5, uSolid);
  vec3 p = position + uDrift * uTime * (0.4 + aSeed);
  p = mod(p + uCell * 0.5, uCell) - uCell * 0.5;
  float a = uOrbit * uTime * (0.3 + aSeed);
  p.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * p.xz;
  p += 5. * sin(uTime * 0.25 + aSeed * 40. + p.yzx * 0.02);
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  float dist = length(mv.xyz);
  // high frequencies make the motes flare
  gl_PointSize = clamp(uSize * uPx * (0.6 + aSeed) * (1. + uHigh * 1.4) * 380. / max(dist, 1.), 1., 48.);
  float twinkle = vLed > 0. ? 0.85 + 0.15 * sin(uTime * 2.1 + aSeed * 90.) : 0.55 + 0.45 * sin(uTime * (0.5 + aSeed * 2.) + aSeed * 90.);
  vAlpha = (1. - fogAmount(dist, uFogDensity)) * twinkle * uMat * uLight * smoothstep(2., 14., dist);
  gl_Position = projectionMatrix * mv;
}`;

export const MOTE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uRainbow, uRainbowAll;
varying float vAlpha, vHue, vLed;
vec3 hue(float h){ return clamp(abs(fract(h + vec3(0., 2. / 3., 1. / 3.)) * 6. - 3.) - 1., 0., 1.); }
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.;
  float a = pow(max(1. - d, 0.), 2.);
  vec3 col = mix(uColor, hue(vHue), max(uRainbow, uRainbowAll));
  if (vLed > 0.) col = (vLed < 1.5 ? vec3(1., 0.06, 0.04) : vLed < 2.5 ? vec3(0.1, 1., 0.18) : vec3(0.55, 0.25, 1.)) * 3. * (a + smoothstep(0.3, 0., d));
  gl_FragColor = vec4(col * a * vAlpha, 1.);
}`;

export const ORB_VERT = /* glsl */ `
attribute vec4 aOrbit; // radius, phase, tilt, angular speed
attribute vec3 aColor;
uniform float uTime, uPx, uFogDensity, uMat, uLight, uBass;
varying vec3 vColor;
varying float vAlpha;
${FOG}
void main(){
  float a = aOrbit.y + uTime * aOrbit.w;
  vec3 p = vec3(cos(a), 0., sin(a)) * aOrbit.x;
  float c = cos(aOrbit.z), s = sin(aOrbit.z);
  p.yz = mat2(c, -s, s, c) * p.yz;
  p.y += sin(uTime * 0.4 + aOrbit.y * 3.) * 8.;
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  float dist = length(mv.xyz);
  gl_PointSize = clamp(uPx * 14000. * uMat * (1. + uBass * 0.5) / max(dist, 1.), 2., 200.);
  vColor = aColor;
  vAlpha = (1. - fogAmount(dist, uFogDensity)) * uMat * uLight;
  gl_Position = projectionMatrix * mv;
}`;

export const ORB_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.;
  float halo = pow(max(1. - d, 0.), 3.);
  float core = smoothstep(0.22, 0.05, d);
  float rim = smoothstep(0.3, 0.24, d) * smoothstep(0.16, 0.24, d);
  gl_FragColor = vec4((vColor * (halo * 0.9 + rim * 0.8) + vec3(1.) * core * 0.9) * vAlpha, 1.);
}`;
