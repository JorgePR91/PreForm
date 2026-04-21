# 📋 CHECKLIST PARA COMPLETAR PROBLEMAS ALTO

## ✅ YA HECHO (Hoy)

- ✅ securityUtils.js (9 funciones)
- ✅ performanceUtils.js (15 funciones)
- ✅ ipcValidator.js (8 funciones)
- ✅ main.js actualizado con imports
- ✅ Global error handlers en main.js

---

## 🔄 POR HACER (Orden de Prioridad)

### PRIORIDAD 1: Actualizar Handlers IPC (2-3 horas)

**Archivos**: main.js

**Qué hacer**: Convertir todos los handlers de este patrón:
```javascript
// VIEJO:
ipcMain.handle('copiar-instaladores', async (event, { archivos, destino }) => {
  if (!Array.isArray(archivos)) return { exito: false, error: 'Invalid' };
  try {
    const r = await installerFinder.copiar(archivos, destino, cb);
    return { exito: true, datos: r };
  } catch (e) {
    return { exito: false, error: e.message };
  }
});
```

**A este patrón**:
```javascript
// NUEVO:
ipcMain.handle('copiar-instaladores',
  conErrorHandlerEstandar(
    async (event, { archivos, destino }) => {
      // Validar parámetros
      validarEsquema({ archivos, destino }, {
        archivos: { tipo: 'array', minLength: 1, maxLength: 10000 },
        destino: { tipo: 'string', minLength: 1 }
      });
      
      // Ejecutar con timeout
      const resultado = await conTimeout(
        installerFinder.copiar(
          archivos,
          destino,
          throttle((a, t, n) => event.sender.send('progreso-copia', { a, t, n }), 500)
        ),
        600000,
        'Copia de instaladores'
      );
      
      return respuestaExitosa(resultado);
    },
    {
      modulo: 'installerFinder',
      operacion: 'copiar',
      timeout: 600000
    }
  )
);
```

**Handlers a actualizar** (~20):
1. obtener-programas ← No necesita validación (sin params)
2. exportar-programas ← Poco crítico
3. importar-json-programas ← Crítico (lee archivo 50MB)
4. comparar-programas-recuperacion ← Importante
5. **escanear-instaladores** ← CRÍTICO (largo)
6. **copiar-instaladores** ← CRÍTICO (validar cantidad)
7. calcular-hash ← Median (largo)
8. **analizar-basura** ← CRÍTICO
9. **eliminar-archivos-confirmado** ← CRÍTICO
10. escanear-personales ← CRÍTICO
11. transferir-archivos-confirmado ← CRÍTICO (validar ruta)
12. detectar-gestores ← No necesita
13. cifrar-archivo ← Importante
14. seleccionar-archivo ← No necesita
15. detectar-juegos-partidas ← Largo
16. verificar-ruta-partida ← Validación
17. respaldar-partidas-confirmado ← Largo
18. escanear-certificados ← Long operation
19. exportar-certificados-confirmado ← Validación

**Marked as CRÍTICO** = Operaciones >10s or with input validation

---

### PRIORIDAD 2: Performance en Módulos (1 hora)

**Archivos**: 
- src/modules/fileOrganizer.js
- src/modules/installerFinder.js
- src/modules/junkCleaner.js
- src/modules/gameSaveService.js

**Qué hacer**: Agregar `throttle` en callbacks

```javascript
// ANTES:
async function copiar(archivos, destino, onProgreso) {
  for (let i = 0; i < archivos.length; i++) {
    if (onProgreso) onProgreso(i + 1, archivos.length, archivo.nombre);  // 100k calls!
    await fs.copyFile(...);
  }
}

// DESPUÉS:
const { throttle } = require('../utils/performanceUtils');

async function copiar(archivos, destino, onProgreso) {
  const onProgresoThrottled = onProgreso ? throttle(onProgreso, 500, 1000) : null;
  
  for (let i = 0; i < archivos.length; i++) {
    if (onProgresoThrottled) onProgresoThrottled(i + 1, archivos.length, archivo.nombre);
    await fs.copyFile(...);
  }
}
```

**Funciones a actualizar**:
1. fileOrganizer.transferir() ← Manifesto 100k archivos
2. installerFinder.copiar() ← Puede ser 10k archivos
3. junkCleaner.eliminar() ← Miles de archivos temporales
4. installerFinder.escanear() ← Ya tiene callback, agregar throttle

---

### PRIORIDAD 3: Cleanup de Listeners en Renderer (1.5 horas)

**Archivos**: 
- renderer.js
- preload.js (agregar métodos cleanup)

**Qué hacer**: Prevenir memory leak

```javascript
// EN PRELOAD.JS - Agregar métodos cleanup:
contextBridge.exposeInMainWorld('electronAPI', {
  // ... métodos existentes ...
  
  // Cleanup
  limpiarListenersProgreso: () => ipcRenderer.removeAllListeners('progreso-escaneo'),
  limpiarListenersCopia: () => ipcRenderer.removeAllListeners('progreso-copia'),
  limpiarListenersProgProgramas: () => ipcRenderer.removeAllListeners('progreso-escaneo-personales'),
  // ... etc para cada tipo de progreso
});

// EN RENDERER.JS - Uso:
async function escanearInstaladores(ruta) {
  // Limpiar listeners previos
  window.electronAPI.limpiarListenersCopia?.();
  
  // Registrar listeners nuevos
  window.electronAPI.onProgresoEscaneador((datos) => {
    actualizarUI(datos);
  });
  
  // Ejecutar
  const resultado = await window.electronAPI.escanearInstaladores(ruta);
  
  // Limpiar después
  window.electronAPI.limpiarListenersCopia?.();
  
  return resultado;
}
```

**Listeners a limpiar**:
1. progreso-escaneo
2. progreso-copia
3. progreso-analisis-basura
4. progreso-eliminacion
5. progreso-escaneo-personales
6. progreso-transferencia
7. progreso-deteccion-juegos
8. progreso-respaldo-partidas
9. progreso-exportacion-certificados

---

### PRIORIDAD 4: Manejador de Crash Renderer (30 min)

**Archivo**: main.js

**Qué hacer**: Detectar si renderer se desmorona

```javascript
// En createWindow():
mainWindow.webContents.on('crashed', () => {
  console.error('[RENDERER CRASH] El renderer process falló');
  dialog.showErrorBox(
    'Error Crítico',
    'La interfaz de usuario se cerró inesperadamente. ' +
    'Por favor, reinicia la aplicación.'
  );
});

mainWindow.webContents.on('unresponsive', () => {
  console.warn('[UNRESPONSIVE] Renderer no responde por >30s');
  dialog.showMessageBox(mainWindow, {
    type: 'warning',
    message: 'La aplicación no responde',
    detail: 'La interfaz está procesando una operación pesada. Espera...'
  });
});
```

---

### PRIORIDAD 5: Actualizar Dependencias (1 hora)

**Archivo**: package.json

**Problema**: vdf (2015) y winreg (2019) están desactualizados

**Solución Opción A** - Actualizar:
```bash
npm uninstall vdf
npm install vdf@latest

npm uninstall winreg  
npm install winreg@latest
```

**Solución Opción B** - Reemplazar:
```bash
# vdf → usar parser custom o fallback regex
# winreg → considerar registry package más nuevo
```

**Recomendación**: Opción A (simple)

---

## 📊 RESUMEN PARA COMPLETAR

```
TAREA                          ARCHIVO           DURACIÓN  CRÍTICO
────────────────────────────────────────────────────────────────
Actualizar handlers (20)       main.js           2-3h      🔴
Agregar throttle (4 mod)       modules/*.js      1h        🟡
Cleanup listeners (render)     renderer.js       1.5h      🟡
Crash handler                  main.js           0.5h      🟡
Actualizar deps                package.json      1h        🟢
────────────────────────────────────────────────────────────────
TOTAL                                            ~7.5h     
```

---

## 🧪 VALIDACIÓN DESPUÉS DE COMPLETAR

```bash
# 1. Compilar
npm run dev

# 2. Ejecutar tests (si existen)
npm test

# 3. Auditar dependencias
npm audit

# 4. Check memory leaks (herramientas externas)
# Chrome DevTools → Performance → Memoria
```

---

## 📝 PLANTILLA PARA COPIAR/PEGAR

Usa esta plantilla para actualizar handlers rápidamente:

```javascript
ipcMain.handle('NOMBRE-HANDLER',
  conErrorHandlerEstandar(
    async (event, params) => {
      // VALIDAR PARÁMETROS (si hay)
      if (params) {
        validarEsquema(params, {
          param1: { tipo: 'string', minLength: 1 },
          param2: { tipo: 'array', minLength: 0, maxLength: 10000 }
        });
      }
      
      // EJECUTAR CON TIMEOUT (si es operación larga)
      const resultado = await conTimeout(
        miModulo.miMétodo(params, onProgreso),
        300000, // 5 minutos
        'Descripción de operación'
      );
      
      // RESPONDER ESTANDARIZADO
      return respuestaExitosa(resultado);
    },
    {
      modulo: 'nombreModulo',
      operacion: 'nombreOperacion',
      timeout: 300000  // Match with conTimeout
    }
  )
);
```

---

**Generado**: 18 de Abril de 2026  
**Estado**: Guía Completa para Implementación  
**Siguiente**: Ejecutar paso a paso
