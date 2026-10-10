// Light worms: a few small lights that wander the dark round you on long, slow curves, each drawing a
// soft trail behind it that thins and fades, and each blinking now and then like a firefly. Part of the
// void's look (and of a dimension's that asks for it: see World.enter); while a light show lights the
// blocks in the sky (saber's), each answers one of its five groups of lights, in its colour, brighter
// and a little quicker as it flares.
// How many, how fast, how long their trails and the rest: look.worm* (see look.js), an admin's to turn.
import * as THREE from "three";
import { look } from "./look.js";

const COUNT = 64;          // at most (look.wormCount of them are out)
const SAMPLES = 80;        // trail points kept, one every look.wormTrail / SAMPLES seconds
const POINTS = SAMPLES * 2 - 1; // drawn: the kept ones, and one between each two (Catmull-Rom)
const PALETTE = ["#4dff7a", "#ff3df0", "#ff3a3a", "#7a6bff", "#58c8ff"].map((c) => new THREE.Color(c));

const VERT = /* glsl */ `
attribute float aT, aSide;
attribute vec3 aColor;
varying float vT, vSide;
varying vec3 vColor;
void main(){
  vT = aT; vSide = aSide; vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
}`;
const FRAG = /* glsl */ `
uniform float uLight;
varying float vT, vSide;
varying vec3 vColor;
void main(){
  // (clamped: with MSAA a pixel on the edge is shaded where its samples are, a little past the tail's end,
  // and pow of a negative number is NaN, which the glow then spreads over the whole picture)
  float across = max(1. - vSide * vSide, 0.);
  float along = pow(max(1. - vT, 0.), 1.6);
  gl_FragColor = vec4(vColor * across * along * uLight, 1.);
}`;
const HEAD_VERT = /* glsl */ `
attribute vec3 aColor;
uniform float uPx;
varying vec3 vColor;
void main(){
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.);
  gl_PointSize = 34. * uPx;
  gl_Position = projectionMatrix * mv;
}`;
const HEAD_FRAG = /* glsl */ `
uniform float uLight;
varying vec3 vColor;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.;
  float halo = pow(max(1. - d, 0.), 3.), core = smoothstep(0.22, 0.04, d);
  gl_FragColor = vec4((vColor * halo * 0.8 + mix(vColor, vec3(1.), 0.6) * core) * uLight, 1.);
}`;

const lerp = THREE.MathUtils.lerp;
const override = new THREE.Color();
const from = new THREE.Vector3(), lastSide = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3(), side = new THREE.Vector3(), toEye = new THREE.Vector3(), along = new THREE.Vector3();
const catmull = (p0, p1, p2, p3, t, axis) => {
  const a = p0[axis], b = p1[axis], c = p2[axis], d = p3[axis], t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
};

export class Worms {
  constructor(world) {
    this.world = world;
    const G = world.G;
    this.group = new THREE.Group();
    this.group.frustumCulled = false;
    this.worms = Array.from({ length: COUNT }, (_, i) => ({
      i, pos: new THREE.Vector3(), dir: new THREE.Vector3(), trail: [], acc: 0,
      // each its own: how it winds, how fast, when it blinks
      freq: [0.11 + Math.random() * 0.2, 0.09 + Math.random() * 0.2, 0.13 + Math.random() * 0.2],
      phase: [Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3],
      speed: 150 + Math.random() * 170, blink: 0.25 + Math.random() * 0.35, blinkAt: Math.random() * 6.3,
      colour: new THREE.Color(), group: i % 5,
    }));
    // the trails: one strip of POINTS pairs per worm, built each frame facing the eye
    const strip = POINTS * 2, verts = COUNT * strip;
    this.positions = new Float32Array(verts * 3);
    this.colours = new Float32Array(verts * 3);
    const t = new Float32Array(verts), s = new Float32Array(verts), index = [];
    for (let w = 0; w < COUNT; w++) for (let k = 0; k < POINTS; k++) {
      const v = w * strip + k * 2;
      t[v] = t[v + 1] = k / (POINTS - 1);
      s[v] = -1; s[v + 1] = 1;
      if (k < POINTS - 1) index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(this.colours, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aT", new THREE.BufferAttribute(t, 1));
    geometry.setAttribute("aSide", new THREE.BufferAttribute(s, 1));
    geometry.setIndex(index);
    const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
    this.trails = new THREE.Mesh(geometry, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uLight: G.uLight }, side: THREE.DoubleSide, ...additive }));
    this.trails.frustumCulled = false;
    // and the light at the head of each
    this.headPositions = new Float32Array(COUNT * 3);
    this.headColours = new Float32Array(COUNT * 3);
    const heads = new THREE.BufferGeometry();
    heads.setAttribute("position", new THREE.BufferAttribute(this.headPositions, 3).setUsage(THREE.DynamicDrawUsage));
    heads.setAttribute("aColor", new THREE.BufferAttribute(this.headColours, 3).setUsage(THREE.DynamicDrawUsage));
    this.heads = new THREE.Points(heads, new THREE.ShaderMaterial({ vertexShader: HEAD_VERT, fragmentShader: HEAD_FRAG, uniforms: { uLight: G.uLight, uPx: G.uPx }, ...additive }));
    this.heads.frustumCulled = false;
    this.group.add(this.trails, this.heads);
    world.scene.add(this.group);
    this.placed = false;
  }

  // somewhere round the eye, not too near, heading anywhere; its trail starts from nothing
  place(worm, eye) {
    tmp.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.7, Math.random() - 0.5).normalize();
    worm.pos.copy(eye).addScaledVector(tmp, lerp(this.near, this.far, Math.random()));
    worm.dir.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.4, Math.random() - 0.5).normalize();
    worm.trail = Array.from({ length: SAMPLES }, () => worm.pos.clone());
  }

  update(dt, camera) {
    const G = this.world.G, eye = camera.position;
    this.group.visible = G.uSolid.value > 0.5;
    if (!this.group.visible) { this.placed = false; return; }
    const t = G.uTime.value, show = G.uBlocksLit.value, out = Math.min(COUNT, Math.round(look.wormCount));
    const NEAR = (this.near = look.wormNear), FAR = (this.far = Math.max(look.wormFar, NEAR + 100)), STEP = look.wormTrail / SAMPLES;
    this.out = out;
    for (const w of this.worms) {
      if (w.i >= out) { w.away = true; continue; }
      // put round you at first, and again after a jump (a portal, the map: they do not fly after you), or
      // when it comes out again
      if (!this.placed || w.away || w.pos.distanceToSquared(eye) > (FAR * 2.5) ** 2) this.place(w, eye);
      w.away = false;
      const lights = show > 0 ? G.uBlocksLights.value[w.group] : 0;
      // the way it is going turns slowly, on its own winding, and back toward you when it strays (or away
      // when it comes too near): a long smooth curve, never a corner
      const k = dt * 0.9 * look.wormCurl;
      w.dir.x += Math.sin(t * w.freq[0] + w.phase[0]) * k;
      w.dir.y += Math.sin(t * w.freq[1] + w.phase[1]) * k * 0.6;
      w.dir.z += Math.sin(t * w.freq[2] + w.phase[2]) * k;
      toEye.subVectors(eye, w.pos);
      const d = toEye.length();
      if (d > FAR) w.dir.addScaledVector(toEye, (dt * 0.5 * Math.min(1, (d - FAR) / FAR)) / d);
      else if (d < NEAR) w.dir.addScaledVector(toEye, (-dt * 0.8 * (1 - d / NEAR)) / d);
      w.dir.normalize();
      from.copy(w.pos);
      w.pos.addScaledVector(w.dir, w.speed * look.wormSpeed * (1 + lights * 0.35) * dt);
      // a point kept every STEP, each where it was at that moment: a long frame (a slow machine, a
      // hitch) keeps several, spread along the way it came, not all in one place (that pinches the trail)
      for (let at = STEP - w.acc; at <= dt; at += STEP) {
        const last = w.trail.pop();
        w.trail.unshift(last.lerpVectors(from, w.pos, dt > 0 ? Math.max(0, at / dt) : 1));
      }
      w.acc = (w.acc + dt) % STEP;
      // how bright: a slow firefly blink over a steady glow, and a light show's flare on top
      const blink = Math.pow(0.5 + 0.5 * Math.sin(t * w.blink * Math.PI * 2 + w.blinkAt), 6);
      const level = (0.7 + 1.1 * blink * look.wormBlink) * (show > 0 ? 0.55 + lights * 0.9 : 1) * look.wormBright;
      w.colour.copy(show > 0 ? G.uBlocksColours.value[w.group] : PALETTE[w.group]);
      if (look.wormColourMix > 0) w.colour.lerp(override.set(look.wormColour), look.wormColourMix); // (an admin's colour over theirs)
      w.colour.multiplyScalar(level);
    }
    this.placed = true;
    this.draw(eye);
  }

  draw(eye) {
    const strip = POINTS * 2, pts = [];
    this.trails.geometry.setDrawRange(0, this.out * (POINTS - 1) * 6);
    this.heads.geometry.setDrawRange(0, this.out);
    for (const w of this.worms) {
      if (w.i >= this.out) break;
      // the head where it is now, then the kept points, with one between each two
      const kept = [w.pos, ...w.trail.slice(1)];
      pts.length = 0;
      for (let k = 0; k < kept.length - 1; k++) {
        const p0 = kept[Math.max(0, k - 1)], p1 = kept[k], p2 = kept[k + 1], p3 = kept[Math.min(kept.length - 1, k + 2)];
        pts.push(p1.x, p1.y, p1.z);
        pts.push(catmull(p0, p1, p2, p3, 0.5, "x"), catmull(p0, p1, p2, p3, 0.5, "y"), catmull(p0, p1, p2, p3, 0.5, "z"));
      }
      const end = kept[kept.length - 1];
      pts.push(end.x, end.y, end.z);
      const base = w.i * strip;
      for (let k = 0; k < POINTS; k++) {
        const a = Math.max(0, k - 1), b = Math.min(POINTS - 1, k + 1);
        along.set(pts[b * 3] - pts[a * 3], pts[b * 3 + 1] - pts[a * 3 + 1], pts[b * 3 + 2] - pts[a * 3 + 2]);
        tmp.set(pts[k * 3], pts[k * 3 + 1], pts[k * 3 + 2]);
        toEye.subVectors(eye, tmp);
        // as wide on the screen near or far: a few pixels, thinning to nothing at the tail
        const width = toEye.length() * 0.0028 * look.wormWidth * (1 - (k / (POINTS - 1)) * 0.85);
        side.crossVectors(along, toEye);
        if (side.lengthSq() < 1e-8) side.copy(lastSide); // (two points as one: across as the last)
        lastSide.copy(side.normalize());
        side.multiplyScalar(width);
        const v = (base + k * 2) * 3;
        this.positions[v] = tmp.x - side.x; this.positions[v + 1] = tmp.y - side.y; this.positions[v + 2] = tmp.z - side.z;
        this.positions[v + 3] = tmp.x + side.x; this.positions[v + 4] = tmp.y + side.y; this.positions[v + 5] = tmp.z + side.z;
        w.colour.toArray(this.colours, v);
        w.colour.toArray(this.colours, v + 3);
      }
      w.pos.toArray(this.headPositions, w.i * 3);
      w.colour.toArray(this.headColours, w.i * 3);
    }
    const g = this.trails.geometry.attributes, h = this.heads.geometry.attributes;
    g.position.needsUpdate = g.aColor.needsUpdate = h.position.needsUpdate = h.aColor.needsUpdate = true;
  }
}
