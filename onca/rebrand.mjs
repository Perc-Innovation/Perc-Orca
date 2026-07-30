#!/usr/bin/env node
/**
 * Aplica la marca ONCA sobre los artefactos compilados (out/), no sobre el código.
 *
 * Por qué post-build: este repo es un fork que se sincroniza seguido con
 * stablyai/orca. Rebrandear el árbol generaba ~8 conflictos de merge por día de
 * upstream, todos inútiles (líneas donde upstream editó otra cosa). Manteniendo
 * el código idéntico al padre, `git merge upstream/main` queda limpio y la marca
 * se aplica recién al empaquetar.
 *
 * Se corre entre `build:electron-vite` y electron-builder — ver onca/build.sh.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const OUT = resolve(process.argv[2] ?? 'out')
const EXTS = ['.js', '.cjs', '.mjs', '.html', '.json']

/**
 * Frases que el código compara en minúscula contra un mensaje ya rebrandeado.
 * Si se renombra el mensaje y no el patrón que lo clasifica, la comparación deja
 * de coincidir: eso rompió la reconexión al runtime remoto, el hint de Tailscale
 * y los errores de plugins la primera vez. Van antes que la regla general.
 */
const LOWERCASE_PAIRS = [
  // Cubre las cinco variantes de una sola vez. Listarlas enteras fallaba: una de
  // ellas vive dentro de una regex con un grupo en el medio
  // (`timed out (?:waiting for|while connecting to) the remote orca runtime`),
  // así que la frase completa nunca aparecía literal y quedaba a medio renombrar.
  ['remote orca runtime', 'remote onca runtime'],
  ['requires orca', 'requires onca']
]

/**
 * Red de seguridad: si upstream agrega un mensaje nuevo con su comparador en
 * minúscula, esto lo delata en vez de dejar un clasificador roto en silencio.
 */
const SUSPICIOUS = /\b(?:the|a|remote|to|from|running|requires|use|using|via|restart|relaunch|inside) orca\b/g

/**
 * `Orca` como nombre propio suelto. Nunca toca `orca` minúscula (comando CLI,
 * orca.yaml, orca://, appId, rutas) ni identificadores camelCase.
 */
const NAME = /(?<![A-Za-z0-9_])Orca(?![/A-Za-z0-9_-])/g
/** Contexto que vuelve funcional a la ocurrencia: bundle, ruta o producto ajeno. */
const AFTER_KEEP = /^(\.yaml|\.app|\.exe|\.AppImage|\.plist|:\/\/| Dev\b| Computer Use\b)/
const BEFORE_KEEP = /(GNOME |[/\\])$/
const QUOTED_EXACT = /^(['"`])Orca\1/
/** Título de la pantalla de bienvenida. `ORCA_` (env vars) queda protegido por el lookahead. */
const SHOUT = /(?<![A-Za-z0-9_])ORCA(?![A-Za-z0-9_-])/g

/**
 * Las skill guides se sincronizan desde stablyai/orca vía `npx skills update`:
 * rebrandearlas deja el manifest pidiendo un contenido que esa fuente nunca
 * sirve, y el updater entra en un bucle de "still out of date".
 */
const SKIP_FILES = [/bundled-skill-guides\.js$/]

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      out.push(...walk(full))
    } else if (EXTS.some((e) => entry.endsWith(e))) {
      out.push(full)
    }
  }
  return out
}

function rebrandText(text) {
  let n = 0
  let result = text
  for (const [from, to] of LOWERCASE_PAIRS) {
    const parts = result.split(from)
    n += parts.length - 1
    result = parts.join(to)
  }
  result = result.replace(SHOUT, () => {
    n += 1
    return 'ONCA'
  })
  result = result.replace(NAME, (match, offset, whole) => {
    const before = whole.slice(Math.max(0, offset - 8), offset)
    const after = whole.slice(offset + match.length, offset + match.length + 16)
    if (QUOTED_EXACT.test(whole.slice(Math.max(0, offset - 1))) || AFTER_KEEP.test(after) || BEFORE_KEEP.test(before)) {
      return match
    }
    n += 1
    return 'Onca'
  })
  return { result, n }
}

const files = walk(OUT)
let total = 0
let touched = 0
let skipped = 0
const suspects = new Map()
for (const file of files) {
  if (SKIP_FILES.some((re) => re.test(file))) {
    skipped += 1
    continue
  }
  const text = readFileSync(file, 'utf8')
  if (!/Orca|ORCA|orca/.test(text)) {
    continue
  }
  const { result, n } = rebrandText(text)
  if (n > 0) {
    writeFileSync(file, result)
    total += n
    touched += 1
  }
  for (const hit of result.matchAll(SUSPICIOUS)) {
    const snippet = result.slice(Math.max(0, hit.index - 40), hit.index + 40).replace(/\s+/g, ' ')
    if (!suspects.has(hit[0])) {
      suspects.set(hit[0], { file: file.slice(OUT.length + 1), snippet })
    }
  }
}

console.log(`[rebrand-onca] ${total} reemplazos en ${touched} archivos (${skipped} salteados por contrato con upstream)`)
if (total === 0) {
  console.error('[rebrand-onca] no se reemplazó nada — ¿corriste el build antes?')
  process.exit(1)
}
if (suspects.size > 0) {
  console.warn(`[rebrand-onca] ${suspects.size} frase(s) con "orca" en minúscula sobreviven; revisá si alguna es un comparador:`)
  for (const [frase, { file, snippet }] of suspects) {
    console.warn(`  "${frase}"  (${file})\n      …${snippet}…`)
  }
}
