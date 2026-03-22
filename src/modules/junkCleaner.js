// =============================================================
// src/modules/junkCleaner.js — Módulo 3: Limpieza de Basura
// =============================================================
//
// ⚠️ REGLA DE ORO — LEE ESTO ANTES DE MODIFICAR ESTE ARCHIVO:
//
//    Este módulo tiene DOS fases bien separadas a propósito:
//
//    FASE 1 → analizar()   Solo lee el disco. No toca nada.
//                          Devuelve una lista de candidatos.
//
//    FASE 2 → eliminar()   MUEVE archivos a la PAPELERA DE RECICLAJE.
//                          NUNCA se llama sola. Solo se llama cuando
//                          el usuario confirma explícitamente en la UI.
//
//    Si alguna vez ves código que llame a eliminar() sin una confirmación
//    previa del usuario, es un bug de seguridad. Repórtalo.
//
// ¿POR QUÉ LA PAPELERA Y NO BORRAR PERMANENTEMENTE?
//    Porque los usuarios cometen errores. Si algo se borra por error,
//    la papelera permite recuperarlo. El borrado permanente NO tiene
//    marcha atrás. Siempre preferimos la opción reversible.
//
// =============================================================

const fs   = require('fs').promises;
const path = require('path');

// shell.trashItem() es la función de Electron que mueve un archivo
// a la Papelera de Reciclaje del sistema operativo (como hacer
// clic derecho → Eliminar en el Explorador de Windows).
const { shell } = require('electron');

// =============================================================
// CATEGORÍAS DE BASURA
//
// Organizamos los archivos en categorías para que el usuario
// pueda revisar y decidir qué eliminar por grupos, no archivo
// por archivo (que sería imposible con miles de temporales).
//
// Cada categoría tiene:
//   - id:          Identificador único interno
//   - nombre:      Lo que verá el usuario
//   - descripcion: Explicación de qué son esos archivos
//   - rutas:       Dónde buscarlos (se calculan dinámicamente más abajo)
//   - extensiones: null = todos los archivos, Set = solo esas extensiones
//   - recursivo:   Si debe entrar en subcarpetas
// =============================================================
function obtenerCategorias() {
  // Variables de entorno de Windows donde viven las carpetas de usuario.
  // process.env.TEMP     → C:\Users\TuNombre\AppData\Local\Temp (normalmente)
  // process.env.LOCALAPPDATA → C:\Users\TuNombre\AppData\Local
  // process.env.APPDATA  → C:\Users\TuNombre\AppData\Roaming
  const TEMP       = process.env.TEMP       || '';
  const LOCALAPP   = process.env.LOCALAPPDATA || '';
  const APPDATA    = process.env.APPDATA    || '';
  const WINDIR     = process.env.WINDIR     || 'C:\\Windows';

  return [
    // ── Archivos temporales del sistema ─────────────────────
    {
      id:          'temp-sistema',
      nombre:      'Archivos temporales del sistema',
      descripcion: 'Archivos que Windows crea al instalar programas o durante ' +
                   'operaciones internas. Son seguros de eliminar.',
      rutas:       [
        path.join(WINDIR, 'Temp'),  // C:\Windows\Temp
        TEMP,                        // %TEMP% del usuario actual
      ],
      extensiones: null,   // Todos los archivos
      recursivo:   true,
    },

    // ── Archivos de registro (.log) ──────────────────────────
    {
      id:          'logs',
      nombre:      'Archivos de registro (.log)',
      descripcion: 'Registros generados por programas para depurar errores. ' +
                   'Pueden acumularse durante años sin que el usuario lo sepa.',
      rutas:       [
        path.join(LOCALAPP, 'Temp'),
        path.join(WINDIR, 'Logs'),
      ],
      extensiones: new Set(['.log', '.etl', '.dmp']),
      recursivo:   true,
    },

    // ── Caché de Google Chrome ───────────────────────────────
    {
      id:          'cache-chrome',
      nombre:      'Caché de Google Chrome',
      descripcion: 'Chrome guarda copias de páginas web, imágenes y scripts ' +
                   'para cargarlos más rápido. Puede ocupar varios GB.',
      rutas:       [
        path.join(LOCALAPP, 'Google', 'Chrome', 'User Data', 'Default', 'Cache'),
        path.join(LOCALAPP, 'Google', 'Chrome', 'User Data', 'Default', 'Code Cache'),
        path.join(LOCALAPP, 'Google', 'Chrome', 'User Data', 'Default', 'GPUCache'),
      ],
      extensiones: null,
      recursivo:   true,
    },

    // ── Caché de Microsoft Edge ──────────────────────────────
    {
      id:          'cache-edge',
      nombre:      'Caché de Microsoft Edge',
      descripcion: 'Igual que Chrome pero para Edge. Al formatear el PC ' +
                   'se perderá de todas formas, así que es seguro limpiarlo ahora.',
      rutas:       [
        path.join(LOCALAPP, 'Microsoft', 'Edge', 'User Data', 'Default', 'Cache'),
        path.join(LOCALAPP, 'Microsoft', 'Edge', 'User Data', 'Default', 'Code Cache'),
      ],
      extensiones: null,
      recursivo:   true,
    },

    // ── Caché de Mozilla Firefox ─────────────────────────────
    {
      id:          'cache-firefox',
      nombre:      'Caché de Mozilla Firefox',
      descripcion: 'Archivos temporales de Firefox. La carpeta "cache2" ' +
                   'suele ser la más grande.',
      rutas:       [
        // Firefox usa un perfil con nombre aleatorio, así que buscamos
        // dentro de la carpeta Profiles sin saber el nombre exacto.
        path.join(APPDATA, 'Mozilla', 'Firefox', 'Profiles'),
      ],
      extensiones: null,
      recursivo:   true,
      // Solo nos interesan las subcarpetas de caché dentro del perfil
      filtroCarpeta: 'cache',  // Solo entra en carpetas cuyo nombre contiene "cache"
    },

    // ── Minidumps (volcados de memoria de errores) ───────────
    {
      id:          'minidumps',
      nombre:      'Volcados de memoria de errores (minidumps)',
      descripcion: 'Cuando un programa se cierra inesperadamente, Windows ' +
                   'guarda un "volcado" para depurar el error. Son inútiles ' +
                   'para el usuario normal y pueden pesar varios MB cada uno.',
      rutas:       [
        path.join(LOCALAPP, 'CrashDumps'),
        path.join(LOCALAPP, 'Microsoft', 'Windows', 'WER', 'ReportArchive'),
      ],
      extensiones: new Set(['.dmp', '.mdmp']),
      recursivo:   true,
    },

    // ── Miniaturas de Windows ────────────────────────────────
    {
      id:          'thumbcache',
      nombre:      'Caché de miniaturas de Windows',
      descripcion: 'Windows guarda versiones pequeñas de tus imágenes para ' +
                   'mostrarlas rápido en el Explorador. Se regeneran solos.',
      rutas:       [
        path.join(LOCALAPP, 'Microsoft', 'Windows', 'Explorer'),
      ],
      // thumbcache_*.db son las bases de datos de miniaturas
      extensiones: new Set(['.db']),
      recursivo:   false,  // No necesitamos entrar en subcarpetas aquí
    },
  ];
}

// =============================================================
// FUNCIÓN PRINCIPAL: analizar
//
// Recorre todas las categorías, cuenta los archivos candidatos
// y calcula cuánto espacio se podría liberar.
//
// IMPORTANTE: Esta función es de SOLO LECTURA. No modifica,
// mueve ni borra ningún archivo. Es como hacer un inventario.
//
// @param {Function} onProgreso - Callback(categoria, archivosEncontrados)
//                                para actualizar la UI mientras analiza
// @returns {Promise<Array>}    - Array de categorías con sus archivos
// =============================================================
async function analizar(onProgreso) {
  const categorias = obtenerCategorias();
  const resultado  = [];

  for (const categoria of categorias) {
    // Notificamos a la UI que estamos analizando esta categoría
    if (onProgreso) {
      onProgreso(categoria.nombre);
    }

    // Recogemos todos los archivos de todas las rutas de esta categoría
    const archivosCategoria = [];

    for (const ruta of categoria.rutas) {
      // Comprobamos si la carpeta existe antes de intentar leerla.
      // Es normal que algunas no existan (ej: Firefox no instalado).
      const existe = await existeCarpeta(ruta);
      if (!existe) continue;

      // Listamos los archivos según la configuración de la categoría
      const archivos = await listarArchivos(
        ruta,
        categoria.extensiones,
        categoria.recursivo,
        categoria.filtroCarpeta || null
      );

      archivosCategoria.push(...archivos);
    }

    // Calculamos el espacio total que ocupa esta categoría
    const espacioTotal = archivosCategoria.reduce((suma, a) => suma + a.tamano, 0);

    resultado.push({
      ...categoria,         // Copiamos toda la info de la categoría
      archivos: archivosCategoria,
      espacioTotal,
      seleccionada: true,   // Por defecto, todas las categorías están marcadas
    });
  }

  return resultado;
}

// =============================================================
// FUNCIÓN PRINCIPAL: eliminar
//
// Mueve los archivos indicados a la PAPELERA DE RECICLAJE.
//
// ⚠️ ESTA FUNCIÓN NUNCA DEBE LLAMARSE SIN CONFIRMACIÓN PREVIA.
//    En main.js, el handler que llama a esta función se llama
//    'eliminar-archivos-confirmado' — el sufijo es un recordatorio.
//
// ¿POR QUÉ shell.trashItem() Y NO fs.unlink()?
//    fs.unlink() borra el archivo permanentemente y de forma
//    irrecuperable. shell.trashItem() lo mueve a la Papelera,
//    igual que cuando arrastras un archivo a la papelera en
//    el Explorador de Windows. El usuario puede recuperarlo.
//
// @param {Array}    archivos   - Lista de objetos con propiedad .ruta
// @param {Function} onProgreso - Callback(actual, total, nombre)
// @returns {Promise<Object>}   - { eliminados, errores[] }
// =============================================================
async function eliminar(archivos, onProgreso) {
  const resultado = { eliminados: 0, errores: [] };

  for (let i = 0; i < archivos.length; i++) {
    const archivo = archivos[i];

    // Actualizamos el progreso en la UI antes de cada operación
    if (onProgreso) {
      onProgreso(i + 1, archivos.length, archivo.nombre);
    }

    try {
      // shell.trashItem() devuelve una promesa que se resuelve cuando
      // el archivo ya está en la papelera. Si falla (ej: archivo en uso
      // por otro proceso), lanza un error que capturamos abajo.
      await shell.trashItem(archivo.ruta);
      resultado.eliminados++;
    } catch (err) {
      // Guardamos el error pero continuamos con el siguiente archivo.
      // No queremos que un archivo fallido detenga toda la operación.
      console.error(`[junkCleaner] No se pudo mover a papelera: ${archivo.ruta}`, err.message);
      resultado.errores.push({
        nombre: archivo.nombre,
        ruta:   archivo.ruta,
        error:  err.message,
      });
    }
  }

  return resultado;
}

// =============================================================
// FUNCIONES INTERNAS (no se exportan — solo uso interno)
// =============================================================

/**
 * Comprueba si una carpeta existe en el disco.
 * Usamos fs.access() en lugar de fs.stat() porque es más rápido:
 * solo comprueba si podemos acceder, no lee los metadatos completos.
 *
 * @param {string} ruta
 * @returns {Promise<boolean>}
 */
async function existeCarpeta(ruta) {
  try {
    await fs.access(ruta);
    return true;
  } catch {
    // Si lanza error, la carpeta no existe o no tenemos permisos
    return false;
  }
}

/**
 * Lista todos los archivos de una carpeta que cumplan los filtros.
 *
 * @param {string}      dirRaiz        - Carpeta donde empezar
 * @param {Set|null}    extensiones    - Extensiones permitidas, o null para todas
 * @param {boolean}     recursivo      - Si entrar en subcarpetas
 * @param {string|null} filtroCarpeta  - Solo entra en subcarpetas cuyo nombre
 *                                       contenga este texto (ej: 'cache')
 * @returns {Promise<Array>}           - Array de objetos { nombre, ruta, tamano }
 */
async function listarArchivos(dirRaiz, extensiones, recursivo, filtroCarpeta) {
  const encontrados = [];

  // Función recursiva interna — la definimos aquí para que tenga
  // acceso a los parámetros de la función exterior (closure).
  async function recorrer(dirActual) {
    let entradas;
    try {
      // withFileTypes: true → cada entrada nos dice si es archivo o carpeta
      // sin necesidad de hacer un stat() adicional (más eficiente)
      entradas = await fs.readdir(dirActual, { withFileTypes: true });
    } catch {
      // Sin permisos de lectura → saltamos esta carpeta en silencio
      return;
    }

    for (const entrada of entradas) {
      const rutaCompleta = path.join(dirActual, entrada.name);

      if (entrada.isFile()) {
        // Comprobamos si la extensión está en el filtro
        const ext = path.extname(entrada.name).toLowerCase();
        const pasaFiltroExt = !extensiones || extensiones.has(ext);

        if (pasaFiltroExt) {
          try {
            const stats = await fs.stat(rutaCompleta);
            encontrados.push({
              nombre: entrada.name,
              ruta:   rutaCompleta,
              tamano: stats.size,
            });
          } catch {
            // No se pudo leer el tamaño → lo ignoramos
          }
        }

      } else if (entrada.isDirectory() && recursivo) {
        // Si hay filtro de carpeta, solo entramos en subcarpetas
        // cuyo nombre contenga ese texto (insensible a mayúsculas).
        // Ejemplo: filtroCarpeta='cache' → solo entra en 'Cache', 'cache2', etc.
        const nombreLower = entrada.name.toLowerCase();
        const pasaFiltroCarpeta = !filtroCarpeta ||
                                   nombreLower.includes(filtroCarpeta.toLowerCase());

        if (pasaFiltroCarpeta) {
          await recorrer(rutaCompleta);
        }
      }
    }
  }

  await recorrer(dirRaiz);
  return encontrados;
}

// Solo exportamos las funciones que main.js necesita llamar.
// Las funciones internas (existeCarpeta, listarArchivos) no se exportan
// porque son detalles de implementación que nadie más debe usar.
module.exports = { analizar, eliminar };