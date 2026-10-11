// Portals still forming: while a plugin is on its way (its script not yet come, or not yet started), its
// place round the clock is not left empty. Out of nothing, slowly, motes of the void's violet are drawn
// in towards where its ring will be, round and round, gathering on the circle; the circle glows faintly
// there, soft light going round it, and the dark of its hole gathers in it like a cloud, thicker the
// longer it waits. Nothing in it flickers or jumps: it all eases. When its own ring is there (not when
// its plugin is: some build their ring only once they have heard from their source), it opens out from
// the middle to meet the motes on the circle, as what stood in for it fades. One that never comes (its
// plugin could not be loaded, or long after it was, still no ring) eases apart instead: its motes drift
// off outwards and fade. But one whose source does not answer (unreachable(name): see grey.js) is not given
// up on: it forms on, drawn grey, until its plugin hears from its source and puts up its ring.
import * as THREE from "three";
import { hubSlot, PORTAL_FORMS_ITSELF } from "./constants.js";
import { materialize } from "./reach.js";

const RING = 120, HOLE = 104;  // as the plugins' own rings (see theirs)
const MOTES = 140;             // drawn in to each
const SHOW = 1.6;              // seconds, eased in from nothing
const GATHER = 7;              // seconds over which the cloud of its hole and its glow thicken (most of the way)
const OPEN = 1.5;              // seconds, from its plugin come to its own ring wholly open, and this gone
const PART = 2.2;              // seconds, from its plugin given up on to gone
const NEAR = 450;              // anything new put this near its place, once its plugin is there, is its ring (and is opened out)
const GIVE_UP = 40;            // seconds after its plugin is there, still no ring where it would be seen: it never comes
                               // (some show theirs only past the start screen: those form on behind it, and open as you come in)

// each mote: its own way round and its own moment, falling in from far out to the circle, then again
const MOTE_VERT = /* glsl */ `uniform float uTime, uPx, uShow, uEnd, uOk; attribute float aAngle, aSeed;
varying float vA; varying float vHot;
void main(){
  float c = fract(uTime * (.16 + aSeed * .14) + aSeed * 7.31);
  float inward = c * c * (3. - 2. * c);
  // come: each eased onto the circle, there as its ring opens out to it; never coming: out, away from it
  float settle = smoothstep(0., .55, uEnd) * uOk;
  inward = mix(inward, 1., settle);
  float r = mix(340. + aSeed * 180., ${RING}., inward) + (1. - uOk) * smoothstep(0., 1., uEnd) * (260. + aSeed * 300.);
  float a = aAngle + (1. - inward) * (2.2 + aSeed * 1.4) + uTime * .05;
  float z = (1. - inward) * (aSeed - .5) * 420.;
  vec4 mv = modelViewMatrix * vec4(cos(a) * r, sin(a) * r, z, 1.);
  vA = mix(sin(3.14159 * c) * .8 + inward * .3, .9, settle) * uShow * (1. - smoothstep(.3, 1., uEnd));
  vHot = inward;
  gl_PointSize = clamp(uPx * (1500. + aSeed * 1100.) / max(-mv.z, 1.), 1., 24.);
  gl_Position = projectionMatrix * mv;
}`;
const MOTE_FRAG = /* glsl */ `varying float vA; varying float vHot;
void main(){
  float d = length(gl_PointCoord - .5) * 2.;
  float glow = pow(max(0., 1. - d), 2.2);
  vec3 c = mix(vec3(.45, .22, 1.1), vec3(.7, .85, 1.3), vHot * .6);
  gl_FragColor = vec4(c * glow * vA * 1.6, 1.);
}`;

// the circle, glowing faintly, two soft lights going slowly round it, one each way; as its own ring opens
// out to it, it swells a little, and fades
const ARC_VERT = /* glsl */ `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;
const ARC_FRAG = /* glsl */ `uniform float uTime, uPhase, uShow, uGrow, uEnd, uOk; varying vec3 vPos;
void main(){
  float a = atan(vPos.y, vPos.x) / 6.28318;
  float one = pow(.5 + .5 * cos((a - uTime * .12 - uPhase) * 6.28318), 6.);
  float two = pow(.5 + .5 * cos((a + uTime * .07 + uPhase * 1.7) * 12.56637), 10.);
  float show = (.12 + .5 * one + .3 * two) * (.45 + .55 * uGrow);
  float swell = uOk * smoothstep(0., .6, uEnd) * .9;
  show = (show + swell) * uShow * (1. - smoothstep(.45, 1., uEnd));
  gl_FragColor = vec4(vec3(.55, .32, 1.25) * show, 1.);
}`;

// the dark of its hole, gathering: a soft cloud, slowly turning, thicker the longer it waits, edged in
// faint light that breathes; it gives way as its own hole opens out within it
const HOLE_VERT = /* glsl */ `varying vec3 vPos; varying vec3 vNormal; varying vec3 vView;
void main(){
  vPos = normalize(position);
  vec4 wp = modelMatrix * vec4(position, 1.);
  vNormal = normalize(mat3(modelMatrix) * normal);
  vView = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const HOLE_FRAG = /* glsl */ `uniform float uTime, uPhase, uShow, uGrow, uEnd; varying vec3 vPos; varying vec3 vNormal; varying vec3 vView;
float hash(vec3 p){ p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
void main(){
  float t = uTime * .12 + uPhase;
  vec3 p = vPos * 2.4;
  p.xy = mat2(cos(t), -sin(t), sin(t), cos(t)) * p.xy;
  float n = noise(p + vec3(0., 0., uTime * .15)) * .65 + noise(p * 2.1 - uTime * .1) * .35;
  float cloud = smoothstep(.62 - .3 * uGrow, .9, n);
  float breathe = .5 + .5 * sin(uTime * 1.1 + uPhase);
  float rim = pow(max(1. - abs(dot(normalize(vNormal), normalize(vView))), 0.), 4.);
  float a = (cloud * .3 + rim * (.18 + .14 * breathe)) * (.35 + .65 * uGrow) * uShow * (1. - smoothstep(0., .7, uEnd));
  gl_FragColor = vec4(vec3(.4, .2, 1.) * a, 1.);
}`;

const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
const Z = new THREE.Vector3(0, 0, 1);
const eased = (t) => 1 - (1 - t) ** 3; // (quick, then settling)

export class Forming {
  constructor({ scene, world }) {
    this.scene = scene;
    this.world = world;
    this.rings = new Map(); // name → { group, uniforms, age, waited: null | seconds since its plugin came, end: null | 0..1 from its ring come (or not), opened }
    this.known = new Set(); // what was in the scene before any plugin (none of it a ring)
    this.unreachable = () => false; // (whether a plugin's source does not answer: set by main.js, see grey.js)
  }

  // one at each of these places round the clock, forming until done(name)
  start(names) {
    const G = this.world.G;
    this.known = new Set(this.scene.children);
    const angles = new Float32Array(MOTES), seeds = new Float32Array(MOTES);
    for (let i = 0; i < MOTES; i++) { angles[i] = Math.random() * Math.PI * 2; seeds[i] = Math.random(); }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3));
    geometry.setAttribute("aAngle", new THREE.BufferAttribute(angles, 1));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    const arc = new THREE.TorusGeometry(RING, 2, 6, 160), hole = new THREE.SphereGeometry(HOLE, 40, 24);
    for (const name of names) {
      if (PORTAL_FORMS_ITSELF.has(name)) continue; // (its own way: see constants.js)
      const uniforms = {
        uTime: G.uTime, uPx: G.uPx, uPhase: { value: Math.random() * 10 },
        uShow: { value: 0 }, uGrow: { value: 0 }, uEnd: { value: 0 }, uOk: { value: 1 },
      };
      const group = new THREE.Group();
      const motes = new THREE.Points(geometry, new THREE.ShaderMaterial({ uniforms, vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, ...additive }));
      motes.frustumCulled = false; // (where they are is the shader's: the empty box would be culled)
      group.add(motes);
      group.add(new THREE.Mesh(arc, new THREE.ShaderMaterial({ uniforms, vertexShader: ARC_VERT, fragmentShader: ARC_FRAG, ...additive })));
      group.add(new THREE.Mesh(hole, new THREE.ShaderMaterial({ uniforms, vertexShader: HOLE_VERT, fragmentShader: HOLE_FRAG, side: THREE.DoubleSide, forceSinglePass: true, ...additive })));
      const slot = hubSlot(name);
      group.position.set(...slot.at);
      group.quaternion.setFromUnitVectors(Z, new THREE.Vector3(...slot.in));
      group.visible = false;
      this.scene.add(group);
      this.known.add(group);
      this.rings.set(name, { group, uniforms, age: 0, waited: null, end: null, opened: new Map() });
    }
  }

  // its plugin is there (its ring then looked for, each frame), or never will be (it eases apart)
  done(name, ok = true) {
    const ring = this.rings.get(name);
    if (!ring || ring.waited !== null || ring.end !== null) return;
    if (ok) ring.waited = 0;
    else this.end(ring, false);
  }

  end(ring, ok) {
    ring.end = 0;
    ring.uniforms.uOk.value = ok ? 1 : 0;
  }

  // what is new in the scene, shown, and stands at this one's place: its ring (and anything of it, its
  // emblem, say). Groups only: a beam or a gob passing is a lone mesh, a ring never is
  arrived(ring) {
    const at = ring.group.position, found = [];
    for (const object of this.scene.children) {
      if (this.known.has(object) || !object.visible || !object.children.length) continue;
      if (object.position.distanceTo(at) < NEAR) found.push(object);
    }
    return found;
  }

  // whether this one is still forming (its ring not there yet)
  has(name) {
    return this.rings.get(name)?.end === null;
  }

  // after the plugins' own (so their rings stand where they will be drawn this frame)
  // (started: past the start screen)
  update(dt, camera, started) {
    for (const [name, ring] of this.rings) {
      const u = ring.uniforms;
      ring.age += dt;
      u.uShow.value = THREE.MathUtils.smoothstep(ring.age, 0, SHOW);
      u.uGrow.value = 1 - Math.exp((-3 * ring.age) / GATHER);
      // its plugin there: its ring looked for (and, given up on, it eases apart)
      // (drawn only as near as the plugins' rings are, and coming into being as they do: see reach.js)
      const seen = this.world.realm === "void" && materialize(ring.group, ring.group.position.distanceTo(camera.position), dt);
      if (ring.end === null && ring.waited !== null) {
        if (started && seen) ring.waited += dt;
        if (this.unreachable(name)) ring.waited = 0; // (waited on as long as its source does not answer)
        if (this.arrived(ring).length) this.end(ring, true);
        else if (ring.waited > GIVE_UP) this.end(ring, false);
      }
      if (ring.end !== null) {
        ring.end = Math.min(1, ring.end + dt / (u.uOk.value ? OPEN : PART));
        u.uEnd.value = ring.end;
        // its own ring, opening out from the middle, from the frame it is first seen (so it never shows
        // whole before it has opened); what more of it comes while it opens, opened with it
        if (u.uOk.value) {
          const open = Math.max(0.001, eased(ring.end));
          for (const object of this.arrived(ring)) if (!ring.opened.has(object)) ring.opened.set(object, object.scale.clone());
          for (const [object, scale] of ring.opened) object.scale.copy(scale).multiplyScalar(open);
        }
        if (ring.end >= 1) {
          for (const [object, scale] of ring.opened) object.scale.copy(scale);
          this.scene.remove(ring.group);
          ring.group.children.forEach((child) => child.material.dispose());
          this.rings.delete(name);
          continue;
        }
      }
      ring.group.visible = seen;
    }
  }
}
