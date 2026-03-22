// =============================================================
// src/modules/installerFinder.js — Módulo 2: Buscador de Instaladores
// =============================================================
// Escanea una ruta (disco local o carpeta de red) buscando
// archivos instaladores (.exe, .msi, .msix) y permite copiarlos
// a una carpeta de destino con verificación de integridad.
// =============================================================

const fs   = require('fs').promises;
const path = require('path');
const { calcularHash, verificarCopia } = require('../utils/hashUtils');

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
async function recorrer(dirActual, nivel, encontrados, onProgreso) {
  if (nivel > MAX_PROFUNDIDAD) return;

  let entradas;
  try {
    entradas = await fs.readdir(dirActual, { withFileTypes: true });
  } catch {
    return;
  }

  if (onProgreso) {
    onProgreso(dirActual, encontrados.length);
  }

  for (const entrada of entradas) {
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
        await recorrer(rutaCompleta, nivel + 1, encontrados, onProgreso);
      }
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

  for (let i = 0; i < archivos.length; i++) {
    const archivo = archivos[i];
    const rutaDestino = path.join(destino, archivo.nombre);

    if (onProgreso) {
      onProgreso(i + 1, archivos.length, archivo.nombre);
    }

    try {
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