#!/bin/sh
# Instala Scope Compass en Linux: la CLI `scompass` y un lanzador del menú que levanta el Inicio con ícono en la
# bandeja (desde la bandeja se activa el acceso en la red).
#   install.sh [archivo]      el binario scompass-v<versión>-linux-<arq> (sin Node) en ~/.local/bin, o el .tgz con
#                             npm install -g; sin argumento, el más nuevo al lado de este script o en dist/ (primero
#                             el binario)
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
  PKG=${1:-$(ls -t "$HERE"/scompass-v*-linux-* "$HERE"/../dist/scompass-v*-linux-* 2>/dev/null | head -n 1)}
  PKG=${PKG:-$(ls -t "$HERE"/scope-compass-[0-9]*.tgz "$HERE"/../dist/scope-compass-[0-9]*.tgz 2>/dev/null | head -n 1)}
  [ -f "$PKG" ] || { echo "no encuentro el binario ni el .tgz (node tools/build.mjs los arma en dist/): $PKG" >&2; exit 1; }
fi
if [ "${1:-}" = --dev ]; then :
elif [ "${PKG%.tgz}" = "$PKG" ]; then
  # Binario: no hace falta Node. Reemplaza al de --dev, si estaba.
  mkdir -p "$HOME/.local/bin"
  cp "$PKG" "$HOME/.local/bin/scompass.new" && chmod +x "$HOME/.local/bin/scompass.new"
  mv "$HOME/.local/bin/scompass.new" "$HOME/.local/bin/scompass"
  BIN=$HOME/.local/bin/scompass
  "$BIN" hubs >/dev/null # la primera vez extrae su contenido; de ahí sale el ícono
  ICON=$(ls -td "${XDG_CACHE_HOME:-$HOME/.cache}"/scope-compass/runtime/*/web/favicon.svg | head -n 1)
else
  TGZ=$PKG
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
