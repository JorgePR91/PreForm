// =============================================================
// main.js — Proceso Principal de Electron
// =============================================================
// Este archivo es el "cerebro" de la aplicación. Corre en Node.js
// y tiene acceso completo al sistema operativo. La UI (lo que ves)
// está separada en /renderer/ y se comunica con este archivo
// mediante mensajes IPC (como eventos, pero entre procesos).
// =============================================================

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');

// ── Importamos los módulos de funcionalidad ──────────────────
// Cada módulo está en su propio archivo para mantener el código organizado.
// Ahora mismo son stubs (vacíos), los iremos llenando sprint por sprint.
const programScanner   = require('./src/modules/programScanner');
const installerFinder  = require('./src/modules/installerFinder');
const junkCleaner      = require('./src/modules/junkCleaner');
const fileOrganizer    = require('./src/modules/fileOrganizer');
const credentialHelper = require('./src/modules/credentialHelper');

// ── Variable global para la ventana principal ────────────────
// La declaramos aquí para que no sea borrada por el recolector
// de basura de JavaScript (un bug clásico en Electron).
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

    // Opciones de seguridad y comunicación
    webPreferences: {
      // preload.js actúa como intermediario seguro entre main y renderer
      preload: path.join(__dirname, 'preload.js'),

      // SEGURIDAD: nunca pongas esto en true en producción
      nodeIntegration: false,

      // SEGURIDAD: aisla el contexto del renderer del de Node.js
      contextIsolation: true,
    }
  });

  // Cargamos el HTML de la interfaz
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // En modo desarrollo, abrimos las DevTools para depurar
  // (como F12 en el navegador)
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

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
// MANEJADORES IPC (Comunicación entre renderer y main)
// =============================================================
// La UI llama a window.electronAPI.algoHacer() (definido en preload.js)
// que envía un mensaje IPC aquí. Nosotros procesamos y respondemos.
//
// Patrón: ipcMain.handle('nombre-del-evento', async (event, datos) => {
//   // hacer algo con Node.js
//   return resultado;
// });
// =============================================================

// ── MÓDULO 1: Programas instalados ──────────────────────────

// El renderer pide la lista de programas → nosotros la obtenemos y devolvemos
ipcMain.handle('obtener-programas', async () => {
  try {
    const programas = await programScanner.obtenerTodos();
    return { exito: true, datos: programas };
  } catch (error) {
    // IMPORTANTE: registramos el error en consola, no en la UI
    console.error('[Módulo 1] Error al obtener programas:', error.message);
    return { exito: false, error: error.message };
  }
});

// El renderer pide exportar la lista en un formato determinado
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
    console.error('[Módulo 1] Error al exportar:', error.message);
    return { exito: false, error: error.message };
  }
});

// ── MÓDULO 2: Buscador de instaladores ──────────────────────

// Escanea una ruta y envía eventos de progreso en tiempo real.
// Usamos event.sender.send() para "empujar" datos al renderer
// mientras el escaneo está en curso, sin esperar a que termine.
ipcMain.handle('escanear-instaladores', async (event, { ruta }) => {
  try {
    const instaladores = await installerFinder.escanear(
      ruta,
      // Callback de progreso: se llama por cada carpeta escaneada
      (carpetaActual, totalEncontrados) => {
        // Enviamos el progreso al renderer (no bloqueante)
        event.sender.send('progreso-escaneo', {
          carpeta: carpetaActual,
          encontrados: totalEncontrados,
        });
      }
    );
    return { exito: true, datos: instaladores };
  } catch (error) {
    console.error('[Módulo 2] Error al escanear:', error.message);
    return { exito: false, error: error.message };
  }
});

// Copia los instaladores seleccionados al destino.
// También envía progreso en tiempo real.
ipcMain.handle('copiar-instaladores', async (event, { archivos, destino }) => {
  if (!archivos || archivos.length === 0) {
    return { exito: false, razon: 'lista-vacia' };
  }

  try {
    const resultado = await installerFinder.copiar(
      archivos,
      destino,
      (actual, total, nombre) => {
        event.sender.send('progreso-copia', { actual, total, nombre });
      }
    );
    return { exito: true, datos: resultado };
  } catch (error) {
    console.error('[Módulo 2] Error al copiar:', error.message);
    return { exito: false, error: error.message };
  }
});

// Calcula el hash SHA-256 de un archivo concreto bajo demanda.
// Es una operación lenta para archivos grandes, por eso es opcional.
ipcMain.handle('calcular-hash', async (event, { ruta }) => {
  try {
    const hash = await installerFinder.calcularHashArchivo(ruta);
    return { exito: true, hash };
  } catch (error) {
    console.error('[Módulo 2] Error al calcular hash:', error.message);
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
    console.error('[Módulo 3] Error al analizar basura:', error.message);
    return { exito: false, error: error.message };
  }
});

// El sufijo "confirmado" en el nombre del evento es intencional:
// nos recuerda que SOLO llegamos aquí después de una confirmación del usuario.
ipcMain.handle('eliminar-archivos-confirmado', async (event, { archivos }) => {
  // Doble verificación de seguridad: lista vacía = no hacemos nada
  if (!archivos || archivos.length === 0) {
    return { exito: false, razon: 'lista-vacia' };
  }

  try {
    const resultado = await junkCleaner.eliminar(
      archivos,
      // Progreso de eliminación: cuántos archivos van y cuál es el actual
      (actual, total, nombre) => {
        event.sender.send('progreso-eliminacion', { actual, total, nombre });
      }
    );
    return { exito: true, datos: resultado };
  } catch (error) {
    console.error('[Módulo 3] Error al eliminar:', error.message);
    return { exito: false, error: error.message };
  }
});

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
    console.error('[Módulo 4] Error al escanear:', error.message);
    return { exito: false, error: error.message };
  }
});

// El sufijo "confirmado" recuerda que SOLO llega aquí después
// de que el usuario aceptó el modal de confirmación en la UI.
ipcMain.handle('transferir-archivos-confirmado', async (event, { archivos, destino, modo, organizarPorTipo }) => {
  // Doble verificación de seguridad
  if (!archivos || archivos.length === 0) {
    return { exito: false, razon: 'lista-vacia' };
  }

  try {
    const resultado = await fileOrganizer.transferir(
      archivos,
      destino,
      modo,
      organizarPorTipo,
      // Progreso: archivo actual, total y nombre
      (actual, total, nombre) => {
        event.sender.send('progreso-transferencia', { actual, total, nombre });
      }
    );
    return { exito: true, datos: resultado };
  } catch (error) {
    console.error('[Módulo 4] Error al transferir:', error.message);
    return { exito: false, error: error.message };
  }
});

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
    console.error('[Módulo 5] Error al detectar gestores:', error.message);
    return { exito: false, error: error.message };
  }
});

// Detecta navegadores con contraseñas guardadas (sin leer ningún dato)
ipcMain.handle('detectar-navegadores', async () => {
  try {
    const navegadores = await credentialHelper.detectarNavegadores();
    return { exito: true, datos: navegadores };
  } catch (error) {
    console.error('[Módulo 5] Error al detectar navegadores:', error.message);
    return { exito: false, error: error.message };
  }
});

// Cifra un archivo con AES-256-CBC.
// ⚠️ La contraseña pasa por IPC pero NUNCA se loggea.
// El log de error usa error.message, no el parámetro contrasena.
ipcMain.handle('cifrar-archivo', async (event, { rutaOrigen, rutaDestino, contrasena }) => {
  // Verificación de seguridad: nunca loggeamos 'contrasena'
  if (!rutaOrigen || !rutaDestino || !contrasena) {
    return { exito: false, error: 'Faltan parámetros para el cifrado.' };
  }

  try {
    await credentialHelper.cifrarArchivo(rutaOrigen, rutaDestino, contrasena);
    return { exito: true };
  } catch (error) {
    // Solo loggeamos el mensaje de error, nunca la contraseña
    console.error('[Módulo 5] Error al cifrar archivo:', error.message);
    return { exito: false, error: error.message };
  }
});

// Diálogo para seleccionar un ARCHIVO (no una carpeta).
// Lo usamos en el Módulo 5 para seleccionar el archivo a cifrar.
ipcMain.handle('seleccionar-archivo', async (event, { filtros }) => {
  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
    title: 'Seleccionar archivo a cifrar',
    properties: ['openFile'],
    // filtros permite restringir los tipos de archivo visibles en el diálogo,
    // ej: [{ name: 'CSV', extensions: ['csv'] }]
    filters: filtros || [{ name: 'Todos los archivos', extensions: ['*'] }],
  });

  if (canceled || filePaths.length === 0) return null;
  return filePaths[0];
});

// ── UTILIDADES GENERALES ────────────────────────────────────

// Abrir una carpeta en el Explorador de Windows
ipcMain.handle('abrir-carpeta', async (event, { ruta }) => {
  shell.openPath(ruta);
});

// Diálogo para seleccionar una carpeta de destino
ipcMain.handle('seleccionar-carpeta', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
    title: 'Seleccionar carpeta de destino',
    properties: ['openDirectory']
  });

  if (canceled || filePaths.length === 0) return null;
  return filePaths[0];
});