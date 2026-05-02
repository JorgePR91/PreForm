// =============================================================
// preload.js — Puente Seguro entre Main y Renderer
// =============================================================
// Este archivo es el intermediario de seguridad de Electron.
//
// PROBLEMA que resuelve:
//   - La UI (renderer) no puede usar Node.js directamente (sería inseguro).
//   - El proceso main tiene Node.js pero no puede tocar el DOM (la pantalla).
//
// SOLUCIÓN:
//   - preload.js corre en un contexto especial que tiene acceso a ambos.
//   - Expone SOLO las funciones que queremos que la UI pueda llamar.
//   - La UI llama window.electronAPI.funcionX() → llega aquí → va al main.
//
// =============================================================
// NOTA PARA EL ESTUDIANTE:
// Si en algún módulo necesitas una función nueva:
//   1. Agrega el handler en main.js con ipcMain.handle('nombre', ...)
//   2. Expónla aquí en contextBridge con el mismo nombre de evento
//   3. Úsala en renderer.js con window.electronAPI.nuevaFuncion()
// =============================================================
//
// =============================================================

// contextBridge — API segura: solo expone lo que listamos; no inyecta require en la página.
// ipcRenderer — envía mensajes al proceso main (invoke con respuesta, on para eventos push).
const { contextBridge, ipcRenderer } = require('electron');

// exposeInMainWorld('electronAPI', objeto) — define window.electronAPI en el renderer
// sin desactivar contextIsolation (el objeto es un proxy a IPC, no Node).
contextBridge.exposeInMainWorld('electronAPI', {

  // ── MÓDULO 1: Programas instalados ────────────────────────
  // Canal 'obtener-programas' → Promise<{ exito, datos?|error? }>
  obtenerProgramas: () =>
    ipcRenderer.invoke('obtener-programas'),
 
  // Canal 'exportar-programas' — payload { formato: 'json'|'csv'|'pdf', datos: array programas }
  exportarProgramas: (formato, datos) =>
    ipcRenderer.invoke('exportar-programas', { formato, datos }),

  // Abre diálogo abrir archivo; devuelve { exito, datos?, ruta?, error?, razon? }
  importarJsonProgramas: () =>
    ipcRenderer.invoke('importar-json-programas'),

  // Compara lista importada con escaneo actual del registro.
  compararProgramasRecuperacion: (listaAntigua) =>
    ipcRenderer.invoke('comparar-programas-recuperacion', { listaAntigua }),
 
  // ── MÓDULO 2: Buscador de instaladores ────────────────────
  // Durante escaneo el main emite 'progreso-escaneo' { carpeta, encontrados }.
  escanearInstaladores: (ruta) =>
    ipcRenderer.invoke('escanear-instaladores', { ruta }),
 
  copiarInstaladores: (archivos, destino) =>
    ipcRenderer.invoke('copiar-instaladores', { archivos, destino }),
 
  calcularHash: (ruta) =>
    ipcRenderer.invoke('calcular-hash', { ruta }),
 
  // Eventos de progreso: el main los "empuja" mientras trabaja.
  // El renderer registra un callback con onProgresoXxx() y lo
  // limpia con quitarListeners() cuando ya no lo necesita.
  //
  // DIFERENCIA con invoke/handle:
  //   invoke/handle → el renderer pregunta y el main responde (una vez)
  //   on/send       → el main avisa al renderer cuando quiere (muchas veces)
  onProgresoEscaneo: (callback) => {
    ipcRenderer.removeAllListeners('progreso-escaneo');
    ipcRenderer.on('progreso-escaneo', (event, datos) => callback(datos));
  },

  onProgresoCopia: (callback) => {
    ipcRenderer.removeAllListeners('progreso-copia');
    ipcRenderer.on('progreso-copia', (event, datos) => callback(datos));
  },
 
  // Limpia los listeners de progreso para evitar acumulación de callbacks
  // si el usuario escanea más de una vez en la misma sesión.
  quitarListenersProgreso: () => {
    ipcRenderer.removeAllListeners('progreso-escaneo');
    ipcRenderer.removeAllListeners('progreso-copia');
  },
 
   // ── MÓDULO 3: Limpieza de basura ──────────────────────────
   analizarBasura: () =>
    ipcRenderer.invoke('analizar-basura'),
 
  // ⚠️ El sufijo "Confirmado" es intencional: recuerda que esta
  // función solo debe llamarse tras confirmación explícita del usuario.
  eliminarArchivosConfirmado: (archivos) =>
    ipcRenderer.invoke('eliminar-archivos-confirmado', { archivos }),
 
  // Progreso del análisis: el main avisa qué categoría está leyendo ahora
  onProgresoAnalisisBasura: (callback) => {
    ipcRenderer.removeAllListeners('progreso-analisis-basura');
    ipcRenderer.on('progreso-analisis-basura', (event, datos) => callback(datos));
  },

  onProgresoEliminacion: (callback) => {
    ipcRenderer.removeAllListeners('progreso-eliminacion');
    ipcRenderer.on('progreso-eliminacion', (event, datos) => callback(datos));
  },
 
  // Limpia los listeners del módulo 3 (mismo patrón que en módulo 2)
  quitarListenersBasura: () => {
    ipcRenderer.removeAllListeners('progreso-analisis-basura');
    ipcRenderer.removeAllListeners('progreso-eliminacion');
  },
 
  // ── MÓDULO 4: Reorganizador de archivos ───────────────────
  escanearPersonales: () =>
    ipcRenderer.invoke('escanear-personales'),
 
  // El sufijo "Confirmado" recuerda que solo se llama tras confirmación del usuario.
  // modo: 'copiar' | 'mover'
  // organizarPorTipo: boolean — si true, crea subcarpetas por tipo (Imágenes/, Vídeos/, etc.)
  transferirArchivosConfirmado: (archivos, destino, modo, organizarPorTipo) =>
    ipcRenderer.invoke('transferir-archivos-confirmado', { archivos, destino, modo, organizarPorTipo }),
 
  // Progreso del escaneo: el main avisa qué carpeta personal está leyendo
  onProgresoEscaneoPersonales: (callback) => {
    ipcRenderer.removeAllListeners('progreso-escaneo-personales');
    ipcRenderer.on('progreso-escaneo-personales', (event, datos) => callback(datos));
  },

  onProgresoTransferencia: (callback) => {
    ipcRenderer.removeAllListeners('progreso-transferencia');
    ipcRenderer.on('progreso-transferencia', (event, datos) => callback(datos));
  },
 
  // Limpia los listeners del módulo 4
  quitarListenersPersonales: () => {
    ipcRenderer.removeAllListeners('progreso-escaneo-personales');
    ipcRenderer.removeAllListeners('progreso-transferencia');
  },
 
  // ── MÓDULO 5: Ayuda con contraseñas ───────────────────────
  // Solo detecta presencia de apps — nunca lee datos sensibles
  detectarGestores: () =>
    ipcRenderer.invoke('detectar-gestores'),
 
  detectarNavegadores: () =>
    ipcRenderer.invoke('detectar-navegadores'),

  // ── MÓDULO 6: Partidas guardadas (juegos) ───────────────────
  detectarJuegosPartidas: () =>
    ipcRenderer.invoke('detectar-juegos-partidas'),

  verificarRutaPartida: (ruta) =>
    ipcRenderer.invoke('verificar-ruta-partida', { ruta }),

  onProgresoDeteccionJuegos: (callback) => {
    ipcRenderer.removeAllListeners('progreso-deteccion-juegos');
    ipcRenderer.on('progreso-deteccion-juegos', (event, datos) => callback(datos));
  },

  respaldarPartidasConfirmado: (items, destino) =>
    ipcRenderer.invoke('respaldar-partidas-confirmado', { items, destino }),

  onProgresoRespaldoPartidas: (callback) => {
    ipcRenderer.removeAllListeners('progreso-respaldo-partidas');
    ipcRenderer.on('progreso-respaldo-partidas', (event, datos) => callback(datos));
  },

  quitarListenersPartidas: () => {
    ipcRenderer.removeAllListeners('progreso-deteccion-juegos');
    ipcRenderer.removeAllListeners('progreso-respaldo-partidas');
  },
 
  // ── MÓDULO 7: Certificados Digitales ──────────────────────
  escanearCertificados: () =>
    ipcRenderer.invoke('escanear-certificados'),

  exportarCertificadosConfirmado: (certificados, destino, password) =>
    ipcRenderer.invoke('exportar-certificados-confirmado', { certificados, destino, password }),

  onProgresoExportacionCertificados: (callback) => {
    ipcRenderer.removeAllListeners('progreso-exportacion-certificados');
    ipcRenderer.on('progreso-exportacion-certificados', (event, datos) => callback(datos));
  },

  quitarListenersCertificados: () =>
    ipcRenderer.removeAllListeners('progreso-exportacion-certificados'),

  // Cifra un archivo con AES-256.
  // ⚠️ La contraseña se pasa en memoria dentro de la misma máquina.
  //    Es seguro en Electron con contextIsolation porque no sale por red.
  //    NUNCA la almacenes ni la loggees en el renderer.
  cifrarArchivo: (rutaOrigen, rutaDestino, contrasena) =>
    ipcRenderer.invoke('cifrar-archivo', { rutaOrigen, rutaDestino, contrasena }),
 
  // Diálogo para seleccionar un archivo (distinto de seleccionarCarpeta)
  // filtros: array de { name, extensions } para filtrar tipos de archivo
  seleccionarArchivo: (filtros) =>
    ipcRenderer.invoke('seleccionar-archivo', { filtros }),
 
  // ── UTILIDADES GENERALES ──────────────────────────────────
  abrirCarpeta: (ruta) =>
    ipcRenderer.invoke('abrir-carpeta', { ruta }),
 
  seleccionarCarpeta: () =>
    ipcRenderer.invoke('seleccionar-carpeta'),
});
