// =============================================================
// src/utils/securityUtils.js — Utilidades de Seguridad
// =============================================================
// Funciones reutilizables para:
// 1. Prevenir Path Traversal attacks
// 2. Detectar Symbolic Links
// 3. Validar parámetros IPC
// 4. Escapar comandos PowerShell
// 5. Manejo centralizado de errores
// =============================================================

const path = require('path');
const fs = require('fs').promises;

/**
 * VALIDACIÓN 1: Path Traversal Prevention
 * 
 * Verifica que una ruta resuelta esté dentro de una ruta base permitida.
 * Previene ataques como: "../../Windows/System32" o "/etc/passwd"
 * 
 * @param {string} ruta - Ruta a validar (puede ser relativa)
 * @param {string} rutaBase - Ruta base permitida (debe ser absoluta)
 * @param {string} nombreParam - Nombre del parámetro (para mensajes de error)
 * @returns {string} Ruta resuelta y validada
 * @throws {Error} Si la ruta está fuera de límites
 */
function validarRutaSegura(ruta, rutaBase, nombreParam = 'ruta') {
  if (!ruta || typeof ruta !== 'string') {
    throw new Error(`${nombreParam} debe ser una cadena no vacía`);
  }
  
  if (!rutaBase || typeof rutaBase !== 'string') {
    throw new Error('rutaBase debe ser especificada y válida');
  }

  // Resolver y normalizar rutas
  const rutaResuelta = path.resolve(ruta);
  const rutaBaseResuelta = path.resolve(rutaBase);

  // Verificar que la ruta resuelta comienza con la ruta base
  if (!rutaResuelta.startsWith(rutaBaseResuelta)) {
    throw new Error(
      `${nombreParam} está fuera de los límites permitidos. ` +
      `Base: ${rutaBaseResuelta}, solicitado: ${rutaResuelta}`
    );
  }

  return rutaResuelta;
}

/**
 * VALIDACIÓN 2: Symlink Detection
 * 
 * Detecta si una ruta es un enlace simbólico.
 * Usa fs.lstat() (no fs.stat()) para NO seguir links.
 * 
 * @param {string} ruta - Ruta a verificar
 * @returns {Promise<boolean>} true si es symlink, false si no
 */
async function detectarSymlink(ruta) {
  try {
    const stats = await fs.lstat(ruta); // ⚠️ lstat, NO stat
    return stats.isSymbolicLink();
  } catch (error) {
    // Si no podemos acceder, reportamos como error
    throw new Error(`No se pudo verificar si es symlink: ${error.message}`);
  }
}

/**
 * VALIDACIÓN 3: Safe File Operations
 * 
 * Verifica una ruta antes de operaciones peligrosas.
 * Combina validación de path traversal + detección de symlinks.
 * 
 * @param {string} ruta - Ruta a verificar
 * @param {string} rutaBase - Ruta base permitida
 * @param {Object} opciones - { detectarSymlinks: boolean }
 * @returns {Promise<void>} Lanza error si hay problema
 */
async function validarRutaParaOperacion(ruta, rutaBase, opciones = {}) {
  const { detectarSymlinks = true } = opciones;

  // Paso 1: Validar path traversal
  validarRutaSegura(ruta, rutaBase);

  // Paso 2: Detectar symlinks (opcional pero recomendado)
  if (detectarSymlinks) {
    const esSymlink = await detectarSymlink(ruta);
    if (esSymlink) {
      throw new Error(
        `Operación rechazada: "${ruta}" es un enlace simbólico. ` +
        `Por seguridad, no se permiten operaciones en symlinks.`
      );
    }
  }
}

/**
 * VALIDACIÓN 4: IPC Parameter Validation
 * 
 * Valida que los parámetros del IPC sean del tipo esperado.
 * Previene crashes por datos malformados desde el renderer.
 * 
 * @param {Object} params - Objeto con parámetros
 * @param {Object} schema - Definición de parámetros esperados
 *   Ejemplo: { ruta: 'string', archivos: 'array', id: 'number' }
 * @returns {Object} Parámetros validados
 * @throws {Error} Si un parámetro no cumple el esquema
 */
function validarParametrosIPC(params, schema) {
  if (!params || typeof params !== 'object') {
    throw new Error('Los parámetros deben ser un objeto');
  }

  const validated = {};

  for (const [clave, tipoEsperado] of Object.entries(schema)) {
    const valor = params[clave];

    // Verificar tipo
    let tipoReal = typeof valor;
    if (Array.isArray(valor)) tipoReal = 'array';
    if (valor === null) tipoReal = 'null';

    if (tipoReal !== tipoEsperado) {
      throw new Error(
        `Parámetro "${clave}" debe ser ${tipoEsperado}, ` +
        `pero recibimos ${tipoReal}`
      );
    }

    validated[clave] = valor;
  }

  return validated;
}

/**
 * VALIDACIÓN 5: PowerShell Command Escaping
 * 
 * Escapa caracteres especiales en strings que se inyectarán en PowerShell.
 * Previene inyección de comandos PowerShell.
 * 
 * @param {string} texto - Texto a escapar
 * @returns {string} Texto escapado seguro para PowerShell
 */
function escaparComandoPowerShell(texto) {
  if (!texto || typeof texto !== 'string') {
    return '';
  }

  // Escape de caracteres especiales en PowerShell:
  // - $ → `$ (literal dollar sign)
  // - ` → `` (literal backtick)
  // - " → `" (literal quote)
  // - ' → '' (single quote, solo en single-quoted strings)
  
  return texto
    .replace(/\$/g, '`$')      // $ → `$
    .replace(/`/g, '``')       // ` → ``
    .replace(/"/g, '`"')       // " → `"
    .replace(/\r/g, '`r')      // carriage return
    .replace(/\n/g, '`n');     // newline
}

/**
 * VALIDACIÓN 6: Rate Limiting / TOCTOU Prevention
 * 
 * Agrega un pequeño delay para preventing TOCTOU (Time-of-Check-Time-of-Use).
 * En situaciones de race condition, reintenta la operación.
 * 
 * @param {Function} operacion - Función async a ejecutar
 * @param {Object} opciones - { reintentos: number, delayMs: number }
 * @returns {Promise<any>} Resultado de la operación
 */
async function ejecutarConReintento(operacion, opciones = {}) {
  const { reintentos = 3, delayMs = 100 } = opciones;

  for (let intento = 1; intento <= reintentos; intento++) {
    try {
      return await operacion();
    } catch (error) {
      if (intento === reintentos) {
        throw error; // Último intento fallido, propagar error
      }
      
      // Esperar un poco antes de reintentar (exponencial)
      const delay = delayMs * Math.pow(2, intento - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * VALIDACIÓN 7: Global Error Handler Wrapper
 * 
 * Envuelve handlers IPC para capturar errores inesperados.
 * 
 * @param {Function} handler - Función async del handler IPC
 * @param {string} nombreModulo - Nombre del módulo (para logging)
 * @returns {Function} Handler envuelto con manejo de errores
 */
function conErrorHandler(handler, nombreModulo = 'desconocido') {
  return async (event, ...args) => {
    try {
      return await handler(event, ...args);
    } catch (error) {
      const mensaje = error?.message || 'Error desconocido';
      console.error(`[${nombreModulo}] Error no capturado:`, error);
      
      return {
        exito: false,
        error: mensaje,
        modulo: nombreModulo,
        tipo: error?.constructor?.name || 'Error'
      };
    }
  };
}

/**
 * UTILIDAD: Validar rango de valores
 * 
 * @param {number} valor - Valor a validar
 * @param {number} minimo - Valor mínimo
 * @param {number} maximo - Valor máximo
 * @param {string} nombre - Nombre del parámetro
 * @throws {Error} Si el valor está fuera de rango
 */
function validarRango(valor, minimo, maximo, nombre = 'valor') {
  if (typeof valor !== 'number' || valor < minimo || valor > maximo) {
    throw new Error(
      `${nombre} debe estar entre ${minimo} y ${maximo}, ` +
      `pero recibimos ${valor}`
    );
  }
}

/**
 * UTILIDAD: Sanitizar entrada de usuario para logging
 * 
 * Previene que información sensible o rutas del sistema se loggeen.
 * 
 * @param {any} valor - Valor a sanitizar
 * @returns {string} Valor sanitizado
 */
function sanitizarParaLog(valor) {
  if (typeof valor !== 'string') {
    return String(valor);
  }

  const os = require('os');
  const home = os.homedir();

  // Reemplazar rutas sensibles con <HOME>, <APPDATA>, etc.
  let sanitizado = valor
    .replace(home, '<HOME>')
    .replace(/C:\\Users\\[^\\]+/gi, '<HOME>')
    .replace(/password|pwd|token|secret|key/gi, '<REDACTED>');

  // Limitar longitud
  if (sanitizado.length > 200) {
    sanitizado = sanitizado.substring(0, 197) + '...';
  }

  return sanitizado;
}

module.exports = {
  validarRutaSegura,
  detectarSymlink,
  validarRutaParaOperacion,
  validarParametrosIPC,
  escaparComandoPowerShell,
  ejecutarConReintento,
  conErrorHandler,
  validarRango,
  sanitizarParaLog,
};
