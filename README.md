# vvoid

![The origin of vvoid: the hub's clock in its ring of cubes, and Irrlicht, the cold flame that keeps by you](docs/vvoid.jpg)

Past the blue fog of the PlayStation 2 system menu, there is more of it.

A grid of rooms that were never built, each one dreamt the first time someone comes near: its name,
its colours, what stands in it, the drone it hums, the words hanging in the fog, the sky over it.
Claude dreams them. Once dreamt, a place stays as it was, for everyone who comes after.

Something else is out there. It notices you. Sometimes it says where it will be waiting.

And a cold flame with eyes keeps by you. It is called Irrlicht, and through it you can always go back.

## To enter

    npm install
    echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
    npm start                 # http://127.0.0.1:5173

Without a key the void still opens, made of local noise instead of dreams.

Mouse to look, `W` `A` `S` `D` to fly, `Shift` to surge, `V` casts a light ahead, `J` throws a gob of
alien goo at the post you look at (it clings to the screen and runs down it). `Tab` holds the rest: the map
of everywhere you have been, the keys, the settings (graphics, controls and the controller, sound), the
credits. Its `share` copies a link to where you are: whoever opens it comes in right there, facing as you
face (in a plugin's dimension too, and in its room).

### In a headset

vvoid is played in VR too (WebXR). In a headset's own browser (a Quest's), the start screen's click puts
you straight into it; elsewhere, with a headset there, the `vr` button in the corner does. Your head is
the camera: look at something to aim (the ring before your eyes), and pull either trigger to click it
(a portal flies you in, a post opens). The left stick flies where you look, the right one turns you (in
steps, or smoothly) and rises or sinks; a grip surges. A opens what you look at, B takes you back
(Irrlicht's way), X autofly, Y the menu: the origin, the way back, the sound, how you turn, comfort (the
edges darkened while you fly fast), how big you are in the void, how sharp the picture is. Walking about
your room walks you through the void. What the screen writes over the void (the place's name, a word on
what happened, what the void says, Irrlicht) hangs on a pane below where you look.

A headset needs vvoid on https (behind nginx, say) or on localhost; on a Quest over USB, `adb reverse
tcp:5173 tcp:5173` and open `localhost:5173` in its browser. The picture in there is drawn without the
screen's glow and glass. Plugins whose games are windows on the page (mania, say) cannot be seen in there;
the menu's origin takes you out of them. The saber plugin is made for it.

<details>
<summary>settings, in <code>.env</code></summary>

| | default | |
|---|---|---|
| `PORT` | `5173` | |
| `VVOID_HOST` | `127.0.0.1` | bind address |
| `VVOID_MODEL` | `claude-opus-5-5` | who dreams |
| `VVOID_EFFORT` | `low` | higher: slower, more considered places |
| `VVOID_FAST` | off | `1`: Opus fast mode (twice the price) |
| `VVOID_CACHE` | `.cache/sectors` | where the dreamt places are kept |
| `VVOID_MAX_SECTORS` | `300` | new places per run of the server |
| `VVOID_MAX_BEATS` | `600` | turns of the entity per run |
| `VVOID_MAX_SLOTS` | none | how many may be in the void at once; the rest wait in line on the start screen |
| `VVOID_ADMIN_KEY` | none | open vvoid once as `/?admin=<key>`: that browser is admin for a year, straight in past the line (taking no slot) and through every portal without its password; `/?admin=` lets it go |
| `VVOID_LOOK` | `.cache/look.json` | where the void's look is kept (as an admin turns it: `Tab`, then look) |
| `VVOID_PORTALS` | `.cache/portals.json` | what each portal is, in your words, on a pane inside it, beside its way back; and each one's quick access, a word of its own: `/<word>` on vvoid's address starts you before that portal and flies you in (both written from the panel's plugins page; seen without a restart) |
| `VVOID_PLUGINS_OFF` | none | plugins left in `plugins/` but not loaded: their folders' names, split by commas |

Behind nginx on the same machine, let it say who is asking (for the logs, and so that wrong passwords
are counted per visitor rather than for everyone at once):

    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

</details>

### The panel

    npm run panel             # http://localhost:5174

A page of its own, on its own port, apart from the void: every setting above and every plugin's, each as
its README describes it (or `.env` whole, as it is), which plugins are on, the void's look, and vvoid
itself, started, stopped and restarted from there (it reads `.env` once, as it starts), with what it
writes. The way in is a passkey, and nothing else, kept in `.cache/panel-passkeys.json`. A passkey is for one
address: the panel's are `http://localhost:<port>`, always, and those in `VVOID_PANEL_ORIGIN`
(`https://panel.example.org` behind a proxy). While there is none at all it shows a page to make the first, at
any of them, with a key: `VVOID_PANEL_KEY`, or, unset, a new one each time it starts, in the link it prints.
The key makes that passkey and nothing more (never a way in of its own); once there is one it is refused for
everything. More passkeys (one a device: "laptop", "phone") are made and taken away, never the last, from the
panel's passkeys tab; one for another of its addresses with a code given there (ten minutes, once), typed in
at that address in place of the key. Every one lost: delete the passkeys' file on the server, and the key makes
one again. The `.env` before each change is kept in `.cache/panel/env/`. vvoid started from the panel stops
with it; one started elsewhere (`npm start`) is seen, and, on Linux, as the panel's user in this folder, stopped
from it too, or restarted there (then running from the panel, its log read there).

| | default | |
|---|---|---|
| `VVOID_PANEL_PORT` | `5174` | the panel's port |
| `VVOID_PANEL_HOST` | `127.0.0.1` | its bind address (anything wider: put it behind https, as it shows every key) |
| `VVOID_PANEL_KEY` | a new one each run | the key that makes the first passkey, while there is none (and nothing else) |
| `VVOID_PANEL_ORIGIN` | none | the panel's addresses as the browser shows them, besides `http://localhost:<port>` (always one), split by commas (`https://panel.example.org` behind a proxy): a passkey is made for one of them, and taken there only |
| `VVOID_PANEL_PASSKEYS` | `.cache/panel-passkeys.json` | where its passkeys are kept (delete it, and the key makes one again) |
| `VVOID_PANEL_START` | off | `1`: start vvoid as the panel starts |
| `VVOID_PANEL_SYSTEMD` | none | the systemd unit vvoid runs as (`vvoid`, `vvoid.service`): the panel's start, stop and restart are that unit's (`systemctl`), its state is shown, and its journal is the log; the panel starts no vvoid of its own then. A system unit, as the panel's user: through polkit, else `sudo -n` (a sudoers line such as `kibi ALL=(root) NOPASSWD: /usr/bin/systemctl restart vvoid.service`, one for each of start, stop and restart wanted); its journal, the panel's user in `systemd-journal` |
| `VVOID_PANEL_SYSTEMD_USER` | off | `1`: that unit is one of the panel's user's own (`systemctl --user`) |

## Other doors

Round the clock at the origin there is room for more rings. Each is a plugin, a folder in `plugins/`:
a dimension, a game, a place of someone's own. vvoid needs none of them, and keeps them out of its
repository. What a plugin is given and the hooks it answers are written down in `public/src/main.js`
(the page) and `server.js` (the server). Any of them can be put behind a password, asked at its ring:
`VVOID_PASSWORD` in `.env` for all of them, `VVOID_<NAME>_PASSWORD` for one, over it; asked every time,
unless `VVOID_REMEMBER` (or `VVOID_<NAME>_REMEMBER`: `30d`, `12h`) says how long to remember it (see `locks.js`).
None is locked unless a password is set.

Each portal stands in its place on the circle round the clock, the circle shared evenly among them. One can
be placed elsewhere: `VVOID_<NAME>_PORTAL` is `angle,distance,height`, the angle in degrees round the clock
(0 straight ahead as you arrive, 90 a quarter turn to the right), the distance from it (`8800`, the circle's),
and the height over it (`0`); the others stay where they stood. The panel's plugins page has them on a map,
to be dragged where they should stand, and `auto` puts one back. And a few words for each, what it is: inside
it, on a pane of dark glass beside its way back to the hub, turned to you as you come near (none written, none there).

## Made with

Open source, and with thanks to the people who made it:

| | licence | |
|---|---|---|
| [three.js](https://threejs.org) | MIT | the whole picture: the void, what stands in it, the glow |
| [Ruffle](https://ruffle.rs) | MIT / Apache-2.0 | Flash, played again, in the plugins' dimensions |
| [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript) | MIT | how the server asks Claude, who dreams the places |
| [Zod](https://zod.dev) | MIT | the shape a dreamt place has to have |
| [Node.js](https://nodejs.org) | MIT | the server |
| [Puppeteer](https://pptr.dev) | Apache-2.0 | vvoid driven headless: its tests, and stills of it |

And the code it borrows:

| | licence | |
|---|---|---|
| [webgl-noise](https://github.com/stegu/webgl-noise) | MIT | simplex noise on the GPU, by Ian McEwan and Stefan Gustavson: the sky and every place's field |
| [Simplex noise demystified](https://github.com/stegu/perlin-noise) | public domain | simplex noise on the CPU, after Stefan Gustavson: where the void is crowded and where it is empty |
| [mulberry32](https://gist.github.com/tommyettinger/46a874533244883189143505d203312c) | public domain | seeded randomness, by Tommy Ettinger: the same place is always the same |
| [MurmurHash3](https://github.com/aappleby/smhasher) | public domain | its finaliser, by Austin Appleby: a place's coordinates into its seed |

The licence text of the code taken from them: `THIRD-PARTY-NOTICES.md`.

What a plugin brings keeps its own licence, and is named on the credits page in vvoid (`Tab`, then
`credits`).

## Made by

<img src="docs/irrlicht.png" alt="Irrlicht" width="140" align="right">

Kibi Kelburton, with Claude (Opus 5.5, by Anthropic), who wrote the code with Kibi in Claude Code
and, in the void, dreams the places and speaks for what waits there.

Copyright (C) 2026 Kibi Kelburton. vvoid is free software under the GNU Affero General Public
License, version 3 or (at your option) any later version (see `LICENSE`), and comes with no
warranty. Run it, change it, pass it on; if you let others use a changed vvoid over a network,
offer them its source.
