// =============================================================
// src/utils/performanceUtils.js — Utilidades de Rendimiento
// =============================================================
// Funciones para:
// 1. Throttling/debouncing de callbacks
// 2. Timeouts en promesas
// 3. Validación de límites
// 4. Error formatting con contexto
// 5. Limpieza de recursos
// =============================================================

/**
 * THROTTLE: Limita la frecuencia de llamadas a una función
 * 
 * Ejemplo: onProgreso() se llama cada 100ms máximo, o cada 1000 items
 * 
 * @param {Function} fn - Función a throttle
 * @param {number} interval - Intervalo mínimo en ms
 * @param {number} count - O cada N items
 * @returns {Function} Función throttleada
 */
function throttle(fn, interval = 100, count = null) {
  let lastCall = 0;
  let itemCount = 0;

  return function throttled(...args) {
    const now = Date.now();
    itemCount++;

    // Llamar si: pasó intervalo O se alcanzó count
    const debeCall =
      (now - lastCall >= interval) || 
      (count && itemCount >= count);

    if (debeCall) {
      fn.apply(this, args);
      lastCall = now;
      itemCount = 0;
    }
  };
}

/**
 * DEBOUNCE: Retrasa ejecución hasta que dejen de llamarse
 * 
 * Ejemplo: búsqueda en tabla solo se ejecuta 300ms después del último keyup
 * 
 * @param {Function} fn - Función a debounce
 * @param {number} delay - Delay en ms
 * @returns {Function} Función debounceada
 */
function debounce(fn, delay = 300) {
  let timeoutId;

  return function debounced(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * PROMISE TIMEOUT: Agrega timeout a una promesa
 * 
 * @param {Promise} promise - Promesa a envolver
 * @param {number} ms - Timeout en milisegundos
 * @param {string} contexto - Descripción para error
 * @returns {Promise} Promesa envuelta con timeout
 */
function conTimeout(promise, ms = 300000, contexto = 'operación') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => {
        reject(new Error(
          `${contexto} excedió el timeout de ${ms}ms. ` +
          `Operación probablemente colgada o disco lento.`
        ));
      }, ms)
    )
  ]);
}

/**
 * PROMISE TIMEOUT WITH ABORT: Versión con AbortController
 *
 * Mejor para operaciones que aceptan AbortSignal (fetch, streams, etc.)
 * La función factory recibe la señal y debe pasarla a la operación interna.
 *
 * @param {Function} factory - Función (signal) => Promise que crea la promesa con la señal
 * @param {number} ms - Timeout en ms
 * @returns {Promise} Promesa envuelta
 *
 * @example
 * conTimeoutAbort(signal => fetch(url, { signal }), 5000)
 */
function conTimeoutAbort(factory, ms = 300000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);

  return Promise.resolve(factory(controller.signal))
    .then(
      result => { clearTimeout(timeoutId); return result; },
      error  => { clearTimeout(timeoutId); throw error; }
    );
}

/**
 * VALIDACIÓN DE LÍMITES: Previene operaciones sobre límites
 * 
 * @param {number} cantidad - Cantidad actual
 * @param {number} limite - Límite permitido
 * @param {string} tipo - Tipo de objeto para mensaje
 * @throws {Error} Si se excede límite
 */
function validarLimite(cantidad, limite, tipo = 'items') {
  if (cantidad > limite) {
    throw new Error(
      `Límite de ${tipo} excedido: ${cantidad} > ${limite}. ` +
      `Por favor, divide en lotes más pequeños.`
    );
  }
}

/**
 * VALIDACIÓN DE RANGO CON CONTEXTO
 * 
 * @param {number} valor - Valor a validar
 * @param {number} min - Mínimo
 * @param {number} max - Máximo
 * @param {string} nombre - Nombre del parámetro (para error)
 * @throws {Error} Si está fuera de rango
 */
function validarRangoConContexto(valor, min, max, nombre) {
  if (typeof valor !== 'number' || valor < min || valor > max) {
    throw new Error(
      `${nombre} inválido: ${valor}. Debe estar entre ${min} y ${max}.`
    );
  }
}

/**
 * ERROR FORMATTER: Enriquece errores con contexto
 * 
 * @param {Error} error - Error a enriquecer
 * @param {Object} contexto - { modulo, operacion, input, usuario }
 * @returns {Object} Error estructurado
 */
function formatearError(error, contexto = {}) {
  const errorId = `ERR-${Date.now().toString(36).toUpperCase()}`;
  
  return {
    id: errorId,
    tipo: error?.constructor?.name || 'Error',
    mensaje: error?.message || 'Error desconocido',
    
    // Contexto para debugging
    ...(contexto?.modulo && { modulo: contexto.modulo }),
    ...(contexto?.operacion && { operacion: contexto.operacion }),
    
    // Stack solo en desarrollo
    ...(process.env.NODE_ENV === 'development' && { stack: error?.stack }),
    
    // Input que causó el error (sanitizado)
    ...(contexto?.input && { 
      input: typeof contexto.input === 'string' 
        ? contexto.input.substring(0, 100)
        : JSON.stringify(contexto.input).substring(0, 100)
    }),
    
    // Timestamp
    timestamp: new Date().toISOString(),
    
    // Usuario (si aplica)
    ...(contexto?.usuario && { usuario: contexto.usuario })
  };
}

/**
 * EVENT LISTENER CLEANUP: Ayuda a limpiar listeners
 * 
 * @param {Element} element - Elemento que tiene listeners
 * @param {string} eventType - Tipo de event (opcional, limpia todos si no se especifica)
 */
function limpiarListeners(element, eventType = null) {
  if (!element) return;

  // Clonar y reemplazar elimina todos los listeners
  const clone = element.cloneNode(true);
  if (eventType) {
    // Si eventType específico, solo limpiar ese... más complejo
    // Por ahora, usar this approach es lo más simple
  }
  element.parentNode?.replaceChild(clone, element);
  return clone;
}

/**
 * DELEGATED CLEANUP: Quita un específico listener
 * 
 * Nota: requiere que guardes referencia a la función callback
 * 
 * @param {Element} element - Elemento
 * @param {string} eventType - Tipo de evento
 * @param {Function} handler - Handler original
 */
function removerListener(element, eventType, handler) {
  if (!element || !eventType || !handler) return;
  element.removeEventListener(eventType, handler);
}

/**
 * CREAR NAMESPACE PARA LISTENERS: Evita colisiones
 * 
 * @param {Element} element - Elemento donde agregar listener
 * @param {string} eventType - Tipo de evento
 * @param {Function} handler - Handler
 * @param {string} namespace - Namespace para luego limpiar fácil
 * @returns {Object} { remove: () => void }
 */
function listenConNamespace(element, eventType, handler, namespace = '') {
  element.addEventListener(eventType, handler);
  
  // Guardar referencia para cleanup posterior
  if (!element._listeners) element._listeners = [];
  element._listeners.push({ eventType, handler, namespace });

  return {
    remove: () => removerListener(element, eventType, handler)
  };
}

/**
 * CLEANUP TODO POR NAMESPACE
 * 
 * @param {Element} element - Elemento
 * @param {string} namespace - Namespace a limpiar
 */
function limpiarPorNamespace(element, namespace) {
  if (!element._listeners) return;

  element._listeners = element._listeners.filter(listener => {
    if (listener.namespace === namespace) {
      removerListener(element, listener.eventType, listener.handler);
      return false; // Remover de la lista
    }
    return true; // Mantener
  });
}

/**
 * POOLING DE PROMESAS: Ejecuta con límite de concurrencia
 * 
 * @param {Array<Function>} tareas - Array de funciones async
 * @param {number} limiteConc - Máximo concurrentes
 * @returns {Promise<Array>} Resultados
 */
async function ejecutarConPooling(tareas, limiteConc = 3) {
  const resultados = [];
  const enProgreso = new Set();

  for (let i = 0; i < tareas.length; i++) {
    // Esperar si ya hay limiteConc en progreso
    while (enProgreso.size >= limiteConc) {
      await Promise.race(enProgreso);
    }

    // Crear promesa y agregarla al conjunto
    const promesa = tareas[i]()
      .then(resultado => {
        resultados[i] = resultado;
      })
      .catch(error => {
        resultados[i] = { error: error.message };
      })
      .finally(() => enProgreso.delete(promesa));

    enProgreso.add(promesa);
  }

  // Esperar las últimas promesas
  await Promise.all(enProgreso);
  return resultados;
}

/**
 * MEMORY STATS: Monitorea uso de memoria (Node.js)
 * 
 * @returns {Object} Estadísticas de memoria
 */
function obtenerStatsMemoria() {
  if (typeof process === 'undefined') return null;

  const stats = process.memoryUsage();
  return {
    heapUsed: `${Math.round(stats.heapUsed / 1024 / 1024)}MB`,
    heapTotal: `${Math.round(stats.heapTotal / 1024 / 1024)}MB`,
    rss: `${Math.round(stats.rss / 1024 / 1024)}MB`, // Resident Set Size
    external: `${Math.round(stats.external / 1024 / 1024)}MB`,
  };
}

/**
 * GARBAGE COLLECTION HINT: Sugiere al GC que active
 * 
 * Nota: Requiere --expose-gc en node
 */
function sugerirGC() {
  if (global.gc) {
    global.gc();
    console.log('[GC] Garbage collection sugerido');
  }
}

/**
 * PERFORMANCE MONITOR: Mide tiempo de ejecución
 * 
 * @param {string} label - Etiqueta
 * @returns {Object} { fin: () => ms }
 */
function medirTiempo(label) {
  const inicio = performance.now();

  return {
    fin: () => {
      const duracion = performance.now() - inicio;
      const segundos = (duracion / 1000).toFixed(2);
      console.log(`[${label}] ${duracion.toFixed(2)}ms (${segundos}s)`);
      return duracion;
    }
  };
}

module.exports = {
  throttle,
  debounce,
  conTimeout,
  conTimeoutAbort,
  validarLimite,
  validarRangoConContexto,
  formatearError,
  limpiarListeners,
  removerListener,
  listenConNamespace,
  limpiarPorNamespace,
  ejecutarConPooling,
  obtenerStatsMemoria,
  sugerirGC,
  medirTiempo
};
