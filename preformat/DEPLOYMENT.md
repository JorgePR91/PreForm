# 📦 Guía de Despliegue - PreFormat Scaffolding

## ✅ Build Ejecutado Exitosamente

Se ha generado un ejecutable portable `.exe` sin necesidad de instalación.

### 📍 Ubicación del Ejecutable

```
dist-manual/
└── PreFormat-1.0.0/
    ├── PreFormat.exe          ← 🎯 Ejecutable principal (169 MB)
    ├── main.js                ← Código del proceso principal
    ├── preload.js             ← Bridge seguro IPC
    ├── package.json
    ├── src/                   ← Código de módulos
    └── node_modules/          ← Dependencias
```

---

## 🚀 Cómo Ejecutar

### **Opción 1: Doble clic directo**
1. Navega a `dist-manual/PreFormat-1.0.0/`
2. Haz doble clic en `PreFormat.exe`
3. La aplicación se abre inmediatamente

### **Opción 2: Línea de comandos**
```bash
cd dist-manual/PreFormat-1.0.0
.\PreFormat.exe
```

---

## 📋 Cómo Distribuir

### **Para usuarios finales:**
```
Opción A: Carpeta completa
  └─ dist-manual/PreFormat-1.0.0/  ← Compartir toda la carpeta
     (Requiere ~170 MB)

Opción B: Empaquetado en ZIP
  └─ PreFormat-1.0.0.zip           ← Comprimir y distribuir
```

### **En GitHub (Releases):**
1. Comprime la carpeta `dist-manual/PreFormat-1.0.0/`:
   ```bash
   Compress-Archive -Path dist-manual/PreFormat-1.0.0 -DestinationPath PreFormat-v1.0.0.zip
   ```
2. Sube el `.zip` a [GitHub Releases](../../releases)
3. Usuarios descargan, descomprimen y ejecutan `PreFormat.exe`

---

## 🛠️ Cómo Reconstruir el Ejecutable

### Después de cambios en el código:

```bash
# 1. Realiza cambios en src/ o main.js/preload.js
# 2. Ejecuta el build
npm run build

# O manualmente
node build-manual.js

# 3. El nuevo .exe estará en dist-manual/PreFormat-1.0.0/PreFormat.exe
```

---

## 📊 Ventajas de Este Método

✅ **Sin instalación** — Copia y ejecuta (`portable`)  
✅ **Sin permisos elevados** — No requiere admin  
✅ **Sin cambios del registro** — No toca Windows  
✅ **Fácil distribución** — Carpeta independiente  
✅ **Rápida actualización** — Solo descargar nueva carpeta  

---

## 🔧 Estructura del Build

El script `build-manual.js` automáticamente:
1. Crea la carpeta `dist-manual/PreFormat-1.0.0/`
2. Copia `main.js`, `preload.js`, `src/`, `node_modules/`, `package.json`
3. Copia el ejecutable de Electron como `PreFormat.exe`
4. Listo para distribuir

---

## 💡 Próximos Pasos Opcionales

Si en el futuro quieres:
- **Instalador NSIS** (menú Inicio, entrada en "Agregar/Quitar programas")
  → Usa `electron-builder --config.nsis` (requiere permisos admin)

- **Auto-actualización**
  → Implementa `electron-updater` (requiere servidor)

- **Firma de código** (certificado de seguridad)
  → Configura en `package.json` `> build.win.certificateFile`

---

## ❓ Solución de Problemas

**"No se ejecuta nada al hacer doble clic"**
- Verifica que `node_modules/` está en la carpeta (requiere ~150 MB)
- Prueba desde línea de comandos para ver errores

**"Falta 'electron.exe'"**
- Ejecuta `npm install` de nuevo
- Verifica que `node_modules/electron/dist/` existe

**"Error de permisos o acceso denegado"**
- Descarga completamente la carpeta a un directorio local
- No ejecutes desde comprimidos (.zip)

---

## 📄 Archivos Generados

| Archivo | Tamaño | Propósito |
|---------|--------|----------|
| `PreFormat.exe` | ~169 MB | Ejecutable principal |
| `node_modules/` | ~145 MB | Dependencias (no tocar) |
| `src/` | ~500 KB | Código fuente de módulos |
| `main.js` | ~26 KB | Inicialización |
| `preload.js` | ~9 KB | Bridge IPC seguro |

