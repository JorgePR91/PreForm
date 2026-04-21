#!/usr/bin/env node

/**
 * Script alternativo para crear el .exe portable sin electron-builder
 * Solución para problema de permisos de symlinks en Windows
 */

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

const projectRoot = __dirname;
const distDir = path.join(projectRoot, 'dist-manual');
const appDir = path.join(distDir, 'PreFormat-1.0.0');
const electronExePath = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe');

async function build() {
  try {
    console.log('🔨 Creando estructura de directorios...');
    await fsp.mkdir(appDir, { recursive: true });

    console.log('📋 Copiando archivos de la aplicación...');

    // Copiar archivos principales
    await copyFile(path.join(projectRoot, 'main.js'), path.join(appDir, 'main.js'));
    await copyFile(path.join(projectRoot, 'preload.js'), path.join(appDir, 'preload.js'));
    await copyFile(path.join(projectRoot, 'package.json'), path.join(appDir, 'package.json'));

    // Copiar directorios
    await copyDir(path.join(projectRoot, 'src'), path.join(appDir, 'src'));
    await copyDir(path.join(projectRoot, 'node_modules'), path.join(appDir, 'node_modules'));

    console.log('🔗 Creando ejecutable...');

    // Copiar electron.exe como PreFormat.exe
    const exePath = path.join(appDir, 'PreFormat.exe');
    if (fs.existsSync(electronExePath)) {
      await copyFile(electronExePath, exePath);
      console.log(`✅ Ejecutable creado: ${exePath}`);
    } else {
      console.error('❌ electron.exe no encontrado en node_modules');
      process.exit(1);
    }

    console.log('\n✨ Build completado exitosamente!');
    console.log(`📦 Ubicación: ${distDir}/`);
    console.log(`   - Ejecutable: PreFormat-1.0.0/PreFormat.exe`);
    console.log('\n⚙️  Para ejecutar: ./dist-manual/PreFormat-1.0.0/PreFormat.exe');
  } catch (error) {
    console.error('❌ Error durante el build:', error.message);
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
    if (file.name === 'node_modules' && src.includes('node_modules')) {
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
