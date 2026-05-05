// =============================================================
// src/modules/installerFinder.js — Módulo 2: Buscador de Instaladores
// =============================================================
// Escanea una ruta (disco local o carpeta de red) buscando
// archivos instaladores (.exe, .msi, .msix) y permite copiarlos
// a una carpeta de destino con verificación de integridad.
// =============================================================

const fs   = require('fs').promises;
const path = require('path');
// calcularHash — SHA-256 por stream; verificarCopia — compara dos archivos (no usado por main actualmente).
const { calcularHash, verificarCopia } = require('../utils/hashUtils');
// SEGURIDAD: importar validadores
const { detectarSymlink } = require('../utils/securityUtils');

// Extensiones que consideramos "instaladores"
const EXTENSIONES = new Set(['.exe', '.msi', '.msix', '.msp', '.msu']);

// Carpetas que nunca tiene sentido escanear:
// son del sistema o son demasiado grandes y no contienen instaladores de usuario.
const CARPETAS_IGNORAR = new Set([
  'windows',
  'system32',
  'syswow64',
  '$recycle.bin',
  '$windows.~bt',
  'winsxs',
  'assembly',
  'node_modules',
  '.git',
]);

// Profundidad máxima de recursión para evitar escaneos eternos
const MAX_PROFUNDIDAD = 8;

// =============================================================
// FUNCIÓN PRINCIPAL: escanear
// Recorre una ruta recursivamente y devuelve los instaladores
// que encuentra. Llama a onProgreso durante el escaneo para
// que la UI pueda mostrar avance en tiempo real.
//
// @param {string}   ruta       - Carpeta raíz donde empezar
// @param {Function} onProgreso - Callback(carpetaActual, totalEncontrados)
// @returns {Promise<Array>}
// =============================================================
async function escanear(ruta, onProgreso) {
  const encontrados = [];
  await recorrer(ruta, 0, encontrados, onProgreso);
  return encontrados;
}

// =============================================================
// FUNCIÓN INTERNA: recorrer
// Núcleo recursivo del escáner. No se llama directamente.
// =============================================================
async function recorrer(dirRaiz, nivelInicial, encontrados, onProgreso) {
  const pilaDirectorios = [{ ruta: dirRaiz, nivel: nivelInicial }];
  const LIMITE_SEGURIDAD = 100000; // Previene colapso de memoria e IPC

  while (pilaDirectorios.length > 0) {
    const { ruta: dirActual, nivel } = pilaDirectorios.pop();

    if (nivel > MAX_PROFUNDIDAD) continue;

    let flujoDirectorio;
    try {
      // Abrimos un canal de flujo (stream) en lugar de volcar todo a RAM
      flujoDirectorio = await fs.opendir(dirActual);
    } catch {
      continue; // Sin permisos → saltamos
    }

    if (onProgreso) {
      onProgreso(dirActual, encontrados.length);
    }

    try {
      for await (const entrada of flujoDirectorio) {
        if (encontrados.length >= LIMITE_SEGURIDAD) {
          break;
        }

        const rutaCompleta = path.join(dirActual, entrada.name);

        if (entrada.isFile()) {
          const ext = path.extname(entrada.name).toLowerCase();
          if (EXTENSIONES.has(ext)) {
            try {
              const stats = await fs.stat(rutaCompleta);
              encontrados.push({
                id:               rutaCompleta,
                nombre:           entrada.name,
                ruta:             rutaCompleta,
                carpeta:          dirActual,
                extension:        ext.slice(1).toUpperCase(),
                tamano:           stats.size,
                fechaModificacion: stats.mtime.toLocaleDateString('es-ES'),
                hash:             null,
                seleccionado:     false,
              });
            } catch {
              // No se pudo obtener stats → lo ignoramos
            }
          }
        } else if (entrada.isDirectory()) {
          const nombreLower = entrada.name.toLowerCase();
          const debeIgnorar = CARPETAS_IGNORAR.has(nombreLower) ||
                              nombreLower.startsWith('$');

          if (!debeIgnorar) {
            pilaDirectorios.push({ ruta: rutaCompleta, nivel: nivel + 1 });
          }
        }
      }
    } catch (errorLectura) {
      // Ignorar errores parciales de lectura en medio del flujo
    }

    if (encontrados.length >= LIMITE_SEGURIDAD) {
      break;
    }
  }
}

// =============================================================
// FUNCIÓN: copiar
// Copia los archivos seleccionados al destino indicado.
//
// @param {Array}    archivos   - Lista de objetos con .ruta y .nombre
// @param {string}   destino    - Carpeta de destino
// @param {Function} onProgreso - Callback(actual, total, nombreArchivo)
// @returns {Promise<Object>}   - { copiados, errores[] }
// =============================================================
async function copiar(archivos, destino, onProgreso) {
  const resultado = { copiados: 0, errores: [] };
  let destinoReal = destino;

  // SEGURIDAD: Resolver la ruta real del destino.
  // Esto permite destinos legítimos que en Windows son junctions o carpetas redirigidas.
  try {
    await fs.mkdir(destino, { recursive: true });
    destinoReal = await fs.realpath(destino);
  } catch (error) {
    return {
      copiados: 0,
      errores: [{ error: `Acceso a destino rechazado: ${error.message}` }]
    };
  }

  for (let i = 0; i < archivos.length; i++) {
    const archivo = archivos[i];
    const rutaDestino = path.join(destinoReal, archivo.nombre);

    if (onProgreso) {
      onProgreso(i + 1, archivos.length, archivo.nombre);
    }

    try {
      // SEGURIDAD: Detectar symlinks en archivos fuente
      const esSymlinkOrigen = await detectarSymlink(archivo.ruta);
      if (esSymlinkOrigen) {
        resultado.errores.push({
          nombre: archivo.nombre,
          error: 'Es un enlace simbólico — se rechaza por seguridad'
        });
        continue;
      }

      await fs.copyFile(archivo.ruta, rutaDestino);
      resultado.copiados++;
    } catch (err) {
      console.error(`[installerFinder] Error al copiar ${archivo.nombre}:`, err.message);
      resultado.errores.push({ nombre: archivo.nombre, error: err.message });
    }
  }

  return resultado;
}

// =============================================================
// FUNCIÓN: calcularHashArchivo
// Calcula el SHA-256 de un archivo concreto bajo demanda.
// =============================================================
async function calcularHashArchivo(ruta) {
  return calcularHash(ruta, 'sha256');
}

module.exports = { escanear, copiar, calcularHashArchivo, verificarCopia };