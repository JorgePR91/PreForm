// =============================================================
// src/modules/credentialHelper.js — Módulo 5: Ayuda con Contraseñas
// =============================================================
//
// ⚠️ REGLAS DE ORO — LEE ESTO ANTES DE MODIFICAR ESTE ARCHIVO:
//
//    1. Este módulo NUNCA lee contraseñas del sistema operativo,
//       los navegadores ni los gestores. Solo detecta su presencia.
//
//    2. La única contraseña que maneja es la que el usuario introduce
//       para CIFRAR su propio archivo exportado. Esa contraseña:
//         - Se usa y se descarta inmediatamente
//         - NUNCA se registra en logs ni en consola
//         - NUNCA se escribe en disco en texto plano
//         - Pasa por IPC cifrada en memoria (es seguro en Electron
//           con contextIsolation: true porque es comunicación interna
//           dentro de la misma máquina, no por red)
//
//    3. El archivo resultante del cifrado usa AES-256-CBC, que es
//       el estándar de la industria para cifrado simétrico.
//       Sin la contraseña correcta es computacionalmente imposible
//       descifrar el archivo (años o siglos de cómputo).
//
// QUÉ HACE ESTE MÓDULO:
//   - Detecta gestores de contraseñas instalados (Bitwarden, KeePass, etc.)
//   - Detecta navegadores con contraseñas guardadas (Chrome, Firefox, Edge)
//   - Para cada uno, proporciona instrucciones paso a paso de exportación
//   - Cifra el archivo que el usuario haya exportado manualmente
//
// QUÉ NO HACE:
//   - Extraer contraseñas automáticamente del sistema
//   - Leer la base de datos interna de ningún gestor o navegador
//   - Guardar contraseñas en ningún formato sin cifrar
//
// =============================================================

const fs   = require('fs').promises;
const path = require('path');

// node-forge es una librería de criptografía para Node.js.
// La usamos para AES-256 y PBKDF2 (derivación de claves).
// Está en package.json como dependencia → se instala con npm install.
let forge;
try {
  forge = require('node-forge');
} catch {
  console.warn('[credentialHelper] node-forge no instalado. Ejecuta: npm install node-forge');
}

// =============================================================
// GESTORES DE CONTRASEÑAS
//
// Para cada gestor definimos:
//   - nombre:          Lo que verá el usuario
//   - icono:           Emoji identificativo
//   - rutasDeteccion:  Carpetas que existen si el gestor está instalado
//   - pasos:           Instrucciones detalladas paso a paso
//   - formatoExport:   Qué archivo genera la exportación
//   - advertencia:     Aviso específico de ese gestor (si aplica)
// =============================================================
const GESTORES_CONOCIDOS = [
  {
    nombre:    'Bitwarden',
    icono:     '🔷',
    rutasDeteccion: [
      path.join(process.env.LOCALAPPDATA || '', 'Bitwarden'),
      path.join(process.env.APPDATA     || '', 'Bitwarden'),
    ],
    pasos: [
      'Abre la aplicación de escritorio de Bitwarden.',
      'En el menú superior, haz clic en "Archivo" → "Exportar bóveda".',
      'Elige el formato ".json (Cifrado)" para una exportación segura.',
      'Introduce tu contraseña maestra cuando te la pida.',
      'Guarda el archivo .json exportado en una ubicación segura.',
      'A continuación, usa la herramienta de cifrado de abajo para añadir una capa extra de seguridad.',
    ],
    formatoExport: '.json',
    advertencia: null,
  },
  {
    nombre:    'KeePass',
    icono:     '🟢',
    rutasDeteccion: [
      'C:\\Program Files\\KeePass Password Safe 2',
      'C:\\Program Files (x86)\\KeePass Password Safe 2',
    ],
    pasos: [
      'Abre KeePass.',
      'En el menú, ve a "Archivo" → "Exportar".',
      'Selecciona el formato "KeePass XML (2.x)".',
      'Guarda el archivo .xml generado.',
      '⚠️ El XML de KeePass NO está cifrado por defecto. Usa la herramienta de abajo para cifrarlo antes de guardarlo en ningún sitio.',
    ],
    formatoExport: '.xml',
    advertencia: 'El archivo exportado no está cifrado. Usa la herramienta de cifrado antes de guardarlo.',
  },
  {
    nombre:    '1Password',
    icono:     '🔵',
    rutasDeteccion: [
      path.join(process.env.LOCALAPPDATA || '', '1Password'),
    ],
    pasos: [
      'Abre 1Password.',
      'Ve a "Archivo" → "Exportar" → "Todos los ítems".',
      'Selecciona el formato "1PUX" (es el formato nativo cifrado de 1Password).',
      'Introduce tu contraseña maestra.',
      'Guarda el archivo .1pux generado.',
      'El formato 1PUX ya está cifrado, pero puedes añadir otra capa con la herramienta de abajo.',
    ],
    formatoExport: '.1pux',
    advertencia: null,
  },
  {
    nombre:    'LastPass',
    icono:     '🔴',
    rutasDeteccion: [
      path.join(process.env.APPDATA || '', 'LastPass'),
    ],
    pasos: [
      'Abre LastPass en tu navegador (extensión o web lastpass.com).',
      'Ve a "Opciones avanzadas" en el menú lateral.',
      'Haz clic en "Exportar" → "LastPass CSV File".',
      'Introduce tu contraseña maestra.',
      '⚠️ El CSV de LastPass está en TEXTO PLANO. Cifra el archivo inmediatamente con la herramienta de abajo y borra el original.',
    ],
    formatoExport: '.csv',
    advertencia: 'El archivo exportado está en texto plano. ¡Cífralo inmediatamente y borra el original!',
  },
  {
    nombre:    'Dashlane',
    icono:     '🟣',
    rutasDeteccion: [
      path.join(process.env.LOCALAPPDATA || '', 'Dashlane'),
      path.join(process.env.APPDATA     || '', 'Dashlane'),
    ],
    pasos: [
      'Abre Dashlane.',
      'Ve a "Mi cuenta" → "Exportar datos".',
      'Selecciona "Exportar como archivo CSV seguro".',
      'Introduce tu contraseña maestra.',
      'Guarda el archivo exportado.',
      'Cifra el archivo con la herramienta de abajo antes de guardarlo en un USB o en la nube.',
    ],
    formatoExport: '.csv',
    advertencia: null,
  },
];

// =============================================================
// NAVEGADORES CON CONTRASEÑAS GUARDADAS
//
// Los navegadores guardan contraseñas en carpetas de perfil.
// Detectamos su presencia, pero NUNCA leemos esas carpetas.
// Solo guiamos al usuario para que exporte manualmente.
// =============================================================
const NAVEGADORES_CONOCIDOS = [
  {
    nombre:    'Google Chrome',
    icono:     '🌐',
    rutasDeteccion: [
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data', 'Default'),
    ],
    pasos: [
      'Abre Google Chrome.',
      'Haz clic en los tres puntos (⋮) → "Contraseñas y autocompletado" → "Administrador de contraseñas".',
      'En la parte superior derecha, haz clic en el icono de configuración (⚙).',
      'Selecciona "Exportar contraseñas".',
      'Confirma tu identidad de Windows cuando te lo pida.',
      '⚠️ El archivo .csv que genera Chrome está en TEXTO PLANO. Cífralo con la herramienta de abajo y borra el original.',
    ],
    advertencia: 'El CSV de Chrome está en texto plano. ¡Cífralo inmediatamente!',
  },
  {
    nombre:    'Mozilla Firefox',
    icono:     '🦊',
    rutasDeteccion: [
      path.join(process.env.APPDATA || '', 'Mozilla', 'Firefox', 'Profiles'),
    ],
    pasos: [
      'Abre Firefox.',
      'Haz clic en el menú (☰) → "Contraseñas".',
      'En la ventana del administrador, haz clic en los tres puntos (⋯) de la esquina superior derecha.',
      'Selecciona "Exportar contraseñas".',
      'Confirma que quieres exportar.',
      '⚠️ El archivo .csv de Firefox también está en texto plano. Usa la herramienta de cifrado.',
    ],
    advertencia: 'El CSV de Firefox está en texto plano. ¡Cífralo inmediatamente!',
  },
  {
    nombre:    'Microsoft Edge',
    icono:     '🔷',
    rutasDeteccion: [
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'User Data', 'Default'),
    ],
    pasos: [
      'Abre Microsoft Edge.',
      'Ve a Configuración (⋯) → "Contraseñas".',
      'Haz clic en los tres puntos junto a "Contraseñas guardadas".',
      'Selecciona "Exportar contraseñas".',
      'Confirma tu identidad de Windows.',
      '⚠️ El CSV de Edge está en texto plano. Cífralo con la herramienta de abajo.',
    ],
    advertencia: 'El CSV de Edge está en texto plano. ¡Cífralo inmediatamente!',
  },
];

// =============================================================
// FUNCIÓN: detectarGestores
//
// Comprueba qué gestores de contraseñas están instalados buscando
// sus carpetas características. No lee ningún dato sensible.
//
// @returns {Promise<Array>} - Gestores encontrados con sus instrucciones
// =============================================================
async function detectarGestores() {
  const detectados = [];

  for (const gestor of GESTORES_CONOCIDOS) {
    for (const ruta of gestor.rutasDeteccion) {
      try {
        // fs.access solo comprueba si la ruta es accesible.
        // No lee ni devuelve ningún contenido — es la operación mínima posible.
        await fs.access(ruta);

        detectados.push({
          nombre:        gestor.nombre,
          icono:         gestor.icono,
          pasos:         gestor.pasos,
          formatoExport: gestor.formatoExport,
          advertencia:   gestor.advertencia,
          // NUNCA incluimos rutas internas de datos del gestor
        });
        break; // Con una ruta válida es suficiente para confirmar que está instalado
      } catch {
        // Ruta no existe → gestor no instalado → continuamos con el siguiente
      }
    }
  }

  return detectados;
}

// =============================================================
// FUNCIÓN: detectarNavegadores
//
// Igual que detectarGestores pero para navegadores.
// Detectamos por la presencia de la carpeta de perfil de usuario.
//
// @returns {Promise<Array>}
// =============================================================
async function detectarNavegadores() {
  const detectados = [];

  for (const navegador of NAVEGADORES_CONOCIDOS) {
    for (const ruta of navegador.rutasDeteccion) {
      try {
        await fs.access(ruta);
        detectados.push({
          nombre:      navegador.nombre,
          icono:       navegador.icono,
          pasos:       navegador.pasos,
          advertencia: navegador.advertencia,
        });
        break;
      } catch {
        // Navegador no instalado → continuamos
      }
    }
  }

  return detectados;
}

/**
* =============================================================
* FUNCIÓN: cifrarArchivo
*
* Cifra un archivo con AES-256-CBC y una clave derivada de la
 * contraseña del usuario mediante PBKDF2.
 *
 * ESTRUCTURA DEL ARCHIVO CIFRADO:
 *   [ salt: 16 bytes ][ IV: 16 bytes ][ datos cifrados: N bytes ]
 *
 *   - salt:  Valor aleatorio único que se combina con la contraseña
 *             para derivar la clave. Aunque dos archivos usen la misma
 *             contraseña, el salt diferente hace que las claves sean distintas.
 *   - IV:    Vector de inicialización. Hace que el mismo bloque de datos
 *             produzca texto cifrado diferente cada vez. Imprescindible en CBC.
 *   - datos: El contenido del archivo cifrado con AES-256.
 *
 * PBKDF2 (Password-Based Key Derivation Function 2):
 *   Convierte la contraseña en una clave de 256 bits mediante 100.000
 *   iteraciones de SHA-256. Las muchas iteraciones hacen que los ataques
 *   de fuerza bruta sean extremadamente lentos.
 *
   * ⚠️ SEGURIDAD CRÍTICA:
 *   - La contraseña NUNCA se registra en logs
 *   - La contraseña NUNCA se escribe en el archivo de salida
 *   - Sin la contraseña correcta, el archivo es irrecuperable
 *
 * @param {string} rutaOrigen  - Archivo a cifrar
 * @param {string} rutaDestino - Donde guardar el archivo cifrado
 * @param {string} contrasena  - Contraseña elegida por el usuario
 *                               ⚠️ NUNCA LOGGEAR ESTE PARÁMETRO
* =============================================================
 */
async function cifrarArchivo(rutaOrigen, rutaDestino, contrasena) {
  // Verificamos que node-forge esté disponible antes de continuar
  if (!forge) {
    throw new Error('La librería node-forge no está instalada. Ejecuta: npm install node-forge');
  }

  // Leemos el archivo original como Buffer binario
  const datosOriginales = await fs.readFile(rutaOrigen);

  // Generamos valores aleatorios criptográficamente seguros
  // (forge.random usa el generador del sistema operativo, no Math.random)
  const salt = forge.random.getBytesSync(16); // 128 bits de salt
  const iv   = forge.random.getBytesSync(16); // 128 bits de IV para AES-CBC

  // Derivamos la clave de 256 bits a partir de la contraseña.
  // - 100.000 iteraciones: hace que un ataque de fuerza bruta tarde
  //   ~100.000 veces más que simplemente hashear la contraseña una vez.
  // - 'sha256': función hash usada internamente en cada iteración.
  // - 32 bytes = 256 bits: tamaño de clave para AES-256.
  const clave = forge.pkcs5.pbkdf2(contrasena, salt, 100000, 32, 'sha256');

  // Creamos el cifrador AES-256-CBC con la clave y el IV
  const cifrador = forge.cipher.createCipher('AES-CBC', clave);
  cifrador.start({ iv });

  // Alimentamos el cifrador con los datos del archivo.
  // forge.util.createBuffer convierte el Buffer de Node.js al formato
  // interno de forge para procesarlo.
  cifrador.update(forge.util.createBuffer(datosOriginales));
  cifrador.finish();

  // Obtenemos los datos cifrados como string binario
  const datosCifrados = cifrador.output.getBytes();

  // Concatenamos: salt + IV + datos cifrados
  // El salt y el IV no son secretos (se guardan en el archivo) pero
  // son necesarios para descifrar. Sin la CONTRASEÑA no sirven de nada.
  const archivoFinal = Buffer.concat([
    Buffer.from(salt,         'binary'),
    Buffer.from(iv,           'binary'),
    Buffer.from(datosCifrados,'binary'),
  ]);

  // Escribimos el archivo cifrado en el destino
  await fs.writeFile(rutaDestino, archivoFinal);

  // La contraseña y la clave derivada desaparecen cuando esta función
  // termina y el garbage collector de JS limpia las variables.
  // (JS no garantiza limpieza inmediata de memoria, pero es el mejor
  // nivel de seguridad disponible en este entorno)
}

// Exportamos solo las funciones que main.js necesita.
// cifrarArchivo se exporta aunque recibe la contraseña porque
// la encapsulación aquí garantiza que NUNCA se loggea.
module.exports = { detectarGestores, detectarNavegadores, cifrarArchivo };
