// =============================================================
// src/modules/gameSaveService.js — Partidas guardadas (juegos)
// =============================================================
// Detecta juegos instalados (registro + Steam) y rutas típicas de
// guardado; permite copiar carpetas seleccionadas a un destino.
// Solo lectura en la fase de detección; la copia requiere confirmación.
// =============================================================
// GUÍA DE RECONSTRUCCIÓN — Flujo de datos
// =============================================================
// 1) detectarTodo(onProgreso, { cacheDir }) — orquesta todo:
//    - Carga gameSaveCatalog.json (rutas plantilla por nombre de programa).
//    - Opcional: ludusaviLoader.cargarManifestLudusavi → índices YAML.
//    - Lee SteamPath (HKCU) y recorre steamapps (manifiestos .acf + libraryfolders.vdf).
//    - programScanner.obtenerTodos() → filtra esProgramaJuego → rutas catálogo + Ludusavi.
//    - escanearCarpetasComunes → subcarpetas bajo Documents/My Games y Saved Games.
//    - fusionarPorNombre une duplicados; ordena por nombre.
// 2) verificarRutaPartida(ruta) — enriquecerRuta para entradas manuales en la UI.
// 3) respaldarPartidas(items, destinoRaiz, onProgreso) — fs.cp/copyFile bajo PreFormat-Partidas/.
//
// EXPORTA: detectarTodo, respaldarPartidas, esProgramaJuego, normalizarNombre, verificarRutaPartida.
// =============================================================

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
// fsSync — readFileSync para catálogo JSON al inicio (evita async innecesario en cargarCatalogo).
const fsSync = require('fs');

const programScanner = require('./programScanner');
const ludusaviLoader = require('./ludusaviLoader');

// vdf — parser opcional de Valve VDF; si falta, se usa regex de respaldo sobre el texto.
let vdf;
try {
  vdf = require('vdf');
} catch {
  vdf = null;
}

// RUTA_CATALOGO — JSON empaquetado con la app: coincidencias de nombre → plantillas %VAR%.
const RUTA_CATALOGO = path.join(__dirname, '../data/gameSaveCatalog.json');

// PALABRAS_CLAVE — si el nombre o editor del programa contiene alguna, se considera “juego”.
const PALABRAS_CLAVE = [
  'steam', 'ubisoft', 'ubisoft connect', 'epic games', 'gog galaxy', 'gog.com', 'origin', 'ea app',
  'battle.net', 'riot games', 'rockstar', 'bethesda.net', 'xbox', 'minecraft',
  'playnite', 'ea desktop', 'amazon games', 'paradox', 'square enix', 'bandai',
  'electronic arts', 'activision', 'blizzard', 'nvidia', 'physx',
];

// PATRON_NOMBRE — regex sobre el nombre (incluye “simulator” en cirílico por títulos rusos).
const PATRON_NOMBRE = /game|juego|gaming|launcher|симулятор/i;

// Registry — winreg para leer SteamPath en HKCU; null fuera de Windows o sin dependencia.
let Registry;
try {
  Registry = require('winreg');
} catch {
  Registry = null;
}

/** @param {{ nombre?: string, editor?: string }} programa */
function esProgramaJuego(programa) {
  const n = (programa.nombre || '').toLowerCase();
  const e = (programa.editor || '').toLowerCase();
  if (PALABRAS_CLAVE.some((k) => n.includes(k) || e.includes(k))) return true;
  return PATRON_NOMBRE.test(n);
}

/** Normalización alineada con ludusaviLoader para cruzar nombres. */
function normalizarNombre(nombre) {
  return String(nombre || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[™®©]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Sustituye %USERPROFILE%, %APPDATA%, %LOCALAPPDATA%, %DOCUMENTS%, %SAVEDGAMES% y normaliza separadores. */
function expandirPlantilla(plantilla) {
  const home = os.homedir();
  const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const docs = path.join(home, 'Documents');
  const savedGames = path.join(home, 'Saved Games');
  const expandido = plantilla
    .replace(/%USERPROFILE%/gi, home)
    .replace(/%APPDATA%/gi, appdata)
    .replace(/%LOCALAPPDATA%/gi, local)
    .replace(/%DOCUMENTS%/gi, docs)
    .replace(/%SAVEDGAMES%/gi, savedGames)
    .replace(/\\/g, path.sep);
  return path.normalize(expandido);
}

/** @returns {{ version: number, entradas: Array }} objeto vacío si falla lectura/parseo. */
function cargarCatalogo() {
  try {
    const raw = fsSync.readFileSync(RUTA_CATALOGO, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { version: 1, entradas: [] };
  }
}

/** Para cada entrada del catálogo cuyo array coincidencias encaja con nombrePrograma, expande rutas. */
function rutasDesdeCatalogo(nombrePrograma, catalogo) {
  const norm = normalizarNombre(nombrePrograma);
  const salida = [];
  for (const ent of catalogo.entradas || []) {
    const match = (ent.coincidencias || []).some((c) => norm.includes(normalizarNombre(c)));
    if (!match) continue;
    for (const r of ent.rutas || []) {
      if (!r.plantilla) continue;
      salida.push({
        etiqueta: r.etiqueta || 'Guardado',
        ruta: expandirPlantilla(r.plantilla),
        origenCatalogo: true,
      });
    }
  }
  return salida;
}

/** Promesa<boolean> — fs.access sin lanzar. */
async function existeRuta(ruta) {
  try {
    await fs.access(ruta);
    return true;
  } catch {
    return false;
  }
}

/** Suma tamaños de archivos recursivamente; límite de profundidad para evitar árboles infinitos. */
async function tamanoCarpeta(ruta, profundidadMax = 18) {
  try {
    const st = await fs.stat(ruta);
    if (st.isFile()) return st.size;
  } catch {
    return 0;
  }

  let total = 0;
  const pilaDirectorios = [{ dir: ruta, nivel: 0 }];

  while (pilaDirectorios.length > 0) {
    const { dir: dirActual, nivel } = pilaDirectorios.pop();

    if (nivel > profundidadMax) continue;

    let flujoDirectorio;
    try {
      // Leemos a goteo (stream) para no saturar la RAM
      flujoDirectorio = await fs.opendir(dirActual);
    } catch {
      continue; // Sin permisos → saltamos esta carpeta
    }

    try {
      for await (const entrada of flujoDirectorio) {
        const rutaCompleta = path.join(dirActual, entrada.name);
        
        if (entrada.isDirectory()) {
          pilaDirectorios.push({ dir: rutaCompleta, nivel: nivel + 1 });
        } else if (entrada.isFile()) {
          try {
            const stats = await fs.stat(rutaCompleta);
            total += stats.size;
          } catch {
            /* ignorar archivos bloqueados/inaccesibles */
          }
        }
      }
    } catch (err) {
      // Ignorar interrupciones a mitad del flujo
    }
  }
  return total;
}

/** Añade existe, tamanoBytes y seleccionado (true si existe) a un objeto { ruta, etiqueta, ... }. */
async function enriquecerRuta(r) {
  const ex = await existeRuta(r.ruta);
  let tamanoBytes = 0;
  if (ex) tamanoBytes = await tamanoCarpeta(r.ruta);
  return {
    ...r,
    existe: ex,
    tamanoBytes,
    seleccionado: ex,
  };
}

/** Lee HKCU\Software\Valve\Steam\SteamPath; devuelve string normalizado o null. */
function leerSteamPathRegistro() {
  return new Promise((resolve) => {
    if (!Registry) return resolve(null);
    const reg = new Registry({ hive: Registry.HKCU, key: '\\Software\\Valve\\Steam' });
    reg.get('SteamPath', (err, item) => {
      if (err || !item || !item.value) return resolve(null);
      resolve(String(item.value).replace(/\//g, '\\').replace(/\\$/, ''));
    });
  });
}

/** Fallback regex cuando vdf.parse falla: extrae pares "path" "..." del texto VDF. */
function extraerRutasLibraryFoldersVdf(contenido) {
  const rutas = [];
  const re = /"path"\s+"([^"]+)"/g;
  let m;
  while ((m = re.exec(contenido)) !== null) {
    rutas.push(m[1].replace(/\\\\/g, '\\'));
  }
  return rutas;
}

/** Recorre objeto parseado por vdf buscando propiedades .path (bibliotecas Steam). */
function extraerPathsRecursivoVdf(obj, out) {
  if (!obj || typeof obj !== 'object') return;
  if (typeof obj.path === 'string') {
    out.push(String(obj.path).replace(/\\\\/g, '\\').replace(/\/$/, ''));
  }
  for (const k of Object.keys(obj)) {
    extraerPathsRecursivoVdf(obj[k], out);
  }
}

/** Parseo ligero de appmanifest_*.acf: appid y name para emparejar con Ludusavi. */
function parsearAppManifestAcf(texto) {
  const idMatch = texto.match(/"appid"\s+"(\d+)"/i);
  const nameMatch = texto.match(/"name"\s+"([^"]*)"/i);
  if (!idMatch) return null;
  return {
    appid: idMatch[1],
    nombre: nameMatch ? nameMatch[1].trim() : `App ${idMatch[1]}`,
  };
}

/** Lista todos los appmanifest_*.acf en un directorio steamapps. */
async function listarAppManifestsEnSteamapps(steamappsDir) {
  const salida = [];
  let entradas;
  try {
    entradas = await fs.readdir(steamappsDir, { withFileTypes: true });
  } catch {
    return salida;
  }
  for (const e of entradas) {
    if (!e.isFile() || !e.name.startsWith('appmanifest_') || !e.name.endsWith('.acf')) continue;
    const ruta = path.join(steamappsDir, e.name);
    try {
      const txt = await fs.readFile(ruta, 'utf8');
      const info = parsearAppManifestAcf(txt);
      if (info) salida.push({ ...info, manifestPath: ruta });
    } catch {
      /* siguiente */
    }
  }
  return salida;
}

/**
 * Reúne todas las carpetas .../steamapps (instalación principal + library folders del VDF).
 * @param {string|null} steamPath
 * @returns {Promise<string[]>}
 */
async function obtenerDirectoriosSteamapps(steamPath) {
  const bases = new Set();
  if (steamPath) bases.add(steamPath.replace(/\\$/, ''));

  const rutasVdf = [];
  const vdfMain = steamPath ? path.join(steamPath, 'steamapps', 'libraryfolders.vdf') : null;
  if (vdfMain) {
    try {
      const txt = await fs.readFile(vdfMain, 'utf8');
      if (vdf && typeof vdf.parse === 'function') {
        try {
          const parsed = vdf.parse(txt);
          extraerPathsRecursivoVdf(parsed, rutasVdf);
        } catch {
          extraerRutasLibraryFoldersVdf(txt).forEach((p) => rutasVdf.push(p));
        }
      } else {
        extraerRutasLibraryFoldersVdf(txt).forEach((p) => rutasVdf.push(p));
      }
    } catch {
      /* sin libraryfolders */
    }
  }

  const configPath = steamPath ? path.join(steamPath, 'config', 'config.vdf') : null;
  if (configPath) {
    try {
      const txt = await fs.readFile(configPath, 'utf8');
      if (vdf && typeof vdf.parse === 'function') {
        try {
          const parsed = vdf.parse(txt);
          extraerPathsRecursivoVdf(parsed, rutasVdf);
        } catch {
          extraerRutasLibraryFoldersVdf(txt).forEach((p) => rutasVdf.push(p));
        }
      } else {
        extraerRutasLibraryFoldersVdf(txt).forEach((p) => rutasVdf.push(p));
      }
    } catch {
      /* opcional */
    }
  }

  rutasVdf.forEach((p) => bases.add(String(p).replace(/\\$/, '')));

  const steamappsDirs = [];
  for (const base of bases) {
    const sd = path.join(base, 'steamapps');
    if (await existeRuta(sd)) steamappsDirs.push(sd);
  }
  return steamappsDirs;
}

/** Subcarpetas numéricas bajo steam/userdata = IDs de cuenta Steam locales. */
async function obtenerIdsCuentasSteam(steamPath) {
  const root = path.join(steamPath, 'userdata');
  if (!(await existeRuta(root))) return [];
  const out = [];
  try {
    const xs = await fs.readdir(root, { withFileTypes: true });
    for (const x of xs) {
      if (x.isDirectory() && /^\d+$/.test(x.name)) out.push(x.name);
    }
  } catch {
    /* sin permisos */
  }
  return out;
}

/** Elimina objetos con misma .ruta (case-insensitive). */
function dedupeRutasPorRuta(lista) {
  const visto = new Set();
  const out = [];
  for (const r of lista) {
    if (!r || !r.ruta) continue;
    const k = r.ruta.toLowerCase();
    if (visto.has(k)) continue;
    visto.add(k);
    out.push(r);
  }
  return out;
}

/** Rutas .../userdata/<id>/<appid>/remote si existen (saves cloud/sync en disco). */
async function rutasUserdataSteamParaApp(steamPath, appid) {
  const rutas = [];
  const userdataRoot = path.join(steamPath, 'userdata');
  if (!(await existeRuta(userdataRoot))) return rutas;
  let cuentasReales;
  try {
    cuentasReales = await fs.readdir(userdataRoot, { withFileTypes: true });
  } catch {
    return rutas;
  }
  for (const c of cuentasReales) {
    if (!c.isDirectory() || !/^\d+$/.test(c.name)) continue;
    const remote = path.join(userdataRoot, c.name, String(appid), 'remote');
    if (await existeRuta(remote)) {
      rutas.push({
        etiqueta: `Steam userdata (${c.name}) /remote`,
        ruta: remote,
        origenSteam: true,
      });
    }
  }
  return rutas;
}

/**
 * Por cada juego instalado en Steam (manifest), combina rutas Ludusavi + catálogo + userdata remote.
 * @returns {{ juegos: object[], steamPath?: string, nota?: string }}
 */
async function detectarJuegosSteam(catalogo, onProgreso, indicesLudusavi, steamPathPrevia) {
  const lista = [];
  const steamPath = steamPathPrevia || (await leerSteamPathRegistro());
  if (!steamPath) {
    return { juegos: lista, nota: 'Steam no encontrado en el registro (o no instalado).' };
  }

  if (onProgreso) onProgreso({ fase: 'steam', mensaje: 'Leyendo manifiestos de Steam...' });

  const steamUserIds = await obtenerIdsCuentasSteam(steamPath);
  const ctxLudusavi = { steamUserIds, steamPath };

  const steamappsDirs = await obtenerDirectoriosSteamapps(steamPath);
  const vistos = new Set();

  for (const sd of steamappsDirs) {
    const manifests = await listarAppManifestsEnSteamapps(sd);
    for (const m of manifests) {
      if (vistos.has(m.appid)) continue;
      vistos.add(m.appid);

      let rutasLudusavi = [];
      if (indicesLudusavi) {
        const porId = ludusaviLoader.buscarEntradaPorSteamId(indicesLudusavi, m.appid);
        if (porId) {
          rutasLudusavi = ludusaviLoader.extraerRutasDeEntradaLudusavi(
            porId.nombreOriginal,
            porId.entrada,
            ctxLudusavi
          );
        }
        if (rutasLudusavi.length === 0) {
          const porNombre = ludusaviLoader.buscarEntradaPorNombre(indicesLudusavi, m.nombre);
          if (porNombre) {
            rutasLudusavi = ludusaviLoader.extraerRutasDeEntradaLudusavi(
              porNombre.nombreOriginal,
              porNombre.entrada,
              ctxLudusavi
            );
          }
        }
      }

      const rutasCat = rutasDesdeCatalogo(m.nombre, catalogo);
      const rutasUser = await rutasUserdataSteamParaApp(steamPath, m.appid);
      const combinadas = dedupeRutasPorRuta([...rutasLudusavi, ...rutasCat, ...rutasUser]);
      const rutasGuardado = [];
      for (const r of combinadas) {
        rutasGuardado.push(await enriquecerRuta(r));
      }

      lista.push({
        id: `steam-${m.appid}`,
        nombre: m.nombre,
        fuente: 'steam',
        editor: 'Steam',
        confianza: rutasGuardado.some((x) => x.existe) ? 'alta' : 'media',
        appid: m.appid,
        rutasGuardado,
        seleccionado: true,
      });
    }
  }

  return { juegos: lista, steamPath };
}

/**
 * Une entradas con el mismo nombre normalizado. La primera aparición manda;
 * en detectarTodo conviene pasar primero los juegos de Steam.
 */
function fusionarPorNombre(juegos) {
  const porNombre = new Map();
  for (const j of juegos) {
    const nk = normalizarNombre(j.nombre);
    if (!porNombre.has(nk)) {
      porNombre.set(nk, {
        ...j,
        rutasGuardado: [...(j.rutasGuardado || [])],
      });
      continue;
    }
    const prev = porNombre.get(nk);
    const rutasExistentes = new Set((prev.rutasGuardado || []).map((r) => r.ruta));
    for (const r of j.rutasGuardado || []) {
      if (!rutasExistentes.has(r.ruta)) {
        prev.rutasGuardado.push(r);
        rutasExistentes.add(r.ruta);
      }
    }
    if (j.fuente === 'steam' && prev.fuente !== 'steam') {
      prev.appid = j.appid;
      prev.fuente = 'steam';
      prev.id = j.id;
    }
  }
  return Array.from(porNombre.values());
}

/** Programas del registro filtrados como juegos; rutas desde Ludusavi + catálogo (sin userdata por appid salvo ctx). */
async function detectarDesdeRegistro(catalogo, onProgreso, indicesLudusavi, steamPathOpt) {
  if (onProgreso) onProgreso({ fase: 'registro', mensaje: 'Leyendo programas (registro)...' });

  const programas = await programScanner.obtenerTodos();
  const candidatos = programas.filter(esProgramaJuego);
  const juegos = [];

  const steamUserIds = steamPathOpt ? await obtenerIdsCuentasSteam(steamPathOpt) : [];
  const ctxLudusavi = { steamUserIds, steamPath: steamPathOpt || '' };

  for (const p of candidatos) {
    let rutasLudusavi = [];
    if (indicesLudusavi) {
      const hit = ludusaviLoader.buscarEntradaPorNombre(indicesLudusavi, p.nombre);
      if (hit) {
        rutasLudusavi = ludusaviLoader.extraerRutasDeEntradaLudusavi(
          hit.nombreOriginal,
          hit.entrada,
          ctxLudusavi
        );
      }
    }

    const rutasCat = rutasDesdeCatalogo(p.nombre, catalogo);
    const combinadas = dedupeRutasPorRuta([...rutasLudusavi, ...rutasCat]);
    const rutasGuardado = [];
    for (const r of combinadas) {
      rutasGuardado.push(await enriquecerRuta(r));
    }
    const id = `reg-${Buffer.from(normalizarNombre(p.nombre)).toString('hex').slice(0, 24)}`;
    juegos.push({
      id,
      nombre: p.nombre,
      fuente: 'registro',
      editor: p.editor || '',
      confianza: rutasGuardado.some((x) => x.existe) ? 'media' : 'baja',
      rutasGuardado,
      seleccionado: rutasGuardado.some((x) => x.existe),
    });
  }

  return juegos;
}

/**
 * Carpetas habituales de guardados: cada subcarpeta como entrada revisable manualmente.
 */
async function escanearCarpetasComunes(onProgreso) {
  if (onProgreso) {
    onProgreso({ fase: 'carpetas', mensaje: 'Buscando en Documentos y Saved Games...' });
  }

  const home = os.homedir();
  const bloques = [
    { etiqueta: 'Documentos/My Games', ruta: path.join(home, 'Documents', 'My Games') },
    { etiqueta: 'Saved Games', ruta: path.join(home, 'Saved Games') },
  ];

  const juegos = [];

  for (const bloque of bloques) {
    if (!(await existeRuta(bloque.ruta))) continue;
    let entradas;
    try {
      entradas = await fs.readdir(bloque.ruta, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entradas) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('.')) continue;
      const full = path.join(bloque.ruta, e.name);
      const nombre = `${e.name} (${bloque.etiqueta})`;
      const id = `carpeta-${Buffer.from(normalizarNombre(nombre)).toString('hex').slice(0, 20)}`;
      juegos.push({
        id,
        nombre,
        fuente: 'carpeta',
        editor: '',
        confianza: 'media',
        rutasGuardado: [
          await enriquecerRuta({
            etiqueta: 'Carpeta completa',
            ruta: full,
            origenCarpeta: true,
          }),
        ],
        seleccionado: false,
      });
    }
  }

  return juegos;
}

/**
 * Detección completa: Ludusavi (opcional), Steam, registro, carpetas comunes.
 * @param {function} onProgreso - ({ fase, mensaje })
 * @param {{ cacheDir?: string }} opciones - cacheDir para manifest Ludusavi (userData/cache)
 */
async function detectarTodo(onProgreso, opciones = {}) {
  const advertencias = [];
  const catalogo = cargarCatalogo();

  const cacheDir =
    opciones.cacheDir ||
    path.join(os.homedir(), 'AppData', 'Roaming', 'PreFormat', 'cache');

  let indicesLudusavi = null;
  try {
    indicesLudusavi = await ludusaviLoader.cargarManifestLudusavi(cacheDir, onProgreso);
    if (!indicesLudusavi) {
      advertencias.push(
        'Base Ludusavi no cargada (sin red, error de análisis o js-yaml). Se usan Steam, registro y carpetas comunes.'
      );
    }
  } catch (e) {
    advertencias.push(`Ludusavi omitido: ${e.message}`);
    indicesLudusavi = null;
  }

  const steamPathPrimero = await leerSteamPathRegistro();

  const desdeRegistro = await detectarDesdeRegistro(
    catalogo,
    onProgreso,
    indicesLudusavi,
    steamPathPrimero
  );
  const steamResult = await detectarJuegosSteam(
    catalogo,
    onProgreso,
    indicesLudusavi,
    steamPathPrimero
  );
  if (steamResult.nota) advertencias.push(steamResult.nota);

  let desdeCarpetas = [];
  try {
    desdeCarpetas = await escanearCarpetasComunes(onProgreso);
  } catch (e) {
    advertencias.push(`Carpetas comunes: ${e.message}`);
  }

  const combinados = [...steamResult.juegos, ...desdeRegistro, ...desdeCarpetas];
  const fusionados = fusionarPorNombre(combinados);

  fusionados.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));

  return {
    juegos: fusionados,
    advertencias,
    steamPath: steamResult.steamPath || null,
  };
}

async function verificarRutaPartida(rutaAbs) {
  return enriquecerRuta({ etiqueta: 'Manual', ruta: rutaAbs, origenManual: true });
}

/** Sanitiza segmentos de ruta destino al respaldar (caracteres reservados Windows). */
function nombreSeguroArchivo(nombre) {
  return String(nombre || 'juego')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'juego';
}

/**
 * Copia solo rutas marcadas como seleccionadas en cada juego.
 * @param {Array<{ nombre: string, rutas: Array<{ ruta: string, etiqueta: string }> }>} items
 */
async function respaldarPartidas(items, destinoRaiz, onProgreso) {
  const resultado = { copiados: 0, errores: [] };
  const tareas = [];

  for (const it of items) {
    const base = nombreSeguroArchivo(it.nombre);
    for (const r of it.rutas || []) {
      if (!r || !r.ruta) continue;
      tareas.push({
        origen: r.ruta,
        destino: path.join(destinoRaiz, 'PreFormat-Partidas', base, nombreSeguroArchivo(r.etiqueta || 'carpeta')),
      });
    }
  }

  for (let i = 0; i < tareas.length; i++) {
    const t = tareas[i];
    if (onProgreso) onProgreso(i + 1, tareas.length, t.origen);

    try {
      if (!(await existeRuta(t.origen))) {
        resultado.errores.push({ ruta: t.origen, error: 'No existe o no accesible' });
        continue;
      }
      const st = await fs.stat(t.origen);
      await fs.mkdir(path.dirname(t.destino), { recursive: true });
      if (st.isDirectory()) {
        await fs.cp(t.origen, t.destino, { recursive: true });
      } else {
        await fs.copyFile(t.origen, t.destino);
      }
      resultado.copiados++;
    } catch (err) {
      resultado.errores.push({ ruta: t.origen, error: err.message || String(err) });
    }
  }

  return resultado;
}

// Interfaz pública: el resto de funciones son detalles internos del módulo.
module.exports = {
  detectarTodo,
  respaldarPartidas,
  esProgramaJuego,
  normalizarNombre,
  verificarRutaPartida,
};
