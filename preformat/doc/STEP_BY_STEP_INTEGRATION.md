# 📝 MANUAL STEP-BY-STEP INTEGRATION GUIDE

## 🎯 OBJETIVO
Integrar las utilidades en 3 **handlers CRÍTICOS** primero, validar funcionamiento, luego continuar con los demás.

---

## FASE 1: HANDLERS CRÍTICOS (2 HORAS)

### HANDLER #1: `escanear-instaladores`
**Archivo**: main.js (encontrar con Ctrl+F)  
**Operación**: Escaneador de archivos large (puede tardar >5 minutos)  
**Problemas Actionales**:
- ❌ Sin timeout → puede colgar indefinidamente
- ❌ Sin throttle → 100k eventos IPC
- ❌ Parámetros sin validación → crash si faltan

---

#### PASO 1.1: Encontrar el Handler VIEJO

En `main.js`, buscar:
```javascript
ipcMain.handle('escanear-instaladores', async (event, { carpeta }) => {
  // ... código viejo
});
```

---

#### PASO 1.2: Copiar el Código Template

Aquí está el template para reemplazar:

```javascript
ipcMain.handle('escanear-instaladores',
  conErrorHandlerEstandar(
    async (event, { carpeta }) => {
      // PASO 1: VALIDAR PARÁMETROS
      validarEsquema({ carpeta }, {
        carpeta: { tipo: 'string', minLength: 1, maxLength: 500 }
      });

      // PASO 2: EJECUTAR CON TIMEOUT
      const resultado = await conTimeout(
        installerFinder.escanear(carpeta, (i, t, n) => {
          // PASO 3: THROTTLEAR PROGRESO
          // Sin throttle: 100000 llamadas
          // Con throttle: ~500 llamadas
          event.sender.send('progreso-escaneo-instaladores', { actual: i, total: t, nombre: n });
        }),
        600000, // 10 minutos (scans pueden ser lentos en discos grandes)
        'Escaneo de instaladores'
      );

      // PASO 4: RESPONDER CON FORMATO ESTÁNDAR
      return respuestaExitosa(resultado);
    },
    {
      modulo: 'installerFinder',
      operacion: 'escanear',
      timeout: 600000
    }
  )
);
```

---

#### PASO 1.3: IMPORTANTE - Añadir el Throttle en el Módulo

En `src/modules/installerFinder.js`, buscar la función `escanear()`:

```javascript
async function escanear(carpeta, onProgreso) {
  // ... más código ...
  
  // ANTES (sin throttle):
  if (onProgreso) {
    onProgreso(i, archivos.length, archivo.nombre);  // ← 100k llamadas
  }

  // DESPUÉS (con throttle):
  const { throttle } = require('../utils/performanceUtils');
  const onProgresoThrottled = onProgreso ? throttle(onProgreso, 500, 1000) : null;
  
  if (onProgresoThrottled) {
    onProgresoThrottled(i, archivos.length, archivo.nombre);  // ← ~500 llamadas
  }
}
```

**Nota**: El throttle necesita estar DENTRO de la función, no AFUERA, porque cada llamada debe resetear el contador.

---

#### PASO 1.4: Validar con npm run dev

```bash
cd e:\17. PRO_PROJ\preformat-scaffolding\preformat
npm run dev
```

Esperar que la aplicación abra sin errores en consola.

---

### HANDLER #2: `copiar-instaladores`
**Archivo**: main.js  
**Operación**: Copiar múltiples archivos  
**Problemas Actionales**:
- ❌ Sin validar cantidad → usuario puede seleccionar 1M de archivos
- ❌ Sin timeout → puede colgar
- ❌ Parámetros sin validar

---

#### PASO 2.1: Encontrar el Handler VIEJO

Buscar en main.js:
```javascript
ipcMain.handle('copiar-instaladores', async (event, { archivos, destino }) => {
  // ... código viejo
});
```

---

#### PASO 2.2: Corregir Primero en installerFinder.js

Antes de tocar el handler, revisar el módulo tiene:
```javascript
const { detectarSymlink } = require('../utils/securityUtils');
const { throttle } = require('../utils/performanceUtils');

async function copiar(archivos, destino, onProgreso) {
  // ... validación y prep ...
  
  const onProgresoThrottled = onProgreso ? throttle(onProgreso, 500, 1000) : null;
  
  for (let i = 0; i < archivos.length; i++) {
    const archivo = archivos[i];
    
    // Verificar symlink antes de copiar
    const esSymlinkOrigen = await detectarSymlink(archivo.ruta);
    if (esSymlinkOrigen) {
      // Skip o reportar error
      continue;
    }
    
    if (onProgresoThrottled) {
      onProgresoThrottled(i + 1, archivos.length, archivo.nombre);
    }
    
    await fs.copyFile(...);
  }
  
  return { copiados: count, errores: errors };
}
```

---

#### PASO 2.3: Copiar Template para Handler

```javascript
ipcMain.handle('copiar-instaladores',
  conErrorHandlerEstandar(
    async (event, { archivos, destino }) => {
      // VALIDAR: archivos es array y no excede límite
      validarEsquema({ archivos, destino }, {
        archivos: {
          tipo: 'array',
          minLength: 1,
          maxLength: 10000 // ← Límite importante
        },
        destino: { tipo: 'string', minLength: 1 }
      });

      // EJECUTAR CON TIMEOUT
      const resultado = await conTimeout(
        installerFinder.copiar(
          archivos,
          destino,
          (actual, total, nombre) => {
            event.sender.send('progreso-copia-instaladores', {
              actual, total, nombre
            });
          }
        ),
        600000, // 10 minutos
        'Copia de instaladores'
      );

      return respuestaExitosa({
        copiados: resultado.copiados,
        errores: resultado.errores
      });
    },
    {
      modulo: 'installerFinder',
      operacion: 'copiar',
      timeout: 600000
    }
  )
);
```

---

#### PASO 2.4: Importante - En el Renderer

Cuando el usuario selecciona archivos, validar:

```javascript
// En renderer.js, cuando usuario hace click en "Copiar"
const archivosSeleccionados = [...obtener lista seleccionada...];

if (archivosSeleccionados.length > 10000) {
  mostrarError(`Máximo 10,000 archivos. Seleccionaste ${archivosSeleccionados.length}`);
  return;
}

const resultado = await window.electronAPI.copiarInstaladores({
  archivos: archivosSeleccionados,
  destino: destino
});
```

---

### HANDLER #3: `eliminar-archivos-confirmado`
**Archivo**: main.js  
**Operación**: Eliminar archivos (MÁS PELIGROSO)  
**Problemas Actionales**:
- ❌ Sin timeout
- ❌ Sin throttle
- ❌ Sin validar parámetros

---

#### PASO 3.1: Encontrar el Handler

Buscar:
```javascript
ipcMain.handle('eliminar-archivos-confirmado', async (event, { archivos }) => {
  // ... código viejo
});
```

---

#### PASO 3.2: Revisar junkCleaner.js

Verificar que tiene:
```javascript
const { detectarSymlink, ejecutarConReintento } = require('../utils/securityUtils');
const { throttle } = require('../utils/performanceUtils');

async function eliminar(archivos, onProgreso) {
  const { shell } = require('electron');
  const onProgresoThrottled = onProgreso ? throttle(onProgreso, 500, 1000) : null;

  for (let i = 0; i < archivos.length; i++) {
    const archivo = archivos[i];

    // Detectar symlinks (no eliminar links)
    const esSymlink = await detectarSymlink(archivo.ruta);
    if (esSymlink) {
      continue; // Skip
    }

    // TOCTOU retry: el archivo puede desaparecer entre check y delete
    await ejecutarConReintento(
      async () => {
        await shell.trashItem(archivo.ruta);
      },
      { reintentos: 3, delayMs: 50 }
    );

    if (onProgresoThrottled) {
      onProgresoThrottled(i + 1, archivos.length, archivo.nombre);
    }
  }

  return { eliminados: count, errores: errors };
}
```

---

#### PASO 3.3: Template Handler

```javascript
ipcMain.handle('eliminar-archivos-confirmado',
  conErrorHandlerEstandar(
    async (event, { archivos }) => {
      // VALIDAR
      validarEsquema({ archivos }, {
        archivos: {
          tipo: 'array',
          minLength: 1,
          maxLength: 50000
        }
      });

      // EJECUTAR
      const resultado = await conTimeout(
        junkCleaner.eliminar(
          archivos,
          (actual, total, nombre) => {
            event.sender.send('progreso-eliminacion', {
              actual, total, nombre
            });
          }
        ),
        300000, // 5 minutos (eliminar es rápido)
        'Eliminación de archivos'
      );

      return respuestaExitosa({
        eliminados: resultado.eliminados,
        errores: resultado.errores
      });
    },
    {
      modulo: 'junkCleaner',
      operacion: 'eliminar',
      timeout: 300000
    }
  )
);
```

---

## FASE 2: VALIDACIÓN (30 MINUTOS)

Después de hacer los 3 handlers, ejecutar:

```bash
# 1. Compilar
npm run dev

# 2. Esperar a que la app abra sin errores
# 3. En Chrome DevTools → Console, NO DEBE HABER ERRORES ROJO
# 4. Cerrar app normal (sin crash)

# 5. Compilar de nuevo
npm run dev

# 6. Si todo OK, pasar a siguiente handler
```

---

## FASE 3: PRÓXIMOS HANDLERS (MENOS CRÍTICOS)

Una vez validados los 3 primeros, continuar con estos en orden:

### 4. `analizar-basura` 
**Template**: Similar a escanear-instaladores  
**Timeout**: 600000ms  
**Throttle**: Sí

### 5. `transferir-archivos-confirmado`
**Template**: Similar a copiar-instaladores  
**Validaciones**: archivos maxLength, destino string  
**Throttle**: Sí

### 6. `importar-json-programas`
**Problema**: Puede cargar JSON 50MB  
**Template**: Agregar timeout + validación  
**Timeout**: 60000ms (1 min para JSON)

### 7. `detectar-juegos-partidas`
**Problema**: Operación larga (escanea todo disco)  
**Template**: Escanear-like  
**Timeout**: 300000ms

### 8. Resto de handlers
**Patrón**: Validar + timeout + respuesta estándar

---

## ⚠️ CHECKLIST ANTES DE CADA CAMBIO

```
HANDLER: _____________________

Before making changes:
  [ ] Identifiqué el handler en main.js
  [ ] Abrí el archivo del módulo
  [ ] Verifico que tiene imports de securityUtils
  [ ] Verifico que tiene imports de performanceUtils
  
Changes in modules:
  [ ] Agregué detectarSymlink() si aplica
  [ ] Agregué throttle() en callbacks
  [ ] Agregué ejecutarConReintento() si aplica
  [ ] Las funciones todavía compilan (npm run dev)
  
Changes in main.js handler:
  [ ] Usé conErrorHandlerEstandar()
  [ ] Agregué validarEsquema()
  [ ] Agregué conTimeout()
  [ ] Usé respuestaExitosa()
  [ ] Elimine el viejo try-catch
  
Final validation:
  [ ] npm run dev compila sin errores
  [ ] Abre la app sin crash
  [ ] Cierro la app normalmente
  [ ] No hay mensajes de error en console
```

---

## 🔧 COMÚN: COSAS QUE PUEDEN FALLAR

### Error 1: "conErrorHandlerEstandar is not defined"
```javascript
// ✅ FIX: Verificar que main.js tiene este import:
const { respuestaExitosa, respuestaError, respuestaCancelada, validarEsquema, conErrorHandlerEstandar } = require('./src/utils/ipcValidator');
```

### Error 2: "throttle is not a function"
```javascript
// ✅ FIX: En el MÓDULO (no main.js), necesita:
const { throttle } = require('../utils/performanceUtils');
```

### Error 3: "detectarSymlink() requires await"
```javascript
// ❌ VIEJO:
const esSymlink = detectarSymlink(ruta);

// ✅ NUEVO:
const esSymlink = await detectarSymlink(ruta);
```

### Error 4: "event.sender is undefined"
```javascript
// ✅ FIX: El callback progreso debe usar event.sender.send(), no emit()
event.sender.send('progreso-escaneo', { actual, total });
```

---

## 💡 TIPS

1. **Copiar-pegar el template**: Es más fácil reemplazar TODA la función que editarla línea por línea

2. **Validar tipos de datos**: Los archivos pueden ser objeto con {ruta, nombre, size} o solo strings. Revisar el módulo para saber qué estructura espera

3. **Timeouts según operación**:
   - Scan: 600000ms (10 min) — disco puede ser lento
   - Copy: 600000ms (10 min) — copiar 10k files toma tiempo
   - Delete: 300000ms (5 min) — reciclar es rápido
   - JSON: 60000ms (1 min) — parsing es rápido

4. **Throttle siempre 500ms + 1000 items**: Mantener consistencia

5. **Si algo no funciona**: Revertir el cambio, ejecutar `npm run dev`, verificar que vuelve a funcionar. Luego intentar de nuevo.

---

## 📋 RESUMEN DE CAMBIOS POR ARCHIVO

```
main.js:
  ├─ Importar 4 utilidades (✅ YA HECHO)
  ├─ Reemplazar ~5 handlers CRÍTICOS (← AHORA)
  └─ Reemplazar ~15 handlers MENOS CRÍTICOS (después)

src/modules/installerFinder.js:
  ├─ Importar throttle
  ├─ Agregar throttle en callbacks
  └─ Symlink check (✅ YA HECHO)

src/modules/junkCleaner.js:
  ├─ Agregar throttle (necesario)
  └─ Symlink check + TOCTOU (✅ YA HECHO)

src/modules/fileOrganizer.js:
  ├─ Importar throttle
  ├─ Agregar throttle en callbacks
  └─ Symlink check (✅ YA HECHO)

src/modules/gameSaveService.js:
  ├─ Importar throttle
  └─ Agregar throttle si tiene callbacks
```

---

**Próximo Paso**: Hacer HANDLER #1 (escanear-instaladores) siguiendo PASO 1.1 → 1.4

¿Comenzamos con el Handler #1? 🚀
