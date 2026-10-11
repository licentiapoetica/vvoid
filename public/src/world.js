// The void: a grid of cubic sectors around the player. Each starts as faint dust
// and materializes once its spec arrives (from Claude via the server, or local noise).
import * as THREE from "three";
import { hashCoords, mulberry32 } from "./noise.js";
import { ORIGIN, localSpec, voidSpec, normalizeSpec } from "./spec.js";
import { population } from "./population.js";
import { PRIMITIVES, buildLayers, buildBlueprint } from "./structures.js";
import { CELL, UNIT, SIGHT } from "./constants.js";
import { Worms } from "./worms.js";
import { look, uLook } from "./look.js";
import {
  SKY_VERT, skyFrag, fieldCompiles, DEFAULT_FIELD,
  BOX_VERT, BOX_FRAG, MOTE_VERT, MOTE_FRAG, ORB_VERT, ORB_FRAG,
} from "./shaders.js";

export { CELL };
const MATERIALIZE_SECONDS = 3.5;
const FRACTAL_REACH = 110 * UNIT; // within this distance of a recursion's centre, flight slows
const FRACTAL_FLOOR = 7 * UNIT;   // and this close, the traveller is moved one level back out

const key = (x, y, z) => `${x},${y},${z}`;
const tint = new THREE.Color();
const dummy = new THREE.Object3D();
// collisions
const BOUNCE = 0.55; // how much of the speed into a surface comes back out of it
const inverseWorld = new THREE.Matrix4(), pieceWorld = new THREE.Matrix4();
const local = new THREE.Vector3(), piece = new THREE.Vector3(), nearest = new THREE.Vector3(), normal = new THREE.Vector3();

// What stands in a sector, drawn only while some of the sector is in sight (in the headset, of either eye's): each
// of its objects bounded by a sphere round the whole sector, as three.js leaves an object out by its bounds. Its
// motes wrap round inside its cube, its pieces stand well within it (swaying and swelling a little: see BOX_VERT),
// so nothing of it is out of that sphere; a sector behind you was drawn all the same (all 125 round you, twice in
// the headset). Not by distance: what is far goes into the fog's colour, not into nothing
const SECTOR_BOUND = CELL * 0.9;
const _origin = new THREE.Vector3();
function boundBySector(object, lift = 0) {
  object.frustumCulled = true;
  // (an instanced mesh's own bounds, in its own space: scaled by UNIT and lifted in the sector)
  const sphere = new THREE.Sphere(_origin, (SECTOR_BOUND + Math.abs(lift)) / (object.isInstancedMesh ? UNIT : 1));
  if (object.isInstancedMesh) object.boundingSphere = sphere;
  else object.geometry.boundingSphere = sphere;
}

const DRIFT = {
  rise: [0, 1, 0], fall: [0, -1, 0], stream: [1, 0.05, 0.3], orbit: [0, 0, 0], still: [0, 0, 0],
};

function whisperSprite(text, color) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  ctx.font = '300 40px "Helvetica Neue", Helvetica, Arial, sans-serif';
  if ("letterSpacing" in ctx) ctx.letterSpacing = "6px";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(text, 512, 48, 1000);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture, transparent: true, depthWrite: false, fog: false, opacity: 0, blending: THREE.AdditiveBlending,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(170, 16, 1);
  return sprite;
}

class Cell {
  constructor(world, x, y, z) {
    this.world = world;
    this.coords = [x, y, z];
    this.seed = hashCoords(x, y, z);
    this.group = new THREE.Group();
    this.group.position.set(x * CELL, y * CELL, z * CELL);
    this.spec = null;
    this.mat = { value: 0 };
    this.built = { value: 0 };
    this.disposables = [];
    this.whispers = [];
    this.structures = [];
    this.solids = [];

    // faint dust so an unmaterialized sector is not pure nothing
    const dust = this.points(1400, mulberry32(this.seed ^ 0x51ed), {
      uColor: { value: new THREE.Color("#8fa0c8") }, uSize: { value: 0.7 }, uDrift: { value: new THREE.Vector3(0, 1.5, 0) },
      uOrbit: { value: 0 }, uMat: (this.dustMat = { value: 0 }), // faded in (see update), not there all at once
    });
    this.group.add(dust);
    world.scene.add(this.group);
  }

  points(count, r, uniforms) {
    const G = this.world.G;
    const geometry = new THREE.BufferGeometry();
    const position = new Float32Array(count * 3), seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      position[i * 3] = (r() - 0.5) * CELL;
      position[i * 3 + 1] = (r() - 0.5) * CELL;
      position[i * 3 + 2] = (r() - 0.5) * CELL;
      seed[i] = r();
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    const material = new THREE.ShaderMaterial({
      vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG,
      uniforms: { uTime: G.uTime, uPx: G.uPx, uFogDensity: G.uFogDensity, uLight: G.uLight, uHigh: G.uHigh, uSolid: G.uSolid, uCell: { value: CELL }, uRainbow: { value: 0 }, uRainbowAll: G.uRainbowAll, ...uniforms },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geometry, material);
    boundBySector(points);
    this.disposables.push(geometry, material);
    return points;
  }

  materialize(spec) {
    if (this.spec) {
      // the rest of a sector whose geometry arrived early
      if (this.spec.partial && !spec.partial) {
        this.spec = spec;
        this.addBlueprint(spec);
        this.addWhispers(spec);
      }
      return;
    }
    this.spec = spec;
    const G = this.world.G;
    const r = mulberry32(this.seed);
    const glow = new THREE.Color(spec.palette.glow), accent = new THREE.Color(spec.palette.accent);

    for (const { instances, layer, bands, tiltZ, fractal } of buildLayers(spec, this.seed)) {
      const mesh = this.addMesh(layer.primitive, instances, spec, this.mat, bands, 0, fractal);
      if (!mesh) continue;
      mesh.position.y = layer.lift * 170 * UNIT;
      boundBySector(mesh, mesh.position.y);
      // a recursion stays upright: its descent turns about the vertical
      if (!fractal) mesh.rotation.set(layer.tilt * 1.2, 0, tiltZ);
      this.structures.push({ mesh, spin: layer.spin, fractal });
    }
    if (!spec.partial) this.addBlueprint(spec);

    const moteCount = Math.round(spec.motes.density * 9000);
    if (moteCount) {
      const speed = spec.motes.speed * 28;
      const drift = new THREE.Vector3(...DRIFT[spec.motes.drift]).multiplyScalar(speed);
      this.group.add(this.points(moteCount, r, {
        uColor: spec.air ? G.uMote : { value: glow.clone().lerp(accent, 0.3) }, uSize: { value: spec.motes.size }, uDrift: { value: drift },
        uOrbit: { value: spec.motes.drift === "orbit" ? spec.motes.speed * 0.25 : 0 }, uMat: this.mat,
        uRainbow: { value: spec.rainbow },
      }));
    }

    if (spec.orbs.count) {
      const n = spec.orbs.count;
      const geometry = new THREE.BufferGeometry();
      const orbit = new Float32Array(n * 4), color = new Float32Array(n * 3);
      const hub = spec.hub;
      for (let i = 0; i < n; i++) {
        const radius = (hub ? 150 : 70 + r() * 170) * UNIT;
        orbit.set([radius, (i / n) * Math.PI * 2, hub ? 0.25 : (r() - 0.5) * 1.6, (hub ? 0.22 : 0.08 + r() * 0.25) * (r() < 0.5 || hub ? 1 : -1)], i * 4);
        new THREE.Color(spec.orbs.colors[i]).toArray(color, i * 3);
      }
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      geometry.setAttribute("aOrbit", new THREE.BufferAttribute(orbit, 4));
      geometry.setAttribute("aColor", new THREE.BufferAttribute(color, 3));
      const material = new THREE.ShaderMaterial({
        vertexShader: ORB_VERT, fragmentShader: ORB_FRAG,
        uniforms: { uTime: G.uTime, uPx: G.uPx, uFogDensity: G.uFogDensity, uLight: G.uLight, uBass: G.uBass, uMat: this.mat },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const orbs = new THREE.Points(geometry, material);
      boundBySector(orbs);
      this.group.add(orbs);
      this.disposables.push(geometry, material);
    }

    if (!spec.partial) this.addWhispers(spec);
  }

  // one instanced mesh of a single solid, lit in the sector's colours
  addMesh(primitive, instances, spec, mat, bands = 0, warp = 0, fractal = null) {
    if (!instances.length) return null;
    const G = this.world.G, r = mulberry32(this.seed ^ instances.length);
    const geometry = PRIMITIVES[primitive].clone();
    const seeds = new Float32Array(instances.length), tints = new Float32Array(instances.length);
    const material = new THREE.ShaderMaterial({
      vertexShader: BOX_VERT, fragmentShader: BOX_FRAG,
      defines: { ...(primitive === "cube" ? {} : { BARY: 1 }), ...(fractal ? { FRACTAL: 1 } : {}) },
      uniforms: {
        uFogColor: G.uFogColor, uFogDensity: G.uFogDensity, uLight: G.uLight, uTime: G.uTime, uMat: mat, uWarp: { value: warp },
        uMid: G.uMid, uBeat: G.uBeat, uSolid: G.uSolid, uHaze: G.uGlow, uHazeDir: G.uHazeDir, uKeyLight: G.uKeyLight, uLook, uNear: { value: 1e5 }, uUnit: { value: UNIT }, uRainbow: { value: spec.rainbow }, uChan: G.uChan, uRainbowAll: G.uRainbowAll,
        // a place that wears the air's colours (spec.air): its pieces ease over with the air when it changes
        ...(spec.air ? { uDeep: G.uDeep, uGlow: G.uGlow, uAccent: G.uAccent } : {
          uDeep: { value: new THREE.Color(spec.palette.deep) }, uGlow: { value: new THREE.Color(spec.palette.glow) },
          uAccent: { value: new THREE.Color(spec.palette.accent) },
        }),
        uBands: { value: bands },
      },
    });
    const mesh = new THREE.InstancedMesh(geometry, material, instances.length);
    instances.forEach((inst, i) => {
      mesh.setMatrixAt(i, inst.matrix);
      seeds[i] = r();
      tints[i] = inst.tint;
    });
    geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
    geometry.setAttribute("aTint", new THREE.InstancedBufferAttribute(tints, 1));
    boundBySector(mesh);
    mesh.scale.setScalar(UNIT);
    this.group.add(mesh);
    this.disposables.push(geometry, material, mesh); // the mesh owns the per-instance matrix buffer
    // what you can fly into: every piece as a box (rounder solids a little smaller than their bounds),
    // with a sphere round it to find the near ones quickly. Not the recursions: those are flown into.
    if (!fractal) {
      const n = instances.length, centres = new Float32Array(n * 3), radii = new Float32Array(n), inverse = [];
      instances.forEach(({ matrix }, i) => {
        const e = matrix.elements;
        centres.set([e[12], e[13], e[14]], i * 3);
        radii[i] = Math.max(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10])) * 0.87;
        inverse.push(matrix.clone().invert());
      });
      this.solids.push({ mesh, matrices: instances.map((inst) => inst.matrix), inverse, centres, radii, half: primitive === "cube" || primitive === "cyl" ? 0.5 : 0.4, mat });
    }
    return mesh;
  }

  // Push a sphere (you) out of whatever it has flown into, and bounce its velocity off the surface.
  // Returns how hard the hardest hit was (speed into the surface), 0 for none.
  collide(position, velocity, radius) {
    let impact = 0;
    for (const solid of this.solids) {
      if (solid.mat.value < 0.95) continue; // still materializing: nothing to hit yet
      const { mesh, centres, radii } = solid;
      inverseWorld.copy(mesh.matrixWorld).invert();
      local.copy(position).applyMatrix4(inverseWorld);
      const reach = radius / UNIT;
      for (let i = 0; i < radii.length; i++) {
        const dx = local.x - centres[i * 3], dy = local.y - centres[i * 3 + 1], dz = local.z - centres[i * 3 + 2], r = radii[i] + reach;
        if (dx * dx + dy * dy + dz * dz > r * r) continue;
        impact = Math.max(impact, this.collidePiece(solid, i, position, velocity, radius));
        local.copy(position).applyMatrix4(inverseWorld); // it may have moved
      }
    }
    return impact;
  }

  collidePiece({ mesh, matrices, inverse, half }, i, position, velocity, radius) {
    const q = piece.copy(local).applyMatrix4(inverse[i]); // in the piece's own unit box
    const closest = nearest.set(THREE.MathUtils.clamp(q.x, -half, half), THREE.MathUtils.clamp(q.y, -half, half), THREE.MathUtils.clamp(q.z, -half, half));
    const toWorld = pieceWorld.multiplyMatrices(mesh.matrixWorld, matrices[i]);
    let depth;
    if (closest.equals(q)) {
      // inside it: out through the nearest face
      let best = Infinity, axis = 0;
      for (let k = 0; k < 3; k++) {
        const e = toWorld.elements, scale = Math.hypot(e[k * 4], e[k * 4 + 1], e[k * 4 + 2]), d = (half - Math.abs(q.getComponent(k))) * scale;
        if (d < best) { best = d; axis = k; }
      }
      const e = toWorld.elements;
      normal.set(e[axis * 4], e[axis * 4 + 1], e[axis * 4 + 2]).normalize().multiplyScalar(Math.sign(q.getComponent(axis)) || 1);
      depth = best + radius;
    } else {
      closest.applyMatrix4(toWorld);
      normal.copy(position).sub(closest);
      const distance = normal.length();
      if (distance >= radius) return 0;
      normal.divideScalar(distance || 1);
      depth = radius - distance;
    }
    position.addScaledVector(normal, depth);
    const into = velocity.dot(normal);
    if (into >= 0) return 0;
    velocity.addScaledVector(normal, -(1 + BOUNCE) * into); // back out, losing some of it
    return -into;
  }

  // the built thing arrives after the abstract geometry and grows in on its own clock
  addBlueprint(spec) {
    if (!spec.blueprint) return;
    for (const { primitive, instances } of buildBlueprint(spec.blueprint)) this.addMesh(primitive, instances, spec, this.built, 0, spec.dream * 16);
  }

  addWhispers(spec) {
    const r = mulberry32(this.seed ^ 0x77a1);
    for (const line of spec.whispers) {
      const sprite = whisperSprite(line, spec.palette.accent);
      sprite.position.set((r() - 0.5) * 420 * UNIT, (r() - 0.5) * 320 * UNIT, (r() - 0.5) * 420 * UNIT);
      sprite.scale.multiplyScalar(1.7);
      this.whispers.push(sprite);
      this.group.add(sprite);
      this.disposables.push(sprite.material.map, sprite.material);
    }
  }

  update(dt, camera) {
    if (this.dustMat.value < 0.5) this.dustMat.value = Math.min(0.5, this.dustMat.value + dt / 6);
    if (!this.spec) return;
    if (this.mat.value < 1) this.mat.value = Math.min(1, this.mat.value + dt / MATERIALIZE_SECONDS);
    if (!this.spec.partial && this.built.value < 1) this.built.value = Math.min(1, this.built.value + dt / MATERIALIZE_SECONDS);
    for (const { mesh, spin, fractal } of this.structures) {
      mesh.rotateY(spin * 0.12 * dt);
      if (!fractal) continue;
      // The endless descent. Near a recursion, flight slows in proportion to the distance left, so
      // each shell takes as long to pass as the last. And when the traveller gets very close they are
      // moved back out by exactly one level: the thing is self-similar, so nothing appears to change,
      // and there is always as far to go as there was.
      const centre = mesh.getWorldPosition(dummy.position), offset = dummy.scale.copy(camera.position).sub(centre);
      let distance = offset.length();
      if (distance < FRACTAL_FLOOR && distance > 1e-4) {
        camera.position.copy(centre).addScaledVector(offset, fractal.k);
        mesh.rotateY(fractal.theta);
        distance *= fractal.k;
      }
      mesh.material.uniforms.uNear.value = distance;
      this.world.slow = Math.min(this.world.slow, THREE.MathUtils.clamp(distance / FRACTAL_REACH, 0.01, 1));
    }
    const density = this.world.G.uFogDensity.value;
    for (const sprite of this.whispers) {
      const d = sprite.getWorldPosition(dummy.position).distanceTo(camera.position);
      const fog = Math.exp(-((d * density) ** 2));
      // legible at mid range; they dissolve as you fly into them
      sprite.material.opacity = 0.45 * fog * this.mat.value * this.world.G.uLight.value * THREE.MathUtils.smoothstep(d, 40, 150);
    }
  }

  dispose() {
    this.world.scene.remove(this.group);
    for (const d of this.disposables) d.dispose();
  }
}

// The nebula is the most expensive shader in the game and also the softest image, so it is
// drawn into a small offscreen target and stretched behind the scene instead of per screen pixel.
const JUMP = 2500;    // further than this in one frame is not flying but a jump (see Sky.update)
const SKY_LAYERS = 2; // skies fading at once, at most (see show)

class Sky {
  constructor(world) {
    this.world = world;
    this.scene = new THREE.Scene();
    this.target = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, depthBuffer: false });
    world.scene.background = this.target.texture;
    this.size = new THREE.Vector2();
    this.geometry = new THREE.SphereGeometry(2000, 32, 16);
    this.origin = { value: new THREE.Vector3() };
    this.step = new THREE.Vector3();
    this.current = null;
    this.fading = []; // skies on their way out, oldest first; each is drawn over the ones before it
    this.order = 0;
    this.show(DEFAULT_FIELD);
  }

  mesh(body) {
    const G = this.world.G;
    const material = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: skyFrag(body),
      uniforms: {
        uTime: G.uTime, uOrigin: this.origin, uFogColor: G.uFogColor,
        uDeep: G.uDeep, uGlow: G.uGlow, uAccent: G.uAccent, uLight: G.uLight, uBass: G.uBass, uPulse: G.uPulse, uSolid: G.uSolid, uHazeDir: G.uHazeDir, uKeyLight: G.uKeyLight, uLook, uBlocksMany: G.uBlocksMany, uBlocksLit: G.uBlocksLit, uBlocksLights: G.uBlocksLights, uBlocksColours: G.uBlocksColours, uOpacity: { value: 1 },
      },
      // transparent from the start: switching it later would recompile the shader mid-fade
      side: THREE.BackSide, depthTest: false, depthWrite: false, transparent: true,
    });
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.frustumCulled = false;
    mesh.userData.left = 1; // how much of its fade-out is left
    return mesh;
  }

  // Swap in a sector's nebula function, cross-fading from the previous one. It is checked and the
  // new shader compiled in the background before it is shown, so the swap does not stall a frame.
  setField(body) {
    if (this.wanted === body) return;
    this.wanted = body;
    fieldCompiles(this.world.renderer.getContext(), body).then((check) => {
      if (this.wanted !== body) return; // overtaken while it was being checked
      if (!check.ok) console.warn("[vvoid] sector field failed to compile, using default:\n", check.log, "\n", body);
      this.show(check.ok ? body : DEFAULT_FIELD);
    });
  }

  show(body) {
    this.wanted ??= body;
    if (this.body === body) { this.queued = null; return; }
    // never more than two skies fading at once: a sky taken away while still showing is a jump, so a
    // newer one waits until one of them has gone (only the newest waiting is kept)
    if (this.fading.length >= SKY_LAYERS) { this.queued = body; return; }
    this.queued = null;
    this.body = body;
    const mesh = this.mesh(body);
    const reveal = () => {
      if (this.body !== body) return mesh.material.dispose(); // overtaken while compiling
      if (this.current) {
        // The outgoing sky goes on top at full strength, so nothing changes at the moment of the
        // swap, and fades from there. Skies already fading keep fading under it.
        this.current.renderOrder = ++this.order;
        this.fading.push(this.current);

      }
      this.current = mesh;
      this.scene.add(mesh);
    };
    if (!this.current) reveal();
    else {
      // compiled for the sky's own target: for the screen it would be another program (tone mapping, colour space)
      const { renderer } = this.world, stage = new THREE.Scene().add(mesh), was = renderer.getRenderTarget();
      renderer.setRenderTarget(this.target);
      const done = renderer.compileAsync(stage, this.camera ??= new THREE.PerspectiveCamera());
      renderer.setRenderTarget(was);
      const ready = () => { stage.remove(mesh); reveal(); };
      done.then(ready, ready);
    }
  }

  drop(mesh) {
    this.scene.remove(mesh);
    mesh.material.dispose();
  }

  update(dt, camera) {
    this.camera = camera;
    // Where the nebula is seen from: it moves as you fly, but a jump (a portal, a room, the map) does
    // not jump it with you: it carries on from where it was, so the sky never starts over.
    if (!this.flown) this.flown = camera.position.clone();
    else if (this.lastCamera.distanceToSquared(camera.position) < JUMP * JUMP) this.flown.add(this.step.subVectors(camera.position, this.lastCamera));
    (this.lastCamera ??= new THREE.Vector3()).copy(camera.position);
    this.origin.value.copy(this.flown).multiplyScalar(1 / (CELL * 1.5));
    this.current.position.copy(camera.position);
    for (const mesh of [...this.fading]) {
      mesh.position.copy(camera.position);
      mesh.userData.left -= dt / look.skyFade; // (how many seconds one sky takes to fade into the next)
      // eased at both ends, so neither the start nor the end of the fade can be seen
      mesh.material.uniforms.uOpacity.value = THREE.MathUtils.smootherstep(mesh.userData.left, 0, 1);
      if (mesh.userData.left <= 0) {
        this.drop(mesh);
        this.fading.splice(this.fading.indexOf(mesh), 1);
      }
    }
    if (this.queued && this.fading.length < SKY_LAYERS) this.show(this.queued);
  }

  render(renderer, camera) {
    // (half by default: the blocks far off in it want the sharpness; see look.skyScale)
    renderer.getDrawingBufferSize(this.size).multiplyScalar(look.skyScale).ceil();
    if (this.size.x !== this.target.width || this.size.y !== this.target.height) this.target.setSize(this.size.x, this.size.y);
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, camera);
    renderer.setRenderTarget(null);
  }
}

// The other dimensions, each a grid of its own whose sectors are made in the page (nothing in them is
// asked of the server): how their places are told apart from the void's, and what stands in each.
// The plugins add them (see addRealm).
const REALMS = {};
export function addRealm(name, prefix, spec) {
  REALMS[name] = { prefix, spec };
}

// where the void's glow is (past the hub's clock, as you arrive), and the light on its blocks
const HAZE = new THREE.Vector3(0.768, -0.105, 0.632).normalize(), KEY = new THREE.Vector3(-0.35, 0.62, -0.7).normalize();

const GHOST = normalizeSpec({
  palette: { fog: "#05060c", deep: "#010103", glow: "#3a4466", accent: "#59648a" },
  fogDensity: 0.5,
  sound: { root: 41, mode: "phrygian", shimmer: 0.05, darkness: 0.9 },
});

export class World {
  constructor(scene, renderer, { onSector, onSpec }) {
    this.scene = scene;
    this.renderer = renderer;
    this.onSector = onSector;
    this.onSpec = onSpec;
    this.G = {
      uTime: { value: 0 }, uPx: { value: 1 }, uLight: { value: 1 },
      // what the sound is doing right now; each drives a different part of the picture
      uBass: { value: 0 }, uMid: { value: 0 }, uHigh: { value: 0 }, uBeat: { value: 0 },
      uPulse: { value: 0 }, // 0..1: the nebula on a song's beat, as it lands (a plugin's doing, each frame: see main.js)
      uChan: { value: new Float32Array(18).fill(0.5) },
      uRainbowAll: { value: 0 }, // 0..1: the whole void taken over by the running rainbow (a plugin's doing)
      // 0..1: how far the pieces are pale solid blocks lit from the eye, not dark ones drawn by their lit edges,
      // with the haze far off and the little lamps among the motes (the void's look, and a dimension's that
      // asks for it: see enter)
      uSolid: { value: 1 },
      uHazeDir: { value: HAZE.clone() }, uKeyLight: { value: KEY.clone() }, // (where the glow is; the light the blocks have)
      // the blocks far off in the sky: how many (x1; a dimension's spec.blocks), and how far a light show
      // lights them (0..1; let go on leaving its dimension), its five groups of lights each as bright as it
      // is and in its colour (a plugin's doing, each frame: see saber)
      uBlocksMany: { value: 1 }, uBlocksLit: { value: 0 },
      uBlocksLights: { value: new Float32Array(5) }, uBlocksColours: { value: Array.from({ length: 5 }, () => new THREE.Color()) },
      uMote: { value: new THREE.Color() }, // motes in the air's colours (see spec.air)
      uFogColor: { value: new THREE.Color(ORIGIN.palette.fog) }, uFogDensity: { value: 0.0022 / SIGHT },
      uDeep: { value: new THREE.Color(ORIGIN.palette.deep) }, uGlow: { value: new THREE.Color(ORIGIN.palette.glow) },
      uAccent: { value: new THREE.Color(ORIGIN.palette.accent) },
    };
    this.target = {
      fog: this.G.uFogColor.value.clone(), deep: this.G.uDeep.value.clone(),
      glow: this.G.uGlow.value.clone(), accent: this.G.uAccent.value.clone(), density: 0.0022 / SIGHT,
    };
    this.cells = new Map();
    this.realm = "void"; // or a dimension of a plugin's (see addRealm)
    this.specs = new Map([["0,0,0", normalizeSpec(ORIGIN)]]);
    this.probed = new Set();
    this.probing = new Set();
    this.pending = new Set();
    this.offline = false;
    this.currentKey = null;
    this.currentSpec = undefined;
    this.tick = 0;
    // the entity can turn the lights down and draw the fog in
    this.light = 1;
    this.fogBoost = 1;
    this.slow = 1; // flight speed factor, lowered near a recursion
    this.sky = new Sky(this);

    // Fine dust that is always around you, wherever you are: it drifts past as you fly, so that
    // even the emptiest stretch has texture and a sense of speed. It wraps round the traveller,
    // so it never runs out.
    const n = 2600, box = 1800, at = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n * 3; i++) at[i] = (Math.random() - 0.5) * box;
    for (let i = 0; i < n; i++) seed[i] = Math.random();
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(at, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    this.dust = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { uTime: this.G.uTime, uPx: this.G.uPx, uBox: { value: box }, uCam: { value: new THREE.Vector3() }, uGlow: this.G.uGlow, uLight: this.G.uLight },
      vertexShader: `attribute float aSeed; uniform float uTime, uPx, uBox; uniform vec3 uCam; varying float vA;
        void main(){
          vec3 p = position + vec3(sin(uTime * 0.05 + aSeed * 40.), cos(uTime * 0.04 + aSeed * 23.), sin(uTime * 0.03 + aSeed * 61.)) * 30.;
          p = uCam + mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5; // always the box around you
          vec4 mv = modelViewMatrix * vec4(p, 1.);
          float d = length(mv.xyz);
          gl_PointSize = clamp(uPx * (1.2 + aSeed * 2.) * 260. / max(d, 1.), 1., 6.);
          vA = (1. - smoothstep(uBox * 0.25, uBox * 0.5, d)) * smoothstep(8., 40., d) * (0.35 + 0.65 * sin(uTime * (0.4 + aSeed) + aSeed * 90.) * 0.5 + 0.325);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform vec3 uGlow; uniform float uLight; varying float vA;
        void main(){ float d = length(gl_PointCoord - .5) * 2.; gl_FragColor = vec4(mix(vec3(0.85, 0.9, 1.), uGlow, 0.45) * pow(max(1. - d, 0.), 1.5) * vA * 0.55 * min(uLight, 1.2), 1.); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.dust.frustumCulled = false;
    scene.add(this.dust);
    this.worms = new Worms(this); // (the light worms: see worms.js)
  }

  // The sectors' shaders made before a sector needs them, as saber makes a map's (one first met holds its frame
  // while it is made: for seconds in a headset's own browser): each kind of piece (a cube, a faceted solid, a
  // recursion of either), the motes, the orbs; for a picture drawn into target (the screen's passes), or straight
  // into the headset (null: another program, its tone mapping its own). Kept, so their programs are kept
  warm(camera, target) {
    const { renderer } = this, stage = new THREE.Scene(), additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
    for (const primitive of ["cube", "tetra"]) for (const fractal of [false, true]) {
      const material = new THREE.ShaderMaterial({ vertexShader: BOX_VERT, fragmentShader: BOX_FRAG, defines: { ...(primitive === "cube" ? {} : { BARY: 1 }), ...(fractal ? { FRACTAL: 1 } : {}) } });
      stage.add(new THREE.InstancedMesh(PRIMITIVES[primitive], material, 1));
    }
    const points = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
    stage.add(new THREE.Points(points, new THREE.ShaderMaterial({ vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, ...additive })));
    stage.add(new THREE.Points(points, new THREE.ShaderMaterial({ vertexShader: ORB_VERT, fragmentShader: ORB_FRAG, ...additive })));
    (this.warmed ??= []).push(stage);
    const was = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    const done = renderer.compileAsync(stage, camera).catch(() => {});
    renderer.setRenderTarget(was);
    return done;
  }

  key(x, y, z) {
    return `${REALMS[this.realm]?.prefix ?? ""}${x},${y},${z}`;
  }

  // A sector of the void seen from outside it, from another dimension (the saber plugin's Auto Vivify takes you to the
  // hub through its black hole while you play, and draws it round you): built apart from the sectors round you, never
  // one of them, hidden but for whoever draws it, in the void's own air for that drawing (see air). x, y, z: which (the
  // hub's, by default: its clock); raw: its spec, where it is not known here (one fetched from the server's cache). Null
  // if it is not known.
  glimpse(x = 0, y = 0, z = 0, raw = null) {
    const spec = raw ? normalizeSpec(raw) : this.specs.get(`${x},${y},${z}`);
    if (!spec || spec.partial) return null;
    const cell = new Cell(this, x, y, z);
    cell.group.visible = false;
    cell.materialize(spec);
    cell.mat.value = cell.built.value = 1; cell.dustMat.value = 0.5; // (all there at once: no growing in, as it is come to)
    const air = this.air(spec, { solid: true });
    // (its things turned and faded in as they are round you; a recursion's descent asks where the eye is: far off)
    const far = { position: new THREE.Vector3(1e9, 1e9, 1e9) };
    return {
      root: cell.group, spec, deep: new THREE.Color(spec.palette.deep),
      update: (dt) => cell.update(dt, far),
      begin: () => { cell.group.visible = true; air.begin(); },
      end: () => { cell.group.visible = false; air.end(); },
      dispose: () => cell.dispose(),
    };
  }

  // A place's air (its fog, its colours, the void's look or a dimension's, as enter has them), put on for a drawing and
  // taken off after: for what is drawn from somewhere you are not (see glimpse, and the plugins' own glimpses)
  air(spec, { solid = !!spec.solid } = {}) {
    const G = this.G, kept = {};
    const want = {
      uFogColor: new THREE.Color(spec.palette.fog), uDeep: new THREE.Color(spec.palette.deep), uGlow: new THREE.Color(spec.palette.glow),
      uAccent: new THREE.Color(spec.palette.accent), uFogDensity: (0.0017 + (spec.fogDensity ?? 0.1) * 0.003) / SIGHT,
      uSolid: solid ? 1 : 0, uBlocksMany: spec.blocks ?? 1, uLight: 1,
    };
    return {
      begin() {
        for (const [k, v] of Object.entries(want)) {
          if (v.isColor) { (kept[k] ??= new THREE.Color()).copy(G[k].value); G[k].value.copy(v); }
          else { kept[k] = G[k].value; G[k].value = v; }
        }
      },
      end() { for (const [k, v] of Object.entries(kept)) { if (v.isColor) G[k].value.copy(v); else G[k].value = v; } },
    };
  }

  // Step into another grid of sectors: everything loaded is dropped and rebuilt around the traveller.
  setRealm(realm) {
    for (const cell of this.cells.values()) cell.dispose();
    this.cells.clear();
    this.realm = realm;
    this.G.uBlocksLit.value = 0;
    // the pale blocks, the haze and the little lamps are the void's; the other dimensions keep their own look
    this.currentKey = null;
    this.currentSpec = undefined;
    this.light = 1;
    this.fogBoost = 1;
  }

  // A dimension takes another look (moving on to another stage, say): its sectors are asked
  // again what they are, where they stand. Nothing is built again; the colours ease over and the sky
  // fades across (see enter and Sky).
  restyle(realm) {
    const of = REALMS[realm];
    if (!of) return;
    for (const k of this.specs.keys()) {
      if (!k.startsWith(of.prefix)) continue;
      const [x, y, z] = k.slice(of.prefix.length).split(",").map(Number);
      this.specs.set(k, normalizeSpec(of.spec(x, y, z)));
      this.onSpec(k, this.specs.get(k));
    }
  }

  setSpec(k, raw) {
    const known = this.specs.get(k);
    if (known && !(known.partial && !raw.partial)) return;
    this.specs.set(k, normalizeSpec(raw));
    this.onSpec(k, this.specs.get(k));
    this.cells.get(k)?.materialize(this.specs.get(k));
  }

  goOffline() {
    this.offline = true;
    // cells still waiting on a cache probe resolve themselves: the server may hold a sector Claude dreamt earlier
    for (const [k, cell] of this.cells) {
      if (!cell.spec && !this.probing.has(k)) this.setSpec(k, localSpec(...cell.coords));
    }
  }

  // Ask the server for a sector. cachedOnly never triggers a new Claude call.
  async request(x, y, z, cachedOnly) {
    const k = this.key(x, y, z);
    if (this.specs.has(k)) return;
    if (cachedOnly) {
      if (this.probed.has(k)) return;
      this.probed.add(k);
      this.probing.add(k);
    } else {
      // voids are never sent to Claude; the cache probe settles them (something may have been dreamt there before voids existed)
      if (population(x, y, z) === "void") return;
      if (this.offline) return this.probing.has(k) ? undefined : this.setSpec(k, localSpec(x, y, z));
      if (this.pending.has(k)) return;
      this.pending.add(k);
    }
    let status = 0, early = null;
    try {
      const res = await fetch(`/api/sector?x=${x}&y=${y}&z=${z}${cachedOnly ? "&cached=1" : ""}`);
      status = res.status;
      if (status === 200 && cachedOnly) this.setSpec(k, await res.json());
      else if (status === 200) {
        // lines arrive as Claude writes: first the geometry, then the complete sector
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          for (let nl; (nl = buffer.indexOf("\n")) >= 0; buffer = buffer.slice(nl + 1)) {
            const message = JSON.parse(buffer.slice(0, nl));
            if (message.error) status = message.offline ? 503 : 500;
            else {
              if (message.partial) early = message;
              this.setSpec(k, message);
            }
          }
        }
      } else if (res.headers.has("x-vvoid-offline")) status = 503;
    } catch {
      status = 503;
    }
    (cachedOnly ? this.probing : this.pending).delete(k);
    if (cachedOnly && status === 204 && population(x, y, z) === "void") this.setSpec(k, voidSpec());
    // the stream died after the geometry arrived: keep what we have rather than swapping the place out
    if (early && this.specs.get(k)?.partial) this.setSpec(k, { ...early, partial: false });
    if (status === 503) {
      this.setSpec(k, localSpec(x, y, z));
      this.goOffline();
    } else if (status !== 200 && status !== 204) {
      this.setSpec(k, localSpec(x, y, z));
    }
  }

  // You against everything built in the sectors near you. Nothing is solid in a place that says so
  // (spec.passable): a maze that lets go only of someone who surges, where walls would trap them.
  collide(position, velocity, radius) {
    if (this.currentSpec?.passable) return 0;
    let impact = 0;
    for (const cell of this.cells.values()) {
      if (!cell.solids.length) continue;
      const c = cell.group.position, near = CELL / 2 + 1800;
      if (Math.abs(position.x - c.x) > near || Math.abs(position.y - c.y) > near || Math.abs(position.z - c.z) > near) continue;
      impact = Math.max(impact, cell.collide(position, velocity, radius));
    }
    return impact;
  }

  enter(spec, quiet = false) {
    this.currentSpec = spec;
    const s = spec ?? GHOST;
    // The void keeps one look everywhere: the fog, the far sky and how far you can see are the
    // hub's, whatever sector you are in. Sectors differ in what stands in them (their own colours
    // are on their structures), not in the air around them. His dimension has its own look.
    const air = this.realm !== "void" ? s : this.specs.get("0,0,0");
    this.target.fog.set(air.palette.fog);
    this.target.deep.set(air.palette.deep);
    this.target.glow.set(air.palette.glow);
    this.target.accent.set(air.palette.accent);
    // (unless an admin lets each sector's own colours into the air, some of the way: see look.js)
    if (spec && air !== s && look.sectorColours > 0) {
      const k = look.sectorColours;
      this.target.fog.lerp(tint.set(s.palette.fog), k);
      this.target.deep.lerp(tint.set(s.palette.deep), k);
      this.target.glow.lerp(tint.set(s.palette.glow), k);
      this.target.accent.lerp(tint.set(s.palette.accent), k);
    }
    this.target.density = (0.0017 + air.fogDensity * 0.003) / SIGHT;
    // the void's look (pale blocks, the haze, the blocks far off in the sky), and a dimension's that asks
    // for it (spec.solid), its glow where it says (spec.haze) and the light on the blocks turned with it
    this.G.uSolid.value = this.realm === "void" || air.solid ? 1 : 0;
    this.G.uBlocksMany.value = air.blocks;
    const haze = this.G.uHazeDir.value.copy(air.haze ? dummy.position.fromArray(air.haze) : HAZE);
    this.G.uKeyLight.value.copy(KEY).applyAxisAngle(dummy.up, Math.atan2(haze.x, haze.z) - Math.atan2(HAZE.x, HAZE.z));
    // each sector its own nebula, or the hub's (the dimension's) everywhere: an admin's (see look.js)
    if (spec && !spec.partial) this.sky.setField(look.sectorSky >= 0.5 ? spec.fieldGlsl : air.fieldGlsl);
    if (!quiet) this.onSector(spec, s, this.currentKey);
  }

  // What is drawn round the eye, the sky and the dust, put round this camera for the picture: the idle
  // camera shoots from elsewhere, and the void is all round it there too (see cinema.js; the next
  // update puts them round you again). The nebula is the same one: it is seen from where you have flown.
  surround(camera) {
    for (const mesh of [this.sky.current, ...this.sky.fading]) mesh?.position.copy(camera.position);
    this.dust.material.uniforms.uCam.value.copy(camera.position);
  }

  // (unseen: a plugin draws the picture itself, the headset's (see saber): the worms, seen by nobody, left as
  // they are, and put round you again when they are seen)
  update(dt, camera, unseen = false) {
    const G = this.G;
    G.uTime.value += dt;
    const cx = Math.round(camera.position.x / CELL), cy = Math.round(camera.position.y / CELL), cz = Math.round(camera.position.z / CELL);

    // Crossing into a sector brings a whole slab of new ones into reach: they are built one a frame,
    // the one you are in first, then the nearest, so no single frame carries all of them.
    let nearest = null, best = Infinity;
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) for (let z = cz - 1; z <= cz + 1; z++) {
      if (this.cells.has(this.key(x, y, z))) continue;
      const d = (x * CELL - camera.position.x) ** 2 + (y * CELL - camera.position.y) ** 2 + (z * CELL - camera.position.z) ** 2;
      if (d < best) { best = d; nearest = [x, y, z]; }
    }
    if (nearest) {
      const [x, y, z] = nearest, k = this.key(x, y, z);
      const cell = new Cell(this, x, y, z);
      this.cells.set(k, cell);
      // the other dimensions are generated here; nothing in them is asked of the server
      const local = REALMS[this.realm]?.spec ?? null;
      if (local && !this.specs.has(k)) this.setSpec(k, local(x, y, z));
      else if (this.specs.has(k)) cell.materialize(this.specs.get(k));
      else this.request(x, y, z, true);
    }
    this.slow = 1;
    for (const [k, cell] of this.cells) {
      const [x, y, z] = cell.coords;
      if (Math.max(Math.abs(x - cx), Math.abs(y - cy), Math.abs(z - cz)) > 2) {
        cell.dispose();
        this.cells.delete(k);
      } else {
        cell.update(dt, camera);
      }
    }

    // Only the sector you are in and the two you are looking toward are sent to Claude.
    this.tick -= dt;
    if (this.tick <= 0 && this.realm === "void") {
      this.tick = 0.4;
      this.request(cx, cy, cz, false);
      const heading = camera.getWorldDirection(dummy.scale);
      for (const reach of [0.75, 1.75]) {
        if (this.pending.size >= 3) break;
        const ahead = dummy.position.copy(camera.position).addScaledVector(heading, CELL * reach);
        this.request(Math.round(ahead.x / CELL), Math.round(ahead.y / CELL), Math.round(ahead.z / CELL), false);
      }
    }

    const k = this.key(cx, cy, cz);
    const spec = this.specs.get(k);
    if (k !== this.currentKey || spec !== this.currentSpec) {
      this.currentKey = k;
      this.enter(spec);
    }

    // the air of one sector into the next's: slowly, over seconds, never a step
    // (an admin turning how a sector's air and sky are taken: the one you are in taken again at once)
    const taken = `${look.sectorSky}|${look.sectorColours}`;
    if (taken !== this.taken) { if (this.taken !== undefined && this.currentKey) this.enter(this.currentSpec, true); this.taken = taken; }
    const ease = 1 - Math.exp(-dt * look.airEase); // (how fast: an admin's, see look.js)
    G.uFogColor.value.lerp(this.target.fog, ease);
    G.uDeep.value.lerp(this.target.deep, ease);
    G.uGlow.value.lerp(this.target.glow, ease);
    G.uAccent.value.lerp(this.target.accent, ease);
    G.uMote.value.copy(G.uGlow.value).lerp(G.uAccent.value, 0.3);
    G.uFogDensity.value += (this.target.density * this.fogBoost - G.uFogDensity.value) * ease;
    G.uLight.value += (this.light - G.uLight.value) * (1 - Math.exp(-dt * 0.6));
    this.sky.update(dt, camera);
    if (unseen) this.worms.placed = false;
    else this.worms.update(dt, camera);
    this.dust.material.uniforms.uCam.value.copy(camera.position);
  }
}
