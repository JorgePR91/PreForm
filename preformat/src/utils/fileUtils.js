// =============================================================
// src/utils/fileUtils.js — Utilidades de Sistema de Archivos
// =============================================================
// Funciones reutilizables para operaciones con archivos.
// Todos los módulos pueden importar de aquí en lugar de
// reimplementar lo mismo varias veces.
// =============================================================

// fs.promises — readdir, stat, mkdir, copyFile, utimes, access, unlink async.
const fs   = require('fs').promises;
// path — join para rutas al recorrer árbol de directorios.
const path = require('path');

/**
 * Lee todos los archivos de una carpeta de forma recursiva.
 * @param {string} dirRaiz     - Carpeta de inicio
 * @param {number} profundidad - Niveles máximos a bajar (0 = solo la raíz)
 * @returns {Promise<string[]>} - Array de rutas absolutas de archivos
 */
async function listarArchivosRecursivo(dirRaiz, profundidad = 3) {
  const resultados = [];

  async function recorrer(dirActual, nivelActual) {
    if (nivelActual > profundidad) return;

    let entradas;
    try {
      entradas = await fs.readdir(dirActual, { withFileTypes: true });
    } catch (err) {
      // Si no tenemos permisos para leer la carpeta, la saltamos
      console.warn(`[fileUtils] Sin acceso a: ${dirActual}`);
      return;
    }

    for (const entrada of entradas) {
      const rutaCompleta = path.join(dirActual, entrada.name);

      if (entrada.isFile()) {
        resultados.push(rutaCompleta);
      } else if (entrada.isDirectory()) {
        await recorrer(rutaCompleta, nivelActual + 1);
      }
    }
  }

  await recorrer(dirRaiz, 0);
  return resultados;
}

/**
 * Devuelve el tamaño de un archivo en bytes.
 * @param {string} ruta
 * @returns {Promise<number>}
 */
async function obtenerTamano(ruta) {
  try {
    const stats = await fs.stat(ruta);
    return stats.size;
  } catch {
    return 0;
  }
}

/**
 * Comprueba si una ruta existe (archivo o carpeta).
 * @param {string} ruta
 * @returns {Promise<boolean>}
 */
async function existe(ruta) {
  try {
    await fs.access(ruta);
    return true;
  } catch {
    return false;
  }
}

/**
 * Crea una carpeta y todas las carpetas padre necesarias.
 * Equivalente a "mkdir -p" en Linux.
 * @param {string} ruta
 */
async function crearCarpeta(ruta) {
  await fs.mkdir(ruta, { recursive: true });
}

/**
 * Copia un archivo preservando sus metadatos (fechas de creación/modificación).
 * @param {string} origen
 * @param {string} destino
 */
async function copiarConMetadatos(origen, destino) {
  // Copiamos el archivo
  await fs.copyFile(origen, destino);

  // Recuperamos las fechas originales
  const stats = await fs.stat(origen);

  // Aplicamos las mismas fechas al archivo copiado
  await fs.utimes(destino, stats.atime, stats.mtime);
}

module.exports = {
  listarArchivosRecursivo,
  obtenerTamano,
  existe,
  crearCarpeta,
  copiarConMetadatos,
};
