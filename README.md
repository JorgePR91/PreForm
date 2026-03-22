# PreFormat

Herramienta de escritorio para preparar tu PC antes de un formateo.

## Requisitos previos

Asegúrate de tener instalado:

- [Node.js](https://nodejs.org/) v18 o superior
- npm (viene incluido con Node.js)

Puedes verificarlo abriendo una terminal y escribiendo:
```
node --version
npm --version
```

## Instalación

```bash
# 1. Clona o descarga el proyecto
# (si usas Git)
git clone https://github.com/tu-usuario/preformat.git
cd preformat

# 2. Instala las dependencias
npm install

# 3. Arranca la aplicación en modo desarrollo
npm run dev
```

## Pasos para generar el .exe final

```bash
# 1. Crea el icono (necesario antes de build)
#    Convierte cualquier imagen PNG a .ico en icoconvert.com
#    y guárdala en assets/icons/icon.ico

# 2. Instala dependencias si no lo has hecho
npm install

# 3. Prueba primero sin crear el instalador (más rápido)
npm run build:dir
# → genera dist/win-unpacked/PreFormat.exe

# 4. Cuando estés satisfecho, crea el instalador completo
npm run build
# → genera dist/PreFormat Setup 1.0.0.exe
```

## Scripts disponibles

| Comando | Qué hace |
|---------|----------|
| `npm run dev` | Arranca la app con DevTools abierto (para depurar) |
| `npm start` | Arranca la app en modo normal |
| `npm run build` | Genera el instalador .exe para Windows |

## Estructura del proyecto

```
preformat/
├── main.js          → Proceso principal (Node.js, acceso al sistema)
├── preload.js       → Puente de seguridad entre main y renderer
├── renderer/        → Interfaz de usuario (HTML + CSS + JS)
├── src/
│   ├── modules/     → Lógica de cada módulo (programas, limpieza, etc.)
│   └── utils/       → Funciones auxiliares reutilizables
└── assets/          → Iconos y recursos estáticos
```

## Estado de módulos

| Módulo | Estado |
|--------|--------|
| 1. Programas instalados | 🚧 Sprint 1-2 |
| 2. Buscador de instaladores | 📋 Sprint 2 |
| 3. Limpieza de basura | 📋 Sprint 3 |
| 4. Reorganizador de archivos | 📋 Sprint 4 |
| 5. Exportación de contraseñas | 📋 Sprint 5 |

## Seguridad

- Ninguna operación destructiva se ejecuta sin confirmación del usuario
- Los archivos eliminados van a la Papelera de Reciclaje, no se borran permanentemente
- Las contraseñas nunca aparecen en logs ni en la consola
