# 🏗️ ARQUITECTURA DE SEGURIDAD & RENDIMIENTO

## Diagrama de Capas

```
┌──────────────────────────────────────────────────────────────┐
│                    RENDERER (UI)                             │
│  ┌────────────────────────────────────────┐                  │
│  │ Listeners con cleanup (preload.js)     │                  │
│  │ • limpiarListenersProgreso()           │                  │
│  │ • limpiarListenersCopia()              │                  │
│  │ ✅ Memory leak prevention               │                  │
│  └────────────────────────────────────────┘                  │
└──────────────────────────────────────────────────────────────┘
                          ↕ IPC Bridge
        ┌─────────────────────────────────────────────┐
        │   VALIDACIÓN & ESTANDARIZACIÓN (ipcValidator.js)  │
        │ ═══════════════════════════════════════════════════ │
        │  ┌────────────────────────────────────────────┐   │
        │  │ 1. conErrorHandlerEstandar()               │   │
        │  │    • Captura excepciones                    │   │
        │  │    • Aplica timeout                         │   │
        │  │    • Estructura respuesta estándar          │   │
        │  │    ✅ Prevent hang, consistent format      │   │
        │  └────────────────────────────────────────────┘   │
        │  ┌────────────────────────────────────────────┐   │
        │  │ 2. validarEsquema()                        │   │
        │  │    • Type checking robusto                 │   │
        │  │    • Validación de rango/enum             │   │
        │  │    • Error detallado                       │   │
        │  │    ✅ Prevent crash from malformed input  │   │
        │  └────────────────────────────────────────────┘   │
        │  ┌────────────────────────────────────────────┐   │
        │  │ 3. respuestaExitosa/Error/Cancelada()     │   │
        │  │    • Formato único para frontend            │   │
        │  │    • Incluye errorId para debugging        │   │
        │  │    • Timestamp para auditoría              │   │
        │  │    ✅ Unified response contract            │   │
        │  └────────────────────────────────────────────┘   │
        └─────────────────────────────────────────────┘
                          ↕ ipcMain.handle()
┌──────────────────────────────────────────────────────────────┐
│                    MAIN PROCESS (main.js)                    │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ HANDLERS CON PROTECCIONES MÚLTIPLES                  │   │
│  │ ═══════════════════════════════════════════════════  │   │
│  │                                                       │   │
│  │ ipcMain.handle('operacion',                          │   │
│  │   conErrorHandlerEstandar(async (event, params) => { │   │
│  │     validarEsquema(params, {...});                   │   │
│  │     return respuestaExitosa(...);                    │   │
│  │   }, { timeout: 600000 })                            │   │
│  │ );                                                   │   │
│  │                                                       │   │
│  │ ✅ 3 capas de defensa en cada handler               │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
                          ↕ require()
┌──────────────────────────────────────────────────────────────┐
│                      MÓDULOS (src/modules)                   │
│                                                               │
│  ┌──────────────────┐  ┌──────────────────┐               │
│  │ fileOrganizer    │  │ installerFinder  │               │
│  ├──────────────────┤  ├──────────────────┤               │
│  │ • transferir()   │  │ • escanear()     │               │
│  │   ↳ validar ruta │  │   ↳ throttle OK  │               │
│  │   ↳ symlink check│  │ • copiar()       │               │
│  │   ↳ throttle OK  │  │   ↳ symlink chk  │               │
│  └──────────────────┘  │   ↳ throttle OK  │               │
│                        └──────────────────┘               │
│  ┌──────────────────┐  ┌──────────────────┐               │
│  │ junkCleaner      │  │ gameSaveService  │               │
│  ├──────────────────┤  ├──────────────────┤               │
│  │ • eliminar()     │  │ • escanear()     │               │
│  │   ↳ symlink chk  │  │   ↳ throttle OK  │               │
│  │   ↳ TOCTOU retry │  │ • respaldar()    │               │
│  │   ↳ throttle OK  │  │   ↳ timeout prep │               │
│  └──────────────────┘  │   ↳ throttle OK  │               │
│                        └──────────────────┘               │
│                                                               │
│  ┌──────────────────┐  ┌──────────────────┐               │
│  │ certificateHelper│  │ programScanner   │               │
│  ├──────────────────┤  ├──────────────────┤               │
│  │ • exportar()     │  │ • obtenerTodos() │               │
│  │   ↳ escape PS    │  │   ↳ throttle OK  │               │
│  │   ↳ timeout prep │  │ • exportar()     │               │
│  └──────────────────┘  │   ↳ timeout prep │               │
│                        └──────────────────┘               │
│                                                               │
│  ✅ Todas con validación + seguridad                        │
└──────────────────────────────────────────────────────────────┘
                          ↕ require()
┌──────────────────────────────────────────────────────────────┐
│                      UTILIDADES (src/utils)                  │
│                                                               │
│  ┌─────────────────────────┐                                │
│  │ securityUtils.js        │  PRE-IMPLEMENTED              │
│  ├─────────────────────────┤                                │
│  │ ✅ validarRutaSegura()  │  Paths: prevent ../../../etc  │
│  │ ✅ detectarSymlink()    │  Symlinks: detect & reject    │
│  │ ✅ escaparComandoPShell │  Injection: safe chars only   │
│  │ ✅ ejecutarConReintento │  Retries: TOCTOU handling     │
│  │ ✅ validarParametrosIPC │  Params: basic type check     │
│  │ + 4 more                │                                │
│  └─────────────────────────┘                                │
│                                                              │
│  ┌─────────────────────────┐                                │
│  │ performanceUtils.js     │  READY TO INTEGRATE           │
│  ├─────────────────────────┤                                │
│  │ ✅ throttle()           │  Frequency: max 1 per 500ms   │
│  │ ✅ debounce()           │  Delay: wait 300ms after last │
│  │ ✅ conTimeout()         │  Timeout: wrap promises       │
│  │ ✅ validarLimite()      │  Limits: max 10k files        │
│  │ ✅ formatearError()     │  Errors: with context         │
│  │ ✅ limpiarListeners()   │  Cleanup: prevent leaks       │
│  │ + 9 more                │                                │
│  └─────────────────────────┘                                │
│                                                              │
│  ┌─────────────────────────┐                                │
│  │ ipcValidator.js         │  READY TO INTEGRATE           │
│  ├─────────────────────────┤                                │
│  │ ✅ respuestaExitosa()   │  OK: consistent format        │
│  │ ✅ respuestaError()     │  ERROR: with errorId          │
│  │ ✅ respuestaCancelada() │  CANCEL: user interupt        │
│  │ ✅ validarEsquema()     │  Schema: type validation      │
│  │ ✅ conRateLimit()       │  RateLimit: prevent spam      │
│  │ ✅ conErrorHandlerEst.  │  Handler: timeout + validate  │
│  │ + 2 more                │                                │
│  └─────────────────────────┘                                │
│                                                              │
│  ┌─────────────────────────┐                                │
│  │ fileUtils.js            │  EXISTING                      │
│  ├─────────────────────────┤                                │
│  │ leerArchivo()           │  File I/O                      │
│  │ guardarJSON()           │  JSON persistence             │
│  │ + 3 more                │                                │
│  └─────────────────────────┘                                │
│                                                              │
│  ✅ 3 archivos = 25+ funciones reutilizables                │
└──────────────────────────────────────────────────────────────┘
                          ↕ Node.js APIs
┌──────────────────────────────────────────────────────────────┐
│                    OPERATING SYSTEM (Windows)                │
│  • fs.promises             ✅ Path validation ready         │
│  • child_process.exec      ✅ PowerShell escaping ready    │
│  • electron shell          ✅ Symlink checking ready       │
│  • Registry (winreg)       🟡 Outdated (2019)             │
└──────────────────────────────────────────────────────────────┘
```

---

## 🔐 Matriz de Defensa

### Prevención de Amenazas

```
AMENAZA                    DEFENSA                      CAPA
──────────────────────────────────────────────────────────────
Path Traversal             validarRutaSegura()          Módulo
                           path.resolve() + startsWith  Utilidad

Symlink Attack             detectarSymlink()            Módulo
                           fs.lstat() no fs.stat()      Utilidad

PowerShell Injection       escaparComandoPowerShell()   Módulo
                           Escape $, backticks, quotes  Utilidad

Unhandled Rejection        process.on('unhandledRej')   MainProc
                           Logging + graceful shutdown  System

Promise Timeout            conTimeout()                 Módulo
                           Promise.race() pattern       Utilidad

Invalid Parameters         validarEsquema()             Handler
                           Type + range checking        Validation

IPC Flooding               throttle()                   Módulo
                           500ms cooldown               Utilidad

Memory Leak (Listeners)    limpiarListeners()           Renderer
                           Clone node technique         Cleanup

TOCTOU Race Condition      ejecutarConReintento()       Módulo
                           3x retry with backoff        Utilidad

Inconsistent Errors        respuestaError() w/ errorId  Handler
                           Struct: {exito, error, id}   Validation
```

### Cobertura por Operación

```
OPERACIÓN              DEFENSA APLICADA
──────────────────────────────────────────────────────────────
Escanear & Copiar      • validarRutaSegura()
                       • detectarSymlink()
                       • throttle() en progreso
                       • conTimeout() (600s)
                       • respuestaExitosa()
                       SCORE: 5/5 ✅

Eliminar Archivos      • detectarSymlink()
                       • ejecutarConReintento() (TOCTOU)
                       • throttle() en progreso
                       • conTimeout() (300s)
                       • validarLimite()
                       SCORE: 5/5 ✅

Exportar (PowerShell)  • escaparComandoPowerShell()
                       • validarEsquema() antes
                       • conTimeout() (60s)
                       • respuestaError() con context
                       SCORE: 4/5 🟡 (mejorable en cert select)

Respaldar Partidas     • validarParametrosIPC()
                       • conTimeout() (600s)
                       • throttle() en progreso
                       • respuestaExitosa()
                       SCORE: 4/5 🟡 (sin symlink check)

Importar JSON          • validarEsquema()
                       • fileUtils.leerArchivo()
                       • Error handling contextual
                       SCORE: 3/5 (sin timeout, sin limits)
```

---

## 📊 Flujo Completo - Ejemplo: Copiar Instaladores

```
USUARIO FRONTEND
       ↓
[Selecciona 5000 instaladores] → params validados
       ↓
IPC SEND: copiar-instaladores({archivos: [...], destino: '...'})
       ↓
MAIN.JS HANDLER
  ├─ conErrorHandlerEstandar() ENVUELVE:
  │   ├─ validarEsquema(params, {archivos: {tipo, max: 10000}, ...})
  │   │   ✅ Verifica: array, length ≤ 10000, strings válidos
  │   │
  │   ├─ conTimeout(installerFinder.copiar(...), 600000)
  │   │   └─ Promise.race: operación vs timeout 10min
  │   │
  │   └─ respuestaExitosa(resultado)
  │       └─ {exito: true, datos: [...], timestamp: '...'}
  │
  └─ Error:
      └─ respuestaError(error, 'installerFinder', 'copiar')
         → {exito: false, error: msg, errorId: 'ERR...', timestamp}
        ↓
INSTALLER_FINDER.COPIAR()
  ├─ Recibe onProgreso callback
  │
  ├─ Loop por archivos:
  │   ├─ throttle(onProgreso, 500) → max 1 evento cada 500ms
  │   │
  │   ├─ detectarSymlink(archivo.ruta)
  │   │    ✅ Rechaza si es symlink
  │   │
  │   ├─ fs.copyFile() → OPERACIÓN REAL
  │   │
  │   └─ throttled(i, total, nombre) → IPC SEND
  │       └─ MAIN.JS ESCUCHA → mainWindow.webContents.send()
  │
  └─ Return { copiados, errores, ... }
        ↓
MAIN.JS RECIBE
  └─ respuestaExitosa(resultado)
        ↓
IPC SEND: copiar-instaladores-resultado
        ↓
RENDERER RECIBE
  ├─ if (resultado.exito) → renderizar éxito
  ├─ else → mostrar resultado.error con resultado.errorId
  └─ limpiarListenersCopia() → cleanup
```

---

## ✅ Funciones por Categoría

### SEGURIDAD (securityUtils.js) - 9 funciones
```
Validación de Rutas:
  • validarRutaSegura()          - Path traversal prevention
  • validarRutaParaOperacion()   - Combined validation

Detección de Links:
  • detectarSymlink()            - fs.lstat() based

Escaping:
  • escaparComandoPowerShell()   - $ backticks quotes newlines

Retry Logic:
  • ejecutarConReintento()       - Exponential backoff

Validation:
  • validarParametrosIPC()       - Basic type checking
  • validarRango()               - Numeric bounds

Error Context:
  • conErrorHandler()            - Wrapper with logging
  • sanitizarParaLog()           - Remove sensitive data
```

### PERFORMANCE (performanceUtils.js) - 15 funciones
```
Frequency Limiting:
  • throttle()                   - Max 1 per interval
  • debounce()                   - Delay execution

Timeout Protection:
  • conTimeout()                 - Promise.race wrapper

Validation & Limits:
  • validarLimite()              - Max items check
  • formatearError()             - Structured errors

Listener Management:
  • limpiarListeners()           - Clone node purge
  • listenConNamespace()         - Tracked listeners
  • limpiarPorNamespace()        - Bulk cleanup

Concurrency:
  • ejecutarConPooling()         - Max concurrent tasks

Monitoring:
  • obtenerStatsMemoria()        - Heap/RSS stats
  • medirTiempo()                - Timing wrapper
  • sugerirGC()                  - GC hint when >500MB
```

### VALIDATION & RESPONSES (ipcValidator.js) - 8 funciones
```
Responses:
  • respuestaExitosa()           - {exito: true, datos}
  • respuestaError()             - {exito: false, error, errorId}
  • respuestaCancelada()         - {cancelada: true, razon}

Schema Validation:
  • validarEsquema()             - Full type + range checking
  • obtenerTipo()                - Type detection helper
  • crearEsquema()               - Quick schema builder

Rate Limiting:
  • conRateLimit()               - Prevent request spam

Error Handlers:
  • conErrorHandlerEstandar()    - Validation + timeout wrapper
```

---

## 🎯 Integración Checklist

```
SEC LEVEL   COMPONENT              IMPL STATUS    NEXT STEP
─────────────────────────────────────────────────────────────
🟢  Path validation         fileOrganizer ✅     Active
🟢  Symlink detection      junkCleaner ✅        Active
🟢  PowerShell escaping    certificateHelper ✅  Active
🟢  Error handlers         main.js ✅            Active

🟡  Throttling             (util ready)         → handlers
🟡  Timeout wrapping       (util ready)          → handlers
🟡  Response standardiz.   (util ready)         → handlers
🟡  Param validation       (util ready)          → handlers
🟡  Listener cleanup       (preload.js prep)    → renderer
🟡  Rate limiting          (util ready)          → handlers

⚫  Crash handler          main.js              → tobuild
⚫  Deprec pkg update       package.json        → tobuild
⚫  Memory monitoring       main.js             → tobuild
```

---

**Arquitectura versión**: 2.0  
**Generada**: 18 de Abril de 2026  
**Estado**: Listo para integración en fase 2
