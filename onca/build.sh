#!/bin/bash
# Build de ONCA para macOS: el build normal del upstream + la capa de marca
# aplicada sobre los artefactos compilados, justo antes de empaquetar.
#
#   ./onca/build.sh            build completo
#   ./onca/build.sh --fast     saltea typecheck (iteración rápida)
set -euo pipefail
cd "$(dirname "$0")/.."

# Identidad de firma fija. Why: macOS ata los permisos de Accesibilidad y
# Grabación de pantalla a la identidad de firma, no al nombre ni al bundle id.
# Hay varios certificados en el llavero y electron-builder elige solo, así que
# sin fijarla un build puede salir con otro cert (o ad-hoc) y computer-use deja
# de andar hasta re-tildar todo a mano en Ajustes.
SIGN_IDENTITY="${ONCA_SIGN_IDENTITY:-Apple Development: evaleiras@clapps.xyz (H5CPRMBU82)}"
if ! security find-identity -v -p codesigning | grep -qF "$SIGN_IDENTITY"; then
  echo "No encuentro el certificado de firma fijado:" >&2
  echo "  $SIGN_IDENTITY" >&2
  echo "Identidades disponibles:" >&2
  security find-identity -v -p codesigning >&2
  echo "Si lo renovaste, exportá ONCA_SIGN_IDENTITY con el nombre nuevo. Ojo: cambiar de" >&2
  echo "certificado obliga a re-otorgar los permisos de Accesibilidad y Grabación de pantalla." >&2
  exit 1
fi
export CSC_NAME="$SIGN_IDENTITY"
export ORCA_COMPUTER_MACOS_SIGN_IDENTITY="$SIGN_IDENTITY"

if [ "${1:-}" = "--fast" ]; then
  pnpm run build:relay && pnpm run build:cli && pnpm run build:electron-vite && pnpm run build:web-from-renderer
else
  pnpm run build:desktop
fi
pnpm run build:computer-macos
pnpm run build:notification-status-macos
pnpm run ensure:electron-runtime

# La marca se aplica acá: out/ ya está compilado y electron-builder todavía no
# armó el asar, así que el bundle sale rebrandeado sin tocar una línea del repo.
node onca/rebrand.mjs out

node config/scripts/build-mac-local.mjs

# Verificar que el bundle y el helper quedaron con la identidad fijada: si se
# coló otra, los permisos ya otorgados no aplican y conviene enterarse acá y no
# cuando computer-use falle con "permission denied".
for app in dist/mac-arm64/Orca.app dist/mac/Orca.app; do
  [ -d "$app" ] || continue
  for target in "$app" "$app/Contents/Resources/Orca Computer Use.app"; do
    [ -d "$target" ] || continue
    if ! codesign -dv --verbose=2 "$target" 2>&1 | grep -qF "Authority=$SIGN_IDENTITY"; then
      echo "Firma inesperada en $target (se esperaba: $SIGN_IDENTITY)" >&2
      codesign -dv --verbose=2 "$target" 2>&1 | grep -E "^Authority|^TeamIdentifier" >&2
      echo "Con otra identidad hay que volver a otorgar Accesibilidad y Grabación de pantalla." >&2
      exit 1
    fi
  done
  codesign --verify --deep --strict "$app" || {
    echo "La firma de $app no verifica; revisá que el rebrand corra ANTES de empaquetar." >&2
    exit 1
  }
done
echo "Firma verificada: $SIGN_IDENTITY"

echo
echo "Listo. Para instalar: bash ~/Downloads/instalar-onca.command"
