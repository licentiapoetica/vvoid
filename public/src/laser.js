// Lasers: a beam of light from just under your sight to what you shot at (a portal clicked, or V: just
// ahead, into the dark), its tip racing out, light running along it, held while you fly where it points
// and then faded. The same beam as the f0ck plugin's at its posts. Anyone else's (see the together
// plugin) is drawn here too, in their colour, from where they are.
//
// Every shot of your own is told to whoever listens (onShot), as two points: where from, where to.
import * as THREE from "three";

const GEO = new THREE.CylinderGeometry(2.4, 0.3, 1, 8, 1, true).translate(0, 0.5, 0); // along +y, 0 (its start) to 1 (its end)
const VERT = /* glsl */ `varying float vT; void main(){ vT = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;
const FRAG = /* glsl */ `uniform vec3 uColor; uniform float uHead, uFade, uLen, uTime; varying float vT;
void main(){
  if (vT > uHead) discard;
  float tip = exp(-(uHead - vT) * uLen / 60.) * (uHead < 1. ? 1. : .35);
  float run = pow(.5 + .5 * sin(vT * uLen / 90. - uTime * 14.), 6.);
  float a = (.24 + .4 * run + 1.4 * tip) * smoothstep(0., .12, vT) * uFade;
  gl_FragColor = vec4(uColor * a, 1.);
}`;
const SHOT = 0.35;     // seconds its tip takes to get there (a long one a little longer)
const FADE = 0.9;      // seconds it fades in, once there (and no longer held)
const MOST = 24;       // beams at once, everyone's together: the oldest goes first
const UP = new THREE.Vector3(0, 1, 0), WHITE = new THREE.Color(1, 1, 1);
const way = new THREE.Vector3(), down = new THREE.Vector3();

export class Lasers {
  constructor({ scene, world }) {
    Object.assign(this, { scene, world });
    this.beams = [];
    this.listeners = [];
  }

  // where a shot of yours starts: just under the crosshair, a little ahead
  muzzle(camera, out = new THREE.Vector3()) {
    return out.copy(camera.position).addScaledVector(camera.getWorldDirection(way), 90).add(down.set(0, -18, 0).applyQuaternion(camera.quaternion));
  }

  // A beam. from and to: points (to may be one that moves, a portal floating along: it is followed);
  // colour: its own (else the void's glow, paled); hold(): kept while true, after its tip is there;
  // fade: seconds it takes to fade after that; mine: yours, so told to the listeners (another's, drawn only)
  shoot({ from, to, colour = null, hold = null, fade = FADE, mine = true }) {
    if (this.beams.length >= MOST) this.drop(this.beams[0]);
    const u = { uColor: { value: new THREE.Color() }, uHead: { value: 0 }, uFade: { value: 1 }, uLen: { value: 1 }, uTime: this.world.G.uTime };
    const mesh = new THREE.Mesh(GEO, new THREE.ShaderMaterial({
      uniforms: u, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, forceSinglePass: true,
    }));
    mesh.frustumCulled = false;
    mesh.raycast = () => {};
    this.scene.add(mesh);
    const beam = { mesh, u, from: from.clone(), to, colour, hold, fade, realm: this.world.realm };
    this.beams.push(beam);
    this.place(beam);
    if (mine) for (const listen of this.listeners) listen(beam.from, to.clone());
    return beam;
  }

  // a shot of yours drawn by something else (the f0ck plugin draws its own at its posts), only told
  told(from, to) {
    for (const listen of this.listeners) listen(from.clone(), to.clone());
  }

  onShot(listen) { this.listeners.push(listen); }

  update(dt) {
    for (const beam of [...this.beams]) {
      const { u } = beam;
      if (beam.realm !== this.world.realm) { this.drop(beam); continue; } // (left behind in another dimension)
      u.uHead.value = Math.min(1, u.uHead.value + dt / (SHOT * Math.min(2, Math.max(1, u.uLen.value / 3000))));
      if (u.uHead.value >= 1 && !beam.hold?.()) u.uFade.value -= dt / beam.fade;
      if (u.uFade.value <= 0) { this.drop(beam); continue; }
      this.place(beam);
    }
  }

  place(beam) {
    const { mesh, u } = beam;
    way.copy(beam.to).sub(beam.from);
    const length = way.length();
    mesh.position.copy(beam.from);
    mesh.quaternion.setFromUnitVectors(UP, way.divideScalar(length || 1));
    mesh.scale.set(1, length, 1);
    u.uLen.value = length;
    if (beam.colour) u.uColor.value.copy(beam.colour);
    else u.uColor.value.copy(this.world.G.uGlow.value).lerp(WHITE, 0.35);
  }

  drop(beam) {
    this.scene.remove(beam.mesh);
    beam.mesh.material.dispose();
    this.beams.splice(this.beams.indexOf(beam), 1);
  }
}
