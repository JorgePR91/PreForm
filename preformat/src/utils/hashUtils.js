// =============================================================
// src/utils/hashUtils.js — Verificación de Integridad de Archivos
// =============================================================
// Calcula hashes MD5 y SHA-256 de archivos para verificar que
// no están corruptos después de copiarlos.
//
// Usa el módulo 'crypto' que viene integrado en Node.js
// (no hace falta instalar nada extra).
// =============================================================

const crypto = require('crypto'); // Módulo nativo de Node.js
const fs     = require('fs');     // Usamos la versión síncrona de streams

/**
 * Calcula el hash de un archivo.
 * Usamos streams para no cargar archivos grandes enteros en memoria.
 *
 * @param {string} rutaArchivo - Ruta absoluta del archivo
 * @param {'md5'|'sha256'} algoritmo - Algoritmo a usar
 * @returns {Promise<string>} - Hash en hexadecimal
 */
function calcularHash(rutaArchivo, algoritmo = 'sha256') {
  return new Promise((resolve, reject) => {
    // Creamos el objeto que calculará el hash
    const hash = crypto.createHash(algoritmo);

    // Abrimos el archivo como un stream de lectura (eficiente para archivos grandes)
    const stream = fs.createReadStream(rutaArchivo);

    // Cada vez que llega un trozo de datos, lo alimentamos al hash
    stream.on('data', (trozo) => hash.update(trozo));

    // Cuando termina de leer, calculamos el resultado
    stream.on('end', () => resolve(hash.digest('hex')));

    // Si hay un error (archivo no existe, sin permisos, etc.)
    stream.on('error', (err) => reject(err));
  });
}

/**
 * Verifica si dos archivos son idénticos comparando sus hashes SHA-256.
 * Útil para confirmar que una copia se completó sin corrupción.
 *
 * @param {string} rutaOriginal
 * @param {string} rutaCopia
 * @returns {Promise<boolean>}
 */
async function verificarCopia(rutaOriginal, rutaCopia) {
  const [hashOriginal, hashCopia] = await Promise.all([
    calcularHash(rutaOriginal, 'sha256'),
    calcularHash(rutaCopia,    'sha256'),
  ]);
  return hashOriginal === hashCopia;
}

module.exports = { calcularHash, verificarCopia };
