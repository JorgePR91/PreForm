#!/usr/bin/env node

/**
 * Script alternativo para crear el .exe portable sin electron-builder
 * Solución para problema de permisos de symlinks en Windows
 */

const fs = require("fs");
const fsp = require("fs").promises;
const path = require("path");
const { execSync } = require("child_process");

const projectRoot = __dirname;
const distDir = path.join(projectRoot, "dist-manual");
const appDir = path.join(distDir, "PreFormat-1.0.0");
const electronExePath = path.join(
  projectRoot,
  "node_modules",
  "electron",
  "dist",
  "electron.exe",
);
const appResourcesDir = path.join(appDir, "resources", "app");

async function build() {
  try {
    console.log("🔨 Creando estructura de directorios...");
    await fsp.mkdir(appDir, { recursive: true });
    await fsp.mkdir(appResourcesDir, { recursive: true });

    console.log("📋 Copiando archivos de la aplicación...");

    // Copiar archivos principales
    await copyFile(
      path.join(projectRoot, "main.js"),
      path.join(appResourcesDir, "main.js"),
    );
    await copyFile(
      path.join(projectRoot, "preload.js"),
      path.join(appResourcesDir, "preload.js"),
    );
    await copyFile(
      path.join(projectRoot, "package.json"),
      path.join(appResourcesDir, "package.json"),
    );
    await copyDir(
      path.join(projectRoot, "src"),
      path.join(appResourcesDir, "src"),
    );
    await copyDir(
      path.join(projectRoot, "renderer"),
      path.join(appResourcesDir, "renderer"),
    );
    await copyDir(
      path.join(projectRoot, "node_modules"),
      path.join(appResourcesDir, "node_modules"),
    );

    // Copiar todos los archivos de la dist de Electron al directorio raíz del app
    console.log("📦 Copiando archivos de runtime de Electron...");
    const electronDistDir = path.join(
      projectRoot,
      "node_modules",
      "electron",
      "dist",
    );
    const electronFiles = await fsp.readdir(electronDistDir, {
      withFileTypes: true,
    });
    for (const file of electronFiles) {
      if (file.name === "electron.exe") continue; // Este se copia después como PreFormat.exe
      const srcPath = path.join(electronDistDir, file.name);
      const dstPath = path.join(appDir, file.name);
      if (file.isDirectory()) {
        await copyDir(srcPath, dstPath);
      } else {
        await copyFile(srcPath, dstPath);
      }
    }

    console.log("🔗 Creando ejecutable...");

    // Copiar electron.exe como PreFormat.exe
    const exePath = path.join(appDir, "PreFormat.exe");
    if (fs.existsSync(electronExePath)) {
      await copyFile(electronExePath, exePath);
      console.log(`✅ Ejecutable creado: ${exePath}`);
    } else {
      console.error("❌ electron.exe no encontrado en node_modules");
      process.exit(1);
    }

    console.log("🎨 Aplicando icono al ejecutable...");
    const { default: rcedit } = await import("rcedit");
    await rcedit(exePath, {
      icon: path.join(
        projectRoot,
        "renderer",
        "assets",
        "icons",
        "icon.ico",
      ),
    });
    console.log("✅ Icono aplicado");

    console.log("\n✨ Build completado exitosamente!");
    console.log(`📦 Ubicación: ${distDir}/`);
    console.log(`   - Ejecutable: PreFormat-1.0.0/PreFormat.exe`);
    console.log(
      "\n⚙️  Para ejecutar: ./dist-manual/PreFormat-1.0.0/PreFormat.exe",
    );
  } catch (error) {
    console.error("❌ Error durante el build:", error.message);
    process.exit(1);
  }
}

async function copyFile(src, dst) {
  const dir = path.dirname(dst);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.copyFile(src, dst);
}

async function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;

  await fsp.mkdir(dst, { recursive: true });
  const files = await fsp.readdir(src, { withFileTypes: true });

  for (const file of files) {
    const srcPath = path.join(src, file.name);
    const dstPath = path.join(dst, file.name);

    // Ignorar node_modules internos para evitar copias recursivas grandes
    if (file.name === "node_modules" && src.includes("node_modules")) {
      continue;
    }

    if (file.isDirectory()) {
      await copyDir(srcPath, dstPath);
    } else {
      await copyFile(srcPath, dstPath);
    }
  }
}

build();
