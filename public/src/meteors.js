// Shooting stars, far out in the void: now and then (every ten to thirty seconds or so) a thin streak of
// light crosses a little of the dark and is gone in a second (now and then a long one, its trail drawn far
// out behind it, for two), its head bright, its tail fading behind it,
// tinged with the void's own glow. More often somewhere you are looking, so they are seen. They are as far as anything is drawn and move with you, as the stars do, so no flight
// brings you nearer to them; whatever stands nearer passes in front of them.
import * as THREE from "three";

const FAR = 16000;            // how far out they cross (just inside what is drawn at all: see the camera)
const WIDE = 120;             // the head's width there (two or three pixels)
const MOST = 2;               // at once, at most
const LONG = 0.25;            // how many of them are long ones, with long trails

const VERT = /* glsl */ `attribute float aAlong; attribute float aSide; varying float vAlong; varying float vSide;
void main() { vAlong = aAlong; vSide = aSide; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;
// along: 0 at the end of its tail, 1 at its head; side: -1 to 1 across it
const FRAG = /* glsl */ `uniform vec3 uColor; uniform float uShow; varying float vAlong; varying float vSide;
void main() {
  float across = 1. - smoothstep(.15, 1., abs(vSide));
  float tail = pow(vAlong, 1.7);
  float head = smoothstep(.9, 1., vAlong) * .8;
  float a = (tail + head) * across * uShow * 1.5;
  gl_FragColor = vec4(mix(uColor, vec3(1.), .55 * vAlong) * a, 1.); // (added as it is: its alpha would dim it twice)
}`;

const ahead = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3(), toYou = new THREE.Vector3();
const head = new THREE.Vector3(), tail = new THREE.Vector3(), along = new THREE.Vector3();
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

export class Meteors {
  constructor({ scene, world }) {
    this.world = world;
    this.next = rand(6, 14); // seconds to the first
    this.stars = Array.from({ length: MOST }, () => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(4 * 3), 3));
      geometry.setAttribute("aAlong", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 1]), 1));
      geometry.setAttribute("aSide", new THREE.BufferAttribute(new Float32Array([-1, 1, -1, 1]), 1));
      geometry.setIndex([0, 2, 1, 2, 3, 1]);
      const material = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, uniforms: { uColor: { value: new THREE.Color() }, uShow: { value: 0 } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, forceSinglePass: true,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, life: 0, age: 0, from: new THREE.Vector3(), way: new THREE.Vector3(), sweep: 0, length: 0 };
    });
  }

  // one starts: somewhere in the sky (two times in three where you are looking, else anywhere above the
  // horizon or a little under it), crossing it on a slant, mostly downwards, as they do
  launch(star, camera) {
    camera.getWorldDirection(ahead);
    const from = star.from;
    if (Math.random() < 0.66) {
      from.copy(ahead).add(side.set(rand(-0.75, 0.75), rand(-0.1, 0.5), rand(-0.75, 0.75))).normalize();
    } else {
      const a = Math.random() * Math.PI * 2, y = rand(-0.15, 0.8), r = Math.sqrt(1 - y * y);
      from.set(Math.cos(a) * r, y, Math.sin(a) * r);
    }
    // the way it goes: across the sky at that point (perpendicular to it), slanting downwards
    side.crossVectors(from, up).normalize();
    star.way.copy(side).multiplyScalar(Math.random() < 0.5 ? -1 : 1).addScaledVector(up, -rand(0.3, 1.1)).projectOnPlane(from).normalize();
    // now and then (one in four or so) a long one: slower, further round the sky, its tail drawn out behind it
    const long = Math.random() < LONG;
    star.life = long ? rand(1.4, 2.4) : rand(0.55, 1.2);
    star.age = 0;
    star.sweep = long ? rand(0.35, 0.6) : rand(0.1, 0.24);   // how far round the sky its head goes, in radians
    star.length = long ? rand(0.22, 0.4) : rand(0.05, 0.11); // and its longest tail
    // tinged with the void's glow, mostly white
    star.mesh.material.uniforms.uColor.value.copy(this.world.G.uGlow.value).lerp(new THREE.Color(1, 1, 1), 0.45);
    star.mesh.visible = true;
  }

  update(dt, camera) {
    // only in the void itself (the other dimensions have skies of their own)
    const here = this.world.realm === "void";
    if (here && (this.next -= dt) <= 0) {
      this.next = rand(9, 30);
      const free = this.stars.find((s) => !s.mesh.visible);
      if (free) this.launch(free, camera);
    }
    for (const star of this.stars) {
      if (!star.mesh.visible) continue;
      star.age += dt;
      const k = star.age / star.life;
      if (k >= 1 || !here) { star.mesh.visible = false; continue; }
      // its head runs on, quick at first and slowing a little; its tail grows behind it, then thins away
      const run = 1 - (1 - k) ** 1.6, tailLength = star.length * Math.sin(Math.min(1, k * 1.25) * Math.PI) ** 0.7;
      side.crossVectors(star.from, star.way).normalize(); // (the axis it turns round the sky on)
      head.copy(star.from).applyAxisAngle(side, star.sweep * run);
      tail.copy(head).addScaledVector(along.copy(star.way).applyAxisAngle(side, star.sweep * run), -tailLength).normalize();
      head.multiplyScalar(FAR).add(camera.position);
      tail.multiplyScalar(FAR).add(camera.position);
      // a ribbon facing you, wide at its head, narrowing to its tail
      toYou.copy(camera.position).sub(head).normalize();
      side.subVectors(head, tail).cross(toYou).normalize();
      const p = star.mesh.geometry.attributes.position, w = WIDE * 0.5;
      p.setXYZ(0, tail.x - side.x * w * 0.2, tail.y - side.y * w * 0.2, tail.z - side.z * w * 0.2);
      p.setXYZ(1, tail.x + side.x * w * 0.2, tail.y + side.y * w * 0.2, tail.z + side.z * w * 0.2);
      p.setXYZ(2, head.x - side.x * w, head.y - side.y * w, head.z - side.z * w);
      p.setXYZ(3, head.x + side.x * w, head.y + side.y * w, head.z + side.z * w);
      p.needsUpdate = true;
      // in and out softly
      star.mesh.material.uniforms.uShow.value = Math.min(1, k * 8, (1 - k) * 4) * 0.9;
    }
  }
}
