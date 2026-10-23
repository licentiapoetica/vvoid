// Locks, the page's side (the server's is locks.js, beside server.js): which plugins are behind a password,
// whether this page has their session, and the password asked at a portal. None is locked unless a
// password is set (VVOID_PASSWORD for all, VVOID_<NAME>_PASSWORD for one). Every portal asks it on its
// own (window.vvoid.locked(realm, retry), see main.js); `ask(name)` puts the password on the screen and
// answers whether it opened.
const SAID = { "x-vvoid-lock": "1" }; // (every request that changes something says it comes from this page)
const NO_ANSWER = "vvoid's server does not answer";
const REFUSED_FOR = 0.7; // s the refusal is seen on the gate before it closes

export class Locks {
  constructor() {
    this.open = new Map(); // plugin name -> whether this page has its session (only the locked ones)
    this.asking = null;    // the plugin whose password is on the screen
    this.refused = null;   // refused(name, why): a wrong password given (the void answers it: see main.js)
    this.declined = null;  // declined(name): turned away with none given, Esc (the void answers that too: see main.js)
    this.looks = new Map(); // plugin name -> its gate's { title, color }, as it set them (wherever it is asked from)
    this.forget = new Set();  // the plugins whose password is not remembered: asked every time (VVOID_REMEMBER unset)
    this.leaving = new Map(); // plugin name -> what it does when its session is let go (see onLeave)
    this.keeping = new Map(); // plugin name -> while it answers true, its session outlives leaving its dimensions (see keep)
    // and a reload: the plugins whose session was being kept as the page went (a call) are not let go as
    // it loads again (see load), so what kept it may come back (the plugin lets it go itself, if it does not)
    try { this.keptOver = new Set(JSON.parse(sessionStorage.getItem("vvoid.kept")) ?? []); sessionStorage.removeItem("vvoid.kept"); } catch { this.keptOver = new Set(); }
    addEventListener("pagehide", () => {
      const kept = [...this.keeping].filter(([name, fn]) => this.open.get(name) && fn()).map(([name]) => name);
      try { sessionStorage.setItem("vvoid.kept", JSON.stringify(kept)); } catch { /* private mode: let go as it loads again */ }
    });
    this.gate = Object.assign(document.createElement("div"), { id: "lockGate" });
    this.gate.innerHTML = `<div class="gate-box"><h2></h2><input type="password" autocomplete="current-password" spellcheck="false"><p class="why"></p><p class="hint">the password · enter to go in · esc to stay</p></div>`;
    document.body.append(this.gate);
    this.input = this.gate.querySelector("input");
    this.why = this.gate.querySelector(".why");
    // typed here, not flown
    for (const type of ["keydown", "keyup", "keypress"]) this.gate.addEventListener(type, (e) => e.stopPropagation());
    this.gate.addEventListener("keydown", (e) => this.typed(e));
    // (clicked anywhere on it, the password keeps the keys: Esc and Enter always reach it)
    this.gate.addEventListener("mousedown", (e) => { if (e.target !== this.input) { e.preventDefault(); this.input.focus(); } });
  }
  // which are locked, and whether this page is in (once, as the page loads; one not remembered is let go
  // at once, if a session of it was left from before: it is asked every time; but for one kept as the page
  // was reloaded, see keptOver)
  async load() {
    const names = await fetch("/api/locks").then((r) => (r.ok ? r.json() : [])).catch(() => []);
    await Promise.all(names.map(async (name) => {
      await this.check(name);
      if (this.forget.has(name) && this.open.get(name) && !this.keptOver.has(name)) await this.leave(name);
    }));
  }
  // the plugins installed: one kept over the reload that is not there (to let it go) is let go now
  settle() {
    for (const name of this.keptOver) if (!this.keeping.has(name)) this.left(name);
    this.keptOver.clear();
  }
  async check(name) {
    const s = await fetch(`/plugins/${name}/lock`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (s?.locked) this.open.set(name, !!s.open);
    else this.open.delete(name);
    if (s?.locked && !s.remember) this.forget.add(name);
    else this.forget.delete(name);
    return s;
  }
  // what the plugin does when its session is let go (its own state of being in, dropped)
  onLeave(name, fn) { this.leaving.set(name, fn); }
  // what keeps its session as you leave its dimensions (something of it taken along: a call);
  // once that is over, out of them still, the plugin calls left(name) itself (and so too after a reload
  // that kept it, once what kept it has not come back)
  keep(name, fn) { this.keeping.set(name, fn); }
  // left its dimensions: a password not remembered is let go, to be asked again next time
  left(name) {
    if (!this.forget.has(name) || !this.open.get(name) || this.keeping.get(name)?.()) return;
    this.leave(name);
  }
  has(name) { return this.open.has(name); }                     // behind a password at all
  locked(name) { return this.open.get(name) === false; }        // and this page not in
  // in with the password: null, or why not
  async enter(name, password) {
    const res = await fetch(`/plugins/${name}/lock`, { method: "POST", headers: { ...SAID, "content-type": "application/json" }, body: JSON.stringify({ password }) }).catch(() => null);
    if (!res) return NO_ANSWER;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return data.error ?? "refused";
    for (const other of data.opened ?? [name]) if (this.has(other)) this.open.set(other, true); // (and all of the same password)
    this.open.set(name, true);
    return null;
  }
  // locked again: the password is asked next time
  async leave(name) {
    if (this.has(name)) this.open.set(name, false);
    this.leaving.get(name)?.();
    await fetch(`/plugins/${name}/lock`, { method: "DELETE", headers: SAID }).catch(() => {});
  }
  // a request of a plugin's answered 401 (its session over): locked again here too
  lost(name) { if (this.has(name)) this.open.set(name, false); }

  // the password on the screen, for the plugin `name`: true once it opened, false turned away (Esc, or a
  // wrong password: said on the gate a moment, and then it closes as Esc does).
  // title: what the gate says (the plugin's name); color: its glow
  async ask(name, look = {}) {
    const { title = name, color = "#8fd3ff" } = { ...look, ...this.looks.get(name) };
    if (!this.locked(name)) return true;
    if (this.asking) this.done(false);
    this.asking = name; // (asking from now, while it is asked again first)
    await this.check(name); // (an admin since the page opened goes through without it: see admin.js)
    if (this.asking !== name) return false; // (another portal took the gate meanwhile)
    if (!this.locked(name)) return (this.asking = null), true;
    document.exitPointerLock?.();
    this.gate.querySelector("h2").textContent = title;
    this.gate.style.setProperty("--lock-glow", color);
    this.why.textContent = "";
    this.input.value = "";
    this.gate.classList.add("open");
    document.body.classList.add("asking"); // (the crosshair gone at once: see index.html)
    setTimeout(() => this.input.focus(), 30);
    return new Promise((resolve) => { this.resolve = resolve; });
  }
  done(opened) {
    this.asking = null;
    this.gate.classList.remove("open");
    document.body.classList.remove("asking");
    this.input.blur();
    this.resolve?.(opened);
    this.resolve = null;
  }
  async typed(e) {
    if (e.key === "Escape") {
      const name = this.asking, given = this.trying; // (Esc while one is being tried, or refused: not declined)
      this.done(false);
      if (name && !given) this.declined?.(name);
      return;
    }
    if (e.key !== "Enter" || this.trying || !this.input.value || !this.asking) return;
    this.trying = true;
    const refused = await this.enter(this.asking, this.input.value);
    this.trying = false;
    if (!refused) return this.done(true);
    this.why.textContent = refused;
    this.input.select();
    this.gate.classList.remove("shake");
    void this.gate.offsetWidth;
    this.gate.classList.add("shake");
    if (refused === NO_ANSWER) return; // (nothing was refused: it may be given again)
    // refused (wrong, or too many wrong): the void answers, and the gate closes on you. (It keeps the keys
    // meanwhile, read only: none of them reaches the flight, Enter's autofly above all.)
    const name = this.asking;
    this.trying = true;
    this.input.readOnly = true;
    this.refused?.(name, refused);
    setTimeout(() => {
      this.trying = false;
      this.input.readOnly = false;
      if (this.asking === name) this.done(false);
    }, REFUSED_FOR * 1000);
  }
}
