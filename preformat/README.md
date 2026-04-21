# Preformat Scaffolding

Herramienta completa para limpiar y optimizar Windows: 
programas duplicados, basura del disco, archivos personales desorganizados, 
certificados digitales y más.

## Características

- 📊 Listado de programas instalados (export JSON/CSV/PDF)
- 🔍 Búsqueda y copia masiva de instaladores
- 🗑️ Análisis y limpieza de archivos basura (sin borrado permanente)
- 📁 Reorganización inteligente de carpetas personales (Documentos, Descargas, etc.)
- 🔐 Gestión de certificados digitales y cifrado AES
- 💾 Respaldo automático de partidas guardadas de juegos
- 🛡️ IPC validado, rate limiting, detección de symlinks

## Requisitos

- Windows 10+ (64-bit)
- Node.js 18+ (si ejecutas desde fuente)

## Instalación

### Descargar Ejecutable
1. Ve a [Releases](../../releases)
2. Descarga `preformat-v1.0.0-setup.exe` (instalador) o `preformat-v1.0.0.exe` (portable)
3. Ejecuta y sigue el asistente

### Desde Fuente
```bash
git clone https://github.com/TuUsuario/preformat-scaffolding.git
cd preformat-scaffolding
npm install
npm start