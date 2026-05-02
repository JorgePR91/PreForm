// =============================================================
// src/modules/certificateHelper.js — Módulo 7: Certificados
// =============================================================
// Escanea y exporta certificados personales instalados en Windows.
// Utiliza comandos nativos de PowerShell, por lo que no requiere
// dependencias externas ni compilación nativa en Node.js.
//
// SEGURIDAD:
// Las contraseñas para exportar archivos .pfx se manejan en
// memoria efímera y se inyectan en PowerShell como SecureString.
// Nunca se loggean en consola ni se guardan en disco temporal.
// =============================================================

const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const execAsync = util.promisify(exec);
const { escaparComandoPowerShell } = require('../utils/securityUtils');

/**
 * Lista los certificados personales del usuario actual.
 * Extrae Sujeto, Emisor, Fecha de Expiración, si tiene Clave Privada y el Thumbprint.
 *
 * @returns {Promise<Array>} Array de objetos certificado
 */
async function listar() {
  // Construimos un script de PowerShell que devuelve un array JSON estructurado.
  // @() fuerza a que el resultado sea siempre un array (incluso si hay 0 o 1 certificado).
  const psScript = `
    $certs = @(Get-ChildItem -Path Cert:\\CurrentUser\\My | Select-Object Subject, Issuer, @{Name='Expira';Expression={$_.NotAfter.ToString('yyyy-MM-dd')}}, HasPrivateKey, Thumbprint);
    if ($certs.Count -eq 0) { "[]" } else { $certs | ConvertTo-Json -Compress }
  `;

  try {
    // Convertimos el script a un buffer UTF-16LE y luego a Base64.
    // Este es el método más robusto para ejecutar scripts complejos en PowerShell
    // desde Node.js, ya que evita cualquier problema de escapado de caracteres.
    const psBuffer = Buffer.from(psScript, 'utf16le');
    const comando = `powershell -NoProfile -EncodedCommand ${psBuffer.toString('base64')}`;
    const { stdout } = await execAsync(comando);
    
    // Parseamos el JSON devuelto por PowerShell
    const certificados = JSON.parse(stdout.trim());
    return certificados;
  } catch (error) {
    throw new Error('No se pudo leer el almacén de certificados de Windows: ' + error.message);
  }
}

/**
 * Exporta los certificados seleccionados a una carpeta.
 * Los que tienen Clave Privada se exportan como .pfx protegidos por contraseña.
 * Los que no, se exportan como .cer públicos.
 *
 * @param {Array} certificados - Lista de { thumbprint, tieneClavePrivada }
 * @param {string} destino - Ruta de la carpeta de destino
 * @param {string} password - Contraseña para los .pfx (en texto plano desde UI)
 * @param {Function} onProgreso - Callback(actual, total, nombreArchivo)
 * @returns {Promise<Object>} { exportados: int, errores: array }
 */
async function exportar(certificados, destino, password, onProgreso) {
  const resultados = { exportados: 0, errores: [] };
  
  // SEGURIDAD: Escapar contraseña para prevenir inyección de comandos PowerShell
  const safePassword = escaparComandoPowerShell(password);
  
  // SEGURIDAD: Validar ruta de destino
  const fs = require('fs').promises;
  try {
    await fs.mkdir(destino, { recursive: true });
  } catch (error) {
    throw new Error(`No se pudo crear/acceder a carpeta de destino: ${error.message}`);
  }

  for (let i = 0; i < certificados.length; i++) {
    const cert = certificados[i];
    // Generamos un nombre de archivo amigable usando los primeros 8 caracteres del Thumbprint
    const extension = cert.tieneClavePrivada ? 'pfx' : 'cer';
    const nombreArchivo = `Certificado_${cert.thumbprint.substring(0, 8)}.${extension}`;
    const filePath = path.join(destino, nombreArchivo);

    let psCmd;
    if (cert.tieneClavePrivada) {
      // Exportar PFX: requiere convertir la contraseña a SecureString
      // ⚠️ CRÍTICO: Escapar caracteres especiales en la contraseña
      psCmd = `$pwd = ConvertTo-SecureString -String "${safePassword}" -AsPlainText -Force; Export-PfxCertificate -Cert "Cert:\\CurrentUser\\My\\${cert.thumbprint}" -FilePath "${filePath}" -Password $pwd`;
    } else {
      // Exportar CER: certificado público (no requiere contraseña)
      psCmd = `Export-Certificate -Cert "Cert:\\CurrentUser\\My\\${cert.thumbprint}" -FilePath "${filePath}" -Type CERT`;
    }

    try {
      if (onProgreso) onProgreso(i + 1, certificados.length, nombreArchivo);
      // Usamos el mismo método robusto de comando codificado en Base64
      const psBuffer = Buffer.from(psCmd, 'utf16le');
      await execAsync(`powershell -NoProfile -EncodedCommand ${psBuffer.toString('base64')}`);
      resultados.exportados++;
    } catch (err) {
      // Si el certificado está marcado en el OS como "No exportable", PowerShell lanzará un error aquí
      resultados.errores.push({ thumbprint: cert.thumbprint, error: err.message.split('\n')[0].trim() });
    }
  }
  return resultados;
}

module.exports = { listar, exportar };