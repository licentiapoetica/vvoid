// The numbers of how it runs, over the picture (F4, remembered): how many frames a second and how even they are,
// how long vvoid's own work takes in a frame, what is drawn (calls, triangles) and kept (programs, geometries,
// textures, memory), the picture's size, the graphics card; and each plugin's own lines (its metrics hook: the saber
// plugin's song, its map's world). For finding what is wrong, not for the look: plain, small, in a corner.
import * as THREE from "three";

const WINDOW = 2; // seconds of frames the frame numbers are taken over
const SLOW = 1000 / 45; // a frame longer than this (ms) counted as slow

export class PerfHud {
  constructor({ renderer, stored, store }) {
    this.renderer = renderer;
    this.store = store;
    this.frames = []; // [at (ms), interval (ms), work (ms)]
    this.el = document.createElement("pre");
    this.el.id = "perfHud";
    Object.assign(this.el.style, {
      position: "fixed", top: "10px", right: "10px", zIndex: 50, margin: 0, padding: "8px 10px", maxWidth: "46ch",
      font: "11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace", color: "#d8d0ff", whiteSpace: "pre-wrap",
      background: "rgba(8, 6, 20, 0.72)", border: "1px solid rgba(150, 120, 255, 0.35)", borderRadius: "6px",
      pointerEvents: "none", display: "none",
    });
    document.body.append(this.el);
    this.shown = !!stored("perfHud", false);
    this.el.style.display = this.shown ? "block" : "none";
    this.next = 0;
    // (the card's name, where the browser tells it)
    const gl = renderer.getContext(), ext = gl.getExtension("WEBGL_debug_renderer_info");
    this.gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "(not told)";
  }
  toggle() {
    this.shown = !this.shown;
    this.el.style.display = this.shown ? "block" : "none";
    this.store("perfHud", this.shown);
    return this.shown;
  }
  // each frame: when it began (ms), the time since the last, and how long vvoid's own work in it took
  record(at, interval, work) {
    this.frames.push([at, interval, work]);
    while (this.frames.length && this.frames[0][0] < at - WINDOW * 1000) this.frames.shift();
  }
  // a few times a second, while shown: the numbers again (drawn: the last whole frame's, see main.js's lastDrawn)
  update(now, { drawn, extra }) {
    if (!this.shown || now < this.next) return;
    this.next = now + 250;
    const f = this.frames;
    if (!f.length) return;
    const gaps = f.map((x) => x[1]).filter((x) => x > 0), works = f.map((x) => x[2]);
    const span = (f.at(-1)[0] - f[0][0]) / 1000 || 1;
    const sorted = [...gaps].sort((a, b) => b - a), low = sorted[Math.floor(sorted.length / 100)] ?? sorted[0] ?? 0;
    const avg = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
    const info = this.renderer.info, mem = performance.memory, r = this.renderer;
    const size = r.getDrawingBufferSize(this._size ??= new THREE.Vector2());
    const lines = [
      `${(f.length / span).toFixed(0)} fps · ${avg(gaps).toFixed(1)} ms a frame, worst ${(sorted[0] ?? 0).toFixed(1)} ms · 1% low ${low ? (1000 / low).toFixed(0) : "-"} fps`,
      `slow (> ${SLOW.toFixed(0)} ms): ${gaps.filter((x) => x > SLOW).length} of ${gaps.length} in ${WINDOW} s`,
      `vvoid's work: ${avg(works).toFixed(1)} ms a frame, worst ${Math.max(...works).toFixed(1)} ms`,
      `drawn: ${drawn.calls} calls · ${drawn.triangles.toLocaleString("en")} triangles`,
      `kept: ${info.programs?.length ?? "?"} programs · ${info.memory.geometries} geometries · ${info.memory.textures} textures`,
      mem ? `memory (JS): ${(mem.usedJSHeapSize / 1048576).toFixed(0)} of ${(mem.jsHeapSizeLimit / 1048576).toFixed(0)} MB` : null,
      `picture: ${size.x} × ${size.y} (pixel ratio ${r.getPixelRatio().toFixed(2)})`,
      `card: ${this.gpu}`,
      ...extra,
    ].filter(Boolean);
    this.el.textContent = lines.join("\n");
  }
}
