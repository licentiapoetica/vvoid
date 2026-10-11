// vvoid's panel: a small web server of its own, apart from vvoid's (npm run panel; http://localhost:5174),
// where what vvoid is set by is turned. Its settings and its plugins' (.env, each as its README describes
// it, or the whole file as it is), which plugins are on, the void's look (see public/src/look.js), and vvoid
// itself: started, stopped and restarted from here (it reads its settings once, as it starts), and what it
// writes, read here as it writes it; or, where systemd runs it (VVOID_PANEL_SYSTEMD), its unit started, stopped
// and restarted, and its journal read here.
// The way in: a passkey (WebAuthn), and nothing else (see "the way in", below). VVOID_PANEL_KEY (in .env;
// unset, a new key every time the panel starts, in the link it prints) makes the first one, while there is
// none, and does nothing more. A passkey taken is given a session (in memory: the panel restarting lets
// every one go), which the page sends with every request (never a cookie: vvoid on the same address would
// be sent it too).
// The panel reads .env itself, and never into its own environment: vvoid, started from here, reads it
// afresh each time. A setting in the environment the panel was started from is over the file's (as with
// npm start), and the settings page says so where it is.
import http from "node:http";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { LOOK, cleanLooks } from "./public/src/look.js";
import { CELL, REACH, UNIT, PORTAL_ORDER, PORTAL_RING } from "./public/src/constants.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(here, ".env");
const PUBLIC = path.join(here, "panel");
const PLUGINS = path.join(here, "plugins");
const BACKUPS = path.join(here, ".cache", "panel", "env"); // .env as it was before each change (the last KEEP)
const KEEP = 30;
const hash = (text) => createHash("sha256").update(String(text)).digest();

// ---- .env, line by line, as it is: comments, blanks and order kept ----
// a setting's line: NAME=value, or #NAME=value (commented out: off, its value kept for when it is on again)
const LINE = /^\s*(#\s*)?(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;
// a value as Node reads it (--env-file): in quotes, what is between them; bare, up to a # and trimmed
function unquote(raw) {
  const v = raw.trim(), q = v[0];
  if (q === '"' || q === "'" || q === "`") {
    const end = v.indexOf(q, 1);
    if (end > 0) return q === '"' ? v.slice(1, end).replace(/\\n/g, "\n") : v.slice(1, end);
  }
  return v.replace(/#.*$/, "").trim();
}
// and back: bare where Node would read it so, else in the first quotes it can be put in (null: none)
function quote(value) {
  if (/[\r\n]/.test(value)) return null;
  if (!/#/.test(value) && value === value.trim() && !/^["'`]/.test(value)) return value;
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes("`")) return `\`${value}\``;
  if (!value.includes('"') && !value.includes("\\n")) return `"${value}"`;
  return null;
}
const parse = (text) => text.split(/\r?\n/).map((text) => {
  const m = text.match(LINE);
  return m ? { text, name: m[2], value: unquote(m[3]), off: !!m[1] } : { text };
});
const join = (lines) => lines.map((l) => l.text).join("\n");
// each name as it stands: the last line not commented out (the one Node takes), else the last that is
function settingsOf(lines) {
  const out = new Map();
  for (const l of lines) if (l.name && (l.off ? !out.get(l.name) || out.get(l.name).off : true)) out.set(l.name, l);
  return out;
}
// one change to one name: { name, value, on } (on: its line counts; off: commented out), or { name, remove }
function change(lines, { name, value, on, remove }) {
  if (remove) return lines.filter((l) => l.name !== name);
  const text = quote(value);
  if (text === null) throw new Error(`${name}: a value on one line, without all three kinds of quotes in it`);
  const mine = lines.filter((l) => l.name === name), active = mine.filter((l) => !l.off), off = mine.filter((l) => l.off);
  const write = (l, on) => Object.assign(l, { value, off: !on, text: `${on ? "" : "#"}${name}=${text}` });
  if (on) {
    // the one Node takes, else the commented one of this value (one turned off a moment ago), else the last
    const line = active.at(-1) ?? off.findLast((l) => l.value === value) ?? off.at(-1);
    if (line) write(line, true);
    else add(lines, { text: `${name}=${text}`, name, value, off: false });
  } else if (active.length) {
    for (const l of active) Object.assign(l, { off: true, text: `#${name}=${quote(l.value) ?? ""}` });
    write(active.at(-1), false);
  } else if (off.length) write(off.findLast((l) => l.value === value) ?? off.at(-1), false);
  else add(lines, { text: `#${name}=${text}`, name, value, off: true });
  return lines;
}
// (at the end, before the blank lines the file ends with)
function add(lines, line) {
  let at = lines.length;
  while (at > 0 && !lines[at - 1].text.trim()) at--;
  lines.splice(at, 0, line);
}

const readEnv = () => fs.readFile(ENV_FILE, "utf8").catch(() => "");
const versionOf = (text) => hash(text).toString("hex").slice(0, 16);
// written whole, in place of the old one at once (its mode kept: 600 for a new one), the old one kept first
async function writeEnv(text) {
  const target = await fs.realpath(ENV_FILE).catch(() => ENV_FILE);
  const was = await fs.readFile(target, "utf8").catch(() => null);
  const mode = (await fs.stat(target).catch(() => null))?.mode & 0o777 || 0o600;
  if (was !== null) {
    await fs.mkdir(BACKUPS, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(BACKUPS, `${new Date().toISOString().replace(/[:.]/g, "-")}.env`), was, { mode: 0o600 });
    const old = (await fs.readdir(BACKUPS)).filter((f) => f.endsWith(".env")).sort();
    for (const f of old.slice(0, -KEEP)) await fs.unlink(path.join(BACKUPS, f)).catch(() => {});
  }
  const tmp = `${target}.panel-${process.pid}`;
  await fs.writeFile(tmp, text.endsWith("\n") || !text ? text : `${text}\n`, { mode });
  await fs.chmod(tmp, mode);
  await fs.rename(tmp, target);
}
// a setting as vvoid will be given it: the panel's own environment over the file (null: unset)
const effective = (name, settings) => process.env[name] ?? (settings.get(name)?.off === false ? settings.get(name).value : null);

// ---- what each setting is: found where it is read, and described where its README describes it ----
// (what vvoid reads, said in its README in prose, or read where no process.env names it)
const CORE = {
  ANTHROPIC_API_KEY: { about: "Claude's key (read by the Anthropic SDK); without one the void is made of local noise instead of dreams" },
  VVOID_PASSWORD: { about: "a password at every plugin's ring (VVOID_<NAME>_PASSWORD, over it, for one; see locks.js)" },
  VVOID_REMEMBER: { about: "how long a right password is remembered: 30d, 12h, 10m (unset: asked every time)" },
};
const SECRET = /KEY|TOKEN|PASSWORD|SECRET/;
const PROCESS_ENV = /process\.env(?:\.([A-Z][A-Z0-9_]*)|\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\])/g;
const strip = (text) => text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*\*|`/g, "").replace(/\s+/g, " ").trim();
// a README's descriptions: table rows (| `NAME` | default | what |) and list items (- `NAME`: what, and on)
function docsIn(text) {
  const docs = new Map();
  let last = null;
  for (const line of text.split("\n")) {
    const row = line.match(/^\|\s*`([A-Z][A-Z0-9_]*)`\s*\|([^|]*)\|([^|]*)\|/);
    const item = line.match(/^\s*[-*]\s+`([A-Z][A-Z0-9_]*)(?:=[^`]*)?`\s*:\s*(.*)$/);
    if (row) docs.set(row[1], { default: strip(row[2]), about: strip(row[3]) }), (last = null);
    else if (item && !docs.has(item[1])) docs.set(item[1], (last = { about: strip(item[2]) }));
    else if (last && /^\s{2,}\S/.test(line) && !/^\s*[-*|]/.test(line)) last.about += ` ${strip(line)}`;
    else last = null;
  }
  return docs;
}
async function namesIn(files) {
  const names = new Set();
  for (const file of files) {
    const text = await fs.readFile(file, "utf8").catch(() => "");
    for (const m of text.matchAll(PROCESS_ENV)) names.add(m[1] ?? m[2]);
  }
  return [...names].filter((n) => n.startsWith("VVOID_") || n === "PORT");
}
// a plugin's own code (not its page's, nor what it installed), two folders deep at most
async function codeOf(dir, depth = 0) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory() && depth < 1 && !["node_modules", "public", ".git"].includes(e.name)) out.push(...(await codeOf(path.join(dir, e.name), depth + 1)));
    else if (e.isFile() && /\.m?js$/.test(e.name)) out.push(path.join(dir, e.name));
  }
  return out;
}
// what each plugin is, in a line or so: its item in plugins/README.md (- `name/`: ...), else its README's first words
function aboutPlugins(text) {
  const out = new Map();
  let last = null;
  for (const line of text.split("\n")) {
    const item = line.match(/^- `([\w-]+)\/`\s*:\s*(.*)$/);
    if (item) out.set(item[1], (last = { about: strip(item[2]) }));
    else if (last && /^\s{2,}\S/.test(line)) last.about += ` ${strip(line)}`;
    else last = null;
  }
  return new Map([...out].map(([k, v]) => [k, v.about]));
}

// the catalogue, made again as it is asked for (plugins come and go; it is quick)
async function catalogue() {
  const readme = docsIn(await fs.readFile(path.join(here, "README.md"), "utf8").catch(() => ""));
  const coreNames = new Set([
    ...Object.keys(CORE), ...readme.keys(),
    ...(await namesIn(["server.js", "locks.js", "slots.js", "admin.js"].map((f) => path.join(here, f)))),
  ]);
  const own = (name) => ({ name, ...CORE[name], ...readme.get(name) });
  const groups = [
    { id: "vvoid", title: "vvoid", entries: [...coreNames].filter((n) => !n.startsWith("VVOID_PANEL_")).map(own) },
    { id: "panel", title: "this panel", about: "read as the panel starts: restart it (npm run panel) for a change to count", entries: [...coreNames].filter((n) => n.startsWith("VVOID_PANEL_")).map(own) },
  ];
  const plugins = [];
  const abouts = aboutPlugins(await fs.readFile(path.join(PLUGINS, "README.md"), "utf8").catch(() => ""));
  const dirs = (await fs.readdir(PLUGINS, { withFileTypes: true }).catch(() => []))
    .filter((e) => e.isDirectory() && /^[\w-]+$/.test(e.name)).map((e) => e.name).sort();
  const taken = new Set(coreNames);
  const found = [];
  for (const name of dirs) {
    const dir = path.join(PLUGINS, name), env = `VVOID_${name.toUpperCase().replace(/-/g, "_")}`;
    const text = await fs.readFile(path.join(dir, "README.md"), "utf8").catch(() => "");
    const docs = docsIn(text);
    const names = new Set([...(await namesIn(await codeOf(dir))), ...[...docs.keys()].filter((n) => n === env || n.startsWith(`${env}_`))]);
    names.add(`${env}_PASSWORD`).add(`${env}_REMEMBER`); // (its lock: any plugin may have one)
    if (PORTAL_ORDER.includes(name)) names.add(`${env}_PORTAL`); // (and its portal's place, if it has one on the circle)
    found.push({ name, env, docs, names });
    const first = text.replace(/^#.*$/gm, "").split(/\n\s*\n/).map(strip).find(Boolean) ?? "";
    plugins.push({ name, about: abouts.get(name) ?? first, server: existsSync(path.join(dir, "server.js")), page: existsSync(path.join(dir, "public", "client.js")), portal: PORTAL_ORDER.includes(name) });
  }
  // (a name read by more than one plugin is the one's whose it is by its name, else the first's)
  for (const { name, env, docs, names } of found) {
    const entries = [];
    for (const n of [...names].sort((a, b) => (a === env ? -1 : b === env ? 1 : a.localeCompare(b)))) {
      if (taken.has(n) || (!n.startsWith(`${env}_`) && n !== env && found.some((o) => o.name !== name && (n === o.env || n.startsWith(`${o.env}_`))))) continue;
      taken.add(n);
      entries.push({
        name: n, ...docs.get(n),
        ...(n === `${env}_PASSWORD` && !docs.has(n) && { about: "a password at its ring (empty: open, whatever VVOID_PASSWORD says)" }),
        ...(n === `${env}_REMEMBER` && !docs.has(n) && { about: "how long its password is remembered: 30d, 12h (over VVOID_REMEMBER)" }),
        ...(n === `${env}_PORTAL` && !docs.has(n) && { default: "auto", about: "where its portal stands: angle,distance,height (degrees round the clock, 0 ahead as you arrive, 90 to the right; unset: in its place on the circle)" }),
      });
    }
    groups.push({ id: `plugin:${name}`, title: name, plugin: name, entries });
  }
  return { groups, plugins };
}

// the settings page's whole picture: each setting with its line's value, and the rest of .env as "other"
async function settings() {
  const text = await readEnv(), lines = parse(text), set = settingsOf(lines);
  const { groups, plugins } = await catalogue();
  const known = new Set(groups.flatMap((g) => g.entries.map((e) => e.name)));
  const others = [...set.keys()].filter((n) => !known.has(n)).map((name) => ({ name }));
  if (others.length) groups.push({ id: "other", title: "other", about: "in .env, and read by nothing the panel knows of", entries: others });
  for (const g of groups) for (const e of g.entries) {
    const l = set.get(e.name);
    Object.assign(e, { value: l?.value ?? "", on: l ? !l.off : false, exists: !!l, secret: SECRET.test(e.name) });
    if (process.env[e.name] !== undefined) e.shadowed = true; // (the panel's environment has its own, over the file)
  }
  const off = new Set((effective("VVOID_PLUGINS_OFF", set) ?? "").split(",").map((n) => n.trim()).filter(Boolean));
  for (const p of plugins) {
    const env = `VVOID_${p.name.toUpperCase().replace(/-/g, "_")}`;
    Object.assign(p, { off: off.has(p.name), locked: !!(effective(`${env}_PASSWORD`, set) ?? effective("VVOID_PASSWORD", set)) });
  }
  // (the circle of portals, for the plugins page's map: see hubSlot in constants.js)
  const ring = { order: PORTAL_ORDER, radius: PORTAL_RING, cell: CELL, reach: REACH * UNIT };
  return { version: versionOf(text), groups, plugins, ring };
}

// ---- the panel's own settings, as it starts ----
const startEnv = settingsOf(parse(await readEnv()));
const PORT = Number(effective("VVOID_PANEL_PORT", startEnv) || 5174);
const HOST = effective("VVOID_PANEL_HOST", startEnv) || "127.0.0.1";
const KEY = effective("VVOID_PANEL_KEY", startEnv) || randomBytes(18).toString("base64url");
const MADE_KEY = !effective("VVOID_PANEL_KEY", startEnv);

// ---- vvoid under systemd (VVOID_PANEL_SYSTEMD: its unit; VVOID_PANEL_SYSTEMD_USER=1: one of a user's own):
// the panel starts, stops and restarts the unit (systemctl, never a shell; a system unit as this user, through
// polkit, else sudo -n where sudoers lets it), shows its state, and reads its journal as vvoid's log. It never
// starts a vvoid of its own then ----
const SERVICE = (() => {
  const u = String(effective("VVOID_PANEL_SYSTEMD", startEnv) ?? "").trim();
  if (!u) return null;
  if (!/^[\w@.:-]{1,120}$/.test(u)) { console.error(`[panel] VVOID_PANEL_SYSTEMD: a unit's name (vvoid, vvoid.service), not ${u}`); return null; }
  return /\.(service|target|scope)$/.test(u) ? u : `${u}.service`;
})();
const SERVICE_USER = /^(1|on|yes|true)$/i.test(effective("VVOID_PANEL_SYSTEMD_USER", startEnv) ?? "");
// a command run, its words as they are (no shell): { code, out, err }
function runs(cmd, args, timeout = 60_000) {
  return new Promise((resolve) => {
    let out = "", err = "";
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, SYSTEMD_PAGER: "", SYSTEMD_COLORS: "0" } });
    const kill = setTimeout(() => p.kill("SIGKILL"), timeout);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => (clearTimeout(kill), resolve({ code: -1, out, err: e.code === "ENOENT" ? `${cmd} is not here` : e.message })));
    p.on("close", (code) => (clearTimeout(kill), resolve({ code, out, err })));
  });
}
async function systemctl(...args) {
  const r = await runs("systemctl", [...(SERVICE_USER ? ["--user"] : []), "--no-ask-password", ...args]);
  // (a system unit, refused to this user: through sudo, if sudoers lets it, without asking for a password)
  if (r.code !== 0 && !SERVICE_USER && /access denied|interactive authentication|not permitted|permission|polkit/i.test(r.err)) {
    const s = await runs("sudo", ["-n", "systemctl", "--no-ask-password", ...args]);
    if (s.code === 0) return s;
    return { ...r, refused: true, err: `${r.err.trim()} (and through sudo: ${s.err.trim() || `code ${s.code}`})` };
  }
  return r;
}
// the unit as it is now: { active (active, activating, deactivating, inactive, failed), sub, pid, since, result, loaded }
let unitSeen = { at: 0, v: null };
async function unitState() {
  if (Date.now() - unitSeen.at < 1500 && unitSeen.v) return unitSeen.v;
  const r = await systemctl("show", SERVICE, "--property=LoadState,ActiveState,SubState,MainPID,ActiveEnterTimestamp,InactiveEnterTimestamp,Result");
  const kv = Object.fromEntries(r.out.split("\n").map((l) => l.match(/^(\w+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
  const when = (t) => (t && !/^n\/a$/.test(t) ? Date.parse(t.replace(/^\w+ /, "").replace(/ (\w+)$/, "")) || null : null);
  const v = r.code === 0 ? {
    loaded: kv.LoadState, active: kv.ActiveState, sub: kv.SubState, pid: Number(kv.MainPID) || null, result: kv.Result,
    since: when(kv.ActiveEnterTimestamp), ended: when(kv.InactiveEnterTimestamp),
  } : { loaded: "unknown", active: "unknown", error: r.err.trim() };
  unitSeen = { at: Date.now(), v };
  return v;
}
// its journal, as vvoid's log (followed while the panel runs; again a while after it stops, as when it is refused)
function followJournal() {
  const args = [...(SERVICE_USER ? ["--user", "--user-unit", SERVICE] : ["-u", SERVICE]), "-f", "-n", "200", "-o", "cat", "--no-pager"];
  const j = spawn("journalctl", args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, SYSTEMD_COLORS: "0" } });
  note(`── ${SERVICE}'s journal (journalctl ${args.join(" ")}) ──`);
  lines(j.stdout, false);
  lines(j.stderr, true);
  j.on("error", (e) => note(`── its journal could not be read: ${e.message} ──`, true));
  j.on("exit", (code) => {
    note(`── ${SERVICE}'s journal ended (code ${code})${SERVICE_USER ? "" : ": the panel's user may need to be in the systemd-journal group to read it"}; again in a minute ──`, true);
    setTimeout(followJournal, 60_000);
  });
}

// ---- vvoid itself: started from here (and stopped with the panel), or found running elsewhere ----
let child = null, startedWith = null, startedAt = 0, ended = null, stopping = null;
const log = []; // { n, at, text, err } (the last LOG lines vvoid wrote, and what the panel said of it)
const LOG = 3000;
let logged = 0;
function note(text, err = false) {
  for (const line of text.split("\n")) {
    (err ? process.stderr : process.stdout).write(`${line}\n`); // (and here too, as npm start would say it)
    log.push({ n: ++logged, at: Date.now(), text: line, err });
    if (log.length > LOG) log.shift();
  }
}
function lines(stream, err) {
  let carry = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    const parts = (carry + chunk).split(/\r?\n/);
    carry = parts.pop();
    for (const p of parts) note(p, err);
    if (carry.length > 8192) note(carry, err), (carry = "");
  });
  stream.on("end", () => carry && note(carry, err));
}
async function start() {
  if (child) return;
  startedWith = versionOf(await readEnv());
  // (as npm start does: the panel's environment, and .env under it, read by vvoid itself)
  const run = spawn(process.execPath, ["--env-file-if-exists=.env", "server.js"], { cwd: here, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  child = run;
  startedAt = Date.now();
  ended = null;
  note(`── vvoid started (pid ${run.pid}) ──`);
  lines(run.stdout, false);
  lines(run.stderr, true);
  run.on("error", (err) => note(`── vvoid could not be started: ${err.message} ──`, true));
  run.on("exit", (code, signal) => {
    ended = { at: Date.now(), code, signal };
    note(`── vvoid ended (${signal ?? `code ${code}`}) ──`, !!code && !signal);
    if (child === run) child = null;
  });
}
// SIGTERM, and SIGKILL if it is still there after a while
function stop() {
  if (!child) return Promise.resolve();
  if (stopping) return stopping;
  const run = child;
  stopping = new Promise((resolve) => {
    const hard = setTimeout(() => run.kill("SIGKILL"), 6000);
    run.once("exit", () => (clearTimeout(hard), (stopping = null), resolve()));
    run.kill("SIGTERM");
  });
  return stopping;
}
// one started elsewhere (npm start, node server.js), in this folder, as this user: found in /proc (Linux), and
// stopped from here too (SIGTERM, SIGKILL after a while); a restart then starts it here, its log read here.
// Anything else answering at its address (another user's, another folder's) is left be
let elsewhereSeen = { at: 0, pids: [] };
async function elsewhere() {
  if (process.platform !== "linux") return [];
  if (Date.now() - elsewhereSeen.at < 2000) return elsewhereSeen.pids;
  const uid = process.getuid(), pids = [];
  for (const name of await fs.readdir("/proc").catch(() => [])) {
    const pid = Number(name);
    if (!pid || pid === process.pid || pid === child?.pid) continue;
    try {
      if ((await fs.stat(`/proc/${pid}`)).uid !== uid || (await fs.readlink(`/proc/${pid}/cwd`)) !== here) continue;
      const argv = (await fs.readFile(`/proc/${pid}/cmdline`, "utf8")).split("\0").filter(Boolean);
      if (/^node/.test(path.basename(argv[0] ?? "")) && argv.slice(1).some((a) => a === "server.js" || a === path.join(here, "server.js"))) pids.push(pid);
    } catch {}
  }
  return (elsewhereSeen = { at: Date.now(), pids }).pids;
}
// (gone: no longer there, or only its exit left for its parent to take)
const alive = (pid) => fs.readFile(`/proc/${pid}/stat`, "utf8").then((s) => !/^\d+ \(.*\) Z/s.test(s), () => false);
async function stopElsewhere(pids) {
  const left = async () => (await Promise.all(pids.map(alive))).some(Boolean);
  for (const pid of pids) try { process.kill(pid, "SIGTERM"); } catch {}
  for (const until = Date.now() + 6000; Date.now() < until && (await left()); ) await new Promise((r) => setTimeout(r, 100));
  for (const pid of pids) if (await alive(pid)) try { process.kill(pid, "SIGKILL"); } catch {}
  for (const until = Date.now() + 2000; Date.now() < until && (await left()); ) await new Promise((r) => setTimeout(r, 100));
  elsewhereSeen.at = 0;
}

// whether vvoid answers at its address (its settings as they are in .env now: for one started elsewhere, a guess)
let probed = { at: 0, up: false };
async function probe(set) {
  if (Date.now() - probed.at < 1000) return probed;
  const port = Number(effective("PORT", set) || 5173), host = effective("VVOID_HOST", set) || "127.0.0.1";
  const at = host === "0.0.0.0" ? "127.0.0.1" : host === "::" ? "::1" : host;
  const base = `http://${at.includes(":") ? `[${at}]` : at}:${port}`;
  const up = await fetch(`${base}/api/plugins`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false);
  return (probed = { at: Date.now(), up, base, port });
}
async function vvoidState() {
  const text = await readEnv(), set = settingsOf(parse(text)), { up, base, port } = await probe(set);
  if (SERVICE) {
    const u = await unitState();
    const changed = await fs.stat(ENV_FILE).then((st) => st.mtimeMs, () => 0);
    return {
      state: u.active === "active" ? (up ? "running" : "starting") : u.active === "activating" || u.active === "reloading" ? "starting" : u.active === "deactivating" ? "stopping" : "stopped",
      pid: u.pid, startedAt: u.since, port,
      ended: u.active === "failed" || u.active === "inactive" ? { at: u.ended, code: u.result, signal: null } : null,
      stale: u.active === "active" && !!u.since && changed > u.since, // (.env changed since the unit started: a restart takes it up)
      systemd: { unit: SERVICE, user: SERVICE_USER, active: u.active, sub: u.sub, loaded: u.loaded, error: u.error ?? null },
      base, url: base?.replace(/\/\/(127\.0\.0\.1|\[::1\])/, "//localhost"),
    };
  }
  return {
    state: child ? (up ? "running" : "starting") : up ? "elsewhere" : "stopped",
    pid: child?.pid ?? (up ? (await elsewhere())[0] ?? null : null), startedAt: child ? startedAt : null, ended, port,
    stale: !!child && startedWith !== versionOf(text), // (.env changed since: a restart takes it up)
    base, url: base?.replace(/\/\/(127\.0\.0\.1|\[::1\])/, "//localhost"),
  };
}

// ---- the look: through vvoid while it runs (as an admin: its key is in .env), else in its file ----
async function look() {
  const set = settingsOf(parse(await readEnv())), { up, base } = await probe(set);
  const fields = LOOK.map(({ key, group, label, min, max, step, type, value }) => ({ key, group, label, min, max, step, type, value }));
  if (up) {
    const looks = await fetch(`${base}/api/look`, { signal: AbortSignal.timeout(3000) }).then((r) => r.json()).catch(() => null);
    if (looks) return { fields, looks, live: true, admin: !!effective("VVOID_ADMIN_KEY", set) };
  }
  return { fields, looks: await lookFile(set), live: false };
}
// ---- what each portal is, beside it in the hub (see about.js): its words, in VVOID_PORTALS; vvoid reads the
// file again as it changes, so they are seen without it restarting ----
const ABOUT_MAX = 2000; // (as server.js keeps them)
const portalsPath = (set) => path.resolve(here, effective("VVOID_PORTALS", set) ?? path.join(".cache", "portals.json"));
async function portalsFile(set) {
  try {
    const kept = JSON.parse(await fs.readFile(portalsPath(set), "utf8"));
    return kept && typeof kept === "object" ? kept : {};
  } catch {
    return {};
  }
}
async function setAbout(name, text) {
  const set = settingsOf(parse(await readEnv())), file = portalsPath(set), kept = await portalsFile(set);
  const about = { ...(kept.about ?? {}) };
  if (text.trim()) about[name] = text.slice(0, ABOUT_MAX);
  else delete about[name];
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.panel-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify({ ...kept, about }, null, 2));
  await fs.rename(tmp, file);
  return about;
}

// and each portal's own word, its quick access (/<word> on vvoid's address goes straight to it: see VANITY in
// server.js), kept beside its words: lower case, never one of vvoid's own first steps, never another portal's
const VANITY = /^[a-z0-9][a-z0-9-]{0,39}$/, VANITY_TAKEN = new Set(["api", "src", "vendor", "plugins", "index", "panel", "admin"]);
async function setVanity(name, word) {
  const set = settingsOf(parse(await readEnv())), file = portalsPath(set), kept = await portalsFile(set);
  const vanity = { ...(kept.vanity ?? {}) };
  if (word) vanity[name] = word;
  else delete vanity[name];
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.panel-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify({ ...kept, vanity }, null, 2));
  await fs.rename(tmp, file);
  return vanity;
}

const lookPath = (set) => path.resolve(here, effective("VVOID_LOOK", set) ?? path.join(".cache", "look.json"));
async function lookFile(set) {
  try {
    const kept = JSON.parse(await fs.readFile(lookPath(set), "utf8"));
    return cleanLooks(kept.now || kept.saves ? kept : { now: kept });
  } catch {
    return { now: {}, saves: {}, saber: [] };
  }
}
async function setLook(given) {
  const set = settingsOf(parse(await readEnv())), { up, base } = await probe(set);
  if (up) {
    const key = effective("VVOID_ADMIN_KEY", set);
    if (!key) return [409, { error: "vvoid is running without an admin key: set VVOID_ADMIN_KEY and restart it, or stop it, to change its look" }];
    // (an admin's cookie, as admin.js makes it from the key)
    const token = createHmac("sha256", key).update("vvoid admin").digest("hex");
    const r = await fetch(`${base}/api/look`, {
      method: "PUT", body: JSON.stringify(given), signal: AbortSignal.timeout(5000),
      headers: { "content-type": "application/json", "x-vvoid-lock": "1", cookie: `vvoid_admin=${token}` },
    }).catch((err) => ({ ok: false, status: 502, json: async () => ({ error: err.message }) }));
    const body = await r.json().catch(() => ({}));
    if (r.status === 403) return [409, { error: "vvoid's admin key is not the one in .env now: restart it" }];
    return r.ok ? [200, { looks: body, live: true }] : [r.status, { error: body.error ?? "vvoid did not take it" }];
  }
  const looks = cleanLooks(given, await lookFile(set)), file = lookPath(set);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(looks, null, 2));
  return [200, { looks, live: false }];
}

// ---- the way in: a passkey (WebAuthn), and nothing else ----
// A passkey is made for one address, the panel's as the browser shows it (its host is the "relying party", and
// a browser never gives a passkey to any other), and asked for there only. The panel's addresses: those in
// VVOID_PANEL_ORIGIN (split by commas: https://panel.example.org), and always this machine's own,
// http://localhost:<port>. Which one a request is for, its Origin says, but only to choose among those: what
// the browser signs says where it was, and that is checked against the one chosen, never against what a
// request's Host header claims. The first passkey is made with VVOID_PANEL_KEY, while there is none, and the key
// gives nothing more (no session, ever); once there is one, the key is refused for everything. More are made,
// and taken away (never the last), by one signed in: at the address they are in at, or (an address with none of
// its own yet) with a code they are given, once, for a little while. Every one lost: delete the passkeys' file
// (VVOID_PANEL_PASSKEYS) on the server, and the key makes one again.
const ORIGINS = (() => {
  const local = `http://localhost:${PORT}`;
  const given = String(effective("VVOID_PANEL_ORIGIN", startEnv) ?? "").split(",").map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean);
  const out = [];
  for (const o of [...given, local]) {
    let u = null;
    try {
      u = new URL(o);
    } catch {}
    // (an origin alone, as a browser says it: https, or http on localhost, where passkeys may be made too; a
    // name, not an address: a relying party is never an IP)
    if (!u || u.origin !== o || /^[\d.]+$|^\[/.test(u.hostname) || !(u.protocol === "https:" || (u.protocol === "http:" && u.hostname === "localhost"))) {
      console.error(`[panel] VVOID_PANEL_ORIGIN: the panel's addresses as the browser shows them, split by commas (https://panel.example.org; http://localhost:${PORT} is always one), not ${o}`);
      process.exit(1);
    }
    if (!out.includes(u.origin)) out.push(u.origin);
  }
  return out;
})();
const rpOf = (origin) => new URL(origin).hostname;
// (whether a passkey is for an address's host: one made before the panel had several does not say, and is
// asked for at each, its own found by what it signs, and kept from then on: see the login)
const fits = (p, rp) => !p.rp || p.rp === rp;
// which of the panel's addresses a request is from (its Origin, only ever one of them; else none)
const originOf = (req) => (ORIGINS.includes(req.headers.origin) ? req.headers.origin : null);
const NOT_HERE = `open the panel at ${ORIGINS.join(" or ")} (VVOID_PANEL_ORIGIN)`;
const PASSKEYS = path.resolve(here, effective("VVOID_PANEL_PASSKEYS", startEnv) || path.join(".cache", "panel-passkeys.json"));
const PASSKEYS_SHOWN = PASSKEYS.startsWith(here + path.sep) ? path.relative(here, PASSKEYS) : PASSKEYS;
const NAME = 40; // (a passkey's name: "laptop", "phone")

// the passkeys, read afresh each time (deleting the file counts at once): { user, passkeys: [{ id, publicKey,
// counter, transports, rp (the address's host it is for), name, created, used }] }. None there is none; one that cannot be read opens nothing.
async function passkeysFile() {
  let text;
  try {
    text = await fs.readFile(PASSKEYS, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return { user: null, passkeys: [] };
    throw err;
  }
  let kept = null;
  try {
    kept = JSON.parse(text);
  } catch {}
  if (!Array.isArray(kept?.passkeys)) throw new Error(`${PASSKEYS_SHOWN} cannot be read: mend it, or delete it (and make a passkey again with the key)`);
  return kept;
}
// written whole, in place of the old one at once (600: what is in it lets no one in, but is no one else's)
async function writePasskeys(kept) {
  await fs.mkdir(path.dirname(PASSKEYS), { recursive: true, mode: 0o700 });
  const tmp = `${PASSKEYS}.panel-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(kept, null, 2), { mode: 0o600 });
  await fs.rename(tmp, PASSKEYS);
}
// one change at a time: read, changed, written, before the next is read
let passkeysBusy = Promise.resolve();
function withPasskeys(fn) {
  const run = passkeysBusy.then(() => passkeysFile()).then(fn);
  passkeysBusy = run.catch(() => {});
  return run;
}
const shown = (p) => ({ id: p.id, name: p.name, at: p.rp ?? null, created: p.created, used: p.used ?? null });
const nameOf = (given) => (typeof given === "string" ? given.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, NAME) : "") || "a passkey";

// what the browser is asked to sign: a challenge each, kept here (never trusted from the page), for a little
// while, and taken once, whatever comes of it
const challenges = new Map(); // challenge -> { kind: "enroll" | "add" | "login", origin, until, name, user, session, code }
const CHALLENGE = 2 * 60_000, CHALLENGES = 100;
function asked(options, kind, more = {}) {
  const now = Date.now();
  for (const [c, at] of challenges) if (now >= at.until) challenges.delete(c);
  if (challenges.size >= CHALLENGES) return null;
  challenges.set(options.challenge, { kind, until: now + CHALLENGE, ...more });
  return options;
}
// (found by what the browser signed it with: its clientData, checked again, whole, in the verifying)
function taken(response, kind) {
  let c = null;
  try {
    c = JSON.parse(Buffer.from(String(response?.response?.clientDataJSON ?? ""), "base64url").toString("utf8")).challenge;
  } catch {}
  const at = typeof c === "string" && challenges.get(c);
  if (!at) return null;
  challenges.delete(c);
  return at.kind === kind && Date.now() < at.until ? { ...at, challenge: c } : null;
}
// a new passkey's options, for the address asked from: user verification asked for (a PIN, a finger, a face),
// none of those there already for it
async function toMake(kept, kind, origin, more) {
  const user = kept.user ?? randomBytes(16).toString("base64url"), rp = rpOf(origin);
  const options = await generateRegistrationOptions({
    rpName: "vvoid panel", rpID: rp, userName: "vvoid", userDisplayName: "vvoid panel",
    userID: new Uint8Array(Buffer.from(user, "base64url")), challenge: new Uint8Array(randomBytes(32)),
    timeout: CHALLENGE, attestationType: "none",
    excludeCredentials: kept.passkeys.filter((p) => fits(p, rp)).map(({ id, transports }) => ({ id, transports })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
  });
  return asked(options, kind, { ...more, origin, user });
}
// and the passkey made, as it is kept: the browser's word for where it was, what it signed and that the one
// holding it was there and known to it (UP, UV), all checked (and the relying party's hash in it)
async function made(response, at) {
  const { verified, registrationInfo: info } = await verifyRegistrationResponse({
    response, expectedChallenge: at.challenge, expectedOrigin: at.origin, expectedRPID: rpOf(at.origin), expectedType: "webauthn.create",
    requireUserPresence: true, requireUserVerification: true,
  });
  if (!verified) throw new Error("not verified");
  const { id, publicKey, counter, transports } = info.credential;
  return {
    id, publicKey: Buffer.from(publicKey).toString("base64url"), counter,
    transports: (transports ?? []).filter((t) => typeof t === "string").slice(0, 8), rp: rpOf(at.origin),
    name: at.name, created: new Date().toISOString(), used: null,
  };
}

// a code for another address (one of the panel's with no passkey of its own yet), given to one signed in: a
// passkey made there with it, once, within ten minutes; kept here by its hash, a few at most
const codes = new Map(); // sha-256 of the code -> until
const CODE_LIFE = 10 * 60_000, CODES = 5, CODE_LETTERS = "abcdefghjkmnpqrstuvwxyz23456789";
function newCode() {
  const now = Date.now();
  for (const [k, until] of codes) if (now >= until) codes.delete(k);
  while (codes.size >= CODES) codes.delete(codes.keys().next().value);
  const code = [...randomBytes(12)].map((b) => CODE_LETTERS[b % CODE_LETTERS.length]).join("").replace(/(.{4})(?=.)/g, "$1-");
  codes.set(hash(code).toString("hex"), now + CODE_LIFE);
  return { code, until: now + CODE_LIFE };
}
// (a code given back: good once, as typed, its dashes and case as they come)
function useCode(given) {
  if (typeof given !== "string" || given.length > 64) return false;
  const key = hash(given.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(.{4})(?=.)/g, "$1-")).toString("hex"), until = codes.get(key);
  codes.delete(key);
  return !!until && Date.now() < until;
}

// sessions: a token for the page (in its sessionStorage), kept here by its hash, ended by a while unused, a
// day whatever, signing out, or its passkey taken away (or the file deleted)
const sessions = new Map(); // sha-256 of the token -> { key, at, last, cred }
const IDLE = 12 * 3_600_000, LIFE = 24 * 3_600_000, SESSIONS = 50;
const over = (s, now) => now - s.last > IDLE || now - s.at > LIFE;
async function sessionOf(req) {
  const token = String(req.headers.authorization ?? "").match(/^Bearer ([\w-]{20,100})$/)?.[1];
  if (!token) return null;
  const key = hash(token).toString("hex"), s = sessions.get(key), now = Date.now();
  if (!s || over(s, now)) return sessions.delete(key), null;
  if (!(await passkeysFile()).passkeys.some((p) => p.id === s.cred)) return sessions.delete(key), null;
  s.last = now;
  return s;
}
function newSession(cred) {
  const now = Date.now();
  for (const [k, s] of sessions) if (over(s, now)) sessions.delete(k);
  while (sessions.size >= SESSIONS) sessions.delete(sessions.keys().next().value); // (the oldest)
  const token = randomBytes(32).toString("base64url"), key = hash(token).toString("hex");
  sessions.set(key, { key, at: now, last: now, cred });
  return token;
}

// how often: a wrong key or a refused passkey, five from one address and it waits a while, twenty from
// anywhere in a minute and every one does; and the way in's own requests, so many a minute
const tries = new Map(); // address -> { fails, until }
let wrongs = [];
const TRIES = 5, COOLDOWN = 5 * 60_000;
const hits = new Map(); // "address" -> times, this last minute
function held(who) {
  const now = Date.now();
  wrongs = wrongs.filter((at) => now - at < 60_000);
  if (now < (tries.get(who)?.until ?? 0)) return "too many refused: wait a while";
  if (wrongs.length >= 20) return "too many refused: wait a minute";
  return null;
}
function failed(who) {
  const now = Date.now(), t = tries.get(who) ?? { fails: 0, until: 0 };
  t.fails = now >= t.until && t.until ? 1 : t.fails + 1;
  t.until = t.fails >= TRIES ? now + COOLDOWN : 0;
  if (tries.size > 1000) for (const [k, v] of tries) if (now >= v.until) tries.delete(k);
  tries.set(who, t);
  wrongs.push(now);
}
function often(who, most) {
  const now = Date.now(), times = (hits.get(who) ?? []).filter((at) => now - at < 60_000);
  times.push(now);
  if (hits.size > 1000) for (const [k, v] of hits) if (!v.some((at) => now - at < 60_000)) hits.delete(k);
  hits.set(who, times);
  return times.length > most;
}
// who asks: the address, or, from a proxy on this machine (Caddy), the one it says it passes on (the last it added)
function whoOf(req) {
  const peer = req.socket.remoteAddress ?? "?";
  const passed = /^(127\.|::1$|::ffff:127\.)/.test(peer) && String(req.headers["x-forwarded-for"] ?? "").split(",").at(-1).trim();
  return passed || peer;
}

// the way in's own requests, before any session: what there is, the first passkey (with the key), and in
async function door(req, res, p) {
  const who = whoOf(req), wait = held(who);
  if (wait) return send(res, 429, { error: wait });
  if (often(who, 30) || often("*", 120)) return send(res, 429, { error: "too many at once: wait a minute" });
  const given = await body(req, 64 * 1024).catch(() => null);
  if (!given || typeof given !== "object") return send(res, 400, { error: "bad request" });
  const kept = await passkeysFile();
  const none = !kept.passkeys.length;
  // (which of the panel's addresses this is: its passkeys only)
  const origin = originOf(req);
  if (!origin) return send(res, 400, { error: NOT_HERE });
  const here = kept.passkeys.filter((k) => fits(k, rpOf(origin)));

  if (p === "/api/enroll/options") {
    // (the key, only while there is no passkey: with one, it is not even looked at; then a code, given to one
    // signed in, for an address with none of its own)
    if (!none) {
      if (given.code === undefined) return send(res, 403, { error: `there is a passkey: the key opens nothing now. Here, a code from the passkeys tab, signed in at another address (every one lost? delete ${PASSKEYS_SHOWN} on the server)` });
      if (!useCode(given.code)) {
        failed(who);
        console.log(`[panel] a wrong (or old) code from ${who}`);
        return send(res, 403, { error: "that code is wrong, used, or too old: ask for another" });
      }
      tries.delete(who);
      const options = await toMake(kept, "enroll", origin, { name: nameOf(given.name), code: true });
      return options ? send(res, 200, { options }) : send(res, 429, { error: "too many asked at once: wait a minute" });
    }
    if (!(typeof given.key === "string" && given.key.length < 1024 && timingSafeEqual(hash(given.key), hash(KEY)))) {
      failed(who);
      console.log(`[panel] a wrong key from ${who}`);
      return send(res, 403, { error: "wrong key" });
    }
    tries.delete(who);
    const options = await toMake(kept, "enroll", origin, { name: nameOf(given.name) });
    return options ? send(res, 200, { options }) : send(res, 429, { error: "too many asked at once: wait a minute" });
  }
  if (p === "/api/enroll") {
    const at = taken(given.response, "enroll");
    if (!at) return failed(who), send(res, 403, { error: "that was not asked for, or too long ago: again" });
    try {
      const passkey = await made(given.response, at);
      await withPasskeys(async (now) => {
        // (with a code: one more, for this address; with the key: the first, only while there is none)
        if (at.code) {
          if (!now.passkeys.some((k) => k.id === passkey.id)) now.passkeys.push(passkey);
          now.user ??= at.user;
          return writePasskeys(now);
        }
        if (now.passkeys.length) throw Object.assign(new Error("a passkey was made meanwhile: come in with it"), { status: 409 });
        await writePasskeys({ user: at.user, passkeys: [passkey] });
      });
      console.log(at.code ? `[panel] a passkey, "${passkey.name}", made for ${passkey.rp} from ${who}, with a code` : `[panel] the first passkey, "${passkey.name}", made for ${passkey.rp} from ${who} (the key opens nothing now)`);
      return send(res, 200, { name: passkey.name }); // (and no session: in, with it)
    } catch (err) {
      if (err.status) return send(res, err.status, { error: err.message });
      failed(who);
      console.log(`[panel] a passkey not made, from ${who}: ${err.message}`);
      return send(res, 403, { error: "the passkey was not taken" });
    }
  }
  if (p === "/api/login/options") {
    if (none) return send(res, 409, { error: "no passkey yet: make one with the key" });
    if (!here.length) return send(res, 409, { error: `no passkey for ${origin} yet: make one with a code from the passkeys tab, signed in at ${[...new Set(kept.passkeys.map((k) => k.rp).filter(Boolean))].join(" or ") || "another address"}` });
    const options = asked(await generateAuthenticationOptions({
      rpID: rpOf(origin), challenge: new Uint8Array(randomBytes(32)), timeout: CHALLENGE, userVerification: "required",
      allowCredentials: here.map(({ id, transports }) => ({ id, transports })),
    }), "login", { origin });
    return options ? send(res, 200, { options }) : send(res, 429, { error: "too many asked at once: wait a minute" });
  }
  if (p === "/api/login") {
    if (given.key !== undefined) return failed(who), send(res, 403, { error: "a passkey, only: the key opens nothing" });
    const at = taken(given.response, "login");
    if (!at) return failed(who), send(res, 403, { error: "that was not asked for, or too long ago: again" });
    try {
      // what it signed, by its own key, there and known to it (UP, UV), its counter never back (when it keeps one)
      const passkey = await withPasskeys(async (now) => {
        const passkey = now.passkeys.find((k) => k.id === given.response.id);
        if (!passkey) throw new Error("not one of the panel's");
        if (!fits(passkey, rpOf(at.origin))) throw new Error(`not one for ${at.origin}`);
        const { verified, authenticationInfo: info } = await verifyAuthenticationResponse({
          response: given.response, expectedChallenge: at.challenge, expectedOrigin: at.origin, expectedRPID: rpOf(at.origin), expectedType: "webauthn.get",
          credential: { id: passkey.id, publicKey: new Uint8Array(Buffer.from(passkey.publicKey, "base64url")), counter: passkey.counter ?? 0, transports: passkey.transports },
          requireUserVerification: true,
        });
        if (!verified || !info.userVerified) throw new Error("not verified");
        Object.assign(passkey, { counter: info.newCounter, used: new Date().toISOString(), rp: rpOf(at.origin) });
        await writePasskeys(now);
        return passkey;
      });
      tries.delete(who);
      console.log(`[panel] in, with "${passkey.name}", from ${who}`);
      return send(res, 200, { token: newSession(passkey.id) });
    } catch (err) {
      failed(who);
      console.log(`[panel] a passkey refused, from ${who}: ${err.message}`);
      return send(res, 403, { error: "the passkey was not taken" });
    }
  }
  send(res, 404, { error: "nothing here" });
}
const DOOR = new Set(["/api/enroll/options", "/api/enroll", "/api/login/options", "/api/login"]);

// and, signed in: the passkeys, more of them (one a device), and one taken away (never the last)
async function passkeys(req, res, p, m, session) {
  const list = (kept) => ({ passkeys: kept.passkeys.map(shown), mine: session.cred, file: PASSKEYS_SHOWN });
  if (p === "/api/passkeys" && m === "GET") return send(res, 200, list(await passkeysFile()));
  if (p === "/api/passkeys/options" && m === "POST") {
    const given = await body(req, 4 * 1024).catch(() => ({}));
    const origin = originOf(req);
    if (!origin) return send(res, 400, { error: NOT_HERE });
    const options = await toMake(await passkeysFile(), "add", origin, { name: nameOf(given?.name), session: session.key });
    return options ? send(res, 200, { options }) : send(res, 429, { error: "too many asked at once: wait a minute" });
  }
  if (p === "/api/passkeys" && m === "POST") {
    const given = await body(req, 64 * 1024).catch(() => null);
    const at = taken(given?.response, "add");
    if (!at || at.session !== session.key) return send(res, 403, { error: "that was not asked for, or too long ago: again" });
    let passkey;
    try {
      passkey = await made(given.response, at);
    } catch (err) {
      console.log(`[panel] a passkey not made: ${err.message}`);
      return send(res, 403, { error: "the passkey was not taken" });
    }
    const kept = await withPasskeys(async (now) => {
      if (now.passkeys.some((k) => k.id === passkey.id)) return now;
      now.user ??= at.user;
      now.passkeys.push(passkey);
      await writePasskeys(now);
      return now;
    });
    console.log(`[panel] a passkey added: "${passkey.name}"`);
    return send(res, 200, list(kept));
  }
  // (a code, for an address with no passkey of its own yet: see newCode)
  if (p === "/api/passkeys/code" && m === "POST") {
    const given = newCode();
    console.log("[panel] a code given, for a passkey at another address (ten minutes, once)");
    return send(res, 200, { ...given, origins: ORIGINS });
  }
  const id = p.match(/^\/api\/passkeys\/([\w-]{1,1400})$/)?.[1];
  if (id && m === "DELETE") {
    const kept = await withPasskeys(async (now) => {
      const passkey = now.passkeys.find((k) => k.id === id);
      if (!passkey) throw Object.assign(new Error("no such passkey"), { status: 404 });
      if (now.passkeys.length <= 1) throw Object.assign(new Error("the last passkey stays: add another first"), { status: 409 });
      now.passkeys = now.passkeys.filter((k) => k !== passkey);
      await writePasskeys(now);
      for (const [k, s] of sessions) if (s.cred === id) sessions.delete(k); // (its sessions with it)
      console.log(`[panel] a passkey taken away: "${passkey.name}"`);
      return now;
    }).catch((err) => err);
    if (kept instanceof Error) return send(res, kept.status ?? 500, { error: kept.message });
    return send(res, 200, list(kept));
  }
  send(res, 404, { error: "nothing here" });
}

// ---- the server ----
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };
function send(res, status, value) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}
async function body(req, limit = 256 * 1024) {
  let text = "";
  for await (const chunk of req) if ((text += chunk).length > limit) throw new Error("too large");
  return JSON.parse(text);
}

const server = http.createServer(async (req, res) => {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("content-security-policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; form-action 'none'; frame-ancestors 'none'; base-uri 'none'");
  try {
    const url = new URL(req.url, "http://panel");
    const p = url.pathname, m = req.method;
    if (!p.startsWith("/api/")) {
      if (m !== "GET" && m !== "HEAD") return send(res, 405, { error: "no" });
      const file = { "/": "index.html", "/panel.js": "panel.js", "/panel.css": "panel.css", "/icon.svg": "icon.svg" }[p];
      if (!file) return send(res, 404, { error: "nothing here" });
      res.writeHead(200, { "content-type": TYPES[path.extname(file)], "cache-control": "no-cache" });
      return res.end(await fs.readFile(path.join(PUBLIC, file)));
    }
    if (p === "/api/auth" && m === "GET") {
      // (for the page's door: whether there is any passkey, and one for the address it says it is at)
      const { passkeys } = await passkeysFile(), at = url.searchParams.get("at");
      const origin = ORIGINS.includes(at) ? at : null;
      return send(res, 200, { enrolled: passkeys.length > 0, here: !!origin && passkeys.some((k) => fits(k, rpOf(origin))), origin, origins: ORIGINS, file: PASSKEYS_SHOWN });
    }
    if (DOOR.has(p) && m === "POST") return await door(req, res, p);
    const session = await sessionOf(req);
    if (!session) return send(res, 401, { error: "a passkey, first" });
    if (p === "/api/logout" && m === "POST") return sessions.delete(session.key), send(res, 200, {});
    if (p.startsWith("/api/passkeys")) return await passkeys(req, res, p, m, session);

    if (p === "/api/state" && m === "GET") {
      const since = Number(url.searchParams.get("since") ?? 0);
      return send(res, 200, { vvoid: await vvoidState(), log: log.filter((l) => l.n > since), logged });
    }
    const act = p.match(/^\/api\/vvoid\/(start|stop|restart)$/)?.[1];
    if (act && m === "POST" && SERVICE) {
      const r = await systemctl(act, SERVICE);
      unitSeen.at = 0; probed.at = 0;
      if (r.code !== 0) {
        const how = r.refused ? ` Let this user do it: in sudoers (visudo), ${process.env.USER ?? "<the panel's user>"} ALL=(root) NOPASSWD: /usr/bin/systemctl ${act} ${SERVICE}` : "";
        note(`── systemctl ${act} ${SERVICE} failed: ${r.err.trim()} ──`, true);
        return send(res, r.refused ? 403 : 500, { error: `systemctl ${act} ${SERVICE}: ${r.err.trim() || `code ${r.code}`}.${how}` });
      }
      note(`── systemctl ${act} ${SERVICE} (from the panel) ──`);
      return send(res, 200, await vvoidState());
    }
    if (act && m === "POST") {
      if (!child && (await probe(settingsOf(parse(await readEnv())))).up) {
        if (act === "start") return send(res, 409, { error: "vvoid is running already, started elsewhere: restart it to run it from here" });
        const pids = await elsewhere();
        if (!pids.length) return send(res, 409, { error: "vvoid is running, started elsewhere, but not as this user in this folder: stop it where it runs" });
        note(`── vvoid started elsewhere (pid ${pids.join(", ")}) stopped from the panel ──`);
        await stopElsewhere(pids);
        probed.at = 0;
      }
      if (act !== "start") await stop();
      if (act !== "stop") await start();
      probed.at = 0;
      return send(res, 200, await vvoidState());
    }

    if (p === "/api/settings" && m === "GET") return send(res, 200, await settings());
    if (p === "/api/settings" && m === "PUT") {
      const { base, edits } = await body(req);
      const text = await readEnv();
      if (base !== versionOf(text)) return send(res, 409, { error: ".env was changed elsewhere meanwhile: look again, then save" });
      if (!Array.isArray(edits)) return send(res, 400, { error: "bad request" });
      let lines = parse(text);
      for (const e of edits) {
        if (!e || typeof e.name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(e.name)) return send(res, 400, { error: "a setting's name is letters, digits and _" });
        if (!e.remove && typeof e.value !== "string") return send(res, 400, { error: `${e.name}: no value` });
        try {
          lines = change(lines, { name: e.name, value: e.value, on: !!e.on, remove: !!e.remove });
        } catch (err) {
          return send(res, 400, { error: err.message });
        }
      }
      await writeEnv(join(lines));
      console.log(`[panel] .env: ${edits.map((e) => e.name).join(", ")}`);
      return send(res, 200, await settings());
    }
    if (p === "/api/env" && m === "GET") {
      const text = await readEnv();
      return send(res, 200, { version: versionOf(text), text });
    }
    if (p === "/api/env" && m === "PUT") {
      const { base, text } = await body(req, 1024 * 1024);
      if (typeof text !== "string") return send(res, 400, { error: "bad request" });
      if (base !== versionOf(await readEnv())) return send(res, 409, { error: ".env was changed elsewhere meanwhile: look again, then save" });
      await writeEnv(text);
      console.log("[panel] .env: written whole");
      const now = await readEnv();
      return send(res, 200, { version: versionOf(now), text: now });
    }

    if (p === "/api/about" && m === "GET") {
      const kept = await portalsFile(settingsOf(parse(await readEnv())));
      return send(res, 200, { about: kept.about ?? {}, vanity: kept.vanity ?? {}, max: ABOUT_MAX });
    }
    if (p === "/api/vanity" && m === "PUT") {
      const { name, word: given } = await body(req, 4 * 1024);
      if (typeof name !== "string" || !/^[\w-]+$/.test(name) || typeof given !== "string") return send(res, 400, { error: "bad request" });
      const word = given.trim().toLowerCase().replace(/^\/+|\/+$/g, "");
      if (word && !VANITY.test(word)) return send(res, 400, { error: "a word of letters, digits and dashes, 40 at most, not starting with a dash" });
      if (VANITY_TAKEN.has(word)) return send(res, 400, { error: `/${word} is vvoid's own` });
      const kept = await portalsFile(settingsOf(parse(await readEnv())));
      const other = Object.entries(kept.vanity ?? {}).find(([n, w]) => n !== name && w === word);
      if (word && other) return send(res, 409, { error: `/${word} is ${other[0]}'s already` });
      const vanity = await setVanity(name, word);
      console.log(`[panel] ${name}: its quick access ${word ? `/${word}` : "taken away"}`);
      return send(res, 200, { about: kept.about ?? {}, vanity, max: ABOUT_MAX });
    }
    if (p === "/api/about" && m === "PUT") {
      const { name, text } = await body(req, 64 * 1024);
      if (typeof name !== "string" || !/^[\w-]+$/.test(name) || typeof text !== "string") return send(res, 400, { error: "bad request" });
      if (text.length > ABOUT_MAX) return send(res, 400, { error: `at most ${ABOUT_MAX} characters` });
      const about = await setAbout(name, text);
      console.log(`[panel] ${name}: its portal's words ${text.trim() ? "written" : "taken away"}`);
      return send(res, 200, { about, vanity: (await portalsFile(settingsOf(parse(await readEnv())))).vanity ?? {}, max: ABOUT_MAX });
    }
    if (p === "/api/look" && m === "GET") return send(res, 200, await look());
    if (p === "/api/look" && m === "PUT") {
      const given = await body(req, 512 * 1024).catch(() => null);
      if (!given || typeof given !== "object") return send(res, 400, { error: "bad request" });
      const [status, out] = await setLook(given);
      return send(res, status, out);
    }
    send(res, 404, { error: "nothing here" });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: err.message });
    else res.destroy();
  }
});

// the panel going, vvoid (if it started it) with it
let leaving = false;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, async () => {
    if (leaving) process.exit(1);
    leaving = true;
    if (child) console.log("[panel] stopping vvoid");
    await stop();
    process.exit(0);
  });
}
process.on("exit", () => child?.kill("SIGTERM"));

server.on("error", (err) => {
  console.error(`[panel] ${err.code === "EADDRINUSE" ? `${HOST}:${PORT} is taken (VVOID_PANEL_PORT)` : err.message}`);
  process.exit(1);
});
server.listen(PORT, HOST, async () => {
  const shown = HOST === "0.0.0.0" || HOST === "::" ? "127.0.0.1" : HOST;
  const at = `http://${shown.includes(":") ? `[${shown}]` : shown}:${PORT}/`;
  // (passkeys are made, and asked for, at the panel's addresses only: VVOID_PANEL_ORIGIN's, and this machine's)
  console.log(`[panel] ${ORIGINS.map((o) => `${o}/`).join("  ")}${ORIGINS.includes(at.replace("//127.0.0.1", "//localhost").replace(/\/$/, "")) ? "" : `  (here at ${at})`}`);
  const n = await passkeysFile().then((k) => k.passkeys.length, (err) => (console.error(`[panel] ${err.message}`), null));
  if (n === 0) console.log(`[panel] no passkey yet: make the first at any of those with ${MADE_KEY ? `the key, #key=${KEY} after the address  (a key for this run only: VVOID_PANEL_KEY sets one that stays)` : "VVOID_PANEL_KEY"}`);
  else if (n) console.log(`[panel] ${n} passkey${n === 1 ? "" : "s"} in ${PASSKEYS_SHOWN}: the key opens nothing (every one lost: delete the file, and the key makes one again)`);
  if (!/^(127\.|::1$|localhost$)/.test(HOST)) console.warn("[panel] open to more than this machine: put it behind https, or what is typed into it (keys and all) goes over the wire as it is");
  if (SERVICE) {
    const u = await unitState();
    console.log(`[panel] vvoid runs under systemd: ${SERVICE}${SERVICE_USER ? " (a user's)" : ""}, ${u.active}${u.error ? ` (${u.error})` : ""}`);
    followJournal();
  } else if (/^(1|on|yes|true)$/i.test(effective("VVOID_PANEL_START", startEnv) ?? "")) {
    if ((await probe(startEnv)).up) console.log("[panel] vvoid is running already (started elsewhere)");
    else await start(), console.log("[panel] vvoid started");
  }
});
