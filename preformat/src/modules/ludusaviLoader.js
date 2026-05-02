// =============================================================
// ludusaviLoader.js — Base opcional Ludusavi (manifest YAML)
// =============================================================
// Descarga y cachea el manifest público; si falla (red, parseo,
// memoria), devuelve null sin lanzar al caller principal.
// https://github.com/mtkennerly/ludusavi-manifest
// =============================================================
// DEPENDENCIAS NPM OPCIONALES: js-yaml (si falta, todo el loader devuelve null).
// ENTRADA: manifest YAML gigante con entradas por juego y rutas con placeholders Windows.
// SALIDA: índices por Steam appid y por nombre normalizado + funciones de extracción de rutas.
// =============================================================

// fs.promises — lectura/escritura async del YAML en caché.
const fs = require('fs').promises;
// fs síncrono — no usado en todas las rutas; reservado si se amplía lectura sync.
const fsSync = require('fs');
const path = require('path');
// https — GET al manifest en GitHub raw (sin dependencia axios).
const https = require('https');
const os = require('os');

// URL_MANIFEST — fuente oficial del listado comunitario Ludusavi (YAML).
const URL_MANIFEST =
  'https://raw.githubusercontent.com/mtkennerly/ludusavi-manifest/master/data/manifest.yaml';

// NOMBRE_CACHE — archivo dentro de cacheDir (p. ej. userData/cache del Electron app).
const NOMBRE_CACHE = 'ludusavi-manifest.yaml';
// MAX_EDAD_MS — tras 7 días se intenta redescargar; si falla red, se sigue usando caché vieja si existe.
const MAX_EDAD_MS = 7 * 24 * 60 * 60 * 1000;
// TIMEOUT_DESCARGA_MS — aborta la petición HTTPS si tarda demasiado (manifest muy grande).
const TIMEOUT_DESCARGA_MS = 120000;

// yaml — módulo js-yaml; null si no está instalado → cargarManifestLudusavi retorna null al inicio.
let yaml;
try {
  yaml = require('js-yaml');
} catch {
  yaml = null;
}

/**
 * Normaliza nombres de juego para índice Map (igual criterio que gameSaveService).
 * @param {string} nombre
 * @returns {string}
 */
function normalizarNombre(nombre) {
  return String(nombre || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[™®©]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Descarga una URL HTTPS y devuelve el cuerpo como Buffer (sin escribir a disco aquí).
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<Buffer>}
 */
function descargarHttpsABuffer(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        timeout: timeoutMs,
        headers: { 'User-Agent': 'PreFormat/1.0 (save backup helper)' },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
  });
}

/** Crea cacheDir con recursive:true; ignora error si ya existe. */
async function asegurarCacheDir(cacheDir) {
  await fs.mkdir(cacheDir, { recursive: true }).catch(() => {});
}

/** Ruta absoluta al fichero YAML en disco dentro de cacheDir. */
function rutaCache(cacheDir) {
  return path.join(cacheDir, NOMBRE_CACHE);
}

/**
 * true si existe caché reciente (>1KB) y no supera MAX_EDAD_MS desde mtime.
 * @param {string} cacheDir
 */
async function manifestCacheValido(cacheDir) {
  const p = rutaCache(cacheDir);
  try {
    const st = await fs.stat(p);
    if (Date.now() - st.mtimeMs > MAX_EDAD_MS) return false;
    return st.size > 1000;
  } catch {
    return false;
  }
}

/**
 * Intenta cargar o descargar el manifest. Devuelve objeto parseado o null.
 */
async function cargarManifestLudusavi(cacheDir, onProgreso) {
  if (!yaml) {
    return null;
  }

  try {
    await asegurarCacheDir(cacheDir);
    const destino = rutaCache(cacheDir);

    let usarArchivo = await manifestCacheValido(cacheDir);

    if (!usarArchivo) {
      if (onProgreso) {
        onProgreso({
          fase: 'ludusavi',
          mensaje: 'Descargando base de rutas (Ludusavi, puede tardar)...',
        });
      }
      try {
        const buf = await descargarHttpsABuffer(URL_MANIFEST, TIMEOUT_DESCARGA_MS);
        await fs.writeFile(destino, buf);
        usarArchivo = true;
      } catch (e) {
        if (onProgreso) {
          onProgreso({
            fase: 'ludusavi',
            mensaje: `Descarga Ludusavi no disponible: ${e.message}. Usando caché o catálogo local.`,
          });
        }
        try {
          const st = await fs.stat(destino);
          usarArchivo = st.size > 1000;
        } catch {
          usarArchivo = false;
        }
      }
    }

    if (!usarArchivo) return null;

    if (onProgreso) {
      onProgreso({ fase: 'ludusavi', mensaje: 'Analizando base Ludusavi...' });
    }

    const texto = await fs.readFile(destino, 'utf8');
    const data = yaml.load(texto, {
      maxAliasCount: 100000,
    });

    if (!data || typeof data !== 'object') return null;

    return construirIndices(data);
  } catch (e) {
    console.warn('[ludusaviLoader]', e.message);
    return null;
  }
}

/**
 * Filtra entradas del manifest según condición `when` (OS Windows o sin filtro).
 * @param {object} meta
 * @returns {boolean}
 */
function debeIncluirCuandoArchivo(meta) {
  if (!meta || typeof meta !== 'object') return true;
  const w = meta.when;
  if (!w) return true;
  const lista = Array.isArray(w) ? w : [w];
  if (lista.length === 0) return true;
  return lista.some((cond) => !cond.os || cond.os === 'windows');
}

/** Solo rutas etiquetadas como save o config (o sin tags). */
function tagsRelevantes(meta) {
  const tags = meta && meta.tags;
  if (!tags) return true;
  const t = Array.isArray(tags) ? tags : [tags];
  return t.some((x) => x === 'save' || x === 'config');
}

/**
 * Convierte una ruta plantilla Ludusavi (<winAppData>, <steamUserId>, etc.) en 0..N rutas absolutas.
 * Si quedan '<' sin resolver o hay <base>, se descarta.
 * @param {string} rutaPlantilla
 * @param {{ steamUserIds?: string[], steamPath?: string }} ctx
 * @returns {string[]}
 */
function expandirMarcadores(rutaPlantilla, ctx) {
  if (typeof rutaPlantilla !== 'string') return [];
  if (rutaPlantilla.includes('<base>')) return [];

  const home = os.homedir();
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const docs = path.join(home, 'Documents');
  const savedGames = path.join(home, 'Saved Games');
  const publicDocs = process.env.PUBLIC ? path.join(process.env.PUBLIC, 'Documents') : '';
  const steamPath = ctx.steamPath || '';

  let s = rutaPlantilla;
  s = s.replace(/<winLocalAppData>/gi, localAppData);
  s = s.replace(/<winAppData>/gi, appData);
  s = s.replace(/<winDocuments>/gi, docs);
  s = s.replace(/<userDocuments>/gi, docs);
  s = s.replace(/<home>/gi, home);
  s = s.replace(/<savedGames>/gi, savedGames);
  s = s.replace(/<winPublic>/gi, publicDocs || path.join(home, '..', 'Public'));

  if (/<steamUserId>|<storeUserId>/i.test(s)) {
    const ids = ctx.steamUserIds || [];
    if (ids.length === 0) return [];
    const salida = [];
    for (const id of ids) {
      let t = s.replace(/<steamUserId>/gi, id).replace(/<storeUserId>/gi, id);
      t = t.replace(/\//g, '\\');
      if (t.includes('<')) continue;
      if (!path.isAbsolute(t) && steamPath) {
        t = path.join(steamPath, 'userdata', t);
      }
      if (!path.isAbsolute(t)) continue;
      salida.push(path.normalize(t));
    }
    return salida;
  }

  if (s.includes('<')) return [];

  s = s.replace(/\//g, '\\');
  return [path.normalize(s)];
}

/**
 * Recorre entrada.files del YAML; aplica filtros when/tags y expande marcadores.
 * @param {string} nombreJuego — nombre legible (solo para etiquetas UI).
 * @param {object} entrada — nodo del manifest para un juego.
 * @param {object} ctx — steamPath + steamUserIds para placeholders Steam.
 * @returns {Array<{ etiqueta, ruta, origenLudusavi }>}
 */
function extraerRutasDeEntradaLudusavi(nombreJuego, entrada, ctx) {
  const rutas = [];
  const files = entrada && entrada.files;
  if (!files || typeof files !== 'object') return rutas;

  for (const [relPath, meta] of Object.entries(files)) {
    if (!debeIncluirCuandoArchivo(meta)) continue;
    if (!tagsRelevantes(meta)) continue;

    const expandidas = expandirMarcadores(relPath, ctx);
    for (const abs of expandidas) {
      rutas.push({
        etiqueta: `Ludusavi: ${path.basename(abs) || relPath}`,
        ruta: abs,
        origenLudusavi: true,
      });
    }
  }
  return dedupeRutasObjetos(rutas);
}

/** Elimina duplicados por ruta (comparación case-insensitive en Windows). */
function dedupeRutasObjetos(lista) {
  const visto = new Set();
  const out = [];
  for (const r of lista) {
    const k = r.ruta.toLowerCase();
    if (visto.has(k)) continue;
    visto.add(k);
    out.push(r);
  }
  return out;
}

/**
 * A partir del objeto raíz parseado del YAML, construye Maps para búsqueda O(1).
 * @param {object} manifest — claves = nombres de juego, valores = entradas con .files, .steam, etc.
 * @returns {{ manifest, porSteamId: Map, porNombreNorm: Map, normalizarNombre: function }}
 */
function construirIndices(manifest) {
  const porSteamId = new Map();
  const porNombreNorm = new Map();

  for (const nombreClave of Object.keys(manifest)) {
    const entrada = manifest[nombreClave];
    if (!entrada || typeof entrada !== 'object') continue;

    const nn = normalizarNombre(nombreClave);
    if (nn && !porNombreNorm.has(nn)) {
      porNombreNorm.set(nn, { nombreOriginal: nombreClave, entrada });
    }

    const steam = entrada.steam;
    if (steam && typeof steam.id === 'number') {
      porSteamId.set(String(steam.id), { nombreOriginal: nombreClave, entrada });
    }
    const idExtra = entrada.id && entrada.id.steamExtra;
    if (Array.isArray(idExtra)) {
      for (const x of idExtra) {
        const sid = String(x);
        if (!porSteamId.has(sid)) {
          porSteamId.set(sid, { nombreOriginal: nombreClave, entrada });
        }
      }
    }
  }

  return { manifest, porSteamId, porNombreNorm, normalizarNombre };
}

/** @param {{ porSteamId: Map }} indices @param {string|number} appid */
function buscarEntradaPorSteamId(indices, appid) {
  if (!indices) return null;
  return indices.porSteamId.get(String(appid)) || null;
}

/**
 * Busca por nombre normalizado exacto; si no hay, heurística includes en claves del Map.
 * @returns {{ nombreOriginal: string, entrada: object, len?: number }|null}
 */
function buscarEntradaPorNombre(indices, nombreVisible) {
  if (!indices) return null;
  const nn = indices.normalizarNombre(nombreVisible);
  const exact = indices.porNombreNorm.get(nn);
  if (exact) return exact;

  let mejor = null;
  for (const [k, v] of indices.porNombreNorm) {
    if (nn.includes(k) || k.includes(nn)) {
      if (!mejor || k.length > mejor.len) {
        mejor = { ...v, len: k.length };
      }
    }
  }
  return mejor;
}

// API pública consumida por gameSaveService.js únicamente.
module.exports = {
  cargarManifestLudusavi,
  extraerRutasDeEntradaLudusavi,
  buscarEntradaPorSteamId,
  buscarEntradaPorNombre,
  normalizarNombre,
};
