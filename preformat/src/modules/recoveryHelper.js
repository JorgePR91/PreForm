// =============================================================
// recoveryHelper.js — Comparación post-formateo (listas de programas)
// =============================================================
// Cruza la lista exportada antes del formateo con el escaneo actual.
// No accede a red; solo normaliza nombres y clasifica coincidencias.
//
// EXPORTA (module.exports al final):
//   normalizarListaImportada — valida/limpia JSON del usuario.
//   compararProgramas — cruza dos listas y devuelve reinstalados/pendientes/nuevos.
//   normalizarClaveNombre — misma clave que se usa internamente para el Map (útil tests).
// =============================================================

/**
 * Construye una clave estable para comparar nombres de programas entre listas:
 * minúsculas, sin acentos (NFD + quitar marcas), sin símbolos ™®©,
 * caracteres no alfanuméricos → espacio, trim.
 * @param {string} nombre
 * @returns {string}
 */
function normalizarClaveNombre(nombre) {
  return String(nombre || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[™®©]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Valida que el JSON importado sea un array de objetos con al menos `nombre`.
 * Acepta el formato exportado por programScanner (JSON).
 */
function normalizarListaImportada(data) {
  if (!Array.isArray(data)) return null;
  const salida = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const nombre = item.nombre;
    if (typeof nombre !== 'string' || !nombre.trim()) continue;
    salida.push({
      nombre: nombre.trim(),
      version: item.version || '',
      editor: item.editor || '',
      fechaInstalacion: item.fechaInstalacion || '',
      esDelSistema: !!item.esDelSistema,
      tieneDesinstalador: !!item.tieneDesinstalador,
    });
  }
  return salida.length ? salida : null;
}

/**
 * Compara lista antigua (USB) con lista actual del registro.
 * @returns {{ reinstalados, pendientes, nuevos, totales }}
 */
function compararProgramas(listaAntigua, listaActual) {
  const mapAntes = new Map();
  for (const p of listaAntigua) {
    const key = normalizarClaveNombre(p.nombre);
    if (!key) continue;
    if (!mapAntes.has(key)) mapAntes.set(key, p);
  }

  const keysAhora = new Set();
  for (const p of listaActual) {
    keysAhora.add(normalizarClaveNombre(p.nombre));
  }

  const reinstalados = [];
  const nuevos = [];

  for (const p of listaActual) {
    const key = normalizarClaveNombre(p.nombre);
    if (mapAntes.has(key)) {
      reinstalados.push({ ...p, estado: 'reinstalado' });
    } else {
      nuevos.push({ ...p, estado: 'nuevo' });
    }
  }

  const pendientes = [];
  for (const [key, p] of mapAntes) {
    if (!keysAhora.has(key)) {
      pendientes.push({ ...p, estado: 'pendiente' });
    }
  }

  return {
    reinstalados,
    pendientes,
    nuevos,
    totales: {
      antes: listaAntigua.length,
      ahora: listaActual.length,
      reinstalados: reinstalados.length,
      pendientes: pendientes.length,
      nuevos: nuevos.length,
    },
  };
}

// Objeto exportado: única interfaz pública del módulo para main.js y pruebas.
module.exports = {
  normalizarListaImportada,
  compararProgramas,
  normalizarClaveNombre,
};
