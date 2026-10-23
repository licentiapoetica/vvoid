// The way back: a companion, called Irrlicht (a will-o'-the-wisp: a cold flame that keeps by travellers
// in the dark). In the hub, and once you have gone somewhere (through a portal, into a tag's room, out
// of one, or across the map in one jump), it floats along at your side, off to the left and a little low,
// bobbing as it goes, the way a small machine keeps by someone it looks after. It is not a portal like
// the others: a mouth of dark burnt into the air, its edge burning in a cold blue fire (icefire), giving
// off a thin mist that trails behind it as it moves. It is round, a ball of that dark, its face on one
// side of it: turned away from you, looking at something, you see the back of its head. Through it, you are back where you were before: the dimension, the room
// in it, and where you were a few seconds before you went (not already in the pull of what took you),
// facing as you faced. Taken, it takes you a step further back the next time, as far as it remembers.
// In the hub with nowhere to go back to, it only keeps you company: not a way anywhere, it does not open.
// Right clicked, it takes you to the origin instead (from anywhere but the hub), and again, back.
//
// It follows lazily, and waits where it is while you look at it or come near, so it can be flown into
// (or clicked, as the portals round the clock are: see main.js). Flying into it, its mouth opens wide
// round you and the dark gathers, as at any portal. Its name under the crosshair says where it goes.
//
// In its dark, two eyes, glowing as its edge does. They blink, glance about, and show how it is (see
// MOODS): wide and looking all round when it has just come; calm, glancing now and then; looking back
// at you, pleased, when you look at it; happy, two arches, as you fly into it; narrowed and looking
// ahead when you go fast; wide and anxious when you have left it far behind; drowsy, nodding off, when
// you have kept still a long while; curious, now and then, when calm, turning its face from you a
// while to look at something (a portal, a way out, or only off into the dark) and back; annoyed, half lidded, looking sideways at you and rolling its eyes,
// the longer the more often, when where you are takes a long while to materialize.
//
// While music plays (a song, a radio station: see audio.music), what breaks off its
// edge is music notes instead of embers, rising and swaying, more of them on the beat. Stopped, they
// stop (embers again); played again, they come back a moment after.
//
// Given a name on the start screen, it greets you by it as the flight begins: a few words beside it, in
// its own cold blue, its eyes two happy arches while it says them.
import * as THREE from "three";
import { NOISE_LIB } from "./shaders.js";
import { SPAWN } from "./constants.js";
import { Watching } from "./watch.js";

export const NAME = "Irrlicht";       // what it is called: said under the crosshair when it is aimed at
export const BACK_HOLE = 26;          // its mouth's dark (the crosshair on this is on it)
const MOUTH = 92;                     // the burning disc drawn round it, edge to edge
const OPENS = 1.2;                    // how much wider its mouth opens as you go into it
const REACH = BACK_HOLE * 1.7;        // that near, going into it, you are through
const KEEP = 20;                      // how many places back it remembers
const BEFORE = 2.5;                   // seconds before a jump: where you were then
const FAR = 2500;                     // moved this far in one frame: a jump (the map)
const SPOT = new THREE.Vector3(-260, 0, -300); // where it floats, from you: off to the left, at the side of what you see (above where the place's name is written)
const TIP_FREE = 0.26; // looking up or down this far (radians, ~15 degrees), it keeps level; further, it tips along
const CLEAR_OF = 0.9; // and never long in front of what you look at: within this of straight ahead (cosine, ~25 degrees) it moves aside
const BORED = 8; // seconds of the place round you not yet materialized (Claude still writing it) before it is annoyed
const GREET_AFTER = 2.6, GREET_FOR = 4.2, GREET_WAIT = 30; // seconds: after it has come, its greeting said this long, and given up on if it has not come by then
const GREETINGS = [(n) => `hello, ${n}`, (n) => `oh, ${n}. there you are`, (n) => `${n}! let's go`, (n) => `hi ${n}. i'll keep by you`];
const LOOKS = [7, 16], LOOK_FOR = [1.8, 4.5]; // seconds between its looks away from you (calm), and how long it looks
const TURNS = Math.PI; // how far it turns its face to look (radians: all the way, its back to you if need be; less, and its eyes do the rest)
const SMOKE = 48, EMBERS = 16; // (a thin smoke: it smoulders, it does not billow)
const NOTES = 24, NOTE_SIZE = 11; // music notes, while music plays (in place of the embers): how many at once, how large
const NOTES_AFTER = 0.8; // s of music playing (again) before they come: stopped, they stop at once

// the mouth: a disc of dark with a ragged edge that smoulders, embers crawling along it, charred round it
const MOUTH_VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;
const MOUTH_FRAG = /* glsl */ `${NOISE_LIB}
uniform float uTime, uShow, uOpen, uLid, uWide, uSmile; uniform vec2 uLook; uniform mat3 uFace; varying vec2 vUv;
const float BALL = .5; // (the ball's own size, in the disc: its outline round from anywhere, the ragged edge burnt round that)
// one eye, q from its middle: an oval whose lid comes down from the top (lid 0 open, 1 shut), or,
// happy (smile 1), an arch
float eye(vec2 q, float w, float h, float lid, float smile) {
  float body = 1. - smoothstep(.8, 1., length(q / vec2(w, h)));
  body *= 1. - smoothstep(-.012, .012, q.y - (1. - 2. * lid) * h);
  float arc = abs(length(q - vec2(0., -h * .95)) - h * 1.15);
  float arch = (1. - smoothstep(h * .16, h * .3, arc)) * smoothstep(-h * .5, -h * .2, q.y);
  return mix(body, arch, smile);
}
void main(){
  vec2 p = vUv * 2. - 1.;
  float r = length(p), a = atan(p.y, p.x);
  vec2 ring = vec2(cos(a), sin(a));
  float t = uTime;
  // where the edge has burnt to: ragged, eating slowly round
  float edge = .5 + .1 * fbm(vec3(ring * 1.6, t * .18)) + .04 * snoise(vec3(ring * 5., t * .7));
  float inside = 1. - smoothstep(edge - .03, edge + .01, r);
  // the burning rim: thin, hottest at the edge itself, flickering in patches
  float flick = .55 + .45 * snoise(vec3(ring * 3.2, t * 1.9));
  float rim = exp(-abs(r - edge) * 38.) * flick;
  float glow = (step(edge, r) * exp(-(r - edge) * 9.) * .35 + (1. - step(edge, r)) * exp(-(edge - r) * 16.) * .18) * (.6 + .4 * flick); // (out round it; only a little way in)
  vec3 hot = mix(vec3(.04, .22, .85), vec3(.62, .92, 1.), clamp(rim * 1.4, 0., 1.)); // icefire: deep blue, white-cyan where hottest
  // the ball: the way its surface faces, here (n: as you see it; f: as its face is turned, its face to +z)
  vec2 b = p / BALL; if (dot(b, b) > 1.) b = normalize(b);
  vec3 n = vec3(b, sqrt(max(0., 1. - dot(b, b))));
  vec3 f = uFace * n;
  // inside: not empty: a slow dark blue turning deep in it (on the ball, turning with it)
  float swirl = fbm(f * 1.5 + vec3(sin(t * .2), cos(t * .17), t * .25));
  vec3 deep = vec3(.002, .004, .012) + vec3(.01, .035, .1) * smoothstep(.1, .8, swirl) * (1. - r / max(edge, .01));
  // charred round the outside: a faint soot ring, so it reads against bright skies too
  float soot = smoothstep(edge + .3, edge, r) * (1. - inside) * .55;
  // and the cold fire's light caught on it, high on the side you see, so it reads round
  deep += vec3(.02, .07, .18) * pow(max(0., dot(n, normalize(vec3(-.45, .55, .7)))), 14.) * .5;
  // the back of its head: the light of its eyes come through it, dim, in a patch that turns round with it
  float nape = smoothstep(-.2, -.95, f.z) * (.85 + .15 * sin(t * 1.3));
  deep += vec3(.03, .11, .32) * nape * nape * (.7 + .5 * smoothstep(.3, .8, swirl));
  vec3 c = deep * inside + hot * (rim + glow) * .62; // (kept under the glow's threshold mostly: an ember, not a flare)
  // its eyes, in the dark, looking where it looks; a hotter middle to each, flickering with its edge
  // its eyes, on its face: drawn where it is turned (foreshortened round the ball, gone round the back)
  vec2 e = f.xy * BALL - vec2(0., .04) - uLook;
  float front = smoothstep(.2, .5, f.z);
  float w = .052 * uWide, h = .07 * uWide;
  float eyes = eye(e - vec2(-.15, 0.), w, h, uLid, uSmile) + eye(e - vec2(.15, 0.), w, h, uLid, uSmile);
  float core = exp(-dot(e - vec2(-.15, .01), e - vec2(-.15, .01)) * 900.) + exp(-dot(e - vec2(.15, .01), e - vec2(.15, .01)) * 900.);
  c += eyes * front * inside * mix(vec3(.32, .72, 1.), vec3(.86, .97, 1.), clamp(core, 0., 1.)) * (.78 + .1 * flick);
  float alpha = max(inside, max(soot, clamp(rim + glow, 0., 1.)));
  gl_FragColor = vec4(c * uShow, alpha * uShow);
}`;

// the smoke: soft round puffs, each its own size and darkness, lit warm from below while young
const SMOKE_VERT = /* glsl */ `attribute float aSize; attribute float aLife; attribute float aSeed; varying float vLife; varying float vSeed;
uniform float uScale;
void main(){ vLife = aLife; vSeed = aSeed; vec4 mv = modelViewMatrix * vec4(position, 1.); gl_PointSize = aSize * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`;
const SMOKE_FRAG = /* glsl */ `${NOISE_LIB}
uniform float uTime, uShow; varying float vLife; varying float vSeed;
void main(){
  if (vLife <= 0.) discard;
  vec2 q = gl_PointCoord * 2. - 1.;
  float wisp = .7 + .3 * snoise(vec3(q * 1.8 + vSeed * 7., uTime * .3 + vSeed));
  float a = smoothstep(1., .2, length(q)) * wisp;
  float age = 1. - vLife;
  vec3 c = mix(vec3(.12, .3, .55), vec3(.085, .1, .13), smoothstep(0., .35, age)); // the cold fire's light on it, then a blue grey mist
  gl_FragColor = vec4(c, a * smoothstep(0., .12, age) * vLife * .16 * uShow);
}`;

// the notes: four of them drawn on one picture (a crotchet, a quaver, two beamed, two beamed twice), each
// point showing its own, tipped as it sways, fading as it rises
const NOTE_VERT = /* glsl */ `attribute float aLife; attribute float aKind; attribute float aTilt; varying float vLife; varying float vKind; varying float vTilt;
uniform float uScale;
void main(){ vLife = aLife; vKind = aKind; vTilt = aTilt; vec4 mv = modelViewMatrix * vec4(position, 1.); gl_PointSize = ${NOTE_SIZE.toFixed(1)} * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`;
const NOTE_FRAG = /* glsl */ `uniform sampler2D uMap; uniform float uShow; varying float vLife; varying float vKind; varying float vTilt;
void main(){
  if (vLife <= 0.) discard;
  vec2 q = gl_PointCoord - .5, r = vec2(cos(vTilt) * q.x - sin(vTilt) * q.y, sin(vTilt) * q.x + cos(vTilt) * q.y) + .5;
  if (r.x < 0. || r.x > 1. || r.y < 0. || r.y > 1.) discard;
  float a = texture2D(uMap, (r + vec2(mod(vKind, 2.), floor(vKind / 2.))) * .5).a;
  float age = 1. - vLife;
  gl_FragColor = vec4(mix(vec3(.75, .95, 1.), vec3(.35, .7, 1.), age), a * smoothstep(0., .1, age) * min(1., vLife * 2.) * uShow);
}`;
function notePicture() {
  const canvas = Object.assign(document.createElement("canvas"), { width: 256, height: 256 }), ctx = canvas.getContext("2d");
  ctx.fillStyle = ctx.strokeStyle = "#fff";
  ctx.lineCap = "round";
  const head = (x, y) => { ctx.beginPath(); ctx.ellipse(x, y, 15, 10.5, -0.45, 0, Math.PI * 2); ctx.fill(); };
  const stem = (x, y) => { ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(x + 13, y - 3); ctx.lineTo(x + 13, y - 70); ctx.stroke(); };
  const beam = (x0, x1, y) => { ctx.lineWidth = 9; ctx.lineCap = "butt"; ctx.beginPath(); ctx.moveTo(x0 + 11, y); ctx.lineTo(x1 + 15, y - 6); ctx.stroke(); ctx.lineCap = "round"; };
  // (each in its own quarter, 128 square)
  head(58, 96); stem(58, 96);
  head(186, 96); stem(186, 96);
  ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(199, 26); ctx.bezierCurveTo(222, 40, 230, 56, 214, 80); ctx.stroke();
  head(34, 228); stem(34, 228); head(84, 220); stem(84, 220); beam(34, 84, 158 + 3);
  head(162, 228); stem(162, 228); head(212, 220); stem(212, 220); beam(162, 212, 161); beam(162, 212, 179);
  const map = new THREE.CanvasTexture(canvas);
  map.flipY = false; // (its rows as gl_PointCoord counts them, from the top)
  return map;
}

const ahead = new THREE.Vector3(), to = new THREE.Vector3(), spot = new THREE.Vector3(), yawOnly = new THREE.Euler(0, 0, 0, "YXZ");
const seg = new THREE.Line3(), near = new THREE.Vector3(), drift = new THREE.Vector3();
const QUIET = { bass: 0, mid: 0, high: 0, beat: 0 };
const ZERO = new THREE.Vector2(), DOWN = new THREE.Vector2(0, -0.035), side = new THREE.Vector2(), shake = new THREE.Vector3();
const words = new THREE.Vector3(), up = new THREE.Vector3();
const pullV = new THREE.Vector3(), moved = new THREE.Vector3(), step = new THREE.Vector3(), toIt = new THREE.Vector3();
const gazer = new THREE.Object3D(), turnedQ = new THREE.Quaternion(), faceQ = new THREE.Quaternion(), seenQ = new THREE.Quaternion(), faceM = new THREE.Matrix4(), local = new THREE.Vector3(), fromYou = new THREE.Vector3();
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

export class Back {
  // name(realm, room): what a place is called, for the name under the crosshair; textEl: where it speaks;
  // heading(): the way the view is turning to (it eases round: see main.js face); sights(): where the
  // things round you are (portals, ways out), for it to look at now and then
  constructor({ scene, world, name, textEl, toOrigin, heading, sights, music }) {
    Object.assign(this, { world, name, textEl, heading, sights, music }); // (music(): whether music plays: its notes)
    this.gaze = new THREE.Vector3(); // what it looks at, looking away from you (see wonder)
    this.turned = 0;                 // 0 to 1: how far its face is turned to it
    this.greeting = null; // { text, at (when it is said; null till it has come), by (given up on after) } (see greet)
    this.places = [];
    this.recent = []; // where you have been these last seconds: { t, position, yaw, pitch }
    this.time = 0;
    this.here = null;
    this.returning = false;
    this.toOrigin = !!toOrigin; // where it takes you: back (false), or to the origin (see next)
    this.shown = 0;   // 0 to 1: it comes and goes softly
    this.open = 0;    // 0 to 1: its mouth opening as you fly into it
    this.approach = 0; // how fast you come at it (eased: a frame without moving does not undo it)
    this.into = 0;    // 0 to 1: how surely you are going into it (eased)
    this.closer = 0;  // how fast you near it, its own drifting taken out (eased)
    this.fade = 0;    // the dark as you go in (main.js draws it)
    this.home = new THREE.Vector3();     // where it would float (eased towards you)
    this.post = null;                    // a place it waits at instead, not following you (a plugin's, set each frame: a stage of its own)
    this.terrified = false;              // a plugin's say, set each frame: it is afraid (a haunted house), its eyes wide and darting; 2, frantic
    this.joy = false;                    // a plugin's say, set each frame: it is overjoyed (on a plugin's platform as a song is filmed), its eyes two happy arches
    this.chill = false;                  // a plugin's say, set each frame: it is at its ease where it is (in a corner of a plugin's platform as a song is played or watched)
    this.sees = null;                    // a plugin's say, set each frame: what it watches there, chilling (points in the world, the first the most)
    this.pin = null;                     // a plugin's: exactly where it is this frame (it does not travel there: at the side of your view, never through a wall)
    this.size = 1;                       // a plugin's: how big it is (and its smoke, its embers, the dark you click), set each frame
    this.speed = new THREE.Vector3();    // and how it is going, beside you (see place)
    this.keen = 1.7;
    this.carry = 1;
    this.pace = 0;    // how fast you are going, eased
    this.position = new THREE.Vector3(); // where it is, bobbing (the flight into it follows this: see flyIntoPortal)
    this.lastCam = null;

    const G = world.G;
    this.mouth = new THREE.Mesh(new THREE.PlaneGeometry(MOUTH, MOUTH), new THREE.ShaderMaterial({
      uniforms: {
        uTime: G.uTime, uShow: { value: 0 }, uOpen: { value: 0 },
        uLid: { value: 0.15 }, uWide: { value: 1 }, uSmile: { value: 0 }, uLook: { value: new THREE.Vector2() },
        uFace: { value: new THREE.Matrix3() },
      },
      vertexShader: MOUTH_VERT, fragmentShader: MOUTH_FRAG,
      transparent: true, depthWrite: false,
    }));
    this.mouth.frustumCulled = false;
    this.mouth.visible = false;
    scene.add(this.mouth);

    // smoke and embers live in the world, not on it: it moves on, and what it gave off stays behind
    this.puffs = Array.from({ length: SMOKE }, () => ({ life: 0, span: 1, v: new THREE.Vector3(), grow: 0 }));
    this.puffNext = 0;
    this.puffAt = 0;
    const smoke = new THREE.BufferGeometry();
    smoke.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SMOKE * 3), 3));
    smoke.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(SMOKE), 1));
    smoke.setAttribute("aLife", new THREE.BufferAttribute(new Float32Array(SMOKE), 1));
    smoke.setAttribute("aSeed", new THREE.BufferAttribute(Float32Array.from({ length: SMOKE }, Math.random), 1));
    this.smoke = new THREE.Points(smoke, new THREE.ShaderMaterial({
      uniforms: { uTime: G.uTime, uShow: { value: 0 }, uScale: { value: 1 } }, vertexShader: SMOKE_VERT, fragmentShader: SMOKE_FRAG,
      transparent: true, depthWrite: false,
    }));
    this.smoke.frustumCulled = false;
    this.smoke.visible = false;
    scene.add(this.smoke);

    this.sparks = Array.from({ length: EMBERS }, () => ({ life: 0, v: new THREE.Vector3() }));
    this.sparkAt = 0;
    const embers = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(EMBERS * 3), 3));
    const dot = Object.assign(document.createElement("canvas"), { width: 32, height: 32 }), ctx = dot.getContext("2d"), g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,255,255,.5)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    this.embers = new THREE.Points(embers, new THREE.PointsMaterial({ map: new THREE.CanvasTexture(dot), color: new THREE.Color(0.5, 0.85, 1), size: 3.2, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.embers.frustumCulled = false;
    this.embers.visible = false;
    scene.add(this.embers);

    this.tunes = Array.from({ length: NOTES }, () => ({ life: 0, span: 1, v: new THREE.Vector3(), sway: 0, seed: 0 }));
    this.noteAt = 0;
    const notes = new THREE.BufferGeometry();
    notes.setAttribute("position", new THREE.BufferAttribute(new Float32Array(NOTES * 3), 3));
    notes.setAttribute("aLife", new THREE.BufferAttribute(new Float32Array(NOTES), 1));
    notes.setAttribute("aKind", new THREE.BufferAttribute(new Float32Array(NOTES), 1));
    notes.setAttribute("aTilt", new THREE.BufferAttribute(new Float32Array(NOTES), 1));
    this.notes = new THREE.Points(notes, new THREE.ShaderMaterial({
      uniforms: { uMap: { value: notePicture() }, uShow: { value: 0 }, uScale: { value: 1 } }, vertexShader: NOTE_VERT, fragmentShader: NOTE_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.notes.frustumCulled = false;
    this.notes.visible = false;
    scene.add(this.notes);
  }

  // where you are: the dimension, and the room of the viewer that dimension is (a plugin's viewers)
  where() {
    const realm = this.world.realm, viewer = (window.vvoid?.viewers ?? []).find((v) => v.realm === realm) ?? null, room = viewer?.room ?? null;
    return { key: `${realm}|${room?.key ?? ""}`, realm, viewer, room };
  }

  // the place it goes to, if any: back, or (right clicked: see main.js) to the origin, from anywhere but
  // the hub, facing the clock as at the start
  get next() {
    if (!this.toOrigin) return this.places.at(-1) ?? null;
    if (this.atHub()) return null;
    const at = new THREE.Vector3(...SPAWN), length = at.length() || 1;
    return { origin: true, realm: "void", viewer: null, room: null, name: "the origin", position: at, yaw: Math.atan2(at.x, at.z), pitch: Math.asin(-at.y / length) };
  }
  get label() { return NAME; }
  get ready() { return this.shown > 0.5; }

  // the hub sector of the void itself, where it is with you even before you have been anywhere
  atHub() { return this.world.realm === "void" && this.world.currentKey === "0,0,0"; }

  // the traveller's name: said beside it a moment after it has come (and not at all if it has not come soon)
  greet(name) {
    this.greeting = { text: GREETINGS[Math.floor(Math.random() * GREETINGS.length)](name), at: null, by: this.time + GREET_WAIT };
  }

  // a word or two of its own (as it watches along: see watch.js), said at once, for this long
  say(text, seconds = 2.4) {
    if (!this.greeting) this.remark = { text, at: this.time, for: seconds };
  }

  // its greeting (or a remark), while it is said: beside it, above its mouth, wherever it is on the screen
  speak(dt, camera, visible) {
    const g = this.greeting ?? this.remark, el = this.textEl;
    if (!g || !el) return;
    if (g.at === null) {
      if (visible && this.shown > 0.9) g.at = this.time + GREET_AFTER;
      else if (this.time > g.by) this.greeting = null;
      return;
    }
    const lasts = g.for ?? GREET_FOR;
    const saying = this.time >= g.at && this.time < g.at + lasts;
    if (this.time >= g.at && el.textContent !== g.text) el.textContent = g.text;
    words.copy(this.position).addScaledVector(up.set(0, 1, 0).applyQuaternion(camera.quaternion), MOUTH * 0.45 * this.mouth.scale.x).project(camera);
    const onScreen = visible && words.z < 1 && Math.abs(words.x) < 1.1 && Math.abs(words.y) < 1.1;
    el.classList.toggle("show", saying && onScreen);
    if (onScreen) {
      const w = innerWidth, half = el.offsetWidth / 2 + 12; // (kept whole on the screen)
      el.style.left = `${THREE.MathUtils.clamp((words.x + 1) / 2 * w, half, w - half)}px`;
      el.style.top = `${(1 - words.y) / 2 * innerHeight}px`;
    }
    if (this.time >= g.at + lasts) {
      if (g === this.greeting) this.greeting = null;
      else this.remark = null;
      el.classList.remove("show");
    }
  }
  // taken: the place it goes to, no longer kept (and the jump there is not itself a place to go back to)
  // to the origin, or back again: it blinks, taking it in
  turn() {
    this.toOrigin = !this.toOrigin;
    if (this.mood) this.mood.blinkIn = 0;
    return this.toOrigin;
  }

  // (to the origin: where you were is kept as any other place left, to go back to)
  take() {
    if (this.toOrigin) return this.next;
    const place = this.places.pop() ?? null;
    if (place) this.returning = true;
    return place;
  }

  // Each frame: a jump noticed, and the companion floated along. True when you have flown into it.
  // drawn for a view: its disc facing that camera, its face turned as it faces (yours; or the idle
  // camera's, which shoots it from elsewhere: see cinema.js)
  viewFrom(camera) {
    this.mouth.quaternion.copy(camera.quaternion);
    faceM.makeRotationFromQuaternion(seenQ.copy(faceQ).invert().multiply(camera.quaternion)); // (as it is seen, to as its face is)
    this.mouth.material.uniforms.uFace.value.setFromMatrix4(faceM);
  }

  update(dt, camera, started) {
    this.time += dt;
    const here = this.where(), last = this.recent.at(-1);
    const jumped = this.here && (here.key !== this.here.key || (last && last.position.distanceTo(camera.position) > FAR));
    if (jumped) {
      if (this.returning) this.returning = false;
      else if (started && last) {
        // where you were BEFORE seconds ago (or as long ago as is known)
        const then = this.recent.findLast((r) => r.t <= this.time - BEFORE) ?? this.recent[0];
        this.places.push({ realm: this.here.realm, viewer: this.here.viewer, room: this.here.room, name: this.name(this.here.realm, this.here.room), position: then.position, yaw: then.yaw, pitch: then.pitch });
        if (this.places.length > KEEP) this.places.shift();
        this.place(camera, true);
        this.clearSmoke();
        if (this.mood) this.mood.born = this.time; // (wide eyed again: somewhere new)
      }
      this.recent = [];
      this.lastCam = null;
    }
    this.here = here;
    if (!this.recent.length || this.time - this.recent.at(-1).t > 0.2) {
      this.recent.push({ t: this.time, position: camera.position.clone(), yaw: camera.rotation.y, pitch: camera.rotation.x });
      if (this.recent.length > 40) this.recent.shift();
    }

    // (there once there is somewhere to go back to, in the hub, or wherever a plugin keeps it: company, at least)
    const want = started && (this.next || this.atHub() || this.pin) ? 1 : 0;
    if (want && this.shown <= 0.01) this.place(camera, true); // (coming, it comes at your side, not from wherever it was last)
    this.shown += (want - this.shown) * Math.min(1, dt * 2.5);
    const visible = this.shown > 0.01;
    this.mouth.visible = this.smoke.visible = this.embers.visible = this.notes.visible = visible;
    let through = false;
    if (visible) {
      // It floats towards its place at your side, unhurried. Never long in front of what you look at:
      // before it a moment (left behind as you turned, or drifted there) and not aimed at, it moves aside,
      // quickly. The crosshair put on it (in that moment, turning to it), clicked, or come near: it waits.
      to.copy(this.position).sub(camera.position);
      const distance = to.length() || 1;
      const facing = camera.getWorldDirection(ahead).dot(to.divideScalar(distance));
      const onIt = facing > Math.cos(Math.atan((BACK_HOLE * 1.3) / distance));
      this.dwell = onIt ? (this.dwell ?? 0) + dt : 0;
      const headingAt = THREE.MathUtils.smoothstep(facing, 0.94, 0.985); // (going its way, not just on past it)
      // regarded (aimed at, near the crosshair, or turned to), it goes on waiting a moment after, so its own
      // drifting off the crosshair does not send it off as if it were in the way
      const nearCrosshair = facing > Math.cos(Math.atan((BACK_HOLE * 3) / distance));
      // (on its way aside, its own passing under the crosshair is not your aiming at it)
      const aside = (this.before ?? 0) > 0.6;
      // a tour flying you (a plugin's: see main.js), it is not being come to, only passed: it does not wait
      // for the view the tour turns over it, keeps out of the tour's way, and is not gone through
      const touring = this.touring && !this.held;
      // on foot, in a plugin's dimension that moves you itself (afoot, set each frame), it is as
      // ever, but not gone through by running into it: only clicked
      const passable = this.afoot && !this.held;
      // at its post (a plugin's: see post), it goes there and stays, neither following you nor going aside
      const posted = !!this.post && !this.held;
      // turning to it: the crosshair brought nearer it by your turning (not by its own drifting), from
      // within a good way round it. It waits for you then, before you are on it, to be clicked.
      const off = Math.acos(THREE.MathUtils.clamp(facing, -1, 1));
      const wasOff = this.lastDir ? Math.acos(THREE.MathUtils.clamp(this.lastDir.dot(to), -1, 1)) : off; // (to: the way to it now)
      // (within ~43 degrees, turning to it at 2 a second or more; not flying fast, when a turn its way would
      // leave it waiting, far behind at once: then only the crosshair on it)
      const drifting = 1 - THREE.MathUtils.smoothstep(this.pace, 250, 700);
      const seeking = dt > 0 && drifting > 0.5 && off < 0.75 && (wasOff - off) / dt > 0.04;
      (this.lastDir ??= new THREE.Vector3()).copy(ahead);
      this.regard = ((onIt || seeking) && !aside && !touring) || (nearCrosshair && this.regard > 0) ? 1.5 : Math.max(0, (this.regard ?? 0) - dt); // (near the crosshair keeps a regard, never begins one)
      // (how far you went this frame, exactly: carried that far, it keeps by you at any pace, through any stall)
      if (this.lastCam) moved.copy(camera.position).sub(this.lastCam);
      else moved.set(0, 0, 0);
      if (dt > 0) this.pace += (moved.length() / dt - this.pace) * Math.min(1, dt * 4);
      // come near it, drifting, it waits; but swept near you as you turn at speed, it is not being come to
      // (waiting then, it would be left far behind at once)
      const waits = this.held || (!touring && (this.regard > 0 || (distance < 160 && drifting > 0.5) || (this.approach > 40 && headingAt > 0.5)));
      // (on a tour: your way, as it is to it, leading near it: out of it at once)
      let onWay = false;
      if (touring && this.lastPos) {
        step.copy(moved).sub(this.position).add(this.lastPos);
        const going = step.length(), along = going > 1e-6 ? step.dot(to) / going : 0;
        onWay = along > 0 && distance * Math.sqrt(Math.max(0, 1 - along * along)) < BACK_HOLE * 5 && distance < 1500;
      }
      this.before = (facing > CLEAR_OF || onWay) && !waits && !posted ? (this.before ?? 0) + dt * (onWay ? 4 : 1) : 0; // (how long it has been before you, not aimed at)
      const inTheWay = this.before > 0.6;
      // going aside: to whichever side of what you see it is on already (never across the middle), and
      // keeping to that side after
      if (inTheWay && !aside) this.side = spot.copy(this.position).project(camera).x >= 0 ? 1 : -1;
      // how keenly it goes to its place (eased from one way of going to another, never switched at once),
      // and how much it keeps your pace (none while it waits: it stays where it is, to be flown into)
      const keen = posted ? (this.home.distanceTo(this.post) > 3000 ? 4 : 2) : waits ? 0 : distance > 3000 ? 4 : inTheWay ? 3.2 : 1.7 * THREE.MathUtils.lerp(1, THREE.MathUtils.smoothstep(distance, 160, 420), drifting);
      this.keen += (keen - this.keen) * Math.min(1, dt * 2.5);
      this.carry += ((waits || posted ? 0 : 1) - this.carry) * Math.min(1, dt * 2.5);
      this.place(camera, false, dt, moved);
      const follow = this.carry;
      // bobbing as it hovers, a slow small circling with it
      // (less while it waits for you: it is easier to fly into)
      this.position.copy(this.home).add(drift.set(Math.sin(this.time * 0.7) * 9, Math.sin(this.time * 1.3) * 11, Math.cos(this.time * 0.9) * 7).multiplyScalar(0.3 + 0.7 * follow));
      // pinned (a plugin's: see pin), it is there, only bobbing a little, as small as it is
      if (this.pin && !this.held) {
        this.home.copy(this.pin);
        this.position.copy(this.pin).add(drift.multiplyScalar(0.25 * this.size));
      }

      // coming at it (how fast you near it, in the world: see waits)
      const towards = this.lastCam && dt > 0 ? ahead.copy(camera.position).sub(this.lastCam).dot(to) / dt : 0; // (to: the way to it, from you)
      this.approach += (towards - this.approach) * Math.min(1, dt * 4);
      // going into it: your way as it is to it (its own bobbing and drifting taken out), leading into its
      // mouth, not just near it. Then its mouth opens round you and the dark gathers, steadily the
      // nearer you are, all the way in: it does not swell at the last, nor falter as it bobs off your line.
      let into = 0, closer = 0;
      if (this.next && !touring && !passable && this.lastCam && this.lastPos && dt > 0) {
        step.copy(camera.position).sub(this.lastCam).sub(this.position).add(this.lastPos);
        toIt.copy(this.position).sub(camera.position);
        const going = step.length();
        if (going > 1e-6) {
          closer = step.dot(toIt) / (toIt.length() || 1) / dt;
          const miss = toIt.cross(step.divideScalar(going)).length(); // (how far from its middle your way goes)
          into = THREE.MathUtils.smoothstep(closer, 10, 60) * (1 - THREE.MathUtils.smoothstep(miss, BACK_HOLE * 1.5, BACK_HOLE * 4));
        }
      }
      this.into += (into - this.into) * Math.min(1, dt * (3 + Math.max(0, closer) / 100)); // (sooner sure, the faster you come)
      this.closer += (closer - this.closer) * Math.min(1, dt * 8);
      const nearing = Math.max(this.closer, closer);
      const soon = nearing > 1 ? (distance - REACH) / nearing : Infinity; // (seconds till you are through)
      this.open = this.into * (1 - THREE.MathUtils.smoothstep(distance, REACH, BACK_HOLE * 12));
      // (wholly dark as you are through: the nearer, or, flying fast, the sooner)
      this.fade = this.into * Math.max(1 - THREE.MathUtils.smoothstep(distance, REACH, BACK_HOLE * 7), 1 - THREE.MathUtils.smoothstep(soon, 0.03, 0.4));
      const closing = this.into;
      this.feel(dt, camera, { distance, onIt, closing });
      this.mouth.position.copy(this.position);
      if (this.terrified > 1) this.mouth.position.add(shake.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(5 * this.size)); // (frantic: shaking)
      // (a ball looks round from anywhere: drawn facing you, and its face turned on it, see wonder)
      faceQ.copy(camera.quaternion);
      if (this.turned > 0.001) {
        gazer.position.copy(this.position);
        gazer.lookAt(this.gaze);
        faceQ.slerp(turnedQ.copy(camera.quaternion).rotateTowards(gazer.quaternion, TURNS), this.turned);
      }
      this.viewFrom(camera);
      this.mouth.scale.setScalar((0.25 + 0.75 * this.shown) * (1 + OPENS * this.open) * this.size);
      this.mouth.material.uniforms.uShow.value = this.shown;
      this.mouth.material.uniforms.uOpen.value = this.open;

      // through: its mouth reached (the whole way since the last frame, so no flight is too fast for it)
      if (this.next && !touring && !passable && this.shown > 0.9 && this.lastCam) {
        seg.set(this.lastCam, camera.position);
        through = seg.closestPointToPoint(this.position, true, near).distanceTo(this.position) < Math.max(BACK_HOLE * 0.8, REACH * this.open);
      }
    } else {
      this.open = this.fade = this.approach = this.into = this.closer = 0;
    }
    this.lastPos = (this.lastPos ?? new THREE.Vector3()).copy(this.position);
    this.burn(dt, camera, visible);
    this.speak(dt, camera, visible);
    this.lastCam = (this.lastCam ?? new THREE.Vector3()).copy(camera.position);
    return through;
  }

  // How it is, and so its eyes: wide or narrowed, lids, a smile, where it looks, and its blinking
  feel(dt, camera, { distance, onIt, closing }) {
    const u = this.mouth.material.uniforms, m = (this.mood ??= { lid: 0.15, wide: 1, smile: 0, look: new THREE.Vector2(), glance: new THREE.Vector2(), glanceIn: 0, blinkIn: 3, blink: 0, still: 0, speed: 0, born: this.time });
    m.speed += ((this.lastCam && dt > 0 ? this.lastCam.distanceTo(camera.position) / dt : 0) - m.speed) * Math.min(1, dt * 3);
    m.still = m.speed < 8 ? m.still + dt : 0;
    // waiting for where you are: not yet there at all, or Claude still writing its sky
    const spec = this.world.currentSpec;
    m.waited = !spec || spec.partial ? (m.waited ?? 0) + dt : 0;
    // where it would look: about it (its glances), at you (the middle of its face), or the way you go
    if ((m.glanceIn -= dt) <= 0) {
      m.glanceIn = THREE.MathUtils.randFloat(1.2, 3.6);
      m.glance.set(THREE.MathUtils.randFloat(-0.055, 0.055), THREE.MathUtils.randFloat(-0.03, 0.04));
    }
    const ahead2 = spot.copy(this.position).project(camera); // (where it is on the screen: the way to the middle is the way you go)
    const towardYou = new THREE.Vector2(-ahead2.x, -ahead2.y).normalize().multiplyScalar(0.05);
    let lid = 0.18, wide = 1, smile = 0, look = m.glance, mood = "calm";
    if (this.terrified && !(closing > 0.4 || this.open > 0.3)) {
      // terrified (a plugin's say: a haunted house): its eyes as wide as they go, darting about, back to you,
      // away again, never still, trembling. Frantic (terrified 2: something is right behind you): flipping
      // between terror and fury, wide and then narrowed to a glare, darting several times as fast, shaking
      const frantic = this.terrified > 1;
      mood = frantic ? "frantic" : "terrified"; lid = 0; wide = 1.5;
      if (frantic) {
        if ((m.furyIn = (m.furyIn ?? 0) - dt) <= 0) { m.furyIn = THREE.MathUtils.randFloat(0.25, 0.8); m.fury = !m.fury; }
        lid = m.fury ? 0.4 + 0.06 * Math.sin(this.time * 31) : 0;
        wide = m.fury ? 1.25 : 1.75;
      }
      if ((m.dartIn = (m.dartIn ?? 0) - dt) <= 0) {
        m.dartIn = frantic ? THREE.MathUtils.randFloat(0.05, 0.2) : THREE.MathUtils.randFloat(0.12, 0.6);
        m.dart = Math.random() < 0.4 ? towardYou.clone().multiplyScalar(0.6) : new THREE.Vector2(THREE.MathUtils.randFloat(-0.06, 0.06), THREE.MathUtils.randFloat(-0.04, 0.04));
      }
      const tremble = frantic ? 0.016 : 0.006;
      look = side.copy(m.dart ?? ZERO).add(new THREE.Vector2(Math.sin(this.time * 37) * tremble, Math.cos(this.time * 43) * tremble * 0.85));
      if (m.blinkIn < 4) m.blinkIn = 4 + Math.random() * 4; // (it hardly dares blink)
    }
    else if (closing > 0.4 || this.open > 0.3) { mood = "happy"; lid = 0; wide = 1.1; smile = 1; look = ZERO; }
    else if (this.greeting?.at != null && this.time >= this.greeting.at) { mood = "greeting"; lid = 0; wide = 1.15; smile = 1; look = towardYou.multiplyScalar(0.4); }
    else if (this.joy) {
      // overjoyed (a plugin's say): its eyes two wide happy arches, looking all about it, delighted
      mood = "overjoyed"; lid = 0; wide = 1.25 + 0.06 * Math.sin(this.time * 5.3); smile = 1;
      look = side.set(Math.sin(this.time * 2.3) * 0.03, 0.012 + Math.abs(Math.sin(this.time * 4.1)) * 0.015);
    }
    else if (this.chill) {
      // chilling (a plugin's say): happy, its eyes two arches, watching what goes on there (sees: a plugin's, whoever
      // plays and down the track), its face turned to it and not to you
      mood = "chilling"; lid = 0; wide = 1.1; smile = 1;
      look = this.watchNow(dt) ? side.copy(this.awayTo(camera)) : ZERO;
    }
    else if (this.watching) {
      // on a tour, at a post: watching it with you (a test: see watch.js)
      const w = (this.watch ??= new Watching()).update(dt, this.watching, this.heard ?? QUIET, towardYou);
      mood = `watching: ${w.name}`; lid = w.lid; wide = w.wide; smile = w.smile; look = w.look;
      if (w.say) this.say(w.say);
    }
    else if (this.time - m.born < 2.2) { mood = "new"; lid = 0; wide = 1.3; if (m.glanceIn > 0.6) m.glanceIn = 0.6; }
    else if (m.waited > BORED) {
      // annoyed: a flat look sideways at you, and now and then its eyes rolled up and over, lids lifting
      // as they go (the longer it waits, the sooner again)
      mood = "annoyed"; lid = 0.44; wide = 0.95; look = side.copy(towardYou).multiplyScalar(0.8);
      m.rollIn ??= 2;
      if ((m.rollIn -= dt) <= 0) { m.roll = 0; m.rollIn = THREE.MathUtils.randFloat(2.5, 6) * Math.max(0.4, 1 - (m.waited - BORED) / 60); }
      if (m.roll !== undefined && m.roll < 1) {
        m.roll = Math.min(1, m.roll + dt / 0.9);
        const a = m.roll * Math.PI; // (up, round, and down the other side)
        look = side.set(-Math.cos(a) * 0.05, Math.sin(a) * 0.05);
        lid = 0.44 - 0.34 * Math.sin(a);
      }
    }
    else if (onIt) { mood = "seen"; lid = 0.04; wide = 1.15; smile = 0.3; look = ZERO; }
    else if (distance > 900) { mood = "behind"; lid = 0; wide = 1.28; look = towardYou; }
    else if (m.speed > 700) { mood = "fast"; lid = 0.46; look = towardYou; }
    else if (m.still > 20) { mood = "drowsy"; lid = 0.66 + 0.22 * Math.max(0, Math.sin(this.time * 0.6)); look = DOWN; }
    else if (this.wonder(dt, camera)) { mood = "curious"; lid = 0.05; wide = 1.12; look = side.copy(m.away).addScaledVector(m.glance, 0.35); }
    if (mood !== "curious" && m.sight) { m.sight = false; m.wonderIn = rand(...LOOKS); } // (anything else, and it is back to you)
    this.moodName = mood;
    // its face turned to what it looks at: slowly away, back to you quickly
    const away = mood === "curious" || (mood === "chilling" && !!this.sees?.length);
    this.turned += ((away ? 1 : 0) - this.turned) * Math.min(1, dt * (away ? 2.2 : 6));
    const ease = Math.min(1, dt * 5);
    m.lid += (lid - m.lid) * ease;
    m.wide += (wide - m.wide) * ease;
    m.smile += (smile - m.smile) * Math.min(1, dt * 7);
    m.look.lerp(look, Math.min(1, dt * (mood === "new" ? 10 : mood === "frantic" ? 28 : mood === "terrified" ? 16 : 6)));
    // blinking: now and then, sometimes twice; slowly, when drowsy
    if ((m.blinkIn -= dt) <= 0) {
      m.blink = mood === "drowsy" ? 0.5 : 0.15;
      m.blinkFor = m.blink;
      m.blinkIn = mood === "drowsy" ? THREE.MathUtils.randFloat(1.5, 3) : Math.random() < 0.2 ? 0.3 : THREE.MathUtils.randFloat(2.4, 6);
    }
    let shut = 0;
    if (m.blink > 0) {
      m.blink -= dt;
      shut = Math.sin((1 - Math.max(0, m.blink) / m.blinkFor) * Math.PI);
    }
    u.uLid.value = Math.max(m.lid, shut * (1 - m.smile));
    u.uWide.value = m.wide;
    u.uSmile.value = m.smile;
    u.uLook.value.copy(m.look);
  }

  // Now and then, calm, it looks away from you a while and checks something out: a portal or a way out
  // near it, or only somewhere off in the dark, away from you. Its eyes go first, then it turns round
  // after them, its back to you if that is where it looks (and back to you after, or at once if anything else comes up). True while it looks.
  wonder(dt, camera) {
    const m = this.mood;
    m.wonderIn ??= rand(...LOOKS);
    if (!m.sight) {
      if ((m.wonderIn -= dt) > 0) return false;
      const near = (this.sights?.() ?? []).filter((at) => { const d = at.distanceTo(this.position); return d > 200 && d < 6000; });
      if (near.length && Math.random() < 0.7) this.gaze.copy(near[Math.floor(Math.random() * near.length)]);
      else {
        // (off into the dark: anywhere, but leaning away from you)
        local.randomDirection().addScaledVector(fromYou.copy(this.position).sub(camera.position).normalize(), 0.7).normalize();
        this.gaze.copy(this.position).addScaledVector(local, 2000);
      }
      m.sight = true;
      m.sightFor = rand(...LOOK_FOR);
      if (Math.random() < 0.12) this.say(["hm?", "ooh", "what's that", "..."][Math.floor(Math.random() * 4)], 1.6);
    }
    if ((m.sightFor -= dt) <= 0) {
      m.sight = false;
      m.wonderIn = rand(...LOOKS);
      return false;
    }
    this.awayTo(camera);
    return true;
  }
  // where its eyes look, at what it looks at (gaze): the way to it, as its face is when turned all it turns
  awayTo(camera) {
    const m = this.mood;
    gazer.position.copy(this.position);
    gazer.lookAt(this.gaze);
    turnedQ.copy(camera.quaternion).rotateTowards(gazer.quaternion, TURNS).invert();
    local.copy(this.gaze).sub(this.position).normalize().applyQuaternion(turnedQ);
    (m.away ??= new THREE.Vector2()).set(local.x, local.y).multiplyScalar(0.08);
    if (m.away.length() > 0.06) m.away.setLength(0.06);
    return m.away;
  }
  // chilling, what it watches (a plugin's sees): the first most of the time, now and then another, a few
  // seconds each. True while it has something to watch
  watchNow(dt) {
    const m = this.mood, sees = this.sees;
    if (!sees?.length) return false;
    m.seesIn = (m.seesIn ?? 0) - dt;
    if (m.seesIn <= 0 || !(m.seesI < sees.length)) {
      m.seesI = sees.length > 1 && Math.random() < 0.4 ? 1 + Math.floor(Math.random() * (sees.length - 1)) : 0;
      m.seesIn = rand(2.5, 6);
    }
    this.gaze.copy(sees[m.seesI]);
    return true;
  }

  // its smoke and embers: given off at its edge, rising and spreading, left behind as it moves
  burn(dt, camera, giving) {
    const puffs = this.smoke.geometry.attributes, mouth = (MOUTH * 0.25) * this.mouth.scale.x;
    this.puffAt -= dt;
    while (giving && this.puffAt <= 0) {
      this.puffAt += 1 / 13;
      const puff = this.puffs[this.puffNext], i = this.puffNext;
      this.puffNext = (this.puffNext + 1) % SMOKE;
      const a = Math.random() * Math.PI * 2;
      // from its edge, as seen from you (round it on the screen), a little towards you
      spot.set(Math.cos(a) * mouth, Math.sin(a) * mouth, 4).applyQuaternion(camera.quaternion).add(this.position);
      puffs.position.setXYZ(i, spot.x, spot.y, spot.z);
      puff.v.set(rand(-6, 6), rand(14, 30), rand(-6, 6)).add(spot.sub(this.position).multiplyScalar(0.25));
      puff.span = rand(1.6, 2.6);
      puff.life = 1;
      puff.grow = rand(22, 36);
      puffs.aSize.setX(i, rand(30, 42)); // (larger than the gaps between them: a haze, not dots)
    }
    for (let i = 0; i < SMOKE; i++) {
      const puff = this.puffs[i];
      if (puff.life <= 0) { puffs.aLife.setX(i, 0); continue; }
      puff.life -= dt / puff.span;
      puff.v.multiplyScalar(Math.exp(-0.5 * dt));
      puffs.position.setXYZ(i, puffs.position.getX(i) + puff.v.x * dt, puffs.position.getY(i) + puff.v.y * dt, puffs.position.getZ(i) + puff.v.z * dt);
      puffs.aSize.setX(i, puffs.aSize.getX(i) + puff.grow * dt);
      puffs.aLife.setX(i, Math.max(0, puff.life));
    }
    puffs.position.needsUpdate = puffs.aSize.needsUpdate = puffs.aLife.needsUpdate = true;
    this.smoke.material.uniforms.uShow.value = this.shown;
    this.smoke.material.uniforms.uScale.value = this.size * (this.world.renderer?.domElement.height ?? window.innerHeight) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    this.embers.material.size = 3.2 * this.size;

    // embers: now and then one breaks off the edge and drifts up, dimming (while music plays, a note instead)
    this.musicFor = this.music?.() ? (this.musicFor ?? 0) + dt : 0;
    const sparks = this.embers.geometry.attributes.position, music = this.musicFor > NOTES_AFTER;
    this.sparkAt -= dt;
    if (giving && !music && this.sparkAt <= 0) {
      this.sparkAt = rand(0.08, 0.3);
      const i = this.sparks.findIndex((s) => s.life <= 0);
      if (i >= 0) {
        const a = Math.random() * Math.PI * 2;
        spot.set(Math.cos(a) * mouth, Math.sin(a) * mouth, 2).applyQuaternion(camera.quaternion).add(this.position);
        sparks.setXYZ(i, spot.x, spot.y, spot.z);
        this.sparks[i].v.set(rand(-10, 10), rand(20, 50), rand(-10, 10));
        this.sparks[i].life = 1;
      }
    }
    for (let i = 0; i < EMBERS; i++) {
      const s = this.sparks[i];
      if (s.life <= 0) { sparks.setXYZ(i, 0, -1e7, 0); continue; }
      s.life -= dt / 1.4;
      sparks.setXYZ(i, sparks.getX(i) + s.v.x * dt + Math.sin(this.time * 6 + i) * 4 * dt, sparks.getY(i) + s.v.y * dt, sparks.getZ(i) + s.v.z * dt);
    }
    sparks.needsUpdate = true;
    this.embers.material.opacity = this.shown * (0.7 + 0.3 * Math.sin(this.time * 9));

    // notes: off the edge as embers are, but more often and on the beat, rising further, swaying as they go
    const notes = this.notes.geometry.attributes, beat = this.world.G.uBeat?.value ?? 0;
    this.noteAt -= dt * (1 + beat * 3);
    if (giving && music && this.noteAt <= 0) {
      this.noteAt = rand(0.18, 0.45);
      const i = this.tunes.findIndex((n) => n.life <= 0);
      if (i >= 0) {
        const n = this.tunes[i], a = Math.random() * Math.PI * 2;
        spot.set(Math.cos(a) * mouth, Math.sin(a) * mouth, 3).applyQuaternion(camera.quaternion).add(this.position);
        notes.position.setXYZ(i, spot.x, spot.y, spot.z);
        n.v.set(rand(-12, 12), rand(26, 48), rand(-12, 12)).add(spot.sub(this.position).multiplyScalar(0.3));
        n.span = rand(1.8, 2.8);
        n.life = 1;
        n.sway = rand(0.3, 0.6) * (Math.random() < 0.5 ? -1 : 1);
        n.seed = Math.random() * 10;
        notes.aKind.setX(i, Math.floor(Math.random() * 4));
      }
    }
    for (let i = 0; i < NOTES; i++) {
      const n = this.tunes[i];
      if (n.life <= 0) { notes.aLife.setX(i, 0); continue; }
      n.life -= dt / n.span;
      n.v.multiplyScalar(Math.exp(-0.4 * dt));
      const wave = Math.sin(this.time * 3 + n.seed);
      notes.position.setXYZ(i, notes.position.getX(i) + n.v.x * dt + wave * 10 * dt, notes.position.getY(i) + n.v.y * dt, notes.position.getZ(i) + n.v.z * dt);
      notes.aLife.setX(i, Math.max(0, n.life));
      notes.aTilt.setX(i, wave * n.sway);
    }
    notes.position.needsUpdate = notes.aLife.needsUpdate = notes.aKind.needsUpdate = notes.aTilt.needsUpdate = true;
    this.notes.material.uniforms.uShow.value = this.shown;
    this.notes.material.uniforms.uScale.value = this.smoke.material.uniforms.uScale.value;
  }

  clearSmoke() {
    for (const puff of this.puffs) puff.life = 0;
    for (const s of this.sparks) s.life = 0;
    for (const n of this.tunes) n.life = 0;
  }

  // its place beside you (turned as you are, and tipped only as you look far up or down), at once or easing.
  // Turned as you will be once the view has eased round, not as you are this moment: come out of a portal
  // facing another way, it is put beside where you will look, not where you looked, which the view then
  // turns onto (and it would be in the middle of what you see)
  // It goes along with you, carried as far as you went (carry: how much; none while it waits), and
  // beside you it moves as a thing with weight does: drawn towards its place by a spring (keen: how
  // strongly), so it gathers speed and glides to a stop. However fast you go, it neither falls behind
  // nor overshoots: your speed is not its to catch up with, only where it is beside you.
  place(camera, now, dt = 0, moved = null) {
    // (and, looking far up or down, as a tour flying down does, tipped along past the first ~15 degrees, so
    // it stays in sight; near level it keeps level, calm as you look about)
    const pitch = camera.rotation.x, tip = Math.sign(pitch) * Math.max(0, Math.abs(pitch) - TIP_FREE);
    yawOnly.set(tip, this.heading?.() ?? camera.rotation.y, 0);
    if (this.post && !this.held) spot.copy(this.post); // (at its post: there, wherever you are)
    else spot.copy(SPOT).setX(Math.abs(SPOT.x) * (this.side ?? -1)).applyEuler(yawOnly).add(camera.position);
    if (now) {
      this.home.copy(spot);
      this.speed.set(0, 0, 0);
      return;
    }
    if (moved) this.home.addScaledVector(moved, this.carry);
    const k = this.keen, damp = Math.max(2 * k, 2.2);
    const pull = pullV.copy(spot).sub(this.home).multiplyScalar(k * k).addScaledVector(this.speed, -damp);
    this.speed.addScaledVector(pull, dt);
    this.home.addScaledVector(this.speed, dt);
  }
}
