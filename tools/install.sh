#!/bin/sh
# Instala Scope Compass en Linux: la CLI `scompass` y un lanzador del menú que levanta el Inicio con ícono en la
# bandeja (desde la bandeja se activa el acceso en la red). Sin archivo, baja de GitHub el binario más nuevo y lo
# verifica con SHA256SUMS. Se corre una vez: después el binario se actualiza solo (scompass upgrade, el aviso del Inicio).
#   curl -fsSL https://raw.githubusercontent.com/dannroda/scope-compass/main/tools/install.sh | sh
#   curl -fsSL …/install.sh | SCOMPASS_CHANNEL=beta sh   también las pre-releases (versiones para probar); el binario
#                                                         queda en el canal beta para actualizarse
#   install.sh [archivo]      desde el repo: el binario scompass-v<versión>-linux-<arq> (sin Node) en ~/.local/bin, o
#                             el .tgz con npm install -g; sin argumento, el más nuevo en dist/ o al lado de este script
#                             (primero el binario), y si no hay, lo baja
#   install.sh --dev          `scompass` en ~/.local/bin llama al hub/bin/scompass.js de este repo (para desarrollar)
set -eu
REPO_SLUG=dannroda/scope-compass
CHANNEL=${SCOMPASS_CHANNEL:-stable}
APPS=${XDG_DATA_HOME:-$HOME/.local/share}/applications
ICONS=${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/scalable/apps
case $CHANNEL in stable|beta) ;; *) echo "canal inválido: $CHANNEL (stable o beta)" >&2; exit 1 ;; esac
# Corrido como archivo (no con `curl | sh`), la carpeta del script: ahí y en dist/ se buscan binarios ya armados.
HERE=
case $0 in */install.sh|install.sh) [ -f "$0" ] && HERE=$(cd "$(dirname "$0")" && pwd) ;; esac

fetch() { # url [archivo]: con curl o, si no está, wget
  if command -v curl >/dev/null 2>&1; then
    if [ -n "${2:-}" ]; then curl -fsSL -o "$2" "$1"; else curl -fsSL "$1"; fi
  else
    if [ -n "${2:-}" ]; then wget -qO "$2" "$1"; else wget -qO- "$1"; fi
  fi
}

# La versión más nueva del canal (stable: solo releases; beta: también las pre-releases), como `scompass upgrade`. Sin
# jq: cada release trae tag_name antes que prerelease. SCOMPASS_RELEASES_URL y SCOMPASS_DOWNLOAD_URL cambian de dónde
# salen la lista y los archivos, para probar contra otro servidor.
latest() {
  fetch "${SCOMPASS_RELEASES_URL:-https://api.github.com/repos/$REPO_SLUG/releases?per_page=30}" | tr ',{}' '\n\n\n' |
    sed -nE 's/^[[:space:]]*"(tag_name|prerelease)":[[:space:]]*"?([^"]*)"?[[:space:]]*$/\1 \2/p' |
    awk -v ch="$CHANNEL" '$1 == "tag_name" { t = $2 } $1 == "prerelease" && t ~ /^v[0-9]+\.[0-9]+\.[0-9]+$/ && (ch == "beta" || $2 == "false") { print substr(t, 2); t = "" }' |
    sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1
}

download() {
  case $(uname -m) in x86_64|amd64) ;; *) echo "por ahora solo hay binario para x64 (esta es $(uname -m)): instalá el paquete de npm (ver docs/instalar.md)" >&2; exit 1 ;; esac
  VERSION=$(latest)
  if [ -z "$VERSION" ]; then
    if [ "$CHANNEL" = stable ]; then
      echo "todavía no hay releases estables, solo pre-releases (versiones para probar). Para instalar una:" >&2
      echo "  curl -fsSL https://raw.githubusercontent.com/$REPO_SLUG/main/tools/install.sh | SCOMPASS_CHANNEL=beta sh" >&2
    else
      echo "no encontré releases de $REPO_SLUG" >&2
    fi
    exit 1
  fi
  NAME=scompass-v$VERSION-linux-x64
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT
  BASE=${SCOMPASS_DOWNLOAD_URL:-https://github.com/$REPO_SLUG/releases/download}/v$VERSION
  echo "Bajando Scope Compass $VERSION…"
  fetch "$BASE/$NAME" "$TMP/$NAME"
  fetch "$BASE/SHA256SUMS" "$TMP/SHA256SUMS"
  WANT=$(awk -v n="$NAME" '$2 == n || $2 == "*" n { print $1 }' "$TMP/SHA256SUMS")
  GOT=$(sha256sum "$TMP/$NAME" | cut -d' ' -f1)
  if [ -z "$WANT" ] || [ "$GOT" != "$WANT" ]; then
    echo "$NAME no coincide con SHA256SUMS (se esperaba $WANT, bajó $GOT): no se instaló nada" >&2
    exit 1
  fi
  PKG=$TMP/$NAME
}

if [ "${1:-}" = --dev ]; then
  [ -n "$HERE" ] || { echo "--dev se corre desde el repo: tools/install.sh --dev" >&2; exit 1; }
  REPO=$(cd "$HERE/.." && pwd)
  [ -d "$REPO/hub/node_modules" ] || (cd "$REPO/hub" && npm install)
  mkdir -p "$HOME/.local/bin"
  printf '#!/bin/sh\nexec node %s/hub/bin/scompass.js "$@"\n' "$REPO" > "$HOME/.local/bin/scompass"
  chmod +x "$HOME/.local/bin/scompass"
  BIN=$HOME/.local/bin/scompass
  ICON=$REPO/web/favicon.svg
else
  PKG=${1:-}
  if [ -z "$PKG" ] && [ -n "$HERE" ]; then
    PKG=$(ls -t "$HERE"/../dist/scompass-v*-linux-* "$HERE"/scompass-v*-linux-* 2>/dev/null | head -n 1)
    PKG=${PKG:-$(ls -t "$HERE"/../dist/scope-compass-[0-9]*.tgz "$HERE"/scope-compass-[0-9]*.tgz 2>/dev/null | head -n 1)}
  fi
  if [ -z "$PKG" ]; then download; fi
  [ -f "$PKG" ] || { echo "no existe $PKG" >&2; exit 1; }
fi
if [ "${1:-}" = --dev ]; then :
elif [ "${PKG%.tgz}" = "$PKG" ]; then
  # Binario: no hace falta Node. Reemplaza al de --dev, si estaba.
  mkdir -p "$HOME/.local/bin"
  cp "$PKG" "$HOME/.local/bin/scompass.new" && chmod +x "$HOME/.local/bin/scompass.new"
  mv "$HOME/.local/bin/scompass.new" "$HOME/.local/bin/scompass"
  BIN=$HOME/.local/bin/scompass
  "$BIN" hubs >/dev/null # la primera vez extrae su contenido; de ahí sale el ícono
  ICON=$(ls -td "${SCOMPASS_RUNTIME_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/scope-compass/runtime}"/*/web/favicon.svg | head -n 1)
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
# Con beta, el binario sigue en ese canal al actualizarse (scompass upgrade y el Inicio, §39).
if [ "$CHANNEL" = beta ]; then "$BIN" upgrade --channel beta >/dev/null || echo "Ojo: no se pudo anotar el canal beta; corré scompass upgrade --channel beta" >&2; fi
echo "Listo: $BIN y el lanzador \"Scope Compass\" en el menú ($APPS/scope-compass.desktop)"
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo "Ojo: $HOME/.local/bin no está en el PATH; agregalo para escribir scompass en una terminal." ;; esac
echo "Se actualiza solo (scompass upgrade, o el aviso del Inicio): este instalador no hace falta de nuevo."
