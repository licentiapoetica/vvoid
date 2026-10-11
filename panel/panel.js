// vvoid's panel, the page (its server: panel.js, at vvoid's root). The way in, then: the settings (.env,
// each described where it is read), the plugins (on or off), the void's look, .env as it is, and vvoid's
// log, with vvoid started, stopped and restarted from the top. Nothing is changed until it is saved; a
// save that finds .env changed elsewhere meanwhile is refused, and what was being changed is kept.
const $ = (s) => document.querySelector(s);
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k in e && !k.includes("-")) e[k] = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  e.append(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
  return e;
}
const store = {
  get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v === null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch {} },
};

// ---- the way in: a passkey, and nothing else (the key makes the first, while there is none; see panel.js) ----
let token = store.get("vvoid-panel");
let door = null; // { enrolled, here, origin, origins, file }, as the panel says: any passkey, one for this address, which it is
async function api(path, { method = "GET", body } = {}) {
  const r = await fetch(`/api/${path}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { ...(token && { authorization: `Bearer ${token}` }), ...(body !== undefined && { "content-type": "application/json" }) },
  });
  const out = await r.json().catch(() => ({}));
  if (r.status === 401 && !/^(auth|login|enroll)/.test(path)) {
    out_();
    throw Object.assign(new Error("a passkey, again"), { status: 401 });
  }
  if (!r.ok) throw Object.assign(new Error(out.error ?? `${r.status}`), { status: r.status });
  return out;
}
// a passkey as the browser has it (ArrayBuffers) and as it goes over the wire (JSON, base64url), both ways
function b64u(buf) {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const unb64u = (text) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const ids = (list) => (list ?? []).map((c) => ({ ...c, id: unb64u(c.id) }));
async function makePasskey(o) {
  const cred = await navigator.credentials.create({ publicKey: { ...o, challenge: unb64u(o.challenge), user: { ...o.user, id: unb64u(o.user.id) }, excludeCredentials: ids(o.excludeCredentials) } });
  const r = cred.response;
  return {
    id: cred.id, rawId: b64u(cred.rawId), type: cred.type, authenticatorAttachment: cred.authenticatorAttachment ?? undefined, clientExtensionResults: cred.getClientExtensionResults(),
    response: { clientDataJSON: b64u(r.clientDataJSON), attestationObject: b64u(r.attestationObject), transports: r.getTransports?.() ?? [] },
  };
}
async function usePasskey(o) {
  const cred = await navigator.credentials.get({ publicKey: { ...o, challenge: unb64u(o.challenge), allowCredentials: ids(o.allowCredentials) } });
  const r = cred.response;
  return {
    id: cred.id, rawId: b64u(cred.rawId), type: cred.type, authenticatorAttachment: cred.authenticatorAttachment ?? undefined, clientExtensionResults: cred.getClientExtensionResults(),
    response: { clientDataJSON: b64u(r.clientDataJSON), authenticatorData: b64u(r.authenticatorData), signature: b64u(r.signature), userHandle: r.userHandle ? b64u(r.userHandle) : undefined },
  };
}
// (what the browser's refusals mean, here)
const said = (err) => ({
  NotAllowedError: "no passkey given (put aside, or too slow)",
  InvalidStateError: "this device has one of the panel's passkeys already",
  SecurityError: `passkeys here are for ${door?.origins?.join(" or ") ?? "the panel's own addresses"} only (VVOID_PANEL_ORIGIN)`,
})[err?.name] ?? err.message;

async function in_() {
  const { options } = await api("login/options", { method: "POST", body: {} });
  const response = await usePasskey(options);
  const { token: t } = await api("login", { method: "POST", body: { response } });
  token = t;
  store.set("vvoid-panel", t);
  show();
}
function out_(why = "") {
  token = null;
  store.set("vvoid-panel", null);
  clearTimeout(polling);
  $("#app").hidden = true;
  $("#login").hidden = false;
  return showDoor(why);
}
// the door as it stands, at this address: no passkey at all yet (the key, to make the first), none for this
// address yet (a code, given to one signed in at another), or in with one
const withCode = () => !!door?.enrolled && !door.here;
async function showDoor(why = "", good = false) {
  try {
    door = await api(`auth?at=${encodeURIComponent(location.origin)}`);
  } catch (err) {
    door = null;
    why ||= err.message;
  }
  const enroll = !!door && !door.here, code = withCode();
  $("#enroll").hidden = !enroll;
  $("#signin").hidden = !door?.here;
  $("#enroll-what").textContent = code
    ? "No passkey for this address yet. Signed in at another, the passkeys tab gives a code: it makes one here, once."
    : "No passkey yet. The key makes the first, and nothing more: then come in with it.";
  Object.assign($("#key"), code ? { type: "text", placeholder: "the code: abcd-efgh-jkmn", ariaLabel: "the code" } : { type: "password", placeholder: "key", ariaLabel: "the panel's key" });
  $("#login-hint").textContent = !door ? "" : code
    ? `None signed in anywhere? Every passkey lost: delete ${door.file} on the server, and the key makes one again.`
    : enroll
      ? `VVOID_PANEL_KEY, or the link the panel printed as it started. Once there is a passkey the key opens nothing; to start again, delete ${door.file} on the server.`
      : `Every passkey lost? Delete ${door.file} on the server, and the key makes one again.`;
  if (!window.PublicKeyCredential) why = "this browser has no passkeys";
  else if (door && !door.origin) why = `passkeys here are made at ${door.origins.join(" or ")} (VVOID_PANEL_ORIGIN), not ${location.origin}: open one of those instead`;
  const error = $("#login .error");
  error.textContent = why;
  error.classList.toggle("good", good && !!why);
  (enroll ? $("#key").value ? $("#enroll-name") : $("#key") : $("#signin button")).focus();
}
$("#login").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const error = $("#login .error"), buttons = document.querySelectorAll("#login button");
  error.textContent = "";
  error.classList.remove("good");
  for (const b of buttons) b.disabled = true;
  try {
    if (door && !door.here) {
      const { options } = await api("enroll/options", { method: "POST", body: { [withCode() ? "code" : "key"]: $("#key").value, name: $("#enroll-name").value } });
      const response = await makePasskey(options);
      const { name } = await api("enroll", { method: "POST", body: { response } });
      $("#key").value = $("#enroll-name").value = "";
      await showDoor(`"${name}" made: now come in with it`, true);
    } else await in_();
  } catch (err) {
    error.textContent = said(err);
    if (err.status === 403 && /passkey/.test(err.message) && door && !door.here) showDoor(err.message); // (one was made meanwhile)
  }
  for (const b of buttons) b.disabled = false;
});
$("#logout").addEventListener("click", async () => {
  if (unsaved() && !confirm("Leave what is not saved?")) return;
  await api("logout", { method: "POST" }).catch(() => {});
  out_();
});

// ---- what was said ----
let toastTimer;
function toast(text, bad = false) {
  const t = $("#toast");
  t.textContent = text;
  t.className = `show${bad ? " bad" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ""), bad ? 6000 : 3000);
}

// ---- tabs ----
const TABS = ["settings", "plugins", "look", "env", "log", "passkeys"];
function tab(name) {
  if (!TABS.includes(name)) name = "settings";
  store.set("vvoid-panel-tab", name);
  for (const t of TABS) {
    $(`#tab-${t}`).hidden = t !== name;
    $(`nav [data-tab=${t}]`).setAttribute("aria-selected", String(t === name));
  }
  if (name === "look") loadLook();
  if (name === "env" && !envDirty) loadEnv();
  if (name === "log") requestAnimationFrame(() => ($("#log").scrollTop = $("#log").scrollHeight));
  if (name === "passkeys") loadPasskeys();
}
for (const b of document.querySelectorAll("nav [data-tab]")) b.addEventListener("click", () => tab(b.dataset.tab));

// ---- vvoid: its state, and the log, asked for every few seconds ----
let vvoid = null, polling, logN = 0;
async function poll() {
  clearTimeout(polling);
  try {
    const { vvoid: v, log, logged } = await api(`state?since=${logN}`);
    if (logged < logN) { // (the panel was restarted: its log is a new one)
      logN = 0;
      $("#log").textContent = "";
      return poll();
    }
    vvoid = v;
    showVvoid();
    addLog(log);
    logN = logged;
  } catch (err) {
    if (err.status === 401) return;
  }
  polling = setTimeout(poll, document.hidden ? 10_000 : 2000);
}
document.addEventListener("visibilitychange", () => !document.hidden && token && poll());
const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
function showVvoid() {
  const v = vvoid, s = v.state, sd = v.systemd;
  $("#vvoid .dot").className = `dot ${s === "stopping" ? "starting" : s}`;
  // (under systemd: its unit, as systemctl has it)
  if (sd) {
    $("#vvoid-state").textContent = sd.error ? `${sd.unit}: ${sd.error}`
      : sd.loaded === "not-found" ? `${sd.unit}: no such unit${sd.user ? " (a user's)" : ""}`
      : {
        running: `${sd.unit} · running · pid ${v.pid}${v.startedAt ? ` · since ${time(v.startedAt)}` : ""}`,
        starting: `${sd.unit} · ${sd.active === "active" ? "started, not answering yet" : "starting…"}`,
        stopping: `${sd.unit} · stopping…`,
        stopped: `${sd.unit} · ${sd.active}${v.ended?.code && v.ended.code !== "success" ? ` (${v.ended.code})` : ""}${v.ended?.at ? ` since ${time(v.ended.at)}` : ""}`,
      }[s];
    const open = $("#vvoid-open");
    open.hidden = s !== "running";
    open.href = v.url ?? "#";
    for (const b of document.querySelectorAll("[data-act]")) {
      b.disabled = busy || !!sd.error || sd.loaded === "not-found" || (b.dataset.act === "start" ? s !== "stopped" : s === "stopped");
      b.title = `systemctl ${sd.user ? "--user " : ""}${b.dataset.act} ${sd.unit}`;
    }
    $("#stale").hidden = !v.stale;
    $("#log-where").textContent = `What vvoid writes, from ${sd.unit}'s journal (journalctl), as it writes it (the last 3000 lines).`;
    return;
  }
  $("#vvoid-state").textContent = {
    running: `running · pid ${v.pid} · since ${time(v.startedAt)}`,
    starting: "starting…",
    elsewhere: `running on :${v.port}, started elsewhere${v.pid ? ` · pid ${v.pid}` : ""}`,
    stopped: v.ended ? `stopped · ended ${v.ended.signal ?? `with code ${v.ended.code}`} at ${time(v.ended.at)}` : "stopped",
  }[s];
  const open = $("#vvoid-open");
  open.hidden = !(s === "running" || s === "elsewhere");
  open.href = v.url ?? "#";
  // (one started elsewhere: stopped from here too where the panel found it (its pid), and restarted here)
  const here = s === "running" || s === "starting", found = s === "elsewhere" && !!v.pid;
  for (const b of document.querySelectorAll("[data-act]")) {
    b.disabled = busy || (b.dataset.act === "start" ? s !== "stopped" : !here && !found);
    b.title = s !== "elsewhere" ? "" : !found ? "vvoid was started elsewhere: it can be stopped there"
      : b.dataset.act === "restart" ? "stop the one started elsewhere, and start it here" : b.dataset.act === "stop" ? "stop the one started elsewhere" : "";
  }
  $("#stale").hidden = !v.stale;
  $("#log-where").textContent = s === "elsewhere"
    ? found
      ? "vvoid was started elsewhere, not from this panel: what it writes is written there. Restart it to run it from here, and read it here."
      : "vvoid was started elsewhere, not from this panel: what it writes is written there. Stop it there and start it here to read it here."
    : here ? "What vvoid writes, as it writes it (the last 3000 lines)." : "vvoid is not running. Start it from the top.";
}
let busy = false;
for (const b of document.querySelectorAll("[data-act]")) {
  b.addEventListener("click", async () => {
    busy = true;
    showVvoid();
    try {
      vvoid = await api(`vvoid/${b.dataset.act}`, { method: "POST" });
      toast({ start: "vvoid started", stop: "vvoid stopped", restart: "vvoid restarted" }[b.dataset.act] + (vvoid?.systemd ? ` (${vvoid.systemd.unit})` : ""));
    } catch (err) {
      toast(err.message, true);
    }
    busy = false;
    poll();
  });
}
function addLog(lines) {
  const pre = $("#log"), atEnd = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
  for (const l of lines) pre.append(el("span", { class: l.text.startsWith("──") ? "mark" : l.err ? "err" : null }, `${l.text}\n`));
  while (pre.childNodes.length > 3000) pre.firstChild.remove();
  if (atEnd) pre.scrollTop = pre.scrollHeight;
}

// ---- settings ----
let settings = null;
const pending = new Map(); // name -> { value, on, remove }: changed, not yet saved
const entry = (name) => settings?.groups.flatMap((g) => g.entries).find((e) => e.name === name);
// a change to one name proposed: kept while it differs from .env, let go once it is .env again
function propose(name, next) {
  const e = entry(name);
  const same = e?.exists ? !next.remove && next.value === e.value && next.on === e.on : !next.remove && !next.on && !next.value;
  same ? pending.delete(name) : pending.set(name, next);
  showPending();
}
// what a name is now: as it will be saved, else as it is in .env
const current = (name) => pending.get(name) ?? entry(name);
let openGroups = new Set(JSON.parse(store.get("vvoid-panel-open") ?? '["vvoid"]'));
async function loadSettings() {
  try {
    [settings, described] = await Promise.all([api("settings"), api("about").catch(() => described)]);
    renderSettings();
    renderPlugins();
  } catch (err) {
    toast(err.message, true);
  }
}
function renderSettings() {
  const words = $("#filter").value.trim().toLowerCase().split(/\s+/).filter(Boolean), onlySet = $("#only-set").checked;
  const box = $("#groups");
  box.replaceChildren();
  for (const g of settings.groups) {
    const entries = g.entries.filter((e) =>
      (!onlySet || e.exists || pending.has(e.name)) &&
      words.every((w) => `${e.name} ${e.about ?? ""} ${g.title}`.toLowerCase().includes(w)));
    if (!entries.length) continue;
    const plugin = settings.plugins.find((p) => p.name === g.plugin);
    const set = g.entries.filter((e) => e.exists && e.on).length;
    const d = el("details", { class: "group", id: `group-${g.id}`, open: words.length > 0 || onlySet || openGroups.has(g.id) },
      el("summary", {},
        el("span", { class: "title" }, g.title),
        el("span", { class: "count" }, `${set} of ${g.entries.length} set`),
        plugin?.off && el("span", { class: "badge off" }, "off"),
        plugin?.locked && el("span", { class: "badge" }, "locked")),
      g.about && el("p", { class: "group-about" }, g.about),
      entries.map(row));
    d.addEventListener("toggle", () => {
      if (words.length || onlySet) return;
      d.open ? openGroups.add(g.id) : openGroups.delete(g.id);
      store.set("vvoid-panel-open", JSON.stringify([...openGroups]));
    });
    box.append(d);
  }
  if (!box.children.length) box.append(el("p", { class: "empty" }, "Nothing like that."));
}
function row(e) {
  const p = pending.get(e.name);
  let removing = !!p?.remove, touched = false; // (touched: its box ticked or not by hand, not by typing)
  const value = el("input", {
    class: "value", type: e.secret ? "password" : "text", value: p?.value ?? e.value, spellcheck: false, autocomplete: e.secret ? "new-password" : "off",
    placeholder: e.default ? `default: ${e.default}` : "unset", "aria-label": e.name,
  });
  const on = el("input", { type: "checkbox", checked: p ? p.on : e.on, title: "on (off: commented out, its value kept)", "aria-label": `${e.name} on` });
  const state = el("span", { class: "state" });
  const remove = el("button", { type: "button", class: "quiet", title: "take it out of .env", "aria-label": `take ${e.name} out of .env`, hidden: !e.exists }, "×");
  const show = e.secret && el("button", { type: "button", class: "quiet", onclick: () => {
    value.type = value.type === "password" ? "text" : "password";
    show.textContent = value.type === "password" ? "show" : "hide";
  } }, "show");
  const r = el("div", { class: "row" },
    el("div", { class: "name" }, el("code", {}, e.name), e.default && el("span", { class: "default" }, `default ${e.default}`)),
    e.about && el("div", { class: "about" }, e.about),
    e.shadowed && el("div", { class: "note" }, "the panel was started with this set in its environment: vvoid started from here is given that, over .env"),
    el("div", { class: "edit" }, on, value, show, remove, state));
  function sync() {
    const now = pending.get(e.name) ?? { value: e.value, on: e.on, remove: false };
    const was = e.exists || pending.has(e.name);
    r.className = `row ${now.remove ? "removing" : now.on ? "set" : was ? "off" : "unset"}${pending.has(e.name) ? " dirty" : ""}`;
    state.textContent = now.remove ? "taken out" : now.on ? "on" : e.exists || now.value ? "off" : "unset";
    value.disabled = on.disabled = removing;
    remove.textContent = removing ? "↶" : "×";
  }
  function edit() {
    propose(e.name, { value: value.value, on: on.checked, remove: removing });
    sync();
    if (e.name === "VVOID_PLUGINS_OFF" || /_(PASSWORD|PORTAL)$/.test(e.name)) renderPlugins();
  }
  value.addEventListener("input", () => {
    if (!e.exists && !touched) on.checked = value.value !== ""; // (an unset one typed into is on)
    edit();
  });
  on.addEventListener("change", () => ((touched = true), edit()));
  remove.addEventListener("click", () => {
    removing = !removing;
    if (!removing) value.value = e.value, (on.checked = e.on);
    edit();
  });
  sync();
  return r;
}
$("#filter").addEventListener("input", () => settings && renderSettings());
$("#only-set").addEventListener("change", () => settings && renderSettings());

function showPending() {
  const n = pending.size;
  $("#pending").hidden = !n;
  $("#pending-text").textContent = `${n} ${n === 1 ? "change" : "changes"} to .env`;
}
$("#pending-discard").addEventListener("click", () => {
  pending.clear();
  showPending();
  renderSettings();
  renderPlugins();
});
$("#pending-save").addEventListener("click", async () => {
  const edits = [...pending].map(([name, p]) => (p.remove ? { name, remove: true } : { name, value: p.value, on: p.on }));
  $("#pending-save").disabled = true;
  try {
    settings = await api("settings", { method: "PUT", body: { base: settings.version, edits } });
    pending.clear();
    toast(vvoid?.state === "running" ? "saved: restart vvoid for it to count" : vvoid?.state === "elsewhere" ? "saved: restart vvoid where it runs for it to count" : "saved");
  } catch (err) {
    toast(err.message, true);
    if (err.status === 409) settings = await api("settings").catch(() => settings);
  }
  $("#pending-save").disabled = false;
  showPending();
  renderSettings();
  renderPlugins();
  poll();
});

// ---- plugins: on and off, as VVOID_PLUGINS_OFF says ----
function offList() {
  const e = entry("VVOID_PLUGINS_OFF"), now = pending.get("VVOID_PLUGINS_OFF") ?? e;
  if (!now || now.remove || !now.on) return [];
  return now.value.split(",").map((n) => n.trim()).filter(Boolean);
}
function setOff(list) {
  const e = entry("VVOID_PLUGINS_OFF"), value = list.join(",");
  if (!value) e?.exists && e.on ? pending.set(e.name, { remove: true }) : pending.delete("VVOID_PLUGINS_OFF");
  else if (e?.exists && e.on && e.value === value) pending.delete("VVOID_PLUGINS_OFF");
  else pending.set("VVOID_PLUGINS_OFF", { value, on: true });
  showPending();
  renderPlugins();
  renderSettings();
}
function renderPlugins() {
  const box = $("#plugins");
  box.replaceChildren();
  if (!settings.plugins.length) return box.append(el("p", { class: "empty" }, "No plugins: plugins/ is empty (see the README)."));
  const off = new Set(offList()), changed = pending.has("VVOID_PLUGINS_OFF");
  placeBoxes.clear();
  renderMap();
  for (const p of settings.plugins) {
    const isOff = off.has(p.name);
    const toggle = el("input", { type: "checkbox", checked: !isOff, "aria-label": `${p.name} on`, onchange: () => {
      const list = offList().filter((n) => n !== p.name);
      setOff(toggle.checked ? list : [...list, p.name]);
    } });
    box.append(el("div", { class: `plugin${isOff ? " off" : ""}${changed && isOff !== p.off ? " dirty" : ""}${chosen === p.name ? " selected" : ""}`, id: `plugin-${p.name}` },
      el("div", { class: "top" }, el("strong", {}, p.name), el("label", {}, toggle, isOff ? "off" : "on")),
      p.about && el("p", {}, p.about),
      el("div", { class: "tags" },
        p.server && el("span", {}, "server"),
        p.page && el("span", {}, "page")),
      password(p),
      placeBox(p),
      describeBox(p),
      vanityBox(p),
      el("a", { tabindex: 0, onclick: () => {
        openGroups.add(`plugin:${p.name}`);
        $("#filter").value = "";
        tab("settings");
        renderSettings();
        $(`#group-${CSS.escape(`plugin:${p.name}`)}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      } }, "its settings →")));
  }
}

// its password, at its ring: its own (VVOID_<NAME>_PASSWORD), else every plugin's (VVOID_PASSWORD), else none.
// Typed, it is its own; emptied, its own is commented out (kept in .env for later) and VVOID_PASSWORD counts.
const envOf = (name) => `VVOID_${name.toUpperCase().replace(/-/g, "_")}_PASSWORD`;
function lockOf(name) {
  const own = current(envOf(name)), all = current("VVOID_PASSWORD");
  if (own && !own.remove && own.on) return own.value ? "own" : "open";
  return all && !all.remove && all.on && all.value ? "all" : "open";
}
function password(p) {
  const name = envOf(p.name), e = entry(name), now = current(name);
  const input = el("input", {
    class: "value", type: "password", value: now && !now.remove && now.on ? now.value : "",
    placeholder: "no password of its own", autocomplete: "new-password", spellcheck: false, "aria-label": `${p.name}'s password`,
  });
  const show = el("button", { type: "button", class: "quiet", onclick: () => {
    input.type = input.type === "password" ? "text" : "password";
    show.textContent = input.type === "password" ? "show" : "hide";
  } }, "show");
  const state = el("span", { class: "lockstate" });
  const box = el("div", { class: "lock" }, el("label", {}, "password", el("div", {}, input, show)), state);
  const sync = () => {
    const lock = lockOf(p.name);
    state.className = `lockstate ${lock}`;
    state.textContent = { own: "locked: its own password", all: "locked: VVOID_PASSWORD, every plugin's", open: "open: no password asked" }[lock];
    box.classList.toggle("dirty", pending.has(name));
  };
  input.addEventListener("input", () => {
    const v = input.value;
    // (emptied: its own line commented out, its value kept; never written as NAME= by this, which would open it)
    if (v) propose(name, { value: v, on: true });
    else if (e?.exists && e.on) propose(name, { value: e.value, on: false });
    else propose(name, { value: e?.value ?? "", on: false });
    sync();
    renderSettings();
  });
  sync();
  return box;
}

// ---- portals: where each stands round the clock (VVOID_<NAME>_PORTAL; unset, auto: where vvoid lays it) ----
const portalEnv = (name) => `VVOID_${name.toUpperCase().replace(/-/g, "_")}_PORTAL`;
// "angle,distance,height", as vvoid reads it (see portalPlace in server.js), or null
function parsePlace(text) {
  const [a, r, h] = String(text ?? "").split(",").map((v) => (v.trim() === "" ? NaN : Number(v)));
  if (!Number.isFinite(a)) return null;
  return { angle: ((a % 360) + 360) % 360, ring: Number.isFinite(r) ? Math.min(Math.max(r, 0), 60_000) : settings.ring.radius, height: Number.isFinite(h) ? h : 0 };
}
const placeText = (p) => `${+p.angle.toFixed(1)},${Math.round(p.ring)},${Math.round(p.height)}`;
// the portals vvoid will have, as it will be saved: those of the circle's order with a page, and on
function ringNames() {
  const off = new Set(offList());
  return settings.ring.order.filter((n) => settings.plugins.find((p) => p.name === n)?.page && !off.has(n));
}
// where one stands: placed, or auto (as hubSlot lays them: evenly round the circle, in its order)
function placeOf(name) {
  const now = current(portalEnv(name));
  const own = now && !now.remove && now.on ? parsePlace(now.value) : null;
  const names = ringNames(), i = names.indexOf(name);
  if (own) return { ...own, auto: false, standing: i >= 0 };
  return { angle: (Math.max(0, i) / Math.max(1, names.length)) * 360, ring: settings.ring.radius, height: 0, auto: true, standing: i >= 0 };
}
// placed (null: auto again; its line commented out, kept in .env for later, as a password emptied)
function setPlace(name, place) {
  const env = portalEnv(name), e = entry(env);
  if (place) propose(env, { value: placeText(place), on: true });
  else if (e?.exists && e.on) propose(env, { value: e.value, on: false });
  else propose(env, { value: e?.value ?? "", on: false });
}

const SVG = "http://www.w3.org/2000/svg";
function svg(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}
let chosen = null, dragging = null, extent = 0;
// the map's view: centred where, reaching how far (r null: fitted to every portal; scrolled, pinched or dragged,
// its own, until fit)
const view = { x: 0, y: 0, r: null };
const NEAREST = 400, FURTHEST = 120_000;
const placeBoxes = new Map(); // name -> its card's sync
const xyOf = (p) => [Math.sin((p.angle / 180) * Math.PI) * p.ring, -Math.cos((p.angle / 180) * Math.PI) * p.ring];
function renderMap() {
  const box = $("#portal-map"), { radius, cell, reach } = settings.ring, names = ringNames();
  $("#portals").hidden = !names.length;
  if (!dragging) extent = view.r ?? Math.max(cell * 2.3, ...names.map((n) => placeOf(n).ring * 1.15));
  const cx = view.r === null ? 0 : view.x, cy = view.r === null ? 0 : view.y;
  const map = svg("svg", { viewBox: `${cx - extent} ${cy - extent} ${extent * 2} ${extent * 2}`, class: "map", "font-size": extent * 0.034, role: "group", "aria-label": "the portals round the clock, seen from above" });
  // (where places may stand: the middle of every sector, a cell apart, the hub's in the middle; those in view,
  // and none once so far out that they would only be a grey haze)
  if (extent / cell < 16) {
    const range = (c) => [Math.floor((c - extent - reach) / cell), Math.ceil((c + extent + reach) / cell)];
    const [i0, i1] = range(cx), [j0, j1] = range(cy);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      map.append(svg("rect", { class: i || j ? "place" : "place hub", x: i * cell - reach, y: j * cell - reach, width: reach * 2, height: reach * 2 }));
    }
  }
  map.append(svg("circle", { class: "ring", r: radius }), svg("circle", { class: "clock", r: extent * 0.012 }));
  map.append(svg("text", { class: "ahead", x: cx, y: cy - extent * 0.92 }, "↑ ahead as you arrive"));
  for (const name of names) map.append(dot(map, name));
  box.replaceChildren(map);
}
function dot(map, name) {
  const p = placeOf(name), [x, y] = xyOf(p);
  const g = svg("g", {
    class: `dot${p.auto ? " auto" : ""}${pending.has(portalEnv(name)) ? " dirty" : ""}${chosen === name ? " selected" : ""}`,
    transform: `translate(${x} ${y})`, tabindex: 0, role: "button", "data-name": name,
    "aria-label": `${name}'s portal: ${p.auto ? "auto" : "placed"}, ${Math.round(p.angle)}°, ${Math.round(p.ring)} out`,
  }, svg("circle", { r: extent * 0.024 }), svg("text", { y: -extent * 0.04 }, name));
  const toMap = (ev) => new DOMPoint(ev.clientX, ev.clientY).matrixTransform(map.getScreenCTM().inverse());
  let from = null;
  g.addEventListener("pointerdown", (ev) => {
    g.setPointerCapture(ev.pointerId);
    from = { x: ev.clientX, y: ev.clientY };
    choose(name, false);
  });
  g.addEventListener("pointermove", (ev) => {
    if (!from || (!dragging && Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < 4)) return;
    dragging = name;
    g.classList.add("dragging");
    const at = toMap(ev), step = ev.shiftKey ? [5, 100] : [0.5, 10];
    const angle = (((Math.atan2(at.x, -at.y) * 180) / Math.PI) + 360) % 360, ring = Math.hypot(at.x, at.y);
    const place = { angle: (Math.round(angle / step[0]) * step[0]) % 360, ring: Math.round(ring / step[1]) * step[1], height: placeOf(name).height };
    setPlace(name, place);
    const [x, y] = xyOf(place);
    g.setAttribute("transform", `translate(${x} ${y})`);
    g.classList.remove("auto");
    placeBoxes.get(name)?.();
  });
  const end = () => {
    if (!from) return;
    from = null;
    if (dragging) {
      dragging = null;
      renderMap();
      renderSettings();
    } else choose(name); // (a click: its card shown)
  };
  g.addEventListener("pointerup", end);
  g.addEventListener("pointercancel", end);
  g.addEventListener("keydown", (ev) => {
    const big = ev.shiftKey, p = placeOf(name);
    const by = { ArrowLeft: [-(big ? 5 : 1), 0], ArrowRight: [big ? 5 : 1, 0], ArrowUp: [0, big ? 500 : 100], ArrowDown: [0, -(big ? 500 : 100)] }[ev.key];
    if (!by) return;
    ev.preventDefault();
    setPlace(name, { angle: (((p.angle + by[0]) % 360) + 360) % 360, ring: Math.max(0, p.ring + by[1]), height: p.height });
    chosen = name;
    renderPlugins();
    renderSettings();
    $("#portal-map .dot.selected")?.focus();
  });
  return g;
}
// in and out (scrolled, pinched, its buttons: about a point of the map, which stays where it is on the
// screen), and about (dragged in the dark between the portals)
const mapBox = $("#portal-map");
let redraw = 0;
const soon = () => { if (!redraw) redraw = requestAnimationFrame(() => { redraw = 0; if (settings) renderMap(); }); };
// (a point on the screen, on the map; the map's units to a pixel)
const onMap = (x, y) => new DOMPoint(x, y).matrixTransform(mapBox.querySelector("svg").getScreenCTM().inverse());
const perPixel = () => (extent * 2) / (mapBox.clientWidth || 1);
function own() { if (view.r === null) Object.assign(view, { x: 0, y: 0, r: extent }); }
function zoomAt(factor, at) {
  own();
  const r = Math.min(FURTHEST, Math.max(NEAREST, view.r * factor)), k = r / view.r;
  view.x = at.x + (view.x - at.x) * k;
  view.y = at.y + (view.y - at.y) * k;
  view.r = extent = r;
  soon();
}
mapBox.addEventListener("wheel", (ev) => {
  if (dragging || !settings) return;
  ev.preventDefault();
  const lines = ev.deltaMode === 1 ? 33 : ev.deltaMode === 2 ? 400 : 1;
  zoomAt(Math.exp(ev.deltaY * lines * 0.0015), onMap(ev.clientX, ev.clientY));
}, { passive: false });
const fingers = new Map(); // pointer -> where it is on the screen
const middle = () => { let x = 0, y = 0; for (const f of fingers.values()) { x += f.x; y += f.y; } return { x: x / fingers.size, y: y / fingers.size }; };
const spread = (c) => { let d = 0; for (const f of fingers.values()) d += Math.hypot(f.x - c.x, f.y - c.y); return d / fingers.size; };
mapBox.addEventListener("pointerdown", (ev) => {
  if (ev.target.closest?.(".dot") || ev.button > 0) return; // (a portal: placed, see dot)
  mapBox.setPointerCapture(ev.pointerId);
  fingers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  mapBox.classList.add("panning");
});
mapBox.addEventListener("pointermove", (ev) => {
  if (!fingers.has(ev.pointerId)) return;
  const was = middle(), wasSpread = spread(was);
  fingers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  const now = middle(), u = perPixel();
  own();
  view.x -= (now.x - was.x) * u;
  view.y -= (now.y - was.y) * u;
  // (two fingers: closer as they part, further as they close)
  if (fingers.size > 1 && wasSpread > 0) zoomAt(wasSpread / Math.max(1, spread(now)), onMap(now.x, now.y));
  soon();
});
const lift = (ev) => {
  fingers.delete(ev.pointerId);
  if (!fingers.size) mapBox.classList.remove("panning");
};
mapBox.addEventListener("pointerup", lift);
mapBox.addEventListener("pointercancel", lift);
mapBox.addEventListener("dblclick", (ev) => {
  if (ev.target.closest?.(".dot")) return;
  view.r = null;
  renderMap();
});
for (const b of document.querySelectorAll(".map-tools [data-zoom]")) {
  b.addEventListener("click", () => {
    if (b.dataset.zoom === "fit") view.r = null, renderMap();
    else zoomAt(b.dataset.zoom === "in" ? 1 / 1.4 : 1.4, { x: view.r === null ? 0 : view.x, y: view.r === null ? 0 : view.y }), renderMap();
  });
}

// one chosen: its dot and its card marked (and its card shown)
function choose(name, scroll = true) {
  chosen = name;
  for (const d of document.querySelectorAll("#portal-map .dot")) d.classList.toggle("selected", d.dataset.name === name);
  for (const c of document.querySelectorAll("#plugins .plugin")) c.classList.toggle("selected", c.id === `plugin-${name}`);
  if (scroll) $(`#plugin-${CSS.escape(name)}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
// a card's place: its numbers, and auto
function placeBox(p) {
  if (!p.portal) return null;
  const name = p.name, env = portalEnv(name);
  const field = (key, label, step) => el("label", {}, label, el("input", { type: "number", step, "data-key": key, "aria-label": `${name}'s portal ${label}` }));
  const fields = [field("angle", "angle °", "any"), field("ring", "distance", "any"), field("height", "height", "any")];
  const inputs = fields.map((f) => f.querySelector("input"));
  const auto = el("button", { type: "button", title: "in its place on the circle again, as vvoid lays them" }, "auto");
  const state = el("span", { class: "placestate" });
  const box = el("div", { class: "place" }, el("div", { class: "fields" }, fields, auto), state);
  const sync = () => {
    const pl = placeOf(name);
    for (const i of inputs) if (i !== document.activeElement) i.value = String(+pl[i.dataset.key].toFixed(i.dataset.key === "angle" ? 1 : 0));
    box.className = `place${pl.auto ? " auto" : ""}${pending.has(env) ? " dirty" : ""}`;
    auto.disabled = pl.auto;
    state.className = `placestate${pl.auto ? "" : " own"}`;
    state.textContent = !pl.standing ? "its portal: not in the void while it is off" : pl.auto ? "its portal: auto, in its place on the circle" : "its portal: placed";
  };
  for (const i of inputs) {
    i.addEventListener("input", () => {
      const [angle, ring, height] = inputs.map((x) => Number(x.value));
      if (![angle, ring, height].every(Number.isFinite) || inputs.some((x) => x.value === "")) return;
      setPlace(name, { angle: ((angle % 360) + 360) % 360, ring: Math.max(0, ring), height });
      sync();
      renderMap();
      renderSettings();
    });
    i.addEventListener("focus", () => choose(name, false));
  }
  auto.addEventListener("click", () => {
    setPlace(name, null);
    renderPlugins();
    renderSettings();
  });
  placeBoxes.set(name, sync);
  sync();
  return box;
}

// ---- what each portal is: its words, on a pane inside it, beside its way back (see about.js). Kept at once, apart from
// .env (in VVOID_PORTALS), and seen in the void within half a minute, vvoid not restarted ----
let described = { about: {}, vanity: {}, max: 2000 };
const drafts = new Map(); // name -> its words as typed, not yet kept (kept over the cards drawn again)
function describeBox(p) {
  if (!p.portal) return null;
  const kept = () => described.about[p.name] ?? "";
  const area = el("textarea", {
    rows: 4, maxLength: described.max, value: drafts.get(p.name) ?? kept(), spellcheck: true,
    placeholder: "what it is, on a pane inside it, beside its way back to the hub (none: no pane)", "aria-label": `${p.name}'s description`,
  });
  const count = el("span", { class: "count" });
  const save = el("button", { type: "button", class: "primary" }, "keep");
  const box = el("div", { class: "describe" }, el("label", {}, "description, inside it", area), el("div", { class: "describe-bar" }, count, save));
  const sync = () => {
    const dirty = area.value !== kept();
    dirty ? drafts.set(p.name, area.value) : drafts.delete(p.name);
    box.classList.toggle("dirty", dirty);
    save.disabled = !dirty;
    count.textContent = `${area.value.length} / ${described.max}`;
  };
  area.addEventListener("input", sync);
  save.addEventListener("click", async () => {
    save.disabled = true;
    try {
      described = await api("about", { method: "PUT", body: { name: p.name, text: area.value } });
      const running = vvoid?.state === "running" || vvoid?.state === "elsewhere";
      toast(`${p.name}: ${area.value.trim() ? "its words kept" : "its pane taken away"}${running ? ", seen in the void within half a minute" : ""}`);
    } catch (err) {
      toast(err.message, true);
    }
    sync();
  });
  sync();
  return box;
}

// ---- each portal's own word, its quick access: /<word> on vvoid's address, straight to it (started before it in
// the hub and flown in). Kept beside its words, at once, and seen by vvoid within a second, not restarted ----
const wordDrafts = new Map(); // name -> its word as typed, not yet kept
function vanityBox(p) {
  if (!p.portal) return null;
  const kept = () => described.vanity?.[p.name] ?? "";
  const input = el("input", {
    type: "text", maxLength: 40, value: wordDrafts.get(p.name) ?? kept(), spellcheck: false, autocomplete: "off",
    placeholder: "none", "aria-label": `${p.name}'s quick access word`,
  });
  const save = el("button", { type: "button", class: "primary" }, "keep");
  const box = el("div", { class: "describe vanity" },
    el("label", {}, "quick access, straight to it", el("div", { class: "vanity-word" }, el("span", {}, "/"), input, save)));
  const clean = () => input.value.trim().toLowerCase().replace(/^\/+|\/+$/g, "");
  const sync = () => {
    const dirty = clean() !== kept();
    dirty ? wordDrafts.set(p.name, input.value) : wordDrafts.delete(p.name);
    box.classList.toggle("dirty", dirty);
    save.disabled = !dirty;
  };
  const keep = async () => {
    if (save.disabled) return;
    save.disabled = true;
    try {
      described = await api("vanity", { method: "PUT", body: { name: p.name, word: clean() } });
      wordDrafts.delete(p.name);
      input.value = kept();
      toast(`${p.name}: ${kept() ? `/${kept()} goes straight to it` : "its quick access taken away"}`);
    } catch (err) {
      toast(err.message, true);
    }
    sync();
  };
  input.addEventListener("input", sync);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") keep(); });
  save.addEventListener("click", keep);
  sync();
  return box;
}

// ---- the look ----
let lookData = null, lookEdit = {};
async function loadLook() {
  try {
    lookData = await api("look");
    renderLook();
  } catch (err) {
    toast(err.message, true);
  }
}
function renderLook() {
  const { fields, looks, live, admin } = lookData, box = $("#look");
  const can = !live || admin;
  $("#look-where").textContent = live
    ? admin ? "vvoid is running: what is applied here is seen at once, by everyone in the void (as an admin turns it in the Tab panel)."
      : "vvoid is running without an admin key (VVOID_ADMIN_KEY): its look is shown here, but can be changed only once it has one (and has been restarted), or while it is stopped."
    : "vvoid is not running: the look is kept in its file (VVOID_LOOK), and seen when vvoid starts.";
  box.replaceChildren();
  const valueOf = (f) => lookEdit[f.key] ?? looks.now[f.key] ?? f.value;
  const groups = new Map();
  for (const f of fields) (groups.get(f.group) ?? groups.set(f.group, []).get(f.group)).push(f);
  for (const [group, fs] of groups) {
    box.append(el("div", { class: "look-group" }, el("h3", {}, group), fs.map((f) => {
      const id = `look-${f.key}`, v = valueOf(f);
      if (f.type === "switch") {
        // (a switch: a button, on or off; applied with the rest)
        const button = el("button", { id, type: "button", class: `switch${v > 0 ? " on" : ""}`, disabled: !can }, v > 0 ? "on" : "off");
        const knob = el("div", { class: `knob${f.key in lookEdit ? " changed" : ""}` }, el("label", { for: id, title: f.key }, f.label), button, el("output", { for: id }));
        button.addEventListener("click", () => {
          const now = valueOf(f) > 0 ? 0 : 1;
          if (now === (looks.now[f.key] ?? f.value)) delete lookEdit[f.key];
          else lookEdit[f.key] = now;
          button.textContent = now ? "on" : "off";
          button.classList.toggle("on", !!now);
          knob.classList.toggle("changed", f.key in lookEdit);
          lookBar();
        });
        return knob;
      }
      const out = el("output", { for: id }, f.type === "colour" ? v : String(v));
      const input = f.type === "colour"
        ? el("input", { id, type: "color", value: v, disabled: !can })
        : el("input", { id, type: "range", min: f.min, max: f.max, step: f.step, value: v, disabled: !can });
      const knob = el("div", { class: `knob${f.key in lookEdit ? " changed" : ""}` }, el("label", { for: id, title: f.key }, f.label), input, out);
      input.addEventListener("input", () => {
        const now = f.type === "colour" ? input.value : Number(input.value);
        out.textContent = String(now);
        if (now === (looks.now[f.key] ?? f.value)) delete lookEdit[f.key];
        else lookEdit[f.key] = now;
        knob.classList.toggle("changed", f.key in lookEdit);
        lookBar();
      });
      return knob;
    })));
  }
  const apply = el("button", { class: "primary", id: "look-apply" }, "apply");
  const discard = el("button", { id: "look-discard" }, "discard");
  const own = el("button", { title: "every knob as vvoid has it, untouched (then apply)" }, "vvoid's own");
  apply.disabled = discard.disabled = true;
  own.disabled = !can;
  apply.addEventListener("click", () => putLook({ now: { ...looks.now, ...lookEdit } }, live ? "applied: seen now" : "kept: seen when vvoid starts"));
  discard.addEventListener("click", () => ((lookEdit = {}), renderLook()));
  own.addEventListener("click", () => {
    lookEdit = {};
    for (const f of fields) if ((looks.now[f.key] ?? f.value) !== f.value) lookEdit[f.key] = f.value;
    renderLook();
  });
  box.prepend(el("div", { class: "bar" }, apply, discard, own));
  const names = Object.keys(looks.saves ?? {});
  box.append(el("div", { class: "look-group" }, el("h3", {}, "saves"),
    names.length ? el("div", { class: "saves" }, names.map((name) => el("div", { class: "save" },
      el("span", {}, name),
      looks.saber?.includes(name) && el("em", {}, "saber platform"),
      el("button", { disabled: !can, title: "its knobs here (then apply)", onclick: () => {
        lookEdit = {};
        for (const f of fields) {
          const v = looks.saves[name][f.key] ?? f.value;
          if (v !== (looks.now[f.key] ?? f.value)) lookEdit[f.key] = v;
        }
        renderLook();
        toast(`${name}: its knobs are set here; apply to keep them`);
      } }, "use"),
      el("button", { class: "quiet", disabled: !can, onclick: () => {
        if (!confirm(`Delete the save "${name}"?`)) return;
        const saves = { ...looks.saves };
        delete saves[name];
        putLook({ saves }, `${name}: deleted`);
      } }, "delete"))))
      : el("p", { class: "empty" }, "None yet: an admin saves them in the void (Tab, then look).")));
  lookBar();
}
function lookBar() {
  const n = Object.keys(lookEdit).length, can = !lookData.live || lookData.admin;
  $("#look-apply").disabled = !n || !can;
  $("#look-discard").disabled = !n;
  $("#look-apply").textContent = n ? `apply ${n}` : "apply";
}
async function putLook(body, said) {
  try {
    const { looks, live } = await api("look", { method: "PUT", body });
    lookData.looks = looks;
    lookData.live = live;
    lookEdit = {};
    toast(said);
  } catch (err) {
    toast(err.message, true);
  }
  renderLook();
}

// ---- .env, as it is ----
let envVersion = null, envDirty = false;
async function loadEnv() {
  try {
    const { version, text } = await api("env");
    envVersion = version;
    $("#env-text").value = text;
    envDirty = false;
    envBar();
  } catch (err) {
    toast(err.message, true);
  }
}
function envBar() {
  $("#env-save").disabled = $("#env-discard").disabled = !envDirty;
}
$("#env-text").addEventListener("input", () => ((envDirty = true), envBar()));
$("#env-discard").addEventListener("click", loadEnv);
$("#env-save").addEventListener("click", async () => {
  try {
    const { version, text } = await api("env", { method: "PUT", body: { base: envVersion, text: $("#env-text").value } });
    envVersion = version;
    $("#env-text").value = text;
    envDirty = false;
    envBar();
    toast(vvoid?.state === "running" ? "saved: restart vvoid for it to count" : "saved");
    await loadSettings();
    poll();
  } catch (err) {
    toast(err.message, true);
  }
});

// ---- the passkeys: more made here (one a device, named), and taken away; never the last ----
const when = (iso) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
async function loadPasskeys() {
  try {
    renderPasskeys(await api("passkeys"));
  } catch (err) {
    if (err.status !== 401) toast(err.message, true);
  }
}
function renderPasskeys({ passkeys, mine, file }) {
  const last = passkeys.length <= 1;
  $("#passkeys-file").textContent = file;
  $("#passkeys").replaceChildren(...passkeys.map((p) => el("div", { class: "save" },
    el("span", {}, p.name, el("small", {}, `${p.at ? `at ${p.at} · ` : ""}made ${when(p.created)}${p.used ? ` · last in ${when(p.used)}` : ""}`)),
    p.id === mine && el("em", {}, "this one"),
    el("button", { disabled: last, title: last ? "the last one stays: add another first" : null, onclick: () => removePasskey(p, p.id === mine) }, "take away"))));
}
$("#passkey-add").addEventListener("click", async () => {
  const b = $("#passkey-add");
  b.disabled = true;
  try {
    const { options } = await api("passkeys/options", { method: "POST", body: { name: $("#passkey-name").value } });
    const response = await makePasskey(options);
    renderPasskeys(await api("passkeys", { method: "POST", body: { response } }));
    $("#passkey-name").value = "";
    toast("a passkey added");
  } catch (err) {
    if (err.status !== 401) toast(said(err), true);
  }
  b.disabled = false;
});
// (a code for another of the panel's addresses, with no passkey of its own yet: shown here, ten minutes, once)
let codeTimer;
$("#passkey-code").addEventListener("click", async () => {
  try {
    const { code, until, origins } = await api("passkeys/code", { method: "POST" });
    const others = origins.filter((o) => o !== location.origin);
    $("#passkey-code-out").replaceChildren(el("code", {}, code), ` · at ${others.length ? others.join(" or ") : "another of the panel's addresses"}, in place of the key, until ${new Date(until).toLocaleTimeString([], { timeStyle: "short" })}; once`);
    clearTimeout(codeTimer);
    codeTimer = setTimeout(() => $("#passkey-code-out").replaceChildren(), until - Date.now());
  } catch (err) {
    if (err.status !== 401) toast(err.message, true);
  }
});
async function removePasskey(p, mine) {
  if (!confirm(`Take away the passkey "${p.name}"?${mine ? " You are in with it: you will be let out." : ""}`)) return;
  try {
    const out = await api(`passkeys/${encodeURIComponent(p.id)}`, { method: "DELETE" });
    if (mine) return out_(`"${p.name}" taken away: in, with another`);
    renderPasskeys(out);
    toast(`"${p.name}" taken away`);
  } catch (err) {
    if (err.status !== 401) toast(err.message, true);
  }
}

// ---- leaving with something unsaved ----
const unsaved = () => pending.size > 0 || drafts.size > 0 || envDirty || (lookData && Object.keys(lookEdit).length > 0);
addEventListener("beforeunload", (ev) => {
  if (unsaved()) ev.preventDefault();
});

// ---- the start: a key in the link (#key=…, never sent anywhere but here: for the first passkey only), a
// session kept, or the door ----
async function show() {
  $("#login").hidden = true;
  $("#app").hidden = false;
  tab(store.get("vvoid-panel-tab"));
  await Promise.all([loadSettings(), poll()]);
}
(async () => {
  const key = new URLSearchParams(location.hash.slice(1)).get("key");
  if (key) {
    history.replaceState(null, "", location.pathname);
    $("#key").value = key;
  } else if (token) {
    try {
      await api("state?since=999999999");
      return show();
    } catch {}
  }
  await out_();
  if (key && door?.enrolled) $("#login .error").textContent = "there is a passkey: the key in the link opens nothing now";
})();
