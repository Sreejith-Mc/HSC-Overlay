#!/usr/bin/env bash
# ==========================================================================
# HSC Overlay — one-shot setup for a fresh Ubuntu VM
# (Oracle Cloud Always Free, Hetzner, DigitalOcean, any Debian/Ubuntu box.)
#
# Run as root on a clean server:
#   curl -fsSL https://raw.githubusercontent.com/<you>/<repo>/main/tools/vm-setup.sh | bash -s -- <your-domain>
# or copy it across and:
#   sudo bash vm-setup.sh overlay.example.com
#
# Installs Node, clones the app, runs it under systemd, and puts Caddy in
# front for automatic HTTPS. HTTPS is not optional: the sign-in cookie only
# gets its Secure flag over TLS.
# ==========================================================================
set -euo pipefail

DOMAIN="${1:-}"
REPO="${REPO:-}"          # export REPO=https://github.com/you/hsc-overlay.git
APP_DIR=/opt/hsc-overlay
APP_USER=hsc

if [[ -z "$DOMAIN" ]]; then
  echo "Usage: bash vm-setup.sh <domain>   (point its DNS A record at this server first)"
  exit 1
fi
if [[ -z "$REPO" ]]; then
  echo "Set REPO first, e.g.:  export REPO=https://github.com/you/hsc-overlay.git"
  exit 1
fi

echo "==> Installing Node.js 22 and Caddy"
apt-get update -qq
apt-get install -y -qq curl git debian-keyring debian-archive-keyring apt-transport-https
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
apt-get install -y -qq nodejs

curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  > /etc/apt/sources.list.d/caddy-stable.list
apt-get update -qq && apt-get install -y -qq caddy

echo "==> Fetching the app"
id -u "$APP_USER" &>/dev/null || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
rm -rf "$APP_DIR"
git clone --depth 1 "$REPO" "$APP_DIR"
mkdir -p "$APP_DIR/data" "$APP_DIR/assets"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# A persistent disk means auth.json survives, so operators can be managed with
# `npm run operator` rather than env vars. We still pin AUTH_SECRET so sessions
# survive a restart, and generate an ingest key rather than leaving the default.
SECRET=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
INGEST=$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')

echo "==> Installing the service"
cat >/etc/systemd/system/hsc-overlay.service <<EOF
[Unit]
Description=HSC Overlay
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
Environment=PORT=8787
Environment=HOST=127.0.0.1
Environment=TRUST_PROXY=1
Environment=AUTH_SECRET=$SECRET
Environment=INGEST_KEY=$INGEST
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now hsc-overlay

echo "==> Putting Caddy in front (automatic HTTPS)"
cat >/etc/caddy/Caddyfile <<EOF
$DOMAIN {
    reverse_proxy 127.0.0.1:8787
}
EOF
systemctl reload caddy

cat <<EOF

──────────────────────────────────────────────────────────────
  Done.

  Panel   : https://$DOMAIN/admin
  Overlay : https://$DOMAIN/overlay
  Ingest  : key $INGEST

  ⚠ The panel is OPEN until you create an operator. Do it now:

      cd $APP_DIR && sudo -u $APP_USER npm run operator -- add <name>
      sudo systemctl restart hsc-overlay

  Logs: journalctl -u hsc-overlay -f
──────────────────────────────────────────────────────────────
EOF
