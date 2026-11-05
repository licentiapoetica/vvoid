#!/usr/bin/env bash
# vvoid on a Debian 13 server, in one command: Node.js, the tools the plugins call, a user of its own,
# systemd units for vvoid and its panel, and nginx in front of it (on https, with Let's Encrypt, given an
# email). Run it again, from a newer checkout, to update: the code is copied over; .env and .cache are kept.
#
#   sudo deploy/install.sh --domain void.example.org --email you@example.org
#
# Run it from the checkout you want served, plugins/ and all: plugins are kept out of git, so whatever is in
# this checkout's plugins/ is what the server gets.
set -euo pipefail

DIR=/opt/vvoid
SVC_USER=vvoid
DOMAIN=""
PANEL_DOMAIN=""
EMAIL=""
API_KEY=""
EXTRAS=1
NGINX=1
NODE_MAJOR=24

usage() {
  cat <<EOF
usage: sudo $0 [options]

  --domain NAME        vvoid's address (nginx's server_name); without it nginx answers on any name, on http
  --email ADDR         get a Let's Encrypt certificate for the domain(s) with this address, and serve https
  --panel-domain NAME  the panel on its own address too (https: needs --email); without it the panel stays on
                       this machine's 127.0.0.1:5174, reached through ssh -L 5174:localhost:5174
  --api-key KEY        ANTHROPIC_API_KEY (else asked for, if it is not in .env yet; or set it in the panel)
  --dir DIR            where vvoid is installed (default $DIR)
  --user NAME          the user it runs as (default $SVC_USER)
  --no-extras          skip ffmpeg, chromium, imagemagick and yt-dlp (only plugins need them)
  --no-nginx           leave nginx alone: vvoid and the panel on 127.0.0.1 only, for a proxy of your own
                       (pass it X-Real-IP, X-Forwarded-For and -Proto, and websockets; see the README)
EOF
  exit "${1:-0}"
}

while (($#)); do
  case $1 in
    --domain) DOMAIN=${2:?}; shift 2 ;;
    --panel-domain) PANEL_DOMAIN=${2:?}; shift 2 ;;
    --email) EMAIL=${2:?}; shift 2 ;;
    --api-key) API_KEY=${2:?}; shift 2 ;;
    --dir) DIR=${2:?}; shift 2 ;;
    --user) SVC_USER=${2:?}; shift 2 ;;
    --no-extras) EXTRAS=0; shift ;;
    --no-nginx) NGINX=0; shift ;;
    -h|--help) usage ;;
    *) echo "unknown option: $1" >&2; usage 1 ;;
  esac
done

say() { printf '\033[1;35m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

((EUID == 0)) || die "run it as root (sudo $0 ...)"
trap 'die "stopped at line $LINENO: $BASH_COMMAND (exit $?); nothing after it was done"' ERR
SRC=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
[[ -f $SRC/server.js && -f $SRC/package.json ]] || die "$SRC is not vvoid's checkout"
name_ok='^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$'
[[ -z $DOMAIN || $DOMAIN =~ $name_ok ]] || die "--domain: a host name, not $DOMAIN"
[[ -z $PANEL_DOMAIN || $PANEL_DOMAIN =~ $name_ok ]] || die "--panel-domain: a host name, not $PANEL_DOMAIN"
[[ -z $EMAIL || -n $DOMAIN ]] || die "--email needs --domain (a certificate is for a name)"
if ((NGINX)); then
  [[ -z $PANEL_DOMAIN || -n $EMAIL ]] || die "--panel-domain needs --email: the panel's passkeys work on https only"
else
  [[ -z $DOMAIN && -z $EMAIL ]] || die "--domain and --email are for the nginx it sets up: not with --no-nginx"
  # (--panel-domain still says where your own proxy serves the panel, on https: VVOID_PANEL_ORIGIN)
fi
[[ $SVC_USER =~ ^[a-z_][a-z0-9_-]*$ ]] || die "--user: a user name, not $SVC_USER"
DIR=$(realpath -m "$DIR")
case $DIR in /home/*|/root|/root/*) die "--dir: not under /home or /root (the units keep those read-only)" ;; esac
TLS=0; [[ -n $EMAIL ]] && TLS=1

# shellcheck source=/dev/null
. /etc/os-release 2>/dev/null || true
[[ ${ID:-} == debian && ${VERSION_ID:-} == 13 ]] || warn "made for Debian 13; this is ${PRETTY_NAME:-unknown}: going on anyway"

export DEBIAN_FRONTEND=noninteractive
apt_install() { apt-get install -y --no-install-recommends "$@"; }

# ---- packages ----
say "packages"
apt-get update -q
apt_install ca-certificates curl gnupg rsync sudo
((NGINX)) && apt_install nginx
((TLS)) && apt_install certbot
((EXTRAS)) && apt_install ffmpeg chromium imagemagick python3

# ---- Node.js: 22 or newer (Debian 13's own is 20, without --env-file-if-exists or a WebSocket of its own) ----
node_major() { command -v node >/dev/null && node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
if (($(node_major) < 22)); then
  say "Node.js $NODE_MAJOR (NodeSource)"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" >/etc/apt/sources.list.d/nodesource.list
  printf 'Package: nodejs\nPin: origin deb.nodesource.com\nPin-Priority: 600\n' >/etc/apt/preferences.d/nodesource
  apt-get update -q
  apt_install nodejs
fi
NODE=$(command -v node)
(($(node_major) >= 22)) || die "Node.js is still $(node -v): vvoid needs 22 or newer"
say "Node.js $(node -v) at $NODE"

# ---- what the plugins call ----
if ((EXTRAS)); then
  # yt-dlp from upstream, kept up to date daily (Debian's goes stale, and YouTube and TikTok break old ones)
  if [[ -x /usr/local/bin/yt-dlp ]]; then
    /usr/local/bin/yt-dlp -U || warn "yt-dlp could not update itself"
  else
    say "yt-dlp"
    curl -fsSL -o /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp
    chmod 0755 /usr/local/bin/yt-dlp
  fi
  # (YouTube wants a JavaScript runtime; Node.js is here. Left alone if there is one already)
  [[ -e /etc/yt-dlp.conf ]] || printf '# written by vvoid'"'"'s deploy/install.sh: YouTube needs a JavaScript runtime\n--js-runtimes node\n' >/etc/yt-dlp.conf
  cat >/etc/systemd/system/vvoid-yt-dlp-update.service <<EOF
[Unit]
Description=yt-dlp, updated (for vvoid's plugins)
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/yt-dlp -U
EOF
  cat >/etc/systemd/system/vvoid-yt-dlp-update.timer <<EOF
[Unit]
Description=yt-dlp, updated daily (for vvoid's plugins)

[Timer]
OnCalendar=daily
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
EOF
  # z0r calls magick (ImageMagick 7); where only ImageMagick 6 is, its convert does the same here
  if ! command -v magick >/dev/null && command -v convert >/dev/null; then
    printf '#!/bin/sh\n# ImageMagick 6 standing in for 7'"'"'s magick (written by vvoid'"'"'s deploy/install.sh)\nexec convert "$@"\n' >/usr/local/bin/magick
    chmod 0755 /usr/local/bin/magick
  fi
fi

# ---- the user it runs as ----
if ! id "$SVC_USER" &>/dev/null; then
  say "user $SVC_USER"
  useradd --system --user-group --create-home --home-dir "/var/lib/$SVC_USER" --shell /usr/sbin/nologin "$SVC_USER"
fi
usermod -aG systemd-journal "$SVC_USER" # (the panel reads vvoid's journal as its log)
SVC_HOME=$(getent passwd "$SVC_USER" | cut -d: -f6)
as_svc() { runuser -u "$SVC_USER" -- env HOME="$SVC_HOME" PATH="$PATH" "$@"; }

# ---- the code ----
install -d -m 0755 "$DIR"
if [[ $(realpath "$SRC") != "$DIR" ]]; then
  say "copying $SRC to $DIR"
  rsync -a --exclude=/.git/ --exclude=node_modules/ --exclude=/.cache/ --exclude=/.env --exclude=/.vscode/ --exclude=/.claude/ "$SRC/" "$DIR/"
fi
[[ -d $DIR/plugins ]] && compgen -G "$DIR/plugins/*/server.js" >/dev/null || warn "no plugins in $DIR/plugins: they are kept out of git, so copy them into the checkout you run this from"
chown -R "$SVC_USER:$SVC_USER" "$DIR"

# ---- .env: made from .env.example the first time; what is set there already is kept ----
ENV=$DIR/.env
if [[ ! -f $ENV ]]; then
  say ".env, from .env.example"
  cp "$DIR/.env.example" "$ENV" 2>/dev/null || : >"$ENV"
fi
[[ -s $ENV && -n $(tail -c1 "$ENV") ]] && echo >>"$ENV"
env_get() { awk -v k="$1" 'index($0, k "=") == 1 { v = substr($0, length(k) + 2) } END { print v }' "$ENV"; }
# a setting, put in place of its own line, else of its commented example, else at the end
env_put() {
  local key=$1 at
  if grep -q "^$key=" "$ENV"; then at="$key="; elif grep -q "^#$key=" "$ENV"; then at="#$key="; else printf '%s=%s\n' "$key" "$2" >>"$ENV"; return; fi
  V=$2 awk -v at="$at" -v k="$key" 'BEGIN { v = ENVIRON["V"] } !done && index($0, at) == 1 { print k "=" v; done = 1; next } { print }' "$ENV" >"$ENV.new"
  cat "$ENV.new" >"$ENV" && rm -f "$ENV.new"
}
env_default() { grep -q "^$1=" "$ENV" || env_put "$1" "$2"; }
secret() { head -c 18 /dev/urandom | base64 | tr '+/' '-_' | tr -d '='; }

if [[ -n $API_KEY ]]; then
  env_put ANTHROPIC_API_KEY "$API_KEY"
elif [[ -z $(env_get ANTHROPIC_API_KEY) && -t 0 ]]; then
  read -rsp "ANTHROPIC_API_KEY (Enter to skip: the void is made of local noise without one): " API_KEY </dev/tty; echo
  [[ -n $API_KEY ]] && env_put ANTHROPIC_API_KEY "$API_KEY"
fi
env_default VVOID_HOST 127.0.0.1       # (nginx is in front; only from loopback are its X-Real-IP headers believed)
env_default VVOID_PANEL_HOST 127.0.0.1
env_default VVOID_ADMIN_KEY "$(secret)"
env_default VVOID_PANEL_KEY "$(secret)"
env_put VVOID_PANEL_SYSTEMD vvoid.service
[[ -n $PANEL_DOMAIN ]] && env_put VVOID_PANEL_ORIGIN "https://$PANEL_DOMAIN"
chown "$SVC_USER:$SVC_USER" "$ENV"
chmod 0600 "$ENV"
say "settings in $ENV (root's or $SVC_USER's to read: sudo -u $SVC_USER nano $ENV, or the panel)"
PORT=$(env_get PORT); PORT=${PORT:-5173}
PANEL_PORT=$(env_get VVOID_PANEL_PORT); PANEL_PORT=${PANEL_PORT:-5174}

# ---- its libraries (dev ones too: tiktok and shorts drive Chromium through puppeteer-core) ----
say "npm ci"
(cd "$DIR" && as_svc npm ci --no-audit --no-fund --loglevel=error)
for pj in "$DIR"/plugins/*/package.json; do
  [[ -f $pj ]] || continue
  d=$(dirname "$pj")
  say "npm, for plugins/$(basename "$d")"
  if [[ -f $d/package-lock.json ]]; then (cd "$d" && as_svc npm ci --no-audit --no-fund --loglevel=error)
  else (cd "$d" && as_svc npm install --no-audit --no-fund --loglevel=error); fi
done

# ---- systemd: vvoid, and its panel (which starts, stops and restarts vvoid's unit, through sudo) ----
say "systemd units"
cat >/etc/systemd/system/vvoid.service <<EOF
[Unit]
Description=vvoid
Documentation=file://$DIR/README.md
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=$SVC_USER
Group=$SVC_USER
WorkingDirectory=$DIR
ExecStart=$NODE --env-file-if-exists=.env server.js
Restart=on-failure
RestartSec=3
LimitNOFILE=65536
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only

[Install]
WantedBy=multi-user.target
EOF
cat >/etc/systemd/system/vvoid-panel.service <<EOF
[Unit]
Description=vvoid's panel
Documentation=file://$DIR/README.md
Wants=network-online.target
After=network-online.target vvoid.service

[Service]
Type=simple
User=$SVC_USER
Group=$SVC_USER
WorkingDirectory=$DIR
ExecStart=$NODE panel.js
Restart=on-failure
RestartSec=3
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only
# (no NoNewPrivileges: it restarts vvoid through sudo)

[Install]
WantedBy=multi-user.target
EOF
# (exactly as the panel asks it: sudo -n systemctl --no-ask-password <start|stop|restart> vvoid.service)
sudoers=$(mktemp)
{
  echo "# vvoid's panel, as $SVC_USER, starts, stops and restarts vvoid.service, and nothing else (deploy/install.sh)"
  echo "$SVC_USER ALL=(root) NOPASSWD: /usr/bin/systemctl --no-ask-password start vvoid.service, /usr/bin/systemctl --no-ask-password stop vvoid.service, /usr/bin/systemctl --no-ask-password restart vvoid.service"
} >"$sudoers"
visudo -cqf "$sudoers" || die "the sudoers line did not pass visudo"
install -m 0440 "$sudoers" /etc/sudoers.d/vvoid-panel
rm -f "$sudoers"

systemctl daemon-reload
systemctl enable vvoid.service vvoid-panel.service
((EXTRAS)) && systemctl enable --now vvoid-yt-dlp-update.timer
systemctl restart vvoid.service vvoid-panel.service

# ---- nginx ----
if ((NGINX)); then
say "nginx"
CERT=/etc/letsencrypt/live/vvoid
ACME=/var/www/letsencrypt
install -d -m 0755 "$ACME"
v6=0; [[ -e /proc/net/if_inet6 ]] && v6=1

# what every request to vvoid (or its panel) is given on its way: websockets, who asks, nothing held back
proxy() {
  cat <<EOF
        proxy_pass http://127.0.0.1:$1;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$vvoid_connection;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
EOF
}
# a site: its name (empty: any), the port behind it, the most a request may carry, https or not
site() {
  local name=$1 port=$2 most=$3 https=$4 any=""
  [[ -z $name ]] && any=" default_server"
  cat <<EOF

server {
    listen 80$any;
$( ((v6)) && echo "    listen [::]:80$any;")
    server_name ${name:-_};
    location ^~ /.well-known/acme-challenge/ { root $ACME; }
EOF
  if ((https)); then
    cat <<EOF
    location / { return 301 https://\$host\$request_uri; }
}

server {
    listen 443 ssl;
$( ((v6)) && echo "    listen [::]:443 ssl;")
    http2 on;
    server_name $name;
    ssl_certificate $CERT/fullchain.pem;
    ssl_certificate_key $CERT/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
EOF
  fi
  cat <<EOF
    client_max_body_size $most;
    gzip on;
    gzip_types text/css application/javascript text/javascript application/json image/svg+xml;
    location / {
$(proxy "$port")
    }
}
EOF
}
write_nginx() {
  local https=$1
  {
    echo "# written by vvoid's deploy/install.sh (run again, it is written again)"
    echo 'map $http_upgrade $vvoid_connection { default upgrade; "" close; }'
    site "$DOMAIN" "$PORT" 1g "$https"           # (mania's and slicer's imports run to hundreds of MB)
    [[ -n $PANEL_DOMAIN ]] && site "$PANEL_DOMAIN" "$PANEL_PORT" 16m "$https"
  } >/etc/nginx/sites-available/vvoid
  ln -sf /etc/nginx/sites-available/vvoid /etc/nginx/sites-enabled/vvoid
  nginx -t -q || die "nginx -t failed on /etc/nginx/sites-available/vvoid"
  systemctl reload-or-restart nginx
}
# (without a name vvoid is nginx's default site, in place of Debian's welcome page)
[[ -z $DOMAIN && -L /etc/nginx/sites-enabled/default ]] && rm /etc/nginx/sites-enabled/default
systemctl enable nginx >/dev/null 2>&1
have_cert() { [[ -f $CERT/fullchain.pem && -f $CERT/privkey.pem ]]; }
write_nginx $((TLS && $(have_cert && echo 1 || echo 0)))

if ((TLS)); then
  say "Let's Encrypt, for $DOMAIN${PANEL_DOMAIN:+ and $PANEL_DOMAIN}"
  install -d /etc/letsencrypt/renewal-hooks/deploy
  printf '#!/bin/sh\nsystemctl reload nginx\n' >/etc/letsencrypt/renewal-hooks/deploy/vvoid-nginx
  chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/vvoid-nginx
  if certbot certonly --webroot -w "$ACME" --cert-name vvoid -d "$DOMAIN" ${PANEL_DOMAIN:+-d "$PANEL_DOMAIN"} \
       --email "$EMAIL" --agree-tos --non-interactive --keep-until-expiring; then
    write_nginx 1
  else
    TLS=0
    warn "no certificate (does $DOMAIN${PANEL_DOMAIN:+ and $PANEL_DOMAIN} point at this machine, with ports 80 and 443 open?): serving http for now; run this again once it does"
  fi
fi

if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null
fi
fi # (nginx)

# ---- is it up ----
up() { for _ in $(seq 30); do curl -fsS -o /dev/null "$1" 2>/dev/null && return 0; sleep 1; done; return 1; }
up "http://127.0.0.1:$PORT/" && say "vvoid is up" || warn "vvoid does not answer on 127.0.0.1:$PORT: journalctl -u vvoid -n 50"
up "http://127.0.0.1:$PANEL_PORT/" && say "the panel is up" || warn "the panel does not answer on 127.0.0.1:$PANEL_PORT: journalctl -u vvoid-panel -n 50"

scheme=http; ((TLS)) && scheme=https
at="$scheme://${DOMAIN:-$(hostname -I 2>/dev/null | awk '{print $1}')}"
((NGINX)) || at="http://127.0.0.1:$PORT"
cat <<EOF

vvoid:      $at/
admin:      $at/?admin=$(env_get VVOID_ADMIN_KEY)    (open once in your browser: it stays admin for a year)
EOF
if [[ -n $PANEL_DOMAIN ]] && ((TLS || !NGINX)); then
  echo "panel:      https://$PANEL_DOMAIN/#key=$(env_get VVOID_PANEL_KEY)"
else
  echo "panel:      ssh -L $PANEL_PORT:localhost:$PANEL_PORT <this server>, then http://localhost:$PANEL_PORT/#key=$(env_get VVOID_PANEL_KEY)"
fi
cat <<EOF
            (the key makes the first passkey, and nothing once there is one)
settings:   $ENV (or the panel)
logs:       journalctl -u vvoid -f      journalctl -u vvoid-panel -f
update:     git pull in your checkout, then this again
EOF
((TLS)) || [[ -z $DOMAIN ]] || echo "https:     run this again with --email you@example.org (a headset's WebXR needs https)"
