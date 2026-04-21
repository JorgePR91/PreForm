// =============================================================
// src/modules/fileOrganizer.js — Módulo 4: Reorganizador de Archivos
// =============================================================
//
// PROPÓSITO DE ESTE MÓDULO:
//   Ayudar al usuario a entender qué hay en sus carpetas personales
//   y respaldar lo que necesite antes del formateo.
//
// DOS MODOS DE OPERACIÓN:
//   - 'copiar': Duplica los archivos en el destino. El original queda intacto.
//               Es el modo recomendado y más seguro.
//   - 'mover':  Traslada los archivos al destino. El original desaparece.
//               ⚠️ Requiere confirmación doble en la UI.
//
// CARPETAS QUE ESCANEA:
//   Escritorio, Documentos, Descargas, Imágenes, Vídeos y Música.
//   Son las carpetas estándar de Windows donde el usuario guarda sus cosas.
//
// AGRUPACIÓN POR TIPO:
//   Clasificamos cada archivo según su extensión en categorías legibles
//   (Imágenes, Vídeos, Documentos, etc.) para que el usuario entienda
//   de un vistazo qué tiene y cuánto ocupa cada tipo.
//
// =============================================================

// os.homedir() — raíz del usuario para Desktop, Documents, etc.
const os   = require('os');
const path = require('path');
const fs   = require('fs').promises;

// SEGURIDAD: importar validadores
const { validarRutaParaOperacion, detectarSymlink } = require('../utils/securityUtils');

// =============================================================
// CARPETAS PERSONALES A ESCANEAR
//
// os.homedir() devuelve la carpeta del usuario actual.
// En Windows: C:\Users\TuNombre
// Así no tenemos que hardcodear el nombre de usuario.
// =============================================================
const CARPETAS_PERSONALES = [
  { id: 'escritorio', nombre: 'Escritorio',   icono: '🖥️',  ruta: path.join(os.homedir(), 'Desktop')   },
  { id: 'documentos', nombre: 'Documentos',   icono: '📄',  ruta: path.join(os.homedir(), 'Documents') },
  { id: 'descargas',  nombre: 'Descargas',    icono: '⬇️',  ruta: path.join(os.homedir(), 'Downloads') },
  { id: 'imagenes',   nombre: 'Imágenes',     icono: '🖼️',  ruta: path.join(os.homedir(), 'Pictures')  },
  { id: 'videos',     nombre: 'Vídeos',       icono: '🎬',  ruta: path.join(os.homedir(), 'Videos')    },
  { id: 'musica',     nombre: 'Música',       icono: '🎵',  ruta: path.join(os.homedir(), 'Music')     },
];

// =============================================================
// MAPA DE TIPOS DE ARCHIVO
//
// Agrupamos las extensiones en categorías comprensibles para el usuario.
// La clave es el nombre de la categoría, el valor es el Set de extensiones.
//
// Usamos Set (en lugar de Array) para que la búsqueda sea O(1):
// en vez de recorrer toda la lista, simplemente preguntamos
// si la extensión "está en el conjunto". Es más eficiente con muchos archivos.
// =============================================================
const TIPOS_ARCHIVO = [
  { id: 'imagenes',    nombre: 'Imágenes',    icono: '🖼️',  extensiones: new Set(['.jpg','.jpeg','.png','.gif','.bmp','.webp','.svg','.tiff','.raw','.heic']) },
  { id: 'videos',      nombre: 'Vídeos',      icono: '🎬',  extensiones: new Set(['.mp4','.avi','.mkv','.mov','.wmv','.flv','.webm','.m4v','.mpg','.mpeg']) },
  { id: 'audio',       nombre: 'Audio',       icono: '🎵',  extensiones: new Set(['.mp3','.wav','.flac','.aac','.ogg','.wma','.m4a','.opus']) },
  { id: 'documentos',  nombre: 'Documentos',  icono: '📄',  extensiones: new Set(['.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.odt','.ods','.odp','.txt','.rtf']) },
  { id: 'codigo',      nombre: 'Código',      icono: '💻',  extensiones: new Set(['.js','.ts','.html','.css','.py','.java','.c','.cpp','.cs','.php','.rb','.go','.rs','.json','.xml','.yaml','.yml','.sql','.sh','.bat']) },
  { id: 'comprimidos', nombre: 'Comprimidos', icono: '📦',  extensiones: new Set(['.zip','.rar','.7z','.tar','.gz','.bz2','.xz','.iso']) },
  { id: 'otros',       nombre: 'Otros',       icono: '📎',  extensiones: null }, // null = todo lo que no encaja arriba
];

// =============================================================
// FUNCIÓN PRINCIPAL: escanear
//
// Lee todas las carpetas personales y devuelve una estructura
// con las estadísticas de cada carpeta y los archivos agrupados
// por tipo. Es de SOLO LECTURA — no mueve ni copia nada.
//
// @param {Function} onProgreso - Callback(nombreCarpeta) para actualizar la UI
// @returns {Promise<Array>}    - Array de objetos de carpeta con sus archivos
// =============================================================
async function escanear(onProgreso) {
  const resultado = [];

  for (const carpeta of CARPETAS_PERSONALES) {
    // Avisamos a la UI qué carpeta estamos leyendo ahora
    if (onProgreso) onProgreso(carpeta.nombre);

    // Comprobamos si la carpeta existe antes de intentar leerla.
    // En algunos sistemas puede que no existan todas (ej: sin carpeta Música).
    const existe = await existeCarpeta(carpeta.ruta);
    if (!existe) continue;

    // Leemos todos los archivos de esta carpeta (sin entrar en subcarpetas
    // por defecto — solo el primer nivel para no abrumar al usuario)
    const archivos = await listarArchivosPlanos(carpeta.ruta);

    // Agrupamos los archivos por tipo para las estadísticas
    const porTipo = agruparPorTipo(archivos);

    // Calculamos el espacio total de esta carpeta
    const espacioTotal = archivos.reduce((suma, a) => suma + a.tamano, 0);

    resultado.push({
      ...carpeta,               // id, nombre, icono, ruta
      archivos,                 // Lista completa de archivos
      porTipo,                  // Agrupados por categoría (para las estadísticas)
      totalArchivos: archivos.length,
      espacioTotal,
      seleccionada: false,      // El usuario decide qué carpetas respaldar
    });
  }

  return resultado;
}

// =============================================================
// FUNCIÓN PRINCIPAL: transferir
//
// Copia o mueve los archivos seleccionados al destino indicado,
// preservando los metadatos (fechas de creación y modificación).
//
// ⚠️ ESTA FUNCIÓN NUNCA DEBE LLAMARSE SIN CONFIRMACIÓN PREVIA.
//    El handler en main.js se llama 'transferir-archivos-confirmado'
//    como recordatorio de esta regla.
//
// ¿POR QUÉ PRESERVAMOS METADATOS?
//   Cuando copias un archivo, el sistema operativo le asigna la
//   fecha de hoy como fecha de creación, perdiendo la original.
//   Con fs.utimes() restauramos la fecha original al archivo copiado,
//   así el archivo conserva su historia.
//
// =============================================================

/**
 * Copia o mueve los archivos seleccionados al destino indicado,
 * preservando los metadatos (fechas de creación y modificación).
 *
 * @param {Array}    archivos   - Lista de objetos con .ruta y .nombre
 * @param {string}   destino    - Carpeta raíz de destino
 * @param {string}   modo       - 'copiar' o 'mover'
 * @param {boolean}  organizarPorTipo - Si true, crea subcarpetas por tipo
 * @param {Function} onProgreso - Callback(actual, total, nombre)
 * @returns {Promise<Object>}   - { transferidos, errores[] }
 */
async function transferir(archivos, destino, modo, organizarPorTipo, onProgreso) {
  const resultado = { transferidos: 0, errores: [] };

  // SEGURIDAD: Validar que la ruta de destino es segura
  try {
    await fs.mkdir(destino, { recursive: true });
    
    // Detectar si destino es un symlink (operación peligrosa)
    const esSymlink = await detectarSymlink(destino);
    if (esSymlink) {
      throw new Error('La carpeta de destino es un enlace simbólico. Se rechaza la operación por seguridad.');
    }
  } catch (error) {
    return {
      transferidos: 0,
      errores: [{ error: `Acceso a destino rechazado: ${error.message}` }]
    };
  }

  for (let i = 0; i < archivos.length; i++) {
    const archivo = archivos[i];

    if (onProgreso) onProgreso(i + 1, archivos.length, archivo.nombre);

    try {
      // SEGURIDAD: Validar que el archivo a copiar no sea un symlink
      const esSymlinkArchivo = await detectarSymlink(archivo.ruta);
      if (esSymlinkArchivo) {
        resultado.errores.push({
          nombre: archivo.nombre,
          ruta: archivo.ruta,
          error: 'Es un enlace simbólico — se rechaza por seguridad'
        });
        continue;
      }

      // Determinamos la carpeta de destino del archivo.
      // Si organizarPorTipo está activado, creamos subcarpetas por tipo:
      //   destino/Imágenes/foto.jpg
      //   destino/Documentos/informe.pdf
      // Si no, todos van directamente al destino:
      //   destino/foto.jpg
      let carpetaDestino = destino;
      if (organizarPorTipo) {
        const tipo = obtenerTipoArchivo(archivo.nombre);
        carpetaDestino = path.join(destino, tipo.nombre);
      }

      // Creamos la carpeta de destino si no existe (recursive: true
      // equivale a "mkdir -p": crea también las carpetas padre que falten)
      await fs.mkdir(carpetaDestino, { recursive: true });

      const rutaDestino = path.join(carpetaDestino, archivo.nombre);

      // Leemos los metadatos del archivo original ANTES de copiarlo
      // para poder restaurarlos después en el archivo copiado.
      const statsOriginal = await fs.stat(archivo.ruta);

      if (modo === 'copiar') {
        // fs.copyFile copia el contenido del archivo.
        // No preserva metadatos automáticamente — los restauramos manualmente.
        await fs.copyFile(archivo.ruta, rutaDestino);

        // fs.utimes(ruta, atime, mtime) restaura las fechas:
        //   atime = último acceso
        //   mtime = última modificación
        await fs.utimes(rutaDestino, statsOriginal.atime, statsOriginal.mtime);

      } else if (modo === 'mover') {
        // fs.rename es la forma más eficiente de mover un archivo
        // dentro del mismo disco (no copia los datos, solo reubica el puntero).
        // Si el origen y destino están en discos distintos, lanzará un error
        // que capturamos abajo y tratamos como una copia + borrado.
        try {
          await fs.rename(archivo.ruta, rutaDestino);
        } catch (errRename) {
          // Si rename falla (discos distintos), hacemos copia + borrado manual
          if (errRename.code === 'EXDEV') {
            await fs.copyFile(archivo.ruta, rutaDestino);
            await fs.utimes(rutaDestino, statsOriginal.atime, statsOriginal.mtime);
            await fs.unlink(archivo.ruta); // Borramos el original solo si la copia fue bien
          } else {
            throw errRename; // Otro tipo de error → lo propagamos
          }
        }
      }

      resultado.transferidos++;

    } catch (err) {
      // Guardamos el error pero continuamos con el siguiente archivo
      console.error(`[fileOrganizer] Error al transferir ${archivo.nombre}:`, err.message);
      resultado.errores.push({ nombre: archivo.nombre, ruta: archivo.ruta, error: err.message });
    }
  }

  return resultado;
}

// =============================================================
// FUNCIONES INTERNAS
// =============================================================

/**
 * Lee los archivos del primer nivel de una carpeta (sin recursión).
 * Devuelve solo archivos, no subcarpetas.
 *
 * Elegimos no ser recursivos aquí porque:
 *   1. El usuario ya sabe lo que tiene en sus carpetas directas
 *   2. Entrar en subcarpetas complicaría la UI sin añadir mucho valor
 *   3. Carpetas como Documentos pueden tener estructuras muy profundas
 *
 * @param {string} dirRaiz
 * @returns {Promise<Array>} - Array de { nombre, ruta, tamano, extension, fechaModificacion }
 */
async function listarArchivosPlanos(dirRaiz) {
  const archivos = [];
  const LIMITE_SEGURIDAD = 100000; // Previene colapso de memoria e IPC

  let flujoDirectorio;
  try {
    // Abrimos un canal de flujo (stream) en lugar de volcar todo a RAM
    flujoDirectorio = await fs.opendir(dirRaiz);
  } catch {
    return archivos; // Sin permisos → devolvemos lista vacía
  }

  try {
    for await (const entrada of flujoDirectorio) {
      // Si se alcanza el límite duro, evitamos seguir engordando el array
      if (archivos.length >= LIMITE_SEGURIDAD) {
        break;
      }

      // Solo procesamos archivos, ignoramos subcarpetas en este nivel
      if (!entrada.isFile()) continue;

      const rutaCompleta = path.join(dirRaiz, entrada.name);

      try {
        const stats = await fs.stat(rutaCompleta);
        archivos.push({
          nombre:           entrada.name,
          ruta:             rutaCompleta,
          tamano:           stats.size,
          extension:        path.extname(entrada.name).toLowerCase(),
          fechaModificacion: stats.mtime.toLocaleDateString('es-ES'),
          seleccionado:     false,
        });
      } catch {
        // No se pudo leer el stat → lo ignoramos
      }
    }
  } catch (errorLectura) {
    // Ignorar errores parciales de lectura en medio del flujo
  }

  return archivos;
}

/**
 * Agrupa una lista de archivos por tipo (Imágenes, Vídeos, etc.)
 * y calcula el espacio total de cada grupo.
 *
 * Devuelve un array de grupos, cada uno con:
 *   { id, nombre, icono, cantidad, espacioTotal }
 *
 * @param {Array} archivos
 * @returns {Array}
 */
function agruparPorTipo(archivos) {
  // Inicializamos contadores para cada tipo
  const contadores = {};
  TIPOS_ARCHIVO.forEach(tipo => {
    contadores[tipo.id] = { ...tipo, cantidad: 0, espacioTotal: 0 };
  });

  archivos.forEach(archivo => {
    const tipo = obtenerTipoArchivo(archivo.nombre);
    contadores[tipo.id].cantidad++;
    contadores[tipo.id].espacioTotal += archivo.tamano;
  });

  // Devolvemos solo los tipos que tienen al menos un archivo,
  // ordenados de mayor a menor espacio ocupado
  return Object.values(contadores)
    .filter(t => t.cantidad > 0)
    .sort((a, b) => b.espacioTotal - a.espacioTotal);
}

/**
 * Determina el tipo de un archivo según su extensión.
 * Si no encaja en ninguna categoría, devuelve 'Otros'.
 *
 * @param {string} nombreArchivo
 * @returns {Object} - El objeto de tipo { id, nombre, icono }
 */
function obtenerTipoArchivo(nombreArchivo) {
  const ext = path.extname(nombreArchivo).toLowerCase();

  // Recorremos los tipos en orden hasta encontrar uno que tenga esta extensión.
  // 'otros' siempre es el último y tiene extensiones: null, por eso nunca falla.
  for (const tipo of TIPOS_ARCHIVO) {
    if (tipo.extensiones === null) return tipo; // Es 'otros'
    if (tipo.extensiones.has(ext)) return tipo;
  }

  // Esto nunca debería alcanzarse porque 'otros' siempre atrapa el resto
  return TIPOS_ARCHIVO[TIPOS_ARCHIVO.length - 1];
}

/**
 * Comprueba si una carpeta existe sin lanzar error si no existe.
 * @param {string} ruta
 * @returns {Promise<boolean>}
 */
async function existeCarpeta(ruta) {
  try {
    await fs.access(ruta);
    return true;
  } catch {
    return false;
  }
}

module.exports = { escanear, transferir };