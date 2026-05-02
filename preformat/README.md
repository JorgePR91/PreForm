# PreFormat Scaffolding 🖥️

Herramienta completa para limpiar y optimizar Windows antes de formatear: gestiona programas instalados, limpia archivos basura, reorganiza carpetas personales, gestiona certificados digitales y respalda partidas guardadas de juegos.

---

## 🚀 Inicio Rápido

### Opción 1: Descargar Ejecutable (Recomendado)
1. Ve a [Releases](https://github.com/TuUsuario/preformat-scaffolding/releases)
2. Descarga `PreFormat-1.0.0.exe` (portable, no requiere instalación)
3. Ejecuta directamente - ¡Listo! ✅

### Opción 2: Desde Código Fuente
```bash
# Clonar repositorio
git clone https://github.com/TuUsuario/preformat-scaffolding.git
cd preformat-scaffolding

# Instalar dependencias
npm install

# Ejecutar en modo desarrollo
npm start

# Generar ejecutable portable
npm run build
```

El ejecutable estará en: `dist-manual/PreFormat-1.0.0/PreFormat.exe`

---

## ✅ Requisitos

- **Windows 10+** (64-bit)
- **Node.js 18+** (solo si compila desde fuente)

---

## 🔧 Características

- 📊 Listado de programas instalados (export JSON/CSV/PDF)
- 🔍 Búsqueda y copia masiva de instaladores
- 🗑️ Análisis inteligente de archivos basura (sin borrado permanente)
- 📁 Reorganización de carpetas personales (Documentos, Descargas, etc.)
- 🔐 Gestión de certificados digitales y cifrado AES
- 💾 Respaldo automático de partidas guardadas
- 🛡️ IPC validado, rate limiting, detección de symlinks

---

## 📦 Scripts Disponibles

```bash
npm start       # Ejecutar en modo desarrollo
npm run dev     # Modo desarrollo con logs
npm run build   # Generar ejecutable portable
```

---

## 👨‍💻 Desarrollo

### Estructura del Proyecto
```
preformat-scaffolding/
├── main.js                 # Proceso principal Electron
├── preload.js              # Bridge seguro IPC
├── renderer/               # UI (HTML/CSS/JS)
├── src/
│   ├── modules/            # Lógica de negocio
│   └── utils/              # Utilidades de seguridad y rendimiento
├── doc/                    # Documentación
└── package.json
```

### Desarrollo Local
```bash
npm install
npm start          # Inicia la aplicación
npm run dev        # Desarrollo con console abierta
```

---

## 📄 Licencia

Este proyecto está bajo licencia **MIT** - ver [LICENSE](LICENSE) para detalles.