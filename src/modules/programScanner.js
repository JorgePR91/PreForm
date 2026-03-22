// =============================================================
// src/modules/programScanner.js — Módulo 1: Programas Instalados
// =============================================================
// Escanea el registro de Windows para obtener todos los programas
// instalados, tanto de 32 como de 64 bits.
//
// TECNOLOGÍA USADA: winreg (npm install winreg)
//   Permite leer el registro de Windows desde Node.js.
//
// RUTAS DEL REGISTRO QUE LEEMOS:
//   - HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall
//   - HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall
//   - HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall
// =============================================================

const path = require('path');
const fs   = require('fs').promises;

// Importamos la función de exportación a PDF desde las utilidades compartidas
const { exportarPDF } = require('../utils/exportUtils');

// Intentamos cargar winreg; si no está instalado, lo notificamos
let Registry;
try {
  Registry = require('winreg');
} catch (e) {
  console.warn('[programScanner] winreg no está instalado. Ejecuta: npm install winreg');
}

// ── Rutas del registro donde viven los programas ────────────
const RUTAS_REGISTRO = [
  // Programas de 64 bits (instalados para todos los usuarios)
  '\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  // Programas de 32 bits en sistemas de 64 bits (subsistema WOW64)
  '\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
];

// Programas típicamente asociados al sistema operativo Windows
const NOMBRES_SISTEMA = [
  'microsoft', 'windows', '.net', 'visual c++', 'directx',
  'vcredist', 'visual studio', 'update for windows'
];

// =============================================================
// FUNCIÓN PRINCIPAL: obtenerTodos
// Lee el registro y devuelve un array con todos los programas.
// =============================================================
async function obtenerTodos() {
  // En modo de desarrollo/prueba sin Windows, devolvemos datos de ejemplo
  if (!Registry) {
    console.warn('[programScanner] Usando datos de DEMO (no estamos en Windows)');
    return generarDatosDemo();
  }

  const programas = [];
  const vistos = new Set(); // Para evitar duplicados por GUID

  for (const rutaBase of RUTAS_REGISTRO) {
    try {
      const subprogramas = await leerClavesRegistro(rutaBase);
      for (const p of subprogramas) {
        // Usamos el DisplayName como clave para deduplicar
        const clave = p.nombre.toLowerCase();
        if (!vistos.has(clave) && p.nombre) {
          vistos.add(clave);
          programas.push(p);
        }
      }
    } catch (err) {
      // Si una ruta no existe o no tenemos permisos, continuamos con la siguiente
      console.warn(`[programScanner] No se pudo leer ${rutaBase}:`, err.message);
    }
  }

  // Ordenamos alfabéticamente por nombre
  programas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  return programas;
}

// =============================================================
// FUNCIÓN INTERNA: leerClavesRegistro
// Lee todas las subclaves de una ruta del registro de Windows.
// =============================================================
function leerClavesRegistro(rutaBase) {
  return new Promise((resolve, reject) => {
    // Creamos la referencia a la clave del registro
    const reg = new Registry({
      hive: Registry.HKLM,  // HKEY_LOCAL_MACHINE
      key:  rutaBase
    });

    const programas = [];

    // Obtenemos todas las subclaves (cada programa tiene su propia subclave)
    reg.keys((err, claves) => {
      if (err) return reject(err);
      if (!claves || claves.length === 0) return resolve(programas);

      // Para cada subclave, leemos los valores del programa
      let procesados = 0;
      claves.forEach(clave => {
        leerValoresClave(clave).then(programa => {
          if (programa) programas.push(programa);
          procesados++;
          if (procesados === claves.length) resolve(programas);
        }).catch(() => {
          // Si falla una clave individual, simplemente la saltamos
          procesados++;
          if (procesados === claves.length) resolve(programas);
        });
      });
    });
  });
}

// =============================================================
// FUNCIÓN INTERNA: leerValoresClave
// Lee los valores de una clave específica (un programa).
// =============================================================
function leerValoresClave(clave) {
  return new Promise((resolve) => {
    clave.values((err, valores) => {
      if (err) return resolve(null);

      // Convertimos el array de valores a un objeto clave-valor
      const mapa = {};
      valores.forEach(v => {
        mapa[v.name] = v.value;
      });

      // Si no tiene nombre visible, lo ignoramos (son entradas vacías)
      const nombre = mapa['DisplayName'];
      if (!nombre || nombre.trim() === '') return resolve(null);

      // Determinamos si es un programa del sistema o del usuario
      const nombreLower = nombre.toLowerCase();
      const esDelSistema = NOMBRES_SISTEMA.some(s => nombreLower.includes(s));

      // Construimos el objeto con la info del programa
      const programa = {
        nombre:          nombre.trim(),
        version:         mapa['DisplayVersion'] || '',
        editor:          mapa['Publisher'] || '',
        fechaInstalacion: formatearFechaRegistro(mapa['InstallDate']),
        esDelSistema:    esDelSistema,
        tieneDesinstalador: !!(mapa['UninstallString']),
        rutaInstalacion: mapa['InstallLocation'] || '',
        // No guardamos UninstallString directamente por seguridad
        // (podría usarse para desinstalar sin confirmación)
      };

      resolve(programa);
    });
  });
}

// =============================================================
// FUNCIÓN: exportar
// Guarda la lista de programas en el formato indicado.
// =============================================================
async function exportar(datos, formato, rutaDestino) {
  switch (formato) {
    case 'json':
      await exportarJSON(datos, rutaDestino);
      break;
    case 'csv':
      await exportarCSV(datos, rutaDestino);
      break;
    case 'pdf':
      await exportarPDFProgramas(datos, rutaDestino);
      break;
    default:
      throw new Error(`Formato no soportado: ${formato}`);
  }
}

async function exportarPDFProgramas(datos, ruta) {
  // Definimos las columnas de la tabla del PDF.
  // Cada columna tiene:
  //   cabecera:  texto del encabezado
  //   campo:     nombre de la propiedad en el objeto programa
  //              (o valor especial 'tipo' y 'desinstalador' que exportUtils transforma)
  //   ancho:     peso relativo de la columna (se calcula en proporción al total)
  await exportarPDF(
    datos,
    {
      titulo: 'PreFormat — Programas Instalados',
      columnas: [
        { cabecera: 'Nombre',             campo: 'nombre',           ancho: 30 },
        { cabecera: 'Versión',            campo: 'version',          ancho: 12 },
        { cabecera: 'Editor',             campo: 'editor',           ancho: 22 },
        { cabecera: 'Fecha instalación',  campo: 'fechaInstalacion', ancho: 13 },
        { cabecera: 'Tipo',               campo: 'tipo',             ancho: 9  },
        { cabecera: 'Desinstalador',      campo: 'desinstalador',    ancho: 10 },
      ],
    },
    ruta
  );
}

async function exportarJSON(datos, ruta) {
  // JSON.stringify con sangría de 2 espacios para que sea legible
  const contenido = JSON.stringify(datos, null, 2);
  await escribirConLimpieza(ruta, contenido, 'utf8');
}

async function exportarCSV(datos, ruta) {
  // Encabezados del CSV
  const cabecera = 'Nombre,Versión,Editor,Fecha Instalación,Tipo,Desinstalador\n';

  // Función para escapar celdas con comas o comillas
  const escaparCelda = (v) => {
    const str = String(v || '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const filas = datos.map(p => [
    escaparCelda(p.nombre),
    escaparCelda(p.version),
    escaparCelda(p.editor),
    escaparCelda(p.fechaInstalacion),
    p.esDelSistema ? 'Sistema' : 'Usuario',
    p.tieneDesinstalador ? 'Sí' : 'No'
  ].join(','));

  // '\ufeff' es el BOM (Byte Order Mark): marca que le indica a Excel
  // que el archivo está en UTF-8, evitando que los caracteres especiales
  // como tildes o la ñ se muestren mal al abrirlo.
  const contenido = '\ufeff' + cabecera + filas.join('\n');
  await escribirConLimpieza(ruta, contenido, 'utf8');
}

// =============================================================
// FUNCIÓN INTERNA: escribirConLimpieza
// Escribe un archivo y, si algo falla a mitad, borra el
// archivo incompleto para no dejar basura en el disco.
// =============================================================
async function escribirConLimpieza(ruta, contenido, codificacion) {
  try {
    await fs.writeFile(ruta, contenido, codificacion);
  } catch (errorEscritura) {
    // La escritura falló (disco lleno, permisos, etc.).
    // Intentamos borrar el archivo que quedó a medias.
    try {
      await fs.unlink(ruta);
      console.log(`[exportar] Archivo incompleto eliminado: ${ruta}`);
    } catch {
      // Si el archivo ni siquiera llegó a crearse, unlink fallará.
      // Eso está bien — simplemente lo ignoramos.
    }
    // Re-lanzamos el error original para que main.js lo capture
    // y se lo comunique al usuario.
    throw errorEscritura;
  }
}

// =============================================================
// UTILIDADES
// =============================================================

/**
 * Convierte la fecha del registro (YYYYMMDD) a formato legible.
 * @param {string} fechaRaw - Formato "20231215"
 * @returns {string} - Formato "15/12/2023"
 */
function formatearFechaRegistro(fechaRaw) {
  if (!fechaRaw || fechaRaw.length !== 8) return '';
  const anio = fechaRaw.substring(0, 4);
  const mes  = fechaRaw.substring(4, 6);
  const dia  = fechaRaw.substring(6, 8);
  return `${dia}/${mes}/${anio}`;
}

/**
 * Datos de demostración para probar sin Windows / sin winreg instalado.
 */
function generarDatosDemo() {
  return [
    { nombre: 'Google Chrome', version: '120.0.6099.130', editor: 'Google LLC', fechaInstalacion: '15/01/2024', esDelSistema: false, tieneDesinstalador: true },
    { nombre: 'Visual Studio Code', version: '1.85.1', editor: 'Microsoft Corporation', fechaInstalacion: '10/12/2023', esDelSistema: false, tieneDesinstalador: true },
    { nombre: 'Microsoft Visual C++ 2019', version: '14.29.30153', editor: 'Microsoft Corporation', fechaInstalacion: '01/06/2023', esDelSistema: true, tieneDesinstalador: true },
    { nombre: 'Node.js', version: '20.11.0', editor: 'Node.js Foundation', fechaInstalacion: '05/01/2024', esDelSistema: false, tieneDesinstalador: true },
    { nombre: 'Spotify', version: '1.2.26.1187', editor: 'Spotify AB', fechaInstalacion: '20/11/2023', esDelSistema: false, tieneDesinstalador: true },
  ];
}

// Exportamos las funciones públicas del módulo
module.exports = { obtenerTodos, exportar };