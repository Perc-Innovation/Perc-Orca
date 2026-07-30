# ONCA

Fork de [stablyai/orca](https://github.com/stablyai/orca) con marca propia, pensado
para seguir de cerca al repo padre.

## La regla

**El código es idéntico al upstream. La marca se aplica al buildear.**

Rebrandear el árbol costaba ~8 conflictos de merge por día de upstream, todos
inútiles: líneas donde el padre editó otra cosa y nosotros habíamos cambiado
"Orca". Con el rebrand movido a post-build, `git merge upstream/main` da 0
conflictos.

Lo único que difiere del padre:

| Qué | Por qué no puede ser post-build |
|---|---|
| `resources/` (íconos, `logo.svg`, tray, icon-source) | son binarios/arte |
| `mobile/assets/`, `mobile/src/components/OrcaLogo.tsx` | el path SVG del logo |
| `src/renderer/src/components/Landing.tsx` | una línea: el logo pasó de apaisado a vertical, `size-12` lo deformaba |
| `onca/` | esta carpeta |

Upstream toca esos archivos 0–2 veces cada 3 meses.

## Actualizarse del padre

```bash
git fetch upstream
git merge upstream/main
```

Si algún día conflictúa, casi seguro es un asset: quedate con el nuestro
(`git checkout --ours <archivo>`).

## Buildear

```bash
./onca/build.sh           # completo
./onca/build.sh --fast    # sin typecheck
bash ~/Downloads/instalar-onca.command
```

`onca/rebrand.mjs` corre sobre `out/` antes de empaquetar y reemplaza el nombre
visible. Nunca toca `orca` en minúscula (comando CLI, `orca.yaml`, `orca://`,
appId, rutas) ni los identificadores camelCase.

### Tres trampas que ya nos mordieron

1. **Comparadores en minúscula.** Varios módulos clasifican errores comparando
   el mensaje en minúscula (`'remote orca runtime closed the connection'`,
   `'requires orca'`). Renombrar el mensaje sin renombrar el patrón rompió la
   reconexión al runtime remoto, el hint de Tailscale y los errores de plugins.
   El script los maneja y avisa si aparecen frases nuevas del mismo tipo —
   mirá la advertencia `frase(s) con "orca" en minúscula sobreviven`.

2. **Las skills no se rebrandean.** `skills/`, `skill-guides/` y `skill-stubs/`
   se sincronizan desde stablyai/orca con `npx skills update`. Si los tocamos,
   el manifest queda pidiendo un contenido que esa fuente nunca sirve y el
   updater entra en "still out of date" para siempre. `rebrand.mjs` saltea
   `bundled-skill-guides.js` a propósito.

3. **La identidad de firma es la que sostiene los permisos de macOS.**
   Accesibilidad y Grabación de pantalla se atan al certificado, no al nombre ni
   al bundle id: como esta build se firma con nuestro cert y la de Stably con el
   de Lovecast LLC, los permisos que ya le habías dado a Orca **no valen acá** —
   en Ajustes se ven tildados igual, y computer-use falla con `permission_denied`
   o devuelve árboles vacíos. `build.sh` fija `CSC_NAME` y
   `ORCA_COMPUTER_MACOS_SIGN_IDENTITY`, y verifica el bundle firmado al final,
   para que la identidad no cambie sola entre builds (hay 5 certificados en el
   llavero y electron-builder elegía por su cuenta).

   Si alguna vez hay que cambiarla (renovación del cert, otra máquina):
   `ONCA_SIGN_IDENTITY="Apple Development: ..." ./onca/build.sh`, y después
   re-otorgar los permisos **a las dos entradas** — `Orca.app` y
   `Orca.app/Contents/Resources/Orca Computer Use.app` — en Accesibilidad y en
   Grabación de pantalla. Tildar una entrada vieja no alcanza: hay que sacarla
   con `−` y volver a agregarla, o limpiar el registro fantasma con
   `tccutil reset Accessibility com.stablyai.orca` (ídem `ScreenCapture` y el
   sufijo `.computer-use`). El permiso lo toma el proceso al arrancar, así que
   Orca tiene que reiniciarse después.

## Lo que sigue siendo de Stably

Bundle id (`com.stablyai.orca`), `productName`, el ejecutable y el comando `orca`.
Como consecuencia la app se instala **sobre** Orca y comparte
`~/Library/Application Support/Orca`. También siguen apuntando al padre el
dominio `onorca.dev`, el Discord, el botón "Star on GitHub" y el feed del
updater — o sea que una release de Stably puede pisar esta build.
