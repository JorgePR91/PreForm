// =============================================================
// src/utils/exportUtils.js — Utilidades de Exportación
// =============================================================
// Funciones compartidas para exportar datos a distintos formatos.
// Los módulos llaman estas funciones en lugar de reimplementarlas.
// =============================================================

const fs   = require('fs');       // Versión síncrona — necesaria para streams de PDFKit
const path = require('path');

// =============================================================
// FUNCIÓN: generarNombreArchivo
//
// Genera un nombre de archivo con fecha y hora para que cada
// exportación tenga un nombre único y ordenable cronológicamente.
//
// Ejemplo: "programas_2024-01-15_14-30.json"
//
// @param {string} prefijo   - Ej: "programas"
// @param {string} extension - Ej: "json"
// @returns {string}
// =============================================================
function generarNombreArchivo(prefijo, extension) {
  const ahora = new Date();
  const fecha = ahora.toISOString()
    .replace('T', '_')    // "2024-01-15T14:30:00" → "2024-01-15_14:30:00"
    .replace(/:/g, '-')   // Elimina ":" que no son válidos en nombres de archivo en Windows
    .substring(0, 16);    // Solo hasta los minutos: "2024-01-15_14-30"

  return `${prefijo}_${fecha}.${extension}`;
}

// =============================================================
// FUNCIÓN: exportarPDF
//
// Genera un PDF con una tabla de los datos proporcionados.
// Usa PDFKit, una librería que dibuja el PDF a bajo nivel
// (como si usaras un lápiz en un lienzo).
//
// CÓMO FUNCIONA PDFKIT:
//   PDFKit trabaja con streams. En lugar de construir todo en
//   memoria y guardar al final, va "escribiendo" el PDF en el
//   archivo a medida que añades contenido. Por eso usamos
//   pipe() para conectar el documento con el archivo de destino.
//
//   El patrón es:
//     1. Crear el documento: new PDFDocument()
//     2. Conectarlo a un archivo: doc.pipe(fs.createWriteStream(...))
//     3. Añadir contenido: doc.text(), doc.rect(), etc.
//     4. Cerrar: doc.end()
//     5. Esperar a que el stream termine de escribir (evento 'finish')
//
// @param {Object[]} datos      - Array de objetos a mostrar
// @param {Object}   opciones   - { titulo, columnas[] }
//   columnas: [{ cabecera, campo, ancho }]
//     cabecera: texto del encabezado de columna
//     campo:    nombre de la propiedad en cada objeto de datos
//     ancho:    ancho relativo de la columna en puntos PDF
// @param {string}   rutaDestino - Ruta completa del archivo .pdf a crear
// =============================================================
async function exportarPDF(datos, opciones, rutaDestino) {
  // Cargamos PDFKit aquí (no al inicio del archivo) para que si no
  // está instalado, el error sea claro y no afecte a JSON/CSV.
  let PDFDocument;
  try {
    PDFDocument = require('pdfkit');
  } catch {
    throw new Error('La librería pdfkit no está instalada. Ejecuta: npm install pdfkit');
  }

  // Devolvemos una Promesa porque PDFKit usa eventos (stream),
  // no promesas nativas. Resolvemos cuando el archivo termina de escribirse.
  return new Promise((resolve, reject) => {

    // ── Configuración del documento ──────────────────────────
    const doc = new PDFDocument({
      margin:  40,           // Margen en puntos (1 punto = 1/72 pulgada)
      size:    'A4',         // Tamaño DIN A4
      layout:  'landscape',  // Horizontal para que quepan todas las columnas
    });

    // ── Conectamos el documento con el archivo de destino ────
    // Si writeStream lanza error (ej: ruta inválida), lo capturamos.
    const writeStream = fs.createWriteStream(rutaDestino);
    doc.pipe(writeStream);

    // Capturamos errores del stream de escritura
    writeStream.on('error', reject);

    // Resolvemos la promesa cuando el stream termina de escribir.
    // IMPORTANTE: usamos 'finish' del writeStream, no 'end' del doc,
    // porque 'finish' garantiza que los datos ya están en disco.
    writeStream.on('finish', resolve);

    // ── PALETA DE COLORES ────────────────────────────────────
    // Definimos los colores como constantes para cambiarlos fácilmente
    const COLOR_FONDO_CABECERA = '#1c2133'; // Azul oscuro (igual que --bg-card de la app)
    const COLOR_TEXTO_CABECERA = '#e8ecf4'; // Blanco apagado
    const COLOR_FONDO_FILA_PAR = '#f5f7fa'; // Gris muy claro para filas alternas
    const COLOR_TEXTO_NORMAL   = '#2d3748'; // Gris oscuro legible
    const COLOR_ACENTO         = '#4f8ef7'; // Azul de la app
    const COLOR_BORDE          = '#e2e8f0'; // Gris claro para bordes

    // ── DIMENSIONES ──────────────────────────────────────────
    // pageWidth es el ancho útil: tamaño de página menos los márgenes
    const margen    = 40;
    const pageWidth = doc.page.width - margen * 2;   // A4 landscape: ~761 puntos
    const alturaCabecera = 24; // Altura de la fila de encabezados
    const alturaFila     = 18; // Altura de cada fila de datos

    // Calculamos el ancho real de cada columna en proporción al total
    // de anchos relativos definidos en opciones.columnas
    const anchoTotal = opciones.columnas.reduce((s, c) => s + c.ancho, 0);
    const columnas   = opciones.columnas.map(col => ({
      ...col,
      anchoReal: (col.ancho / anchoTotal) * pageWidth,
    }));

    // ── CABECERA DEL DOCUMENTO ───────────────────────────────
    // Franja de color con el título
    doc.rect(margen, margen, pageWidth, 36)
       .fill(COLOR_FONDO_CABECERA);

    doc.fillColor(COLOR_ACENTO)
       .font('Helvetica-Bold')
       .fontSize(16)
       .text(opciones.titulo, margen + 12, margen + 10, { lineBreak: false });

    // Fecha de generación a la derecha del título
    const fechaGeneracion = new Date().toLocaleString('es-ES');
    doc.fillColor('#7c8ba1')
       .font('Helvetica')
       .fontSize(9)
       .text(
         `Generado el ${fechaGeneracion}`,
         margen, margen + 13,
         { align: 'right', width: pageWidth - 12 }
       );

    // Contador de registros bajo el título
    doc.fillColor('#7c8ba1')
       .fontSize(9)
       .text(
         `${datos.length} registros`,
         margen + 12, margen + 44,
         { lineBreak: false }
       );

    let yActual = margen + 64; // Posición vertical actual (avanza con cada fila)

    // ── FUNCIÓN INTERNA: dibujarFilaCabecera ─────────────────
    // Dibuja la fila de encabezados de la tabla.
    // La separamos en función porque la llamamos también al empezar
    // cada página nueva (cuando hay muchos registros).
    function dibujarFilaCabecera(y) {
      let xActual = margen;

      columnas.forEach(col => {
        // Fondo de color de la celda de cabecera
        doc.rect(xActual, y, col.anchoReal, alturaCabecera)
           .fill(COLOR_FONDO_CABECERA);

        // Texto de la cabecera en blanco y negrita
        doc.fillColor(COLOR_TEXTO_CABECERA)
           .font('Helvetica-Bold')
           .fontSize(8)
           .text(
             col.cabecera.toUpperCase(),
             xActual + 4, y + 7,
             {
               width: col.anchoReal - 8,
               lineBreak: false,
               ellipsis: true, // Si el texto no cabe, añade "..."
             }
           );

        xActual += col.anchoReal;
      });

      return y + alturaCabecera;
    }

    // ── FUNCIÓN INTERNA: dibujarFila ─────────────────────────
    // Dibuja una fila de datos. El parámetro esImpar controla
    // el color de fondo alterno para mejorar la legibilidad.
    function dibujarFila(programa, y, esImpar) {
      let xActual = margen;

      // Fondo alterno: las filas pares tienen un gris muy suave
      if (!esImpar) {
        doc.rect(margen, y, pageWidth, alturaFila)
           .fill(COLOR_FONDO_FILA_PAR);
      }

      columnas.forEach(col => {
        // Obtenemos el valor del campo. Si no existe, mostramos "—"
        let valor = programa[col.campo];

        // Transformaciones especiales según el campo
        if (col.campo === 'tipo') {
          valor = programa.esDelSistema ? 'Sistema' : 'Usuario';
        } else if (col.campo === 'desinstalador') {
          valor = programa.tieneDesinstalador ? 'Sí' : 'No';
        }

        valor = String(valor || '—');

        // Texto de la celda en gris oscuro, fuente normal
        doc.fillColor(COLOR_TEXTO_NORMAL)
           .font('Helvetica')
           .fontSize(7.5)
           .text(
             valor,
             xActual + 4, y + 5,
             {
               width: col.anchoReal - 8,
               lineBreak: false,
               ellipsis: true,
             }
           );

        // Línea divisoria vertical entre columnas
        doc.moveTo(xActual + col.anchoReal, y)
           .lineTo(xActual + col.anchoReal, y + alturaFila)
           .strokeColor(COLOR_BORDE)
           .lineWidth(0.5)
           .stroke();

        xActual += col.anchoReal;
      });

      // Línea divisoria horizontal bajo la fila
      doc.moveTo(margen, y + alturaFila)
         .lineTo(margen + pageWidth, y + alturaFila)
         .strokeColor(COLOR_BORDE)
         .lineWidth(0.5)
         .stroke();

      return y + alturaFila;
    }

    // ── DIBUJAR LA TABLA ─────────────────────────────────────
    yActual = dibujarFilaCabecera(yActual);

    datos.forEach((programa, index) => {
      // Comprobamos si queda espacio en la página actual.
      // doc.page.height es el alto total, menos el margen inferior.
      const espacioRestante = doc.page.height - margen - yActual;

      if (espacioRestante < alturaFila + 10) {
        // No hay espacio — añadimos una nueva página
        doc.addPage();
        yActual = margen;

        // Repetimos la cabecera de la tabla en la nueva página
        // para que el documento sea legible sin ir a la primera página
        yActual = dibujarFilaCabecera(yActual);
      }

      yActual = dibujarFila(programa, yActual, index % 2 !== 0);
    });

       // ── PIE DE PÁGINA ────────────────────────────────────────
    // Ahora que bufferPages: true está activo, PDFKit tiene todas
    // las páginas en memoria y podemos recorrerlas con switchToPage().
    // flushPages() vuelca el buffer al stream — hay que llamarlo
    // ANTES de doc.end() cuando se usa bufferPages.
    const rango       = doc.bufferedPageRange();
    const totalPaginas = rango.start + rango.count;

    for (let i = rango.start; i < rango.start + rango.count; i++) {
      doc.switchToPage(i); // Nos movemos a esa página
      doc.fillColor('#7c8ba1')
         .font('Helvetica')
         .fontSize(8)
         .text(
           `PreFormat — Página ${i + 1} de ${totalPaginas}`,
           margen,
           doc.page.height - margen + 10,
           { align: 'center', width: pageWidth }
         );
    }

    // flushPages() escribe todas las páginas del buffer al stream.
    // Es el paso que faltaba cuando bufferPages: true está activo.
    doc.flushPages();

    // ── FINALIZAR ────────────────────────────────────────────
    // doc.end() cierra el documento y vacía el stream de escritura.
    // El evento 'finish' del writeStream se disparará cuando el
    // archivo esté completamente escrito en disco, resolviendo la promesa.
    doc.end();
  });
}

module.exports = { generarNombreArchivo, exportarPDF };