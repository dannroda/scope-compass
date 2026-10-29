#!/bin/sh
# Instala Scope Compass en Linux: la CLI `scompass` y un lanzador del menú que levanta el Inicio con ícono en la
# bandeja (desde la bandeja se activa el acceso en la red).
#   install.sh [paquete.tgz]  npm install -g del .tgz (sin argumento, el más nuevo al lado de este script o en dist/)
#   install.sh --dev          `scompass` en ~/.local/bin llama al hub/bin/scompass.js de este repo (para desarrollar)
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
APPS=${XDG_DATA_HOME:-$HOME/.local/share}/applications
ICONS=${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/scalable/apps

if [ "${1:-}" = --dev ]; then
  REPO=$(cd "$HERE/.." && pwd)
  [ -d "$REPO/hub/node_modules" ] || (cd "$REPO/hub" && npm install)
  mkdir -p "$HOME/.local/bin"
  printf '#!/bin/sh\nexec node %s/hub/bin/scompass.js "$@"\n' "$REPO" > "$HOME/.local/bin/scompass"
  chmod +x "$HOME/.local/bin/scompass"
  BIN=$HOME/.local/bin/scompass
  ICON=$REPO/web/favicon.svg
else
  TGZ=${1:-$(ls -t "$HERE"/scope-compass-[0-9]*.tgz "$HERE"/../dist/scope-compass-[0-9]*.tgz 2>/dev/null | head -n 1)}
  [ -f "$TGZ" ] || { echo "no encuentro el .tgz (node tools/build.mjs lo arma en dist/): $TGZ" >&2; exit 1; }
  # Un ~/.local/bin/scompass de --dev taparía al de npm en el PATH.
  if grep -qs 'hub/bin/scompass.js' "$HOME/.local/bin/scompass"; then rm "$HOME/.local/bin/scompass"; fi
  npm install -g "$(cd "$(dirname "$TGZ")" && pwd)/$(basename "$TGZ")"
  BIN=$(npm prefix -g)/bin/scompass
  ICON=$(npm root -g)/scope-compass/web/favicon.svg
fi

mkdir -p "$APPS" "$ICONS"
cp "$ICON" "$ICONS/scope-compass.svg"
cat > "$APPS/scope-compass.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Scope Compass
Comment=Inicio de Scope Compass con ícono en la bandeja
Exec=$BIN home --tray --open
Icon=scope-compass
Terminal=false
Categories=Development;
EOF
"$BIN" hubs >/dev/null
echo "Listo: $BIN y el lanzador \"Scope Compass\" en el menú ($APPS/scope-compass.desktop)"
