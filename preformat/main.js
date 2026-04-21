// =============================================================
// main.js — Proceso Principal de Electron
// =============================================================
// Este archivo es el "cerebro" de la aplicación. Corre en Node.js
// y tiene acceso completo al sistema operativo. La UI (lo que ves)
// está separada en /renderer/ y se comunica con este archivo
// mediante mensajes IPC (como eventos, pero entre procesos).
// =============================================================

// require('electron') — API del proceso principal de Electron (solo en main).
//   app — ciclo de vida (whenReady, quit, getPath).
//   BrowserWindow — ventana con Chromium embebido.
//   ipcMain — registro de manejadores ipcMain.handle (respuesta a invoke del renderer).
//   dialog — cuadros nativos abrir/guardar archivo o carpeta.
//   shell — abrir rutas con la app predeterminada del SO (p. ej. Explorador).
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');

// path — unión y resolución de rutas multiplataforma (__dirname, join, etc.).
const path = require('path');

// ── Módulos de negocio (cada require carga un solo archivo con module.exports) ──
// programScanner — lista programas desde registro Windows + export JSON/CSV/PDF.
const programScanner   = require('./src/modules/programScanner');
// installerFinder — escaneo recursivo de instaladores y copia con progreso.
const installerFinder  = require('./src/modules/installerFinder');
// junkCleaner — análisis de “basura” y envío a papelera (no borrado permanente).
const junkCleaner      = require('./src/modules/junkCleaner');
// fileOrganizer — escaneo de carpetas personales y copiar/mover con metadatos.
const fileOrganizer    = require('./src/modules/fileOrganizer');
// credentialHelper — detectar gestores/navegadores (solo rutas) y cifrado AES de archivo exportado.
const credentialHelper = require('./src/modules/credentialHelper');
// gameSaveService — detección de saves (Steam, registro, Ludusavi opcional) y respaldo.
const gameSaveService    = require('./src/modules/gameSaveService');
// recoveryHelper — normalizar JSON importado y comparar listas de programas.
const recoveryHelper     = require('./src/modules/recoveryHelper');
// certificateHelper — escanear y exportar certificados personales en Windows.
const certificateHelper  = require('./src/modules/certificateHelper');

// fsp — API promesas del fs de Node (readFile, writeFile, etc.); usado para leer JSON importado.
const fsp = require('fs').promises;

// SEGURIDAD: Importar utilidades de seguridad
const { validarParametrosIPC, conErrorHandler, sanitizarParaLog } = require('./src/utils/securityUtils');

// RENDIMIENTO: Importar utilidades de performance e IPC
const { throttle, conTimeout } = require('./src/utils/performanceUtils');
const {
  respuestaExitosa, respuestaError, respuestaCancelada,
  validarEsquema, conRateLimit, conErrorHandlerEstandar
} = require('./src/utils/ipcValidator');

// mainWindow — referencia global a la BrowserWindow activa; debe mantenerse en variable
// de módulo para no perderla al salir del ámbito de createWindow (GC + cierres).
let mainWindow;

// =============================================================
// FUNCIÓN: createWindow
// Crea y configura la ventana principal de la aplicación.
// =============================================================
function createWindow() {
  mainWindow = new BrowserWindow({
    // Tamaño inicial de la ventana
    width: 1200,
    height: 780,
    minWidth: 900,
    minHeight: 600,

    // Opciones de apariencia
    title: 'PreFormat — Prepara tu PC',
    backgroundColor: '#0f1117', // Fondo oscuro mientras carga el HTML
    icon: path.join(__dirname, 'renderer', 'assets', 'icons', 'logo_32.png'), // Icono de la ventana

    // Opciones de seguridad y comunicación
    webPreferences: {
      // preload.js actúa como intermediario seguro entre main y renderer
      preload: path.join(__dirname, 'preload.js'),

      // SEGURIDAD: nunca pongas esto en true en producción
      nodeIntegration: false,

      // SEGURIDAD: aisla el contexto del renderer del de Node.js
      contextIsolation: true,
      // SEGURIDAD: habilita el sandbox del SO para el proceso renderer
      sandbox: true
    }
  });

  // Cargamos el HTML de la interfaz
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // En modo desarrollo, abrimos las DevTools para depurar
  // (como F12 en el navegador)
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  // SEGURIDAD: Bloquear navegación a sitios externos o creación de nuevas ventanas
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Solo permitir navegación si es un archivo local interno
    if (!url.startsWith('file://')) event.preventDefault();
  });

  // Cuando la ventana se cierra, limpiamos la referencia
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// =============================================================
// CICLO DE VIDA DE LA APLICACIÓN
// Electron tiene eventos para cuando la app arranca, cierra, etc.
// =============================================================

// La app está lista → creamos la ventana
app.whenReady().then(() => {
  
  // SEGURIDAD: Aplicar Content Security Policy (CSP) estricto.
  // Esto garantiza que la app sea 100% local, bloqueando cualquier fuga de datos por red.
  const { session } = require('electron');
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:"]
      }
    });
  });

  createWindow();

  // En macOS, las apps no se cierran al cerrar todas las ventanas.
  // Este bloque maneja ese caso (aunque nuestra app es solo para Windows).
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// En Windows/Linux, cerramos la app cuando se cierran todas las ventanas
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// =============================================================
// GLOBAL ERROR HANDLERS (Captura de errores no esperados)
// =============================================================
// Previene que la app crashee sin logging.
// Estos handlers atrapan promesas rechazadas y excepciones no capturadas.

process.on('unhandledRejection', (reason, promise) => {
  const mensaje = reason?.message || String(reason);
  console.error('[UNHANDLED REJECTION]', {
    motivo: sanitizarParaLog(mensaje),
    promesa: String(promise),
    stack: reason?.stack
  });
  // Notificar al renderer si es posible
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('error-global', {
      tipo: 'unhandled-rejection',
      mensaje: 'Ocurrió un error inesperado en la aplicación'
    });
  }
});

process.on('uncaughtException', (error) => {
  console.error('[UNCAUGHT EXCEPTION]', {
    mensaje: sanitizarParaLog(error?.message),
    stack: error?.stack
  });
  // La app se cerrará después de esto, pero al menos logged
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('error-global', {
      tipo: 'uncaught-exception',
      mensaje: 'La aplicación debe reiniciarse'
    });
  }
});

// =============================================================
// MANEJADORES IPC (Comunicación entre renderer y main)
// =============================================================
// La UI llama a window.electronAPI.algoHacer() (definido en preload.js)
// que envía un mensaje IPC aquí. Nosotros procesamos y respondemos.
//
// Patrón: ipcMain.handle('nombre-del-evento', async (event, datos) => {
//   // hacer algo con Node.js
//   return resultado;
// });
//
// Convención de respuesta hacia el renderer: objeto con `exito: boolean`.
//   Éxito típico: { exito: true, datos: ... } o { exito: true, ruta: ... }.
//   Cancelación UI: { exito: false, razon: 'cancelado' }.
//   Error: { exito: false, error: string }.
// El parámetro `event` (IpcMainInvokeEvent) solo se usa cuando se llama
// event.sender.send('canal-progreso', payload) desde un callback async.
// =============================================================

// ── MÓDULO 1: Programas instalados ──────────────────────────

// El renderer pide la lista de programas → nosotros la obtenemos y devolvemos
ipcMain.handle('obtener-programas', async () => {
  try {
    const programas = await programScanner.obtenerTodos();
    return { exito: true, datos: programas };
  } catch (error) {
    // IMPORTANTE: registramos el error en consola, no en la UI
    console.error('[Módulo 1] Error al obtener programas:', sanitizarParaLog(error.message));
    return { exito: false, error: error.message };
  }
});

// El renderer pide exportar la lista en un formato determinado
// ── Recuperación post-formateo: importar JSON y cotejar con el sistema actual
ipcMain.handle('importar-json-programas', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
    title: 'Lista de programas exportada antes del formateo (JSON)',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths || filePaths.length === 0) {
    return { exito: false, razon: 'cancelado' };
  }
  try {
    // SEGURIDAD: Previene que un JSON masivo o corrupto agote la memoria RAM o bloquee el event loop.
    const stat = await fsp.stat(filePaths[0]);
    if (stat.size > 50 * 1024 * 1024) { // Límite estricto de 50 MB
      return { exito: false, error: 'El archivo es demasiado grande para ser un respaldo válido (> 50MB).' };
    }

    const raw = await fsp.readFile(filePaths[0], 'utf8');
    const parsed = JSON.parse(raw);
    const lista = recoveryHelper.normalizarListaImportada(parsed);
    if (!lista) {
      return {
        exito: false,
        error: 'El archivo no contiene un array de programas con el campo "nombre".',
      };
    }
    return { exito: true, datos: lista, ruta: filePaths[0] };
  } catch (error) {
    console.error('[Recuperación] Error al leer JSON:', sanitizarParaLog(error.message));
    return { exito: false, error: error.message };
  }
});

ipcMain.handle('comparar-programas-recuperacion', async (event, params) => {
  try {
    const { listaAntigua } = validarEsquema(params, {
      listaAntigua: { tipo: 'array', minLength: 1, maxLength: 100000 }
    });
    const listaActual = await programScanner.obtenerTodos();
    const comparacion = recoveryHelper.compararProgramas(listaAntigua, listaActual);
    return { exito: true, datos: comparacion };
  } catch (error) {
    console.error('[Recuperación] Error al comparar:', sanitizarParaLog(error.message));
    return { exito: false, error: error.message };
  }
});

ipcMain.handle('exportar-programas', async (event, { formato, datos }) => {
  // Abrimos el diálogo de "Guardar como..." nativo de Windows
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    title: 'Guardar lista de programas',
    defaultPath: `programas-instalados.${formato}`,
    filters: [
      { name: formato.toUpperCase(), extensions: [formato] }
    ]
  });

  // Si el usuario canceló, no hacemos nada
  if (canceled || !filePath) return { exito: false, razon: 'cancelado' };

  try {
    await programScanner.exportar(datos, formato, filePath);
    return { exito: true, ruta: filePath };
  } catch (error) {
    console.error('[Módulo 1] Error al exportar:', sanitizarParaLog(error.message));
    return { exito: false, error: error.message };
  }
});

// ── MÓDULO 2: Buscador de instaladores ──────────────────────

// Escanea una ruta y envía eventos de progreso en tiempo real.
// Usamos event.sender.send() para "empujar" datos al renderer
// mientras el escaneo está en curso, sin esperar a que termine.
ipcMain.handle('escanear-instaladores', async (event, params) => {
  try {
    const { ruta } = validarEsquema(params, {
      ruta: { tipo: 'string', minLength: 1, maxLength: 500 }
    });
    const instaladores = await installerFinder.escanear(
      ruta,
      (carpetaActual, totalEncontrados) => {
        event.sender.send('progreso-escaneo', {
          carpeta: carpetaActual,
          encontrados: totalEncontrados,
        });
      }
    );
    return { exito: true, datos: instaladores };
  } catch (error) {
    console.error('[Módulo 2] Error al escanear:', sanitizarParaLog(error.message));
    return { exito: false, error: error.message };
  }
});

// Copia los instaladores seleccionados al destino.
// También envía progreso en tiempo real.
ipcMain.handle('copiar-instaladores', conRateLimit(
  conErrorHandlerEstandar(
    async (event, { archivos, destino }) => {
      return await installerFinder.copiar(
        archivos, destino,
        (actual, total, nombre) => event.sender.send('progreso-copia', { actual, total, nombre })
      );
    },
    {
      validacion: (event, params) => validarEsquema(params, {
        archivos: { tipo: 'array', minLength: 1, maxLength: 10000, itemType: 'object' },
        destino:  { tipo: 'string', minLength: 1, maxLength: 500 }
      }),
      modulo: 'installerFinder',
      operacion: 'copiar-instaladores',
      timeout: 600000
    }
  ),
  3, 30000, 'copiar-instaladores'
));

// Calcula el hash SHA-256 de un archivo concreto bajo demanda.
// Es una operación lenta para archivos grandes, por eso es opcional.
ipcMain.handle('calcular-hash', async (event, params) => {
  try {
    const { ruta } = validarEsquema(params, {
      ruta: { tipo: 'string', minLength: 1, maxLength: 500 }
    });
    const hash = await installerFinder.calcularHashArchivo(ruta);
    return { exito: true, hash };
  } catch (error) {
    console.error('[Módulo 2] Error al calcular hash:', sanitizarParaLog(error.message));
    return { exito: false, error: error.message };
  }
});

// ── MÓDULO 3: Limpieza de basura ────────────────────────────
// ⚠️ REGLA CRÍTICA: Este módulo tiene DOS pasos separados a propósito.
//
//    PASO 1 — 'analizar-basura':
//      Solo lee el disco y devuelve candidatos. No toca nada.
//      Envía eventos de progreso mientras analiza cada categoría.
//
//    PASO 2 — 'eliminar-archivos-confirmado':
//      Solo se llama cuando el usuario confirma en la UI.
//      Mueve los archivos a la Papelera de Reciclaje (nunca borrado permanente).

ipcMain.handle('analizar-basura', async (event) => {
  try {
    const categorias = await junkCleaner.analizar(
      // Callback de progreso: avisamos al renderer qué categoría
      // estamos analizando en este momento para que muestre texto
      (nombreCategoria) => {
        event.sender.send('progreso-analisis-basura', { categoria: nombreCategoria });
      }
    );
    return { exito: true, datos: categorias };
  } catch (error) {
    console.error('[Módulo 3] Error al analizar basura:', sanitizarParaLog(error.message));
    return { exito: false, error: error.message };
  }
});

// El sufijo "confirmado" en el nombre del evento es intencional:
// nos recuerda que SOLO llegamos aquí después de una confirmación del usuario.
ipcMain.handle('eliminar-archivos-confirmado', conRateLimit(
  conErrorHandlerEstandar(
    async (event, { archivos }) => {
      return await junkCleaner.eliminar(
        archivos,
        (actual, total, nombre) => event.sender.send('progreso-eliminacion', { actual, total, nombre })
      );
    },
    {
      validacion: (event, params) => validarEsquema(params, {
        archivos: { tipo: 'array', minLength: 1, maxLength: 50000 }
      }),
      modulo: 'junkCleaner',
      operacion: 'eliminar-archivos-confirmado',
      timeout: 600000
    }
  ),
  3, 30000, 'eliminar-archivos'
));

// ── MÓDULO 4: Reorganizador de archivos ─────────────────────
//
// FLUJO DE SEGURIDAD (igual que el Módulo 3):
//   PASO 1 — 'escanear-personales': Solo lee. Envía progreso por carpeta.
//   PASO 2 — 'transferir-archivos-confirmado': Solo se ejecuta tras
//             confirmación explícita del usuario en la UI.

ipcMain.handle('escanear-personales', async (event) => {
  try {
    const carpetas = await fileOrganizer.escanear(
      // Le avisamos al renderer qué carpeta estamos leyendo ahora
      (nombreCarpeta) => {
        event.sender.send('progreso-escaneo-personales', { carpeta: nombreCarpeta });
      }
    );
    return { exito: true, datos: carpetas };
  } catch (error) {
    console.error('[Módulo 4] Error al escanear:', sanitizarParaLog(error.message));
    return { exito: false, error: error.message };
  }
});

// El sufijo "confirmado" recuerda que SOLO llega aquí después
// de que el usuario aceptó el modal de confirmación en la UI.
ipcMain.handle('transferir-archivos-confirmado', conRateLimit(
  conErrorHandlerEstandar(
    async (event, { archivos, destino, modo, organizarPorTipo }) => {
      return await fileOrganizer.transferir(
        archivos, destino, modo, organizarPorTipo,
        (actual, total, nombre) => event.sender.send('progreso-transferencia', { actual, total, nombre })
      );
    },
    {
      validacion: (event, params) => validarEsquema(params, {
        archivos:        { tipo: 'array',   minLength: 1, maxLength: 100000, itemType: 'object' },
        destino:         { tipo: 'string',  minLength: 1, maxLength: 500 },
        modo:            { tipo: 'string',  enum: ['copiar', 'mover'] },
        organizarPorTipo:{ tipo: 'boolean', opcional: true }
      }),
      modulo: 'fileOrganizer',
      operacion: 'transferir-archivos-confirmado',
      timeout: 600000
    }
  ),
  3, 30000, 'transferir-archivos'
));

// ── MÓDULO 5: Ayuda con contraseñas ─────────────────────────
//
// ⚠️ REGLA CRÍTICA DE SEGURIDAD:
//    Las contraseñas de los gestores y navegadores NUNCA pasan
//    por este proceso. Solo detectamos presencia de aplicaciones.
//
//    La única contraseña que maneja este módulo es la que el usuario
//    elige para cifrar su propio archivo exportado. Esa contraseña
//    se usa y se descarta — NUNCA se loggea ni se almacena.

// Detecta gestores de contraseñas instalados (sin leer ningún dato)
ipcMain.handle('detectar-gestores', async () => {
  try {
    const gestores = await credentialHelper.detectarGestores();
    return { exito: true, datos: gestores };
  } catch (error) {
    console.error('[Módulo 5] Error al detectar gestores:', sanitizarParaLog(error.message));
    return { exito: false, error: error.message };
  }
});

// ── MÓDULO 6: Partidas guardadas (juegos) ───────────────────
// Detección: solo lectura. Copia: solo tras confirmación en la UI.

ipcMain.handle('detectar-juegos-partidas', async (event) => {
  try {
    const cacheDir = path.join(app.getPath('userData'), 'cache');
    const datos = await gameSaveService.detectarTodo(
      (info) => {
        event.sender.send('progreso-deteccion-juegos', info);
      },
      { cacheDir }
    );
    return { exito: true, datos };
  } catch (error) {
    console.error('[Módulo 6] Error al detectar juegos:', sanitizarParaLog(error.message));
    return { exito: false, error: error.message };
  }
});

ipcMain.handle('verificar-ruta-partida', async (event, params) => {
  try {
    const { ruta } = validarEsquema(params, {
      ruta: { tipo: 'string', minLength: 1, maxLength: 500 }
    });
    const datos = await gameSaveService.verificarRutaPartida(ruta.trim());
    return { exito: true, datos };
  } catch (error) {
    console.error('[Módulo 6] Error al verificar ruta:', sanitizarParaLog(error.message));
    return { exito: false, error: error.message };
  }
});

ipcMain.handle('respaldar-partidas-confirmado', conRateLimit(
  conErrorHandlerEstandar(
    async (event, { items, destino }) => {
      return await gameSaveService.respaldarPartidas(
        items, destino,
        (actual, total, nombre) => event.sender.send('progreso-respaldo-partidas', { actual, total, nombre })
      );
    },
    {
      validacion: (event, params) => validarEsquema(params, {
        items:   { tipo: 'array',  minLength: 1, maxLength: 1000, itemType: 'object' },
        destino: { tipo: 'string', minLength: 1, maxLength: 500 }
      }),
      modulo: 'gameSaveService',
      operacion: 'respaldar-partidas-confirmado',
      timeout: 600000
    }
  ),
  3, 30000, 'respaldar-partidas'
));

// ── MÓDULO 7: Certificados Digitales ────────────────────────

ipcMain.handle('escanear-certificados', async () => {
  try {
    const certificados = await certificateHelper.listar();
    return { exito: true, datos: certificados };
  } catch (error) {
    console.error('[Módulo 7] Error al escanear certificados:', sanitizarParaLog(error.message));
    return { exito: false, error: error.message };
  }
});

ipcMain.handle('exportar-certificados-confirmado', conRateLimit(
  conErrorHandlerEstandar(
    async (event, { certificados, destino, password }) => {
      return await certificateHelper.exportar(
        certificados, destino, password,
        (actual, total, nombre) => event.sender.send('progreso-exportacion-certificados', { actual, total, nombre })
      );
    },
    {
      validacion: (event, params) => validarEsquema(params, {
        certificados: { tipo: 'array',  minLength: 1, maxLength: 500, itemType: 'object' },
        destino:      { tipo: 'string', minLength: 1, maxLength: 500 },
        password:     { tipo: 'string', opcional: true }
      }),
      modulo: 'certificateHelper',
      operacion: 'exportar-certificados-confirmado',
      timeout: 300000
    }
  ),
  3, 30000, 'exportar-certificados'
));

// Detecta navegadores con contraseñas guardadas (sin leer ningún dato)
ipcMain.handle('detectar-navegadores', async () => {
  try {
    const navegadores = await credentialHelper.detectarNavegadores();
    return { exito: true, datos: navegadores };
  } catch (error) {
    console.error('[Módulo 5] Error al detectar navegadores:', sanitizarParaLog(error.message));
    return { exito: false, error: error.message };
  }
});

// Cifra un archivo con AES-256-CBC.
// ⚠️ La contraseña pasa por IPC pero NUNCA se loggea.
// El log de error usa error.message, no el parámetro contrasena.
ipcMain.handle('cifrar-archivo', async (event, params) => {
  try {
    // contrasena se valida tipo/longitud pero nunca se loggea
    const { rutaOrigen, rutaDestino, contrasena } = validarEsquema(params, {
      rutaOrigen:  { tipo: 'string', minLength: 1, maxLength: 500 },
      rutaDestino: { tipo: 'string', minLength: 1, maxLength: 500 },
      contrasena:  { tipo: 'string', minLength: 1 }
    });
    await credentialHelper.cifrarArchivo(rutaOrigen, rutaDestino, contrasena);
    return { exito: true };
  } catch (error) {
    console.error('[Módulo 5] Error al cifrar archivo:', sanitizarParaLog(error.message));
    return { exito: false, error: error.message };
  }
});

// Diálogo para seleccionar un ARCHIVO (no una carpeta).
// Lo usamos en el Módulo 5 para seleccionar el archivo a cifrar.
ipcMain.handle('seleccionar-archivo', async (event, { filtros } = {}) => {
  try {
    if (!mainWindow) return { exito: false, razon: 'ventana-no-disponible' };
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
      title: 'Seleccionar archivo a cifrar',
      properties: ['openFile'],
      filters: filtros || [{ name: 'Todos los archivos', extensions: ['*'] }],
    });
    if (canceled || filePaths.length === 0) return { exito: false, razon: 'cancelado' };
    return { exito: true, ruta: filePaths[0] };
  } catch (error) {
    console.error('[Diálogo] Error al seleccionar archivo:', sanitizarParaLog(error.message));
    return { exito: false, razon: 'error', error: error.message };
  }
});

// ── UTILIDADES GENERALES ────────────────────────────────────

// Abrir una carpeta en el Explorador de Windows
ipcMain.handle('abrir-carpeta', async (event, { ruta }) => {
  if (!ruta || typeof ruta !== 'string') return;
  try {
    // Validar que la ruta existe y es un directorio estricto antes de abrir.
    // Previene la ejecución accidental de binarios (.exe, .bat) vía shell.openPath.
    const stat = await fsp.stat(ruta);
    if (stat.isDirectory()) {
      shell.openPath(ruta);
    }
  } catch (error) {
    console.error('[Seguridad] Error al abrir carpeta:', sanitizarParaLog(error.message));
  }
});

// Diálogo para seleccionar una carpeta de destino
ipcMain.handle('seleccionar-carpeta', async () => {
  try {
    if (!mainWindow) return { exito: false, razon: 'ventana-no-disponible' };
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
      title: 'Seleccionar carpeta de destino',
      properties: ['openDirectory']
    });
    if (canceled || filePaths.length === 0) return { exito: false, razon: 'cancelado' };
    return { exito: true, ruta: filePaths[0] };
  } catch (error) {
    console.error('[Diálogo] Error al seleccionar carpeta:', sanitizarParaLog(error.message));
    return { exito: false, razon: 'error', error: error.message };
  }
});