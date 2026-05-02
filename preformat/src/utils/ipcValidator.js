// =============================================================
// src/utils/ipcValidator.js — Validación y Estandarización IPC
// =============================================================
// Funciones para:
// 1. Estandarizar todas las respuestas IPC
// 2. Validar parámetros con esquemas
// 3. Manejo consistente de errores
// 4. Rate limiting en handlers
// =============================================================

/**
 * RESPUESTA EXITOSA: Formato estándar para resultados OK
 * 
 * @param {any} datos - Los datos a devolver
 * @param {string} mensaje - Mensaje adicional (opcional)
 * @returns {Object} Respuesta estructurada
 */
function respuestaExitosa(datos = null, mensaje = null) {
  return {
    exito: true,
    datos,
    ...(mensaje && { mensaje }),
    timestamp: new Date().toISOString()
  };
}

/**
 * RESPUESTA DE ERROR: Formato estándar para errores
 * 
 * @param {string|Error} error - Mensaje o objeto Error
 * @param {string} modulo - Módulo que generó el error
 * @param {string} operacion - Operación que falló
 * @returns {Object} Respuesta de error
 */
function respuestaError(error, modulo = 'desconocido', operacion = null) {
  const errorId = `ERR-${Date.now().toString(36).toUpperCase()}`;
  const mensaje = error?.message || String(error);

  return {
    exito: false,
    error: mensaje,
    errorId,
    ...(modulo && { modulo }),
    ...(operacion && { operacion }),
    timestamp: new Date().toISOString(),
    // Stack solo en desarrollo
    ...(process.env.NODE_ENV === 'development' && {
      stack: error?.stack || 'no disponible'
    })
  };
}

/**
 * RESPUESTA CANCELADA: Cuando el usuario cancela
 * 
 * @param {string} razon - Por qué se canceló
 * @returns {Object} Respuesta
 */
function respuestaCancelada(razon = 'usuario') {
  return {
    exito: false,
    cancelada: true,
    razon,
    timestamp: new Date().toISOString()
  };
}

/**
 * VALIDADOR DE ESQUEMA: Type checking robusto para parámetros IPC
 *
 * @param {Object} params  - Parámetros recibidos por el handler IPC
 * @param {Object} esquema - Mapa clave → regla. Cada regla admite:
 *
 *   Comunes:
 *   @param {string}   regla.tipo        - Tipo esperado: 'string' | 'number' | 'array' |
 *                                         'object' | 'boolean' | 'function'
 *   @param {boolean}  [regla.opcional]  - Si true, permite undefined/null (default: false)
 *
 *   Para 'array':
 *   @param {number}   [regla.minLength] - Longitud mínima del array
 *   @param {number}   [regla.maxLength] - Longitud máxima del array
 *   @param {string}   [regla.itemType]  - Tipo esperado de cada elemento del array
 *
 *   Para 'string':
 *   @param {number}   [regla.minLength] - Longitud mínima de caracteres
 *   @param {number}   [regla.maxLength] - Longitud máxima de caracteres
 *   @param {RegExp}   [regla.pattern]   - Regex que debe cumplir el valor
 *
 *   Para 'number':
 *   @param {number}   [regla.min]       - Valor mínimo (inclusive)
 *   @param {number}   [regla.max]       - Valor máximo (inclusive)
 *
 *   Todos los tipos:
 *   @param {Array}    [regla.enum]         - Lista de valores permitidos
 *   @param {Function} [regla.validacion]   - Función (valor) => boolean para lógica custom
 *   @param {string}   [regla.mensajeError] - Mensaje personalizado si falla `validacion`
 *
 * @returns {Object} Parámetros validados (solo las claves del esquema)
 * @throws  {Error}  Con lista de todos los errores encontrados
 *
 * @example
 * validarEsquema(params, {
 *   archivos: { tipo: 'array', minLength: 1, maxLength: 10000, itemType: 'object' },
 *   destino:  { tipo: 'string', minLength: 1, pattern: /^[A-Z]:\\/ },
 *   modo:     { tipo: 'string', enum: ['copiar', 'mover'] },
 *   callback: { tipo: 'function', opcional: true }
 * });
 */
function validarEsquema(params, esquema) {
  if (!params || typeof params !== 'object') {
    throw new Error('Los parámetros deben ser un objeto');
  }

  const validado = {};
  const errores = [];

  for (const [clave, regla] of Object.entries(esquema)) {
    const valor = params[clave];
    const esOpcional = regla.opcional === true;

    // Si falta y es opcional, saltar
    if (valor === undefined || valor === null) {
      if (esOpcional) {
        validado[clave] = valor;
        continue;
      } else {
        errores.push(`Parámetro requerido "${clave}" no proporcionado`);
        continue;
      }
    }

    // Validar tipo
    const tipoReal = obtenerTipo(valor);
    if (tipoReal !== regla.tipo) {
      errores.push(
        `"${clave}": tipo inválido. Esperado ${regla.tipo}, ` +
        `recibido ${tipoReal}`
      );
      continue;
    }

    // Validaciones específicas por tipo
    if (regla.tipo === 'array') {
      if (regla.minLength && valor.length < regla.minLength) {
        errores.push(
          `"${clave}": array muy corto. Mínimo ${regla.minLength}, ` +
          `recibido ${valor.length}`
        );
      }
      if (regla.maxLength && valor.length > regla.maxLength) {
        errores.push(
          `"${clave}": array demasiado largo. Máximo ${regla.maxLength}, ` +
          `recibido ${valor.length}`
        );
      }
      // Validar items del array
      if (regla.itemType) {
        for (let i = 0; i < valor.length; i++) {
          if (obtenerTipo(valor[i]) !== regla.itemType) {
            errores.push(
              `"${clave}[${i}]": tipo inválido. ` +
              `Esperado ${regla.itemType}`
            );
          }
        }
      }
    }

    if (regla.tipo === 'string') {
      if (regla.minLength && valor.length < regla.minLength) {
        errores.push(
          `"${clave}": string muy corto. Mínimo ${regla.minLength} caracteres`
        );
      }
      if (regla.maxLength && valor.length > regla.maxLength) {
        errores.push(
          `"${clave}": string demasiado largo. Máximo ${regla.maxLength} caracteres`
        );
      }
      if (regla.pattern && !regla.pattern.test(valor)) {
        errores.push(`"${clave}": no cumple el patrón requerido`);
      }
    }

    if (regla.tipo === 'number') {
      if (regla.min !== undefined && valor < regla.min) {
        errores.push(`"${clave}": menor que mínimo ${regla.min}`);
      }
      if (regla.max !== undefined && valor > regla.max) {
        errores.push(`"${clave}": mayor que máximo ${regla.max}`);
      }
    }

    // Validación enum
    if (regla.enum && !regla.enum.includes(valor)) {
      errores.push(
        `"${clave}": valor inválido. ` +
        `Opciones: ${regla.enum.join(', ')}`
      );
    }

    // Validación personalizada
    if (regla.validacion && !regla.validacion(valor)) {
      errores.push(
        `"${clave}": no cumple validación personalizada (${regla.mensajeError || 'ver logs'})`
      );
    }

    validado[clave] = valor;
  }

  if (errores.length > 0) {
    throw new Error(`Validación IPC fallida:\n  - ${errores.join('\n  - ')}`);
  }

  return validado;
}

/**
 * OBTENER TIPO: Determina tipo real de valor
 * 
 * @param {any} valor - Valor a analizar
 * @returns {string} Tipo (string, number, array, object, function, etc.)
 */
function obtenerTipo(valor) {
  if (valor === null) return 'null';
  if (Array.isArray(valor)) return 'array';
  return typeof valor;
}

/**
 * CREAR ESQUEMA RÁPIDO: Helper para definir esquemas comunes
 * 
 * @param {Object} def - Definición simple
 * @returns {Object} Esquema para validarEsquema
 * 
 * Ejemplo:
 * crearEsquema({
 *   archivos: 'array[1..10000]',
 *   destino: 'string[1..500]',
 *   modo: 'enum(copiar|mover)'
 * })
 */
function crearEsquema(def) {
  const esquema = {};

  for (const [clave, definicion] of Object.entries(def)) {
    // Parsear definición como string
    // Ejemplo: 'array[1..10000]', 'string[1..500]', 'enum(a|b|c)'

    if (definicion.includes('[') && definicion.includes(']')) {
      const [tipo, rangos] = definicion.split('[');
      const [min, max] = rangos.replace(']', '').split('..');

      esquema[clave] = {
        tipo: tipo.trim(),
        ...(min && { minLength: parseInt(min) }),
        ...(max && { maxLength: parseInt(max) })
      };
    } else if (definicion.includes('enum(')) {
      const opciones = definicion
        .match(/enum\((.*?)\)/)[1]
        .split('|')
        .map(s => s.trim());

      esquema[clave] = {
        tipo: 'string',
        enum: opciones
      };
    } else {
      esquema[clave] = { tipo: definicion };
    }
  }

  return esquema;
}

/**
 * RATE LIMITING: Previene spam en handlers específicos
 * 
 * @param {Function} handler - Handler IPC
 * @param {number} maxPorIntervalo - Máximo de llamadas
 * @param {number} intervalo - Intervalo en ms
 * @param {string} identificador - ID único para este handler
 * @returns {Function} Handler envuelto con rate limit
 * 
 * Ejemplo:
 * ipcMain.handle('copiar-instaladores', 
 *   conRateLimit(handler, 5, 1000, 'copiar-instaladores')
 * );
 */
function conRateLimit(handler, maxPorIntervalo = 10, intervalo = 1000, identificador = 'handler') {
  let contador = 0;

  // Resetear contador en cada intervalo; el interval vive mientras el handler esté registrado
  setInterval(() => { contador = 0; }, intervalo);

  return async function limitado(event, ...args) {
    contador++;

    if (contador > maxPorIntervalo) {
      return respuestaError(
        `Rate limit excedido. Máximo ${maxPorIntervalo} llamadas por ${intervalo}ms`,
        'rate-limiter',
        identificador
      );
    }

    return await handler(event, ...args);
  };
}

/**
 * WRAPPER PARA HANDLER IPC: Estandariza error handling
 * 
 * @param {Function} handler - Función async handler
 * @param {Object} opciones - { validacion, modulo, timeout }
 * @returns {Function} Handler envuelto
 * 
 * Ejemplo:
 * ipcMain.handle('copiar-instaladores',
 *   conErrorHandlerEstandar(
 *     baseHandler,
 *     {
 *       validacion: (event, params) => validarEsquema(params, esquema),
 *       modulo: 'installerFinder',
 *       timeout: 600000
 *     }
 *   )
 * );
 */
function conErrorHandlerEstandar(handler, opciones = {}) {
  const { validacion, modulo = 'desconocido', timeout = 300000, operacion } = opciones;

  return async (event, ...args) => {
    // Fase 1 — validación: errores de esquema se etiquetan con operacion='validacion'
    try {
      if (validacion) {
        validacion(event, args[0]);
      }
    } catch (validationError) {
      return respuestaError(validationError, modulo, 'validacion');
    }

    // Fase 2 — ejecución: el timer se limpia tanto en éxito como en error
    try {
      const resultado = await new Promise((resolve, reject) => {
        let timeoutId;

        if (timeout) {
          timeoutId = setTimeout(
            () => reject(new Error(`${operacion || 'Operación'} excedió timeout de ${timeout}ms`)),
            timeout
          );
        }

        Promise.resolve(handler(event, ...args))
          .then(res => { clearTimeout(timeoutId); resolve(res); })
          .catch(err => { clearTimeout(timeoutId); reject(err); });
      });

      return respuestaExitosa(resultado);
    } catch (executionError) {
      return respuestaError(executionError, modulo, operacion);
    }
  };
}

module.exports = {
  respuestaExitosa,
  respuestaError,
  respuestaCancelada,
  validarEsquema,
  obtenerTipo,
  crearEsquema,
  conRateLimit,
  conErrorHandlerEstandar
};
