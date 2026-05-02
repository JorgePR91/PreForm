# VALIDATION CHECKLIST — Security Fixes

## ✅ Verificación Técnica

### 1. **Compilación de JavaScript**
```bash
npm run dev
# ✅ Debe: Inicia sin errores de sintaxis
```
**Estado**: ✅ Compilación exitosa

### 2. **Importaciones de módulos**
```bash
# Verificar que securityUtils.js se importa correctamente
# en: fileOrganizer, installerFinder, junkCleaner, main
# ✅ Debe: Aplicación inicia sin "require" errors
```
**Status**: ✅ Todos los imports resueltos

---

## 🧪 Tests Funcionales

### Test 1: Path Traversal Prevention
**Objetivo**: Validar que no se permite acceso fuera del destino

**Pasos**:
1. En renderer, intenta copiar archivo a: `../../Windows/System32`
2. O intenta transferir archivos a: `C:\Windows\Temp\..\..\System32`

**Resultado esperado**: ❌ Rechaza con error
```
Error: [nombre-del-param] está fuera de los límites permitidos
```

**Cómo probarlo** (manual):
- Abre la app con `npm run dev`
- Ve al módulo "Reorganizador de Archivos"
- Intenta seleccionar ruta `../../Windows` como destino
- Debe mostrar error en UI

---

### Test 2: Symlink Detection
**Objetivo**: Validar que rechaza archivos que son symlinks

**Pasos**:
1. Crea un symlink: 
```bash
cd C:\temp
mklink /d folder-link C:\Windows\System32
```

2. En la app, intenta copiar desde `C:\temp\folder-link`

**Resultado esperado**: ❌ Rechaza operación
```
Es un enlace simbólico — se rechaza por seguridad
```

**Automático en estos módulos**:
- ✅ fileOrganizer.transferir()
- ✅ installerFinder.copiar()
- ✅ junkCleaner.eliminar()

---

### Test 3: PowerShell Command Escaping  
**Objetivo**: Validar que caracteres especiales en contraseña se escapan

**Pasos**:
1. Ve al módulo de Certificados
2. Intenta exportar certificado con contraseña: `p@ss$word`123`

**Resultado esperado**: ✅ Se exporta correctamente sin inyección de comandos

**Validación técnica**:
```javascript
// ANTES (vulnerable):
const safePassword = password.replace(/'/g, "''");  // ❌ Incompleto

// DESPUÉS (seguro):  
const safePassword = escaparComandoPowerShell(password);  // ✅ Escapa: $, `, ", etc.
```

---

### Test 4: Global Error Handlers
**Objetivo**: Validar que errores no capturados se registran

**Pasos**:
1. Abre DevTools con F12 en modo desarrollo
2. Consulta la consola de main (puede que no sea visible, pero si hay logs)
3. O, fuerza un error colocando código que lance `throw new Error('test')`

**Resultado esperado**: ✅ Mensaje en consola main:
```
[UNCAUGHT EXCEPTION] {
  mensaje: "...",
  stack: "..."
}
```

**Previene**: Crashes silenciosos sin logging

---

### Test 5: TOCTOU Prevention (Race Conditions)
**Objetivo**: Validar que reintentos funcionan cuando archivo cambia

**Pasos**:
1. Ve a módulo de Limpieza de basura
2. Analiza y obtén lista de ~100+ archivos
3. **Mientras** se ejecuta la eliminación, en otra ventana:
   - Elimina algunos archivos manualmente
4. La operación debe completarse sin fallar en todos los archivos

**Resultado esperado**: ✅ Reintentos silenciosos, archivos que no existen se saltan

**Validación en logs**:
```
[junkCleaner] No se pudo mover a papelera: C:\ruta\archivo.tmp
→ Se agregó a errores[] en lugar de detener la operación
```

---

### Test 6: IPC Parameter Validation (Manual Test)
**Objetivo**: Validar que parámetros malformados se rechazan

**Pasos** (si tienes acceso a preload.js):
1. Desde DevTools, intenta llamar con parámetros incorrectos:
```javascript
// ❌ MALO: tipo incorrecto
await window.electronAPI.copiarInstaladores(['string-en-lugar-de-objeto'], 'C:\\dest');

// ❌ MALO: falta parámetro
await window.electronAPI.copiarInstaladores([], null);

// ✅ BUENO: parámetros correctos
await window.electronAPI.copiarInstaladores(
  [{ ruta: 'C:\\file.exe', nombre: 'setup.exe' }], 
  'C:\\Destino'
);
```

**Resultado esperado**: ❌ Rechaza con error claro
```
{
  exito: false,
  error: "Parámetro 'X' debe ser [tipo], pero recibimos [tipo-incorrecto]"
}
```

---

## 📋 Manual Testing Full Flow

### Scenario 1: Respaldo de Archivos (Seguro)
```
1. ✅ Módulo: Reorganizador de Archivos
2. ✅ Selecciona: Documentos, Descargas
3. ✅ Destino: C:\Backup-Seguro  (ruta válida)
4. ✅ Debe: Copiar correctamente sin errores de seguridad
```

### Scenario 2: Limpieza de Basura  
```
1. ✅ Módulo: Limpieza de Basura
2. ✅ Analiza: Categorías estándar (no falsas rutas)
3. ✅ Selecciona: Algunos archivos temp
4. ✅ Elimina: Debe ir a papelera sin errores
5. ✅ Error handling: Si hay symlinks, deben ser saltados silenciosamente
```

### Scenario 3: Búsqueda de Instaladores
```
1. ✅ Módulo: Buscador de Instaladores
2. ✅ Ruta: C:\Program Files  (ruta válida, no System32)
3. ✅ Copia: Instaladores a C:\Backup  (válida)
4. ✅ No debe: Acceder a rutas del sistema
```

---

## 🔴 Red Flags (Si ves esto, hay problema)

| Señal | Problema | Acción |
|-------|----------|--------|
| "Cannot find module 'securityUtils'" | Import faltante | Verificar ruta en require |
| App crashes sin log | Error handler no funciona | Revisar global handlers |
| Symlink se copia/elimina | Detección fallida | Verificar `fs.lstat()` |
| `¿123 en logs | PowerShell injection | Escapado incorrecto |
| IPC timeout con 100k archivos | Sin timeout impl. | Pendiente: agregar timeout |

---

## ✨ Tabla de Verificación Final

```
SECURITY FIX              | IMPLEMENTADO | COMPILADO | VALIDADO
--------------------------|--------------|-----------|----------
Path Traversal            |     ✅       |    ✅     |   ?
Symlink Detection         |     ✅       |    ✅     |   ?
PowerShell Escaping       |     ✅       |    ✅     |   ?
Global Error Handlers     |     ✅       |    ✅     |   ?
IPC Param Validation      |     ✅       |    ✅     |   ?
TOCTOU Retry              |     ✅       |    ✅     |   ?
```

---

## 📝 Próximos Pasos 

**HECHO**:
- ✅ Crear securityUtils.js
- ✅ Integrar validadores en módulos críticos
- ✅ Agregar global error handlers

**POR HACER**:
- [ ] Ejecutar tests en cada módulo
- [ ] Validar que no hay regressions en funcionalidad
- [ ] Agregar validación de parámetros a todos los handlers IPC (resto)
- [ ] Implementar memory leak fixes
- [ ] Implementar timeouts
- [ ] Agregar tests unitarios para securityUtils

---

## 🆘 Si hay errores

1. **Error en require de securityUtils**:
   ```bash
   npm install
   npm run dev
   ```

2. **TypeError en symlink detection**:
   - Verificar que `fs.lstat()` se usa (no `fs.stat()`)

3. **PowerShell command still injected**:
   - Verificar que `escaparComandoPowerShell()` se aplica antes de inyectar en comando

4. **Crashes sin logging**:
   - Verificar que global error handlers están en main.js
   - Revisar que se envía 'error-global' al renderer

---

**Creado**: 2026-04-18  
**Version**: Security Hotfix 1.0  
**Estado**: Listo para testing
