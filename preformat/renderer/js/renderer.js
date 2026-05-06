// =============================================================
// renderer.js — Lógica de la Interfaz de Usuario
// =============================================================
// Este archivo corre en el "navegador" de Electron (el renderer).
// Es JavaScript normal, como el que ya sabes escribir para la web.
//
// PUEDE hacer:
//   ✅ Manipular el DOM (getElementById, innerHTML, classList...)
//   ✅ Llamar a window.electronAPI.xxx() para pedir cosas al sistema
//   ✅ Reaccionar a eventos del usuario (clicks, inputs...)
//
// NO PUEDE hacer:
//   ❌ Acceder al sistema de archivos directamente (eso lo hace main.js)
//   ❌ Usar require() o módulos de Node.js
// =============================================================

// =============================================================
// GUÍA DE RECONSTRUCCIÓN — Índice de símbolos (este archivo completo)
// =============================================================
// Con este bloque + el contrato IPC (preload.js ↔ main.js) puedes reescribir
// toda la lógica de interfaz: qué estado existe, qué funciones lo mutan y
// qué canales Electron se invocan en cada flujo.
//
// APIs GLOBALES:
//   window.electronAPI — bridge seguro (preload); todos los ipcRenderer.invoke/on.
//   window.mostrarConfirmacion(titulo, mensaje) — Promise<boolean>; modal al final del archivo.
//   window.formatearBytes(bytes) — misma función que formatearBytes (exportada para depuración).
//
// ESTADO GLOBAL (variables let en ámbito de módulo; persisten entre interacciones):
//   listaReferenciaProgramas — null hasta importar JSON; luego array de programas antiguos.
//   datosProgramas — copia en memoria del resultado de obtenerProgramas (Módulo 1).
//   ordenActual — { col: string, dir: 'asc'|'desc' }; orden activo en tabla programas.
//   datosInstaladores — array de objetos instalador; propiedad .seleccionado mutada por la UI.
//   ordenInstaladores — como ordenActual pero para la tabla de instaladores.
//   datosBasura — array de categorías post analizarBasura; cada archivo tiene .seleccionado.
//   datosPersonales — carpetas personales escaneadas; archivos con .seleccionado.
//   datosJuegosPartidas — juegos detectados o añadidos manualmente; rutas con .seleccionado.
//   metaPartidas — { advertencias: string[], steamPath: string|null } tras detectar juegos.
//   datosCertificados — array de certificados detectados; .seleccionado para exportar.
//   rutaArchivoCifrar — string|null; ruta del archivo elegido para cifrado AES (Módulo 5).
//
// FUNCIONES PURAS / UI (orden aproximado de aparición en el archivo):
//   mostrarVista(moduloId) — Oculta .vista, muestra #vista-{moduloId}, marca .nav-btn.active.
//   aplicarFiltroYOrden() — Lee buscador, filtra datosProgramas, ordena, renderiza tabla.
//   ordenarProgramas(programas, col, dir) — Devuelve nuevo array ordenado (localeCompare 'es').
//   renderizarTablaProgramas(programas) — Rellena #tbody-programas y #contador-programas.
//   aplicarFiltroYOrdenInst() — Filtro + orden sobre datosInstaladores → tabla instaladores.
//   ordenarInstaladores(lista, col, dir) — Orden; columna tamano usa resta numérica.
//   renderizarTablaInstaladores(lista) — DOM; registra listeners en checkboxes y botones hash.
//   actualizarContadoresInst() — Actualiza textos de contadores y estado del botón copiar.
//   renderizarCategoriasBasura(categorias) — Construye tarjetas Módulo 3; llama adjuntarEventosCategoria.
//   adjuntarEventosCategoria() — Listeners check categoría/archivo/indeterminate y expandir.
//   actualizarResumenBasura() — Suma espacio seleccionado; muestra/oculta pie y botón eliminar.
//   renderizarCarpetasPersonales(carpetas) — Tarjetas Módulo 4; adjuntarEventosPersonales.
//   adjuntarEventosPersonales() — Listeners carpetas/archivos/expandir Módulo 4.
//   actualizarResumenPersonales() — Resumen selección y etiqueta del botón copiar/mover.
//   construirItemsRespaldoPartidas() — De datosJuegosPartidas a payload IPC respaldar-partidas.
//   actualizarBotonRespaldoPartidas() — Habilita botón si hay al menos un item válido.
//   renderizarListaJuegosPartidas() — Lista tarjetas juego; listeners de checks.
//   renderizarGestores(gestores) — Lista gestores detectados en #lista-gestores.
//   renderizarNavegadores(navegadores) — Lista navegadores en #lista-navegadores.
//   crearTarjetaCredencial(app, tipo) — DOM tarjeta con pasos y acordeón; tipo 'gestor'|'navegador'.
//   actualizarFortaleza(contrasena) — Puntuación 0-5 y clases CSS barra fortaleza.
//   validarFormularioCifrado() — Comprueba ruta, longitud mínima contraseña y coincidencia.
//   mostrarConfirmacion(titulo, mensaje) — Promise; modal #modal-confirmacion confirmar/cancelar.
//   escaparHTML(texto) — Entidades HTML para textos insertados en plantillas.
//   formatearBytes(bytes) — Cadena legible B / KB / MB / GB.
//
// MAPA IPC (canal main.js ↔ método preload ↔ uso típico aquí):
//   obtener-programas → obtenerProgramas() — btn escanear programas.
//   exportar-programas → exportarProgramas(formato, datos) — botones json/csv/pdf.
//   importar-json-programas / comparar-programas-recuperacion — recuperación post-formateo.
//   escanear-instaladores + progreso-escaneo; copiar-instaladores + progreso-copia; calcular-hash.
//   analizar-basura + progreso-analisis-basura; eliminar-archivos-confirmado + progreso-eliminacion.
//   escanear-personales + progreso-escaneo-personales; transferir-archivos-confirmado + progreso-transferencia.
//   detectar-gestores, detectar-navegadores, cifrar-archivo, seleccionar-archivo.
//   detectar-juegos-partidas + progreso-deteccion-juegos; verificar-ruta-partida;
//   respaldar-partidas-confirmado + progreso-respaldo-partidas.
//   abrir-carpeta, seleccionar-carpeta — diálogos y shell.openPath indirecto.
//   escanear-certificados; exportar-certificados-confirmado + progreso-exportacion-certificados.
// =============================================================

// =============================================================
// SISTEMA DE NAVEGACIÓN
// Maneja qué vista (sección) se muestra en cada momento
// =============================================================

/**
 * Cambia la vista activa en el área principal.
 * @param {string} moduloId - ID del módulo a mostrar (ej: 'programas')
 */
function mostrarVista(moduloId) {
  // 1. Ocultamos todas las vistas
  document.querySelectorAll('.vista').forEach(v => {
    v.classList.add('oculto');
  });

  // 2. Mostramos solo la que nos piden
  const vistaObjetivo = document.getElementById(`vista-${moduloId}`);
  if (vistaObjetivo) {
    vistaObjetivo.classList.remove('oculto');
  } else {
    console.warn(`[Navegación] Vista no encontrada: vista-${moduloId}`);
  }

  // 3. Actualizamos el estado visual del menú lateral
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.modulo === moduloId) {
      btn.classList.add('active');
    }
  });
}

// Adjuntamos el evento de clic a todos los botones del menú lateral
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    mostrarVista(btn.dataset.modulo);
  });
});

// Las tarjetas del dashboard también navegan al módulo correspondiente
document.querySelectorAll('.card-modulo').forEach(card => {
  card.addEventListener('click', () => {
    mostrarVista(card.dataset.target);
  });
});

// Al cargar, mostramos el dashboard
mostrarVista('dashboard');

// =============================================================
// RECUPERACIÓN — Post formateo (cotejo de programas)
// =============================================================

let listaReferenciaProgramas = null;

document.getElementById('btn-importar-json-ref')?.addEventListener('click', async () => {
  try {
    const res = await window.electronAPI.importarJsonProgramas();
    if (!res.exito) {
      if (res.razon !== 'cancelado') {
        alert(res.error || 'No se pudo importar el archivo.');
      }
      return;
    }
    listaReferenciaProgramas = res.datos;
    const rutaEl = document.getElementById('recuperacion-ruta-ref');
    if (rutaEl) {
      rutaEl.textContent = `Referencia cargada: ${res.datos.length} programa(s) · ${res.ruta}`;
    }
    const btnCmp = document.getElementById('btn-comparar-programas');
    if (btnCmp) btnCmp.disabled = false;
  } catch (err) {
    console.error('[Recuperación] Importar:', err);
    alert('Error al importar el JSON.');
  }
});

document.getElementById('btn-comparar-programas')?.addEventListener('click', async () => {
  if (!listaReferenciaProgramas || listaReferenciaProgramas.length === 0) {
    alert('Primero importa el JSON de la lista antigua.');
    return;
  }

  const estado = document.getElementById('estado-recuperacion');
  const panel = document.getElementById('panel-resultado-recuperacion');
  estado?.classList.remove('oculto');
  panel?.classList.add('oculto');

  try {
    const res = await window.electronAPI.compararProgramasRecuperacion(listaReferenciaProgramas);
    if (!res.exito) {
      alert(res.error || 'Error al comparar.');
      return;
    }
    const c = res.datos;
    const t = c.totales;
    const resumen = document.getElementById('recuperacion-resumen-texto');
    if (resumen) {
      resumen.textContent =
        `Antes: ${t.antes} · Ahora: ${t.ahora} · ` +
        `Reinstalados: ${t.reinstalados} · Pendientes: ${t.pendientes} · Nuevos: ${t.nuevos}`;
    }

    const tbP = document.getElementById('tbody-recuperacion-pendientes');
    const tbR = document.getElementById('tbody-recuperacion-reinstalados');
    const tbN = document.getElementById('tbody-recuperacion-nuevos');
    if (tbP) {
      tbP.innerHTML = '';
      c.pendientes.forEach((p) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escaparHTML(p.nombre)}</td><td>${escaparHTML(p.editor || '—')}</td>`;
        tbP.appendChild(tr);
      });
      if (c.pendientes.length === 0) {
        tbP.innerHTML = '<tr><td colspan="2" class="texto-dim">Ninguno — todo lo de la lista aparece instalado.</td></tr>';
      }
    }
    if (tbR) {
      tbR.innerHTML = '';
      c.reinstalados.forEach((p) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escaparHTML(p.nombre)}</td><td>${escaparHTML(p.version || '—')}</td>`;
        tbR.appendChild(tr);
      });
    }
    if (tbN) {
      tbN.innerHTML = '';
      c.nuevos.forEach((p) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escaparHTML(p.nombre)}</td><td>${escaparHTML(p.version || '—')}</td>`;
        tbN.appendChild(tr);
      });
      if (c.nuevos.length === 0) {
        tbN.innerHTML = '<tr><td colspan="2" class="texto-dim">Ninguno</td></tr>';
      }
    }

    panel?.classList.remove('oculto');
  } catch (err) {
    console.error('[Recuperación] Comparar:', err);
    alert('Error inesperado al cotejar.');
  } finally {
    estado?.classList.add('oculto');
  }
});

// =============================================================
// MÓDULO 1 — PROGRAMAS INSTALADOS
// =============================================================

// datosProgramas guarda el resultado original del escaneo.
// NUNCA lo modificamos directamente: filtramos y ordenamos sobre
// una copia, para poder restablecer la vista completa en cualquier momento.
let datosProgramas = [];

// Estado del ordenamiento activo: columna y dirección
let ordenActual = { col: 'nombre', dir: 'asc' };

// ── Botón "Escanear ahora" ───────────────────────────────────
const btnEscanear = document.getElementById('btn-escanear-programas');
if (btnEscanear) {
  btnEscanear.addEventListener('click', async () => {
    document.getElementById('estado-programas').classList.remove('oculto');
    document.getElementById('tabla-programas').classList.add('oculto');
    document.getElementById('grupo-export-programas').classList.add('oculto');
    btnEscanear.disabled = true;
    btnEscanear.textContent = '⏳ Escaneando...';

    try {
      const resultado = await window.electronAPI.obtenerProgramas();

      if (resultado.exito) {
        datosProgramas = resultado.datos;
        // Aplicamos el orden por defecto (nombre A→Z) al mostrar los datos
        aplicarFiltroYOrden();
        document.getElementById('tabla-programas').classList.remove('oculto');
        document.getElementById('grupo-export-programas').classList.remove('oculto');
      } else {
        alert(`Error al escanear: ${resultado.error}`);
      }
    } catch (err) {
      console.error('[Módulo 1] Error inesperado:', err);
      alert('Ocurrió un error inesperado. Revisa la consola (Ctrl+Shift+I).');
    } finally {
      document.getElementById('estado-programas').classList.add('oculto');
      btnEscanear.disabled = false;
      btnEscanear.textContent = '🔍 Escanear ahora';
    }
  });
}

// ── Encabezados ordenables ───────────────────────────────────
// Cuando el usuario hace clic en un <th>, ordenamos por esa columna.
// Si ya está activa, alternamos entre ascendente y descendente.
document.querySelectorAll('.th-ordenable').forEach(th => {
  th.addEventListener('click', () => {
    if (datosProgramas.length === 0) return; // Sin datos, no hacemos nada

    const col = th.dataset.col;

    if (ordenActual.col === col) {
      // Misma columna → invertir dirección
      ordenActual.dir = ordenActual.dir === 'asc' ? 'desc' : 'asc';
    } else {
      // Columna distinta → empezar ascendente
      ordenActual.col = col;
      ordenActual.dir = 'asc';
    }

    // Actualizamos el aspecto visual de todos los encabezados
    document.querySelectorAll('.th-ordenable').forEach(otroTh => {
      otroTh.classList.remove('activo', 'asc', 'desc');
    });
    th.classList.add('activo', ordenActual.dir);

    aplicarFiltroYOrden();
  });
});

// ── Buscador en tiempo real ──────────────────────────────────
const buscadorProgramas = document.getElementById('buscador-programas');
if (buscadorProgramas) {
  buscadorProgramas.addEventListener('input', () => {
    // Al escribir en el buscador, respetamos el orden activo
    aplicarFiltroYOrden();
  });
}

/**
 * Función central del módulo 1: combina filtro y orden, luego renderiza.
 *
 * Separar este paso de renderizarTablaProgramas es importante:
 * ambas operaciones (filtrar y ordenar) actúan sobre los datos originales,
 * nunca sobre el DOM ni sobre una lista ya modificada.
 */
function aplicarFiltroYOrden() {
  const termino = buscadorProgramas
    ? buscadorProgramas.value.toLowerCase().trim()
    : '';

  // 1. FILTRAR — buscamos en nombre y editor
  let resultado = datosProgramas.filter(p =>
    p.nombre.toLowerCase().includes(termino) ||
    (p.editor && p.editor.toLowerCase().includes(termino))
  );

  // 2. ORDENAR — sobre la lista ya filtrada
  resultado = ordenarProgramas(resultado, ordenActual.col, ordenActual.dir);

  // 3. RENDERIZAR
  renderizarTablaProgramas(resultado);
}

/**
 * Ordena una lista de programas por el campo y dirección indicados.
 * Devuelve un nuevo array sin modificar el original (spread [...]).
 *
 * @param {Array}  programas
 * @param {string} col - 'nombre' | 'version' | 'editor' | 'fechaInstalacion' | 'tipo'
 * @param {string} dir - 'asc' | 'desc'
 * @returns {Array}
 */
function ordenarProgramas(programas, col, dir) {
  return [...programas].sort((a, b) => {
    let valA, valB;

    // 'tipo' no es un campo directo: lo derivamos de esDelSistema
    if (col === 'tipo') {
      valA = a.esDelSistema ? 'Sistema' : 'Usuario';
      valB = b.esDelSistema ? 'Sistema' : 'Usuario';
    } else {
      valA = a[col] || '';
      valB = b[col] || '';
    }

    // localeCompare con 'es' respeta la ñ, tildes y mayúsculas correctamente.
    // numeric:true hace que "v2" < "v10" en lugar de "v2" > "v10".
    const comparacion = String(valA).localeCompare(String(valB), 'es', {
      sensitivity: 'base',
      numeric: true,
    });

    return dir === 'asc' ? comparacion : -comparacion;
  });
}

/**
 * Llena el <tbody> de la tabla con la lista recibida.
 * Solo se ocupa del DOM — no filtra ni ordena nada.
 * @param {Array} programas
 */
function renderizarTablaProgramas(programas) {
  const tbody   = document.getElementById('tbody-programas');
  const contador = document.getElementById('contador-programas');

  contador.textContent = `${programas.length} programas encontrados`;
  tbody.innerHTML = '';

  programas.forEach(p => {
    const tr = document.createElement('tr');

    const chipTipo = p.esDelSistema
      ? '<span class="chip sistema">Sistema</span>'
      : '<span class="chip usuario">Usuario</span>';

    const iconoDesinstalador = p.tieneDesinstalador ? '✅' : '—';

    tr.innerHTML = `
      <td>${escaparHTML(p.nombre)}</td>
      <td>${escaparHTML(p.version || '—')}</td>
      <td>${escaparHTML(p.editor || '—')}</td>
      <td>${escaparHTML(p.fechaInstalacion || '—')}</td>
      <td>${chipTipo}</td>
      <td style="text-align:center">${iconoDesinstalador}</td>
    `;

    tbody.appendChild(tr);
  });
}

// ── Botones de exportación ───────────────────────────────────
['json', 'csv', 'pdf'].forEach(formato => {
  const btn = document.getElementById(`btn-export-${formato}`);
  if (!btn) return;

  btn.addEventListener('click', async () => {
    if (datosProgramas.length === 0) {
      alert('Primero debes escanear los programas.');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Exportando...';

    try {
      const resultado = await window.electronAPI.exportarProgramas(formato, datosProgramas);

      if (resultado.exito) {
        // Ofrecemos abrir la carpeta donde se guardó el archivo
        const abrir = confirm(`✅ Exportado correctamente.\n📁 ${resultado.ruta}\n\n¿Quieres abrir la carpeta?`);
        if (abrir) {
          // Extraemos la carpeta del path completo
          const carpeta = resultado.ruta.substring(0, resultado.ruta.lastIndexOf('\\'));
          await window.electronAPI.abrirCarpeta(carpeta);
        }
      } else if (resultado.razon !== 'cancelado') {
        alert(`Error al exportar: ${resultado.error}`);
      }
    } catch (err) {
      console.error('[Módulo 1] Error al exportar:', err);
      alert('Error inesperado al exportar.');
    } finally {
      btn.disabled = false;
      btn.textContent = `Exportar ${formato.toUpperCase()}`;
    }
  });
});

// =============================================================
// MÓDULO 2 — BUSCADOR DE INSTALADORES
// =============================================================

// Guardamos todos los instaladores encontrados (sin modificar)
let datosInstaladores = [];

// Estado de ordenamiento de la tabla de instaladores
let ordenInstaladores = { col: 'nombre', dir: 'asc' };

// ── Botón "Explorar": abre el selector de carpeta nativo ────
const btnExplorarRuta = document.getElementById('btn-explorar-ruta');
if (btnExplorarRuta) {
  btnExplorarRuta.addEventListener('click', async () => {
    const respuesta = await window.electronAPI.seleccionarCarpeta();
    if (respuesta && respuesta.exito) {
      document.getElementById('input-ruta-escaneo').value = respuesta.ruta;
    }
  });
}

// ── Botón "Escanear" ────────────────────────────────────────
const btnEscanearInst = document.getElementById('btn-escanear-instaladores');
if (btnEscanearInst) {
  btnEscanearInst.addEventListener('click', async () => {
    const ruta = document.getElementById('input-ruta-escaneo').value.trim();
    if (!ruta) {
      alert('Escribe una ruta antes de escanear.');
      return;
    }

    // Limpiamos listeners anteriores para evitar callbacks duplicados
    window.electronAPI.quitarListenersProgreso();

    // Registramos el listener de progreso ANTES de lanzar el escaneo
    window.electronAPI.onProgresoEscaneo(({ carpeta, encontrados }) => {
      // Acortamos la ruta si es muy larga para que quepa en pantalla
      const carpetaCorta = carpeta.length > 60
        ? '...' + carpeta.slice(-57)
        : carpeta;
      document.getElementById('progreso-carpeta').textContent = carpetaCorta;
      document.getElementById('progreso-encontrados').textContent =
        `${encontrados} encontrados`;
    });

    // Mostramos el estado de carga y ocultamos resultados anteriores
    document.getElementById('estado-instaladores').classList.remove('oculto');
    document.getElementById('tabla-instaladores').classList.add('oculto');
    document.getElementById('acciones-instaladores').classList.add('oculto');
    document.getElementById('barra-copia').classList.add('oculto');
    btnEscanearInst.disabled = true;
    btnEscanearInst.textContent = '⏳ Escaneando...';

    try {
      const resultado = await window.electronAPI.escanearInstaladores(ruta);

      if (resultado.exito) {
        datosInstaladores = resultado.datos;
        aplicarFiltroYOrdenInst();
        document.getElementById('tabla-instaladores').classList.remove('oculto');
        document.getElementById('acciones-instaladores').classList.remove('oculto');
        actualizarContadoresInst();
      } else {
        alert(`Error al escanear: ${resultado.error}`);
      }
    } catch (err) {
      console.error('[Módulo 2] Error inesperado:', err);
      alert('Error inesperado durante el escaneo. Revisa la consola.');
    } finally {
      document.getElementById('estado-instaladores').classList.add('oculto');
      btnEscanearInst.disabled = false;
      btnEscanearInst.textContent = '🔍 Escanear';
    }
  });
}

// ── Buscador en tiempo real ──────────────────────────────────
const buscadorInst = document.getElementById('buscador-instaladores');
if (buscadorInst) {
  buscadorInst.addEventListener('input', () => aplicarFiltroYOrdenInst());
}

// ── Ordenar por columna ──────────────────────────────────────
document.querySelectorAll('.th-ordenable[data-col-inst]').forEach(th => {
  th.addEventListener('click', () => {
    if (datosInstaladores.length === 0) return;

    const col = th.dataset.colInst;
    if (ordenInstaladores.col === col) {
      ordenInstaladores.dir = ordenInstaladores.dir === 'asc' ? 'desc' : 'asc';
    } else {
      ordenInstaladores.col = col;
      ordenInstaladores.dir = 'asc';
    }

    // Actualizamos visual de encabezados (solo los de esta tabla)
    document.querySelectorAll('.th-ordenable[data-col-inst]').forEach(otroTh => {
      otroTh.classList.remove('activo', 'asc', 'desc');
    });
    th.classList.add('activo', ordenInstaladores.dir);

    aplicarFiltroYOrdenInst();
  });
});

// ── Checkbox "seleccionar todos" del encabezado ─────────────
const checkTodos = document.getElementById('check-todos-instaladores');
if (checkTodos) {
  checkTodos.addEventListener('change', () => {
    const termino = buscadorInst ? buscadorInst.value.toLowerCase().trim() : '';
    // Solo afecta a los elementos visibles en la tabla filtrada actual
    datosInstaladores.forEach(inst => {
      const visible = inst.nombre.toLowerCase().includes(termino) ||
                      inst.carpeta.toLowerCase().includes(termino);
      if (visible) inst.seleccionado = checkTodos.checked;
    });
    aplicarFiltroYOrdenInst();
    actualizarContadoresInst();
  });
}

// ── Botones Seleccionar todo / Quitar selección ──────────────
document.getElementById('btn-seleccionar-todos')?.addEventListener('click', () => {
  datosInstaladores.forEach(i => i.seleccionado = true);
  aplicarFiltroYOrdenInst();
  actualizarContadoresInst();
});

document.getElementById('btn-deseleccionar-todos')?.addEventListener('click', () => {
  datosInstaladores.forEach(i => i.seleccionado = false);
  aplicarFiltroYOrdenInst();
  actualizarContadoresInst();
});

// ── Botón "Copiar selección" ─────────────────────────────────
document.getElementById('btn-copiar-seleccion')?.addEventListener('click', async () => {
  const seleccionados = datosInstaladores.filter(i => i.seleccionado);
  if (seleccionados.length === 0) return;

  // Pedimos confirmación con el modal reutilizable del Módulo 1
  const tamanoTotal = formatearBytes(seleccionados.reduce((s, i) => s + i.tamano, 0));
  const confirmo = await window.mostrarConfirmacion(
    '¿Copiar instaladores?',
    `Se copiarán ${seleccionados.length} archivos (${tamanoTotal}).\nElige la carpeta de destino en el siguiente paso.`
  );
  if (!confirmo) return;

  // Seleccionamos la carpeta de destino
  const respuestaDestino = await window.electronAPI.seleccionarCarpeta();
  if (!respuestaDestino || !respuestaDestino.exito) return;
  const destino = respuestaDestino.ruta;

  // Mostramos la barra de progreso de copia
  const barraCopia = document.getElementById('barra-copia');
  barraCopia.classList.remove('oculto');
  document.getElementById('btn-copiar-seleccion').disabled = true;

  // Registramos el listener de progreso de copia
  window.electronAPI.quitarListenersProgreso();
  window.electronAPI.onProgresoCopia(({ actual, total, nombre }) => {
    document.getElementById('copia-archivo-actual').textContent = nombre;
    document.getElementById('copia-contador').textContent = `${actual} / ${total}`;
    const porcentaje = Math.round((actual / total) * 100);
    document.getElementById('progreso-barra-relleno').style.width = `${porcentaje}%`;
  });

  try {
    const resultado = await window.electronAPI.copiarInstaladores(seleccionados, destino);

    if (resultado.exito) {
      const { copiados, errores } = resultado.datos;
      let mensaje = `✅ ${copiados} archivo(s) copiados correctamente en:\n${destino}`;
      if (errores.length > 0) {
        mensaje += `\n\n⚠️ ${errores.length} archivo(s) fallaron:\n`;
        mensaje += errores.map(e => `• ${e.nombre}: ${e.error}`).join('\n');
      }
      const abrirCarpeta = confirm(mensaje + '\n\n¿Abrir la carpeta de destino?');
      if (abrirCarpeta) await window.electronAPI.abrirCarpeta(destino);
    } else {
      alert(`Error al copiar: ${resultado.error}`);
    }
  } catch (err) {
    console.error('[Módulo 2] Error al copiar:', err);
    alert('Error inesperado al copiar archivos.');
  } finally {
    barraCopia.classList.add('oculto');
    document.getElementById('btn-copiar-seleccion').disabled = false;
    document.getElementById('progreso-barra-relleno').style.width = '0%';
  }
});

/**
 * Aplica el filtro de texto y el orden actual, luego renderiza.
 */
function aplicarFiltroYOrdenInst() {
  const termino = buscadorInst
    ? buscadorInst.value.toLowerCase().trim()
    : '';

  let resultado = datosInstaladores.filter(i =>
    i.nombre.toLowerCase().includes(termino) ||
    i.carpeta.toLowerCase().includes(termino)
  );

  resultado = ordenarInstaladores(resultado, ordenInstaladores.col, ordenInstaladores.dir);
  renderizarTablaInstaladores(resultado);
}

/**
 * Ordena una lista de instaladores.
 */
function ordenarInstaladores(lista, col, dir) {
  return [...lista].sort((a, b) => {
    // El tamaño es numérico, el resto son strings
    if (col === 'tamano') {
      return dir === 'asc' ? a.tamano - b.tamano : b.tamano - a.tamano;
    }
    const comp = String(a[col] || '').localeCompare(String(b[col] || ''), 'es', {
      sensitivity: 'base',
      numeric: true,
    });
    return dir === 'asc' ? comp : -comp;
  });
}

/**
 * Renderiza la tabla de instaladores en el DOM.
 */
function renderizarTablaInstaladores(lista) {
  const tbody = document.getElementById('tbody-instaladores');
  tbody.innerHTML = '';

  lista.forEach(inst => {
    const tr = document.createElement('tr');
    if (inst.seleccionado) tr.classList.add('fila-seleccionada');

    // Chip de tipo de archivo
    const colorChip = inst.extension === 'MSI'  ? 'chip-msi'
                    : inst.extension === 'MSIX' ? 'chip-msix'
                    : 'chip-exe';

    // Hash: si ya está calculado lo mostramos, si no, un botón para calcularlo
    const hashCelda = inst.hash
      ? `<code class="hash-valor" title="${inst.hash}">${inst.hash.slice(0, 12)}…</code>`
      : `<button class="btn-hash" data-ruta="${escaparHTML(inst.ruta)}">Calcular</button>`;

    tr.innerHTML = `
      <td style="text-align:center">
        <input type="checkbox" class="check-instalador" data-id="${escaparHTML(inst.id)}"
               ${inst.seleccionado ? 'checked' : ''} />
      </td>
      <td class="celda-nombre" title="${escaparHTML(inst.ruta)}">
        ${escaparHTML(inst.nombre)}
      </td>
      <td class="celda-ruta">${escaparHTML(inst.carpeta)}</td>
      <td style="text-align:right">${formatearBytes(inst.tamano)}</td>
      <td><span class="chip ${colorChip}">${inst.extension}</span></td>
      <td>${inst.fechaModificacion}</td>
      <td>${hashCelda}</td>
    `;

    tbody.appendChild(tr);
  });

  // Delegación de eventos: un solo listener para todos los checkboxes
  tbody.querySelectorAll('.check-instalador').forEach(chk => {
    chk.addEventListener('change', () => {
      const inst = datosInstaladores.find(i => i.id === chk.dataset.id);
      if (inst) {
        inst.seleccionado = chk.checked;
        chk.closest('tr').classList.toggle('fila-seleccionada', chk.checked);
        actualizarContadoresInst();
      }
    });
  });

  // Botones de calcular hash
  tbody.querySelectorAll('.btn-hash').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ruta = btn.dataset.ruta;
      btn.disabled = true;
      btn.textContent = '⏳';

      try {
        const resultado = await window.electronAPI.calcularHash(ruta);
        if (resultado.exito) {
          // Guardamos el hash en los datos para no recalcular
          const inst = datosInstaladores.find(i => i.ruta === ruta);
          if (inst) inst.hash = resultado.hash;
          // Actualizamos solo esta celda sin re-renderizar toda la tabla
          btn.outerHTML = `<code class="hash-valor" title="${resultado.hash}">${resultado.hash.slice(0, 12)}…</code>`;
        } else {
          btn.textContent = '❌ Error';
          btn.disabled = false;
        }
      } catch {
        btn.textContent = '❌ Error';
        btn.disabled = false;
      }
    });
  });
}

/**
 * Actualiza los contadores de la barra de acciones.
 */
function actualizarContadoresInst() {
  const seleccionados = datosInstaladores.filter(i => i.seleccionado);
  const tamanoTotal   = seleccionados.reduce((s, i) => s + i.tamano, 0);

  document.getElementById('contador-instaladores').textContent =
    `${datosInstaladores.length} archivos encontrados`;
  document.getElementById('contador-seleccionados').textContent =
    `${seleccionados.length} seleccionados`;
  document.getElementById('tamano-seleccionados').textContent =
    formatearBytes(tamanoTotal);

  // Habilitamos el botón de copia solo si hay algo seleccionado
  const btnCopiar = document.getElementById('btn-copiar-seleccion');
  if (btnCopiar) btnCopiar.disabled = seleccionados.length === 0;
}

// =============================================================
// MÓDULO 3 — LIMPIEZA DE BASURA
// =============================================================
//
// FLUJO DE ESTE MÓDULO (importante entenderlo antes de leer el código):
//
//   1. Usuario pulsa "Analizar sistema"
//      → Le pedimos al main que lea el disco (sin tocar nada)
//      → El main envía progreso mientras lee cada categoría
//      → Mostramos las categorías con sus archivos y el espacio que ocupan
//
//   2. Usuario revisa y marca/desmarca categorías o archivos individuales
//      → Actualizamos los contadores en tiempo real
//
//   3. Usuario pulsa "Mover a papelera"
//      → Mostramos el modal de confirmación (obligatorio)
//      → Solo si confirma, enviamos la lista al main para que elimine
//      → El main envía progreso por cada archivo movido
//      → Mostramos resultado: cuántos se movieron y si hubo errores
//
// =============================================================

// Guardamos los datos del análisis para poder releerlos sin
// volver a escanear el disco si el usuario cambia selecciones.
let datosBasura = [];

// ── Botón "Analizar sistema" ─────────────────────────────────
const btnAnalizar = document.getElementById('btn-analizar-basura');
if (btnAnalizar) {
  btnAnalizar.addEventListener('click', async () => {

    // Limpiamos listeners anteriores para evitar callbacks duplicados
    // si el usuario pulsa "Analizar" más de una vez en la misma sesión.
    window.electronAPI.quitarListenersBasura();

    // Registramos el listener de progreso ANTES de lanzar el análisis.
    // El main irá enviando eventos 'progreso-analisis-basura' mientras
    // recorre cada categoría, y aquí los mostramos en la UI.
    window.electronAPI.onProgresoAnalisisBasura(({ categoria }) => {
      document.getElementById('progreso-categoria-basura').textContent = categoria;
    });

    // Preparamos la UI: mostramos el spinner y ocultamos resultados anteriores
    document.getElementById('estado-basura').classList.remove('oculto');
    document.getElementById('categorias-limpieza').classList.add('oculto');
    document.getElementById('aviso-basura').classList.add('oculto');
    document.getElementById('pie-limpieza').classList.add('oculto');
    document.getElementById('resumen-espacio').classList.add('oculto');
    btnAnalizar.disabled = true;
    btnAnalizar.textContent = '⏳ Analizando...';

    try {
      const resultado = await window.electronAPI.analizarBasura();

      if (resultado.exito) {
        datosBasura = resultado.datos;
        renderizarCategoriasBasura(datosBasura);

        document.getElementById('categorias-limpieza').classList.remove('oculto');
        document.getElementById('aviso-basura').classList.remove('oculto');
        document.getElementById('resumen-espacio').classList.remove('oculto');
        actualizarResumenBasura();
      } else {
        alert(`Error al analizar: ${resultado.error}`);
      }
    } catch (err) {
      console.error('[Módulo 3] Error inesperado al analizar:', err);
      alert('Error inesperado. Revisa la consola (Ctrl+Shift+I).');
    } finally {
      document.getElementById('estado-basura').classList.add('oculto');
      btnAnalizar.disabled = false;
      btnAnalizar.textContent = '🔍 Analizar sistema';
    }
  });
}

// ── Botón "Mover a papelera" ─────────────────────────────────
const btnEliminar = document.getElementById('btn-eliminar-seleccion');
if (btnEliminar) {
  btnEliminar.addEventListener('click', async () => {

    // Recopilamos todos los archivos marcados en todas las categorías
    const archivosSeleccionados = [];
    datosBasura.forEach(categoria => {
      categoria.archivos.forEach(archivo => {
        if (archivo.seleccionado) archivosSeleccionados.push(archivo);
      });
    });

    if (archivosSeleccionados.length === 0) return;

    // ── PASO DE CONFIRMACIÓN OBLIGATORIO ────────────────────
    // Este modal es el guardián de seguridad.
    // La eliminación NO puede ocurrir sin pasar por aquí.
    const espacioTotal = archivosSeleccionados.reduce((s, a) => s + a.tamano, 0);
    const confirmo = await window.mostrarConfirmacion(
      '¿Mover archivos a la papelera?',
      `Se moverán ${archivosSeleccionados.length} archivos (${formatearBytes(espacioTotal)}) ` +
      `a la Papelera de Reciclaje.\n\nPodrás recuperarlos desde ahí si lo necesitas.`
    );

    if (!confirmo) return;

    // ── PROCESO DE ELIMINACIÓN ───────────────────────────────
    const barraEliminacion = document.getElementById('barra-eliminacion');
    barraEliminacion.classList.remove('oculto');
    btnEliminar.disabled = true;

    window.electronAPI.quitarListenersBasura();
    window.electronAPI.onProgresoEliminacion(({ actual, total, nombre }) => {
      document.getElementById('eliminacion-archivo-actual').textContent = nombre;
      document.getElementById('eliminacion-contador').textContent = `${actual} / ${total}`;
      const porcentaje = Math.round((actual / total) * 100);
      document.getElementById('progreso-eliminacion-relleno').style.width = `${porcentaje}%`;
    });

    try {
      const resultado = await window.electronAPI.eliminarArchivosConfirmado(archivosSeleccionados);

      if (resultado.exito) {
        const { eliminados, errores } = resultado.datos;
        let mensaje = `✅ ${eliminados} archivo(s) movidos a la Papelera de Reciclaje.`;
        if (errores.length > 0) {
          mensaje += `\n\n⚠️ ${errores.length} archivo(s) no se pudieron mover ` +
                     `(probablemente estaban en uso por otro programa):\n`;
          mensaje += errores.map(e => `• ${e.nombre}`).join('\n');
        }
        alert(mensaje);
        // Volvemos a analizar para reflejar el nuevo estado del disco
        btnAnalizar.click();
      } else {
        alert(`Error al eliminar: ${resultado.error}`);
      }
    } catch (err) {
      console.error('[Módulo 3] Error inesperado al eliminar:', err);
      alert('Error inesperado al mover los archivos. Revisa la consola.');
    } finally {
      barraEliminacion.classList.add('oculto');
      btnEliminar.disabled = false;
      document.getElementById('progreso-eliminacion-relleno').style.width = '0%';
    }
  });
}

/**
 * Construye dinámicamente las tarjetas de cada categoría en el DOM.
 * Cada tarjeta muestra nombre, descripción, espacio ocupado y
 * un listado expandible de archivos que se pueden marcar individualmente.
 *
 * @param {Array} categorias - Array devuelto por junkCleaner.analizar()
 */
function renderizarCategoriasBasura(categorias) {
  const contenedor = document.getElementById('categorias-limpieza');
  contenedor.innerHTML = '';

  categorias.forEach(categoria => {
    // No mostramos categorías vacías para no confundir al usuario
    if (categoria.archivos.length === 0) return;

    const tarjeta = document.createElement('div');
    tarjeta.className = 'categoria-limpieza';
    tarjeta.dataset.id = categoria.id;

    tarjeta.innerHTML = `
      <div class="categoria-cabecera">
        <label class="categoria-check-label">
          <input type="checkbox" class="check-categoria"
                 data-categoria-id="${categoria.id}" checked />
          <span class="categoria-nombre">${escaparHTML(categoria.nombre)}</span>
        </label>
        <div class="categoria-meta">
          <span class="categoria-archivos">${categoria.archivos.length} archivos</span>
          <span class="categoria-espacio">${formatearBytes(categoria.espacioTotal)}</span>
          <button class="btn-expandir" data-categoria-id="${categoria.id}">
            Ver archivos ▼
          </button>
        </div>
      </div>
      <p class="categoria-descripcion">${escaparHTML(categoria.descripcion)}</p>
      <div class="categoria-archivos-lista oculto" id="lista-${categoria.id}">
        ${categoria.archivos.map(archivo => `
          <label class="archivo-item">
            <input type="checkbox" class="check-archivo"
                   data-categoria-id="${categoria.id}"
                   data-ruta="${escaparHTML(archivo.ruta)}" checked />
            <span class="archivo-nombre" title="${escaparHTML(archivo.ruta)}">
              ${escaparHTML(archivo.nombre)}
            </span>
            <span class="archivo-tamano">${formatearBytes(archivo.tamano)}</span>
          </label>
        `).join('')}
      </div>
    `;

    contenedor.appendChild(tarjeta);
  });

  // Inicializamos todos los archivos como seleccionados en los datos
  datosBasura.forEach(cat => {
    cat.archivos.forEach(a => a.seleccionado = true);
    cat.seleccionada = true;
  });

  adjuntarEventosCategoria();
  actualizarResumenBasura();
}

/**
 * Adjunta los event listeners a los checkboxes y botones de expandir.
 * Se llama después de renderizar para que los elementos ya existan en el DOM.
 */
function adjuntarEventosCategoria() {

  // ── Checkboxes de categoría (marcan/desmarcan todos sus archivos) ──
  document.querySelectorAll('.check-categoria').forEach(chk => {
    chk.addEventListener('change', () => {
      const catId = chk.dataset.categoriaId;
      const categoria = datosBasura.find(c => c.id === catId);
      if (!categoria) return;

      categoria.archivos.forEach(a => a.seleccionado = chk.checked);
      categoria.seleccionada = chk.checked;

      // Sincronizamos los checkboxes individuales visibles en el DOM
      document.querySelectorAll(`.check-archivo[data-categoria-id="${catId}"]`)
        .forEach(chkArchivo => { chkArchivo.checked = chk.checked; });

      actualizarResumenBasura();
    });
  });

  // ── Checkboxes individuales de archivo ──────────────────────────────
  document.querySelectorAll('.check-archivo').forEach(chk => {
    chk.addEventListener('change', () => {
      const catId = chk.dataset.categoriaId;
      const ruta  = chk.dataset.ruta;

      const categoria = datosBasura.find(c => c.id === catId);
      if (!categoria) return;

      const archivo = categoria.archivos.find(a => a.ruta === ruta);
      if (archivo) archivo.seleccionado = chk.checked;

      // Actualizamos el estado del checkbox de categoría padre:
      // marcado, desmarcado o indeterminado (guión) según la selección parcial
      const checkCat = document.querySelector(`.check-categoria[data-categoria-id="${catId}"]`);
      if (checkCat) {
        const todosSeleccionados = categoria.archivos.every(a => a.seleccionado);
        const algunoSeleccionado = categoria.archivos.some(a => a.seleccionado);
        checkCat.checked       = todosSeleccionados;
        // "indeterminate" es el estado visual de guión (-) cuando la selección es parcial
        checkCat.indeterminate = !todosSeleccionados && algunoSeleccionado;
      }

      actualizarResumenBasura();
    });
  });

  // ── Botones expandir/colapsar lista de archivos ──────────────────────
  document.querySelectorAll('.btn-expandir').forEach(btn => {
    btn.addEventListener('click', () => {
      const catId = btn.dataset.categoriaId;
      const lista = document.getElementById(`lista-${catId}`);
      if (!lista) return;

      const expandido = !lista.classList.contains('oculto');
      lista.classList.toggle('oculto', expandido);
      btn.textContent = expandido ? 'Ver archivos ▼' : 'Ocultar archivos ▲';
    });
  });
}

/**
 * Recalcula y actualiza todos los contadores de la UI:
 * espacio total recuperable, archivos seleccionados y botón de eliminar.
 */
function actualizarResumenBasura() {
  let totalArchivos       = 0;
  let totalEspacio        = 0;
  let espacioRecuperable  = 0;

  datosBasura.forEach(categoria => {
    categoria.archivos.forEach(archivo => {
      espacioRecuperable += archivo.tamano;
      if (archivo.seleccionado) {
        totalArchivos++;
        totalEspacio += archivo.tamano;
      }
    });
  });

  const elEspacioTotal = document.getElementById('espacio-total-recuperable');
  if (elEspacioTotal) elEspacioTotal.textContent = formatearBytes(espacioRecuperable);

  const elResumen = document.getElementById('resumen-seleccion-basura');
  if (elResumen) {
    elResumen.textContent =
      `${totalArchivos} archivos seleccionados · ${formatearBytes(totalEspacio)}`;
  }

  // Mostramos el pie solo cuando hay algo seleccionado
  const pie = document.getElementById('pie-limpieza');
  if (pie) pie.classList.toggle('oculto', totalArchivos === 0);

  const btnElim = document.getElementById('btn-eliminar-seleccion');
  if (btnElim) btnElim.disabled = totalArchivos === 0;
}

// =============================================================
// MÓDULO 4 — REORGANIZADOR DE ARCHIVOS PERSONALES
// =============================================================
//
// FLUJO DE ESTE MÓDULO:
//
//   1. Usuario pulsa "Escanear mis carpetas"
//      → El main lee Escritorio, Documentos, Descargas, Imágenes, Vídeos, Música
//      → Devuelve estadísticas por carpeta agrupadas por tipo de archivo
//      → Mostramos tarjetas con resumen visual de cada carpeta
//
//   2. Usuario selecciona qué carpetas o archivos quiere respaldar
//      → Elige el modo: Copiar (seguro) o Mover (el original desaparece)
//      → Elige si quiere organizar en subcarpetas por tipo
//
//   3. Usuario pulsa "Respaldar selección"
//      → Confirmación obligatoria (doble si el modo es "mover")
//      → Elige la carpeta de destino
//      → El main transfiere con progreso en tiempo real
//
// =============================================================

// Guardamos los datos del escaneo para no repetirlo si el usuario
// cambia la selección sin volver a escanear.
let datosPersonales = [];

// ── Botón "Escanear mis carpetas" ────────────────────────────
const btnEscanearPersonales = document.getElementById('btn-escanear-personales');
if (btnEscanearPersonales) {
  btnEscanearPersonales.addEventListener('click', async () => {

    // Limpiamos listeners anteriores para evitar callbacks duplicados
    window.electronAPI.quitarListenersPersonales();

    // Registramos el listener de progreso antes de lanzar el escaneo
    window.electronAPI.onProgresoEscaneoPersonales(({ carpeta }) => {
      document.getElementById('progreso-carpeta-personal').textContent = carpeta;
    });

    // Preparamos la UI
    document.getElementById('estado-personales').classList.remove('oculto');
    document.getElementById('carpetas-personales').classList.add('oculto');
    document.getElementById('panel-opciones').classList.add('oculto');
    document.getElementById('resumen-personales').classList.add('oculto');
    btnEscanearPersonales.disabled = true;
    btnEscanearPersonales.textContent = '⏳ Escaneando...';

    try {
      const resultado = await window.electronAPI.escanearPersonales();

      if (resultado.exito) {
        datosPersonales = resultado.datos;
        renderizarCarpetasPersonales(datosPersonales);

        document.getElementById('carpetas-personales').classList.remove('oculto');
        document.getElementById('panel-opciones').classList.remove('oculto');
        document.getElementById('resumen-personales').classList.remove('oculto');
        actualizarResumenPersonales();
      } else {
        alert(`Error al escanear: ${resultado.error}`);
      }
    } catch (err) {
      console.error('[Módulo 4] Error inesperado:', err);
      alert('Error inesperado al escanear carpetas. Revisa la consola.');
    } finally {
      document.getElementById('estado-personales').classList.add('oculto');
      btnEscanearPersonales.disabled = false;
      btnEscanearPersonales.textContent = '🔍 Escanear mis carpetas';
    }
  });
}

// ── Botón "Respaldar selección" ──────────────────────────────
const btnTransferir = document.getElementById('btn-transferir-seleccion');
if (btnTransferir) {
  btnTransferir.addEventListener('click', async () => {

    // Recopilamos todos los archivos seleccionados de todas las carpetas
    const archivosSeleccionados = [];
    datosPersonales.forEach(carpeta => {
      carpeta.archivos.forEach(archivo => {
        if (archivo.seleccionado) archivosSeleccionados.push(archivo);
      });
    });

    if (archivosSeleccionados.length === 0) return;

    // Leemos las opciones elegidas por el usuario
    const modoElegido = document.querySelector('input[name="modo-transferencia"]:checked')?.value || 'copiar';
    const organizarPorTipo = document.getElementById('check-organizar-tipo')?.checked ?? true;

    // ── CONFIRMACIÓN OBLIGATORIA ─────────────────────────────
    // Si el modo es "mover", añadimos una advertencia extra porque
    // el original desaparecerá de su ubicación actual.
    const espacioTotal = archivosSeleccionados.reduce((s, a) => s + a.tamano, 0);
    const advertenciaMover = modoElegido === 'mover'
      ? '\n\n⚠️ MODO MOVER: Los archivos desaparecerán de su ubicación original.'
      : '';

    const confirmo = await window.mostrarConfirmacion(
      `¿${modoElegido === 'copiar' ? 'Copiar' : 'Mover'} archivos?`,
      `Se ${modoElegido === 'copiar' ? 'copiarán' : 'moverán'} ` +
      `${archivosSeleccionados.length} archivos (${formatearBytes(espacioTotal)}).` +
      advertenciaMover +
      '\n\nElige la carpeta de destino en el siguiente paso.'
    );

    if (!confirmo) return;

    // Seleccionamos la carpeta de destino con el diálogo nativo de Windows
    const respuestaDestino = await window.electronAPI.seleccionarCarpeta();
    if (!respuestaDestino || !respuestaDestino.exito) return;
    const destino = respuestaDestino.ruta;

    // ── PROCESO DE TRANSFERENCIA ─────────────────────────────
    const barraTransferencia = document.getElementById('barra-transferencia');
    barraTransferencia.classList.remove('oculto');
    btnTransferir.disabled = true;

    // Listener de progreso de transferencia
    window.electronAPI.quitarListenersPersonales();
    window.electronAPI.onProgresoTransferencia(({ actual, total, nombre }) => {
      document.getElementById('transferencia-archivo-actual').textContent = nombre;
      document.getElementById('transferencia-contador').textContent = `${actual} / ${total}`;
      const porcentaje = Math.round((actual / total) * 100);
      document.getElementById('progreso-transferencia-relleno').style.width = `${porcentaje}%`;
    });

    try {
      const resultado = await window.electronAPI.transferirArchivosConfirmado(
        archivosSeleccionados, destino, modoElegido, organizarPorTipo
      );

      if (resultado.exito) {
        const { transferidos, errores } = resultado.datos;
        let mensaje = `✅ ${transferidos} archivo(s) ${modoElegido === 'copiar' ? 'copiados' : 'movidos'} correctamente.`;
        if (errores.length > 0) {
          mensaje += `\n\n⚠️ ${errores.length} archivo(s) fallaron:\n`;
          mensaje += errores.map(e => `• ${e.nombre}: ${e.error}`).join('\n');
        }
        const abrirCarpeta = confirm(mensaje + '\n\n¿Abrir la carpeta de destino?');
        if (abrirCarpeta) await window.electronAPI.abrirCarpeta(destino);

        // Si el modo fue "mover", re-escaneamos para actualizar la vista
        if (modoElegido === 'mover') btnEscanearPersonales.click();
      } else {
        alert(`Error al transferir: ${resultado.error}`);
      }
    } catch (err) {
      console.error('[Módulo 4] Error inesperado al transferir:', err);
      alert('Error inesperado al transferir archivos. Revisa la consola.');
    } finally {
      barraTransferencia.classList.add('oculto');
      btnTransferir.disabled = false;
      document.getElementById('progreso-transferencia-relleno').style.width = '0%';
    }
  });
}

// ── Actualizar resumen cuando cambia el modo ─────────────────
// Si el usuario cambia de "Copiar" a "Mover", actualizamos el
// texto del botón para que sea siempre claro qué va a pasar.
document.querySelectorAll('input[name="modo-transferencia"]').forEach(radio => {
  radio.addEventListener('change', () => actualizarResumenPersonales());
});

/**
 * Construye dinámicamente las tarjetas de cada carpeta personal.
 * Cada tarjeta muestra el nombre de la carpeta, las estadísticas
 * por tipo de archivo y permite seleccionar archivos individualmente.
 *
 * @param {Array} carpetas - Array devuelto por fileOrganizer.escanear()
 */
function renderizarCarpetasPersonales(carpetas) {
  const contenedor = document.getElementById('carpetas-personales');
  contenedor.innerHTML = '';

  carpetas.forEach(carpeta => {
    const tarjeta = document.createElement('div');
    tarjeta.className = 'carpeta-personal';
    tarjeta.dataset.id = carpeta.id;

    // Construimos las pastillas de tipo (ej: 🖼️ 34 imágenes · 1.2 GB)
    const pastillasTipo = carpeta.porTipo.map(tipo =>
      `<span class="pastilla-tipo">
        ${tipo.icono} ${tipo.cantidad} ${tipo.nombre.toLowerCase()}
        · ${formatearBytes(tipo.espacioTotal)}
      </span>`
    ).join('');

    tarjeta.innerHTML = `
      <!-- Cabecera: checkbox + icono + nombre + espacio total -->
      <div class="carpeta-cabecera">
        <label class="carpeta-check-label">
          <input type="checkbox" class="check-carpeta"
                 data-carpeta-id="${carpeta.id}" />
          <span class="carpeta-icono">${carpeta.icono}</span>
          <span class="carpeta-nombre">${escaparHTML(carpeta.nombre)}</span>
        </label>
        <div class="carpeta-meta">
          <span class="carpeta-total">${carpeta.totalArchivos} archivos</span>
          <span class="categoria-espacio">${formatearBytes(carpeta.espacioTotal)}</span>
          <button class="btn-expandir" data-carpeta-id="${carpeta.id}">
            Ver archivos ▼
          </button>
        </div>
      </div>

      <!-- Pastillas de tipo de contenido -->
      <div class="pastillas-contenedor">
        ${pastillasTipo || '<span class="texto-dim">Carpeta vacía</span>'}
      </div>

      <!-- Lista expandible de archivos individuales -->
      <div class="carpeta-archivos-lista oculto" id="lista-carpeta-${carpeta.id}">
        ${carpeta.archivos.map(archivo => `
          <label class="archivo-item">
            <input type="checkbox" class="check-archivo-personal"
                   data-carpeta-id="${carpeta.id}"
                   data-ruta="${escaparHTML(archivo.ruta)}" />
            <span class="archivo-nombre" title="${escaparHTML(archivo.ruta)}">
              ${escaparHTML(archivo.nombre)}
            </span>
            <span class="archivo-tamano">${formatearBytes(archivo.tamano)}</span>
          </label>
        `).join('')}
      </div>
    `;

    contenedor.appendChild(tarjeta);
  });

  // Adjuntamos los eventos después de que todos los elementos están en el DOM
  adjuntarEventosPersonales();
}

/**
 * Adjunta los event listeners a los checkboxes y botones de expandir
 * de las tarjetas de carpetas personales.
 */
function adjuntarEventosPersonales() {

  // ── Checkbox de carpeta completa ────────────────────────────
  document.querySelectorAll('.check-carpeta').forEach(chk => {
    chk.addEventListener('change', () => {
      const carpetaId = chk.dataset.carpetaId;
      const carpeta = datosPersonales.find(c => c.id === carpetaId);
      if (!carpeta) return;

      // Marcamos/desmarcamos todos los archivos de esta carpeta
      carpeta.archivos.forEach(a => a.seleccionado = chk.checked);
      carpeta.seleccionada = chk.checked;

      // Sincronizamos los checkboxes individuales en el DOM
      document.querySelectorAll(`.check-archivo-personal[data-carpeta-id="${carpetaId}"]`)
        .forEach(chkArch => { chkArch.checked = chk.checked; });

      actualizarResumenPersonales();
    });
  });

  // ── Checkbox individual de archivo ──────────────────────────
  document.querySelectorAll('.check-archivo-personal').forEach(chk => {
    chk.addEventListener('change', () => {
      const carpetaId = chk.dataset.carpetaId;
      const ruta      = chk.dataset.ruta;

      const carpeta = datosPersonales.find(c => c.id === carpetaId);
      if (!carpeta) return;

      const archivo = carpeta.archivos.find(a => a.ruta === ruta);
      if (archivo) archivo.seleccionado = chk.checked;

      // Actualizamos el estado del checkbox padre de la carpeta
      const checkCarpeta = document.querySelector(`.check-carpeta[data-carpeta-id="${carpetaId}"]`);
      if (checkCarpeta) {
        const todosSeleccionados = carpeta.archivos.every(a => a.seleccionado);
        const algunoSeleccionado = carpeta.archivos.some(a => a.seleccionado);
        checkCarpeta.checked       = todosSeleccionados;
        checkCarpeta.indeterminate = !todosSeleccionados && algunoSeleccionado;
      }

      actualizarResumenPersonales();
    });
  });

  // ── Botones expandir/colapsar lista de archivos ──────────────
  document.querySelectorAll('.btn-expandir[data-carpeta-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const carpetaId = btn.dataset.carpetaId;
      const lista = document.getElementById(`lista-carpeta-${carpetaId}`);
      if (!lista) return;

      const expandido = !lista.classList.contains('oculto');
      lista.classList.toggle('oculto', expandido);
      btn.textContent = expandido ? 'Ver archivos ▼' : 'Ocultar archivos ▲';
    });
  });
}

/**
 * Recalcula y actualiza los contadores del panel de opciones:
 * archivos seleccionados, espacio total y texto del botón.
 */
function actualizarResumenPersonales() {
  let totalArchivos = 0;
  let totalEspacio  = 0;

  datosPersonales.forEach(carpeta => {
    carpeta.archivos.forEach(archivo => {
      if (archivo.seleccionado) {
        totalArchivos++;
        totalEspacio += archivo.tamano;
      }
    });
  });

  // Actualizamos el contador global en la barra superior
  const elTotal = document.getElementById('total-archivos-personales');
  if (elTotal) {
    const totalGeneral = datosPersonales.reduce((s, c) => s + c.totalArchivos, 0);
    elTotal.textContent = `${totalGeneral} archivos`;
  }

  // Actualizamos el resumen en el panel de opciones
  const elResumen = document.getElementById('resumen-seleccion-personales');
  if (elResumen) {
    if (totalArchivos === 0) {
      elResumen.textContent = 'Selecciona carpetas o archivos para continuar';
    } else {
      const modo = document.querySelector('input[name="modo-transferencia"]:checked')?.value || 'copiar';
      const accion = modo === 'copiar' ? 'Copiar' : 'Mover';
      elResumen.textContent = `${accion} ${totalArchivos} archivos · ${formatearBytes(totalEspacio)}`;
    }
  }

  // El botón de transferencia solo está activo si hay archivos seleccionados
  const btn = document.getElementById('btn-transferir-seleccion');
  if (btn) {
    btn.disabled = totalArchivos === 0;
    // Cambiamos el texto del botón según el modo elegido
    if (totalArchivos > 0) {
      const modo = document.querySelector('input[name="modo-transferencia"]:checked')?.value || 'copiar';
      btn.textContent = modo === 'copiar' ? '📋 Copiar selección' : '✂️ Mover selección';
    } else {
      btn.textContent = '📋 Respaldar selección';
    }
  }
}

// =============================================================
// MÓDULO 6 — PARTIDAS GUARDADAS (JUEGOS)
// =============================================================

let datosJuegosPartidas = [];
let metaPartidas = { advertencias: [], steamPath: null };

const btnDetectarPartidas = document.getElementById('btn-detectar-partidas');
const btnRespaldarPartidas = document.getElementById('btn-respaldar-partidas');

document.getElementById('btn-explorar-manual-partida')?.addEventListener('click', async () => {
  const respuesta = await window.electronAPI.seleccionarCarpeta();
  if (respuesta && respuesta.exito) {
    const input = document.getElementById('input-manual-partida-ruta');
    if (input) input.value = respuesta.ruta;
  }
});

document.getElementById('btn-anadir-manual-partida')?.addEventListener('click', async () => {
  const ruta = document.getElementById('input-manual-partida-ruta')?.value.trim() || '';
  const etiqueta =
    document.getElementById('input-manual-partida-etiqueta')?.value.trim() || 'Respaldo manual';
  if (!ruta) {
    alert('Indica una carpeta o archivo válido.');
    return;
  }

  try {
    const resultado = await window.electronAPI.verificarRutaPartida(ruta);
    if (!resultado.exito) {
      alert(resultado.error || 'No se pudo comprobar la ruta.');
      return;
    }
    const info = resultado.datos;
    datosJuegosPartidas.push({
      id: `manual-${Date.now()}`,
      nombre: etiqueta,
      fuente: 'manual',
      editor: '',
      confianza: 'media',
      rutasGuardado: [
        {
          etiqueta: info.existe ? 'Ruta comprobada' : 'Ruta (no accesible)',
          ruta: info.ruta || ruta,
          existe: !!info.existe,
          tamanoBytes: info.tamanoBytes || 0,
          seleccionado: !!info.existe,
        },
      ],
      seleccionado: !!info.existe,
    });
    document.getElementById('lista-juegos-partidas')?.classList.remove('oculto');
    renderizarListaJuegosPartidas();
    document.getElementById('input-manual-partida-ruta').value = '';
    document.getElementById('input-manual-partida-etiqueta').value = '';
  } catch (err) {
    console.error('[Módulo 6] Manual:', err);
    alert('Error al verificar la ruta.');
  }
});

if (btnDetectarPartidas) {
  btnDetectarPartidas.addEventListener('click', async () => {
    window.electronAPI.quitarListenersPartidas();

    window.electronAPI.onProgresoDeteccionJuegos(({ fase, mensaje }) => {
      const el = document.getElementById('progreso-texto-partidas');
      if (el) el.textContent = mensaje || fase || '...';
    });

    document.getElementById('estado-partidas')?.classList.remove('oculto');
    document.getElementById('lista-juegos-partidas')?.classList.add('oculto');
    document.getElementById('meta-partidas')?.classList.add('oculto');
    btnDetectarPartidas.disabled = true;
    btnDetectarPartidas.textContent = '⏳ Detectando...';

    try {
      const resultado = await window.electronAPI.detectarJuegosPartidas();

      if (resultado.exito) {
        metaPartidas = {
          advertencias: resultado.datos.advertencias || [],
          steamPath: resultado.datos.steamPath,
        };
        datosJuegosPartidas = (resultado.datos.juegos || []).map((j) => ({
          ...j,
          seleccionado: j.seleccionado !== false,
          rutasGuardado: (j.rutasGuardado || []).map((r) => ({
            ...r,
            seleccionado: r.seleccionado !== false,
          })),
        }));
        renderizarListaJuegosPartidas();
        document.getElementById('lista-juegos-partidas')?.classList.remove('oculto');

        const metaEl = document.getElementById('meta-partidas');
        if (metaEl) {
          const partes = [];
          if (metaPartidas.steamPath) {
            partes.push(`Steam: ${metaPartidas.steamPath}`);
          }
          if (metaPartidas.advertencias.length) {
            partes.push(metaPartidas.advertencias.join(' · '));
          }
          metaEl.textContent = partes.join('\n');
          metaEl.classList.toggle('oculto', partes.length === 0);
        }
      } else {
        alert(`Error: ${resultado.error}`);
      }
    } catch (err) {
      console.error('[Módulo 6] Error:', err);
      alert('Error inesperado al detectar juegos.');
    } finally {
      document.getElementById('estado-partidas')?.classList.add('oculto');
      btnDetectarPartidas.disabled = false;
      btnDetectarPartidas.textContent = '🔍 Detectar juegos y saves';
    }
  });
}

if (btnRespaldarPartidas) {
  btnRespaldarPartidas.addEventListener('click', async () => {
    const items = construirItemsRespaldoPartidas();
    if (items.length === 0) {
      alert('Selecciona al menos una carpeta de guardado existente.');
      return;
    }

    const totalRutas = items.reduce((n, it) => n + it.rutas.length, 0);
    const confirmo = await window.mostrarConfirmacion(
      '¿Respaldar partidas?',
      `Se copiarán ${totalRutas} carpeta(s) o archivo(s) desde ${items.length} juego(s).\n` +
        'Elige la carpeta de destino en el siguiente paso (USB, otro disco, etc.).'
    );
    if (!confirmo) return;

    const respuestaDestino = await window.electronAPI.seleccionarCarpeta();
    if (!respuestaDestino || !respuestaDestino.exito) return;
    const destino = respuestaDestino.ruta;

    window.electronAPI.quitarListenersPartidas();
    window.electronAPI.onProgresoRespaldoPartidas(({ actual, total, nombre }) => {
      const corto = nombre && nombre.length > 70 ? '…' + nombre.slice(-67) : nombre;
      document.getElementById('respaldo-partida-actual').textContent = corto || '...';
      document.getElementById('respaldo-partida-contador').textContent = `${actual} / ${total}`;
      const pct = total ? Math.round((actual / total) * 100) : 0;
      document.getElementById('progreso-respaldo-partidas-relleno').style.width = `${pct}%`;
    });

    const barra = document.getElementById('barra-respaldo-partidas');
    barra?.classList.remove('oculto');
    btnRespaldarPartidas.disabled = true;

    try {
      const resultado = await window.electronAPI.respaldarPartidasConfirmado(items, destino);

      if (resultado.exito) {
        const { copiados, errores } = resultado.datos;
        let msg = `✅ Operaciones completadas: ${copiados}.`;
        if (errores.length) {
          msg += `\n\n⚠️ ${errores.length} error(es):\n`;
          msg += errores.slice(0, 8).map((e) => `• ${e.ruta}: ${e.error}`).join('\n');
          if (errores.length > 8) msg += '\n…';
        }
        const abrir = confirm(msg + '\n\n¿Abrir la carpeta de destino?');
        if (abrir) await window.electronAPI.abrirCarpeta(destino);
      } else if (resultado.razon !== 'parametros-invalidos') {
        alert(`Error: ${resultado.error || resultado.razon}`);
      }
    } catch (err) {
      console.error('[Módulo 6] Respaldo:', err);
      alert('Error inesperado al respaldar.');
    } finally {
      barra?.classList.add('oculto');
      btnRespaldarPartidas.disabled = false;
      document.getElementById('progreso-respaldo-partidas-relleno').style.width = '0%';
    }
  });
}

function construirItemsRespaldoPartidas() {
  const items = [];
  for (const j of datosJuegosPartidas) {
    if (!j.seleccionado) continue;
    const rutas = (j.rutasGuardado || []).filter((r) => r.seleccionado && r.existe);
    if (rutas.length === 0) continue;
    items.push({
      nombre: j.nombre,
      rutas: rutas.map((r) => ({ ruta: r.ruta, etiqueta: r.etiqueta || 'Guardado' })),
    });
  }
  return items;
}

function actualizarBotonRespaldoPartidas() {
  const hay = construirItemsRespaldoPartidas().length > 0;
  if (btnRespaldarPartidas) btnRespaldarPartidas.disabled = !hay;
}

function renderizarListaJuegosPartidas() {
  const contenedor = document.getElementById('lista-juegos-partidas');
  if (!contenedor) return;

  contenedor.innerHTML = '';

  if (datosJuegosPartidas.length === 0) {
    contenedor.innerHTML = `
      <p class="sin-deteccion">No se detectaron juegos con los criterios actuales.
      Si usas launchers no listados, respalda manualmente las carpetas de documentos y AppData.</p>`;
    actualizarBotonRespaldoPartidas();
    return;
  }

  datosJuegosPartidas.forEach((j, idxJ) => {
    const tarjeta = document.createElement('div');
    tarjeta.className = 'categoria-limpieza juego-partida-tarjeta';

    const chipConf =
      j.confianza === 'alta'
        ? '<span class="chip usuario">Confianza alta</span>'
        : j.confianza === 'media'
          ? '<span class="chip sistema">Confianza media</span>'
          : '<span class="chip sistema">Confianza baja</span>';

    const rutasHtml = (j.rutasGuardado || [])
      .map(
        (r, idxR) => `
      <label class="archivo-item juego-ruta-item">
        <input type="checkbox" class="check-ruta-partida"
               data-juego="${idxJ}" data-ruta="${idxR}"
               ${r.seleccionado ? 'checked' : ''}
               ${r.existe ? '' : 'disabled'} />
        <span class="archivo-nombre" title="${escaparHTML(r.ruta)}">
          ${escaparHTML(r.etiqueta || 'Ruta')}
          ${r.existe ? '' : ' <em class="texto-dim">(no encontrada)</em>'}
        </span>
        <span class="archivo-tamano">${r.existe ? formatearBytes(r.tamanoBytes || 0) : '—'}</span>
      </label>
    `
      )
      .join('');

    tarjeta.innerHTML = `
      <div class="categoria-cabecera">
        <label class="categoria-check-label">
          <input type="checkbox" class="check-juego-partida" data-juego="${idxJ}" ${j.seleccionado ? 'checked' : ''} />
          <span class="categoria-nombre">${escaparHTML(j.nombre)}</span>
        </label>
        <div class="categoria-meta">
          <span class="categoria-archivos">${escaparHTML(j.fuente || '')}${j.appid ? ' · app ' + escaparHTML(String(j.appid)) : ''}</span>
          ${chipConf}
        </div>
      </div>
      <div class="categoria-archivos-lista" style="margin-top:8px">
        ${rutasHtml || '<p class="texto-dim">Sin rutas resueltas. Revisa si el juego guarda en la nube.</p>'}
      </div>
    `;

    contenedor.appendChild(tarjeta);
  });

  contenedor.querySelectorAll('.check-juego-partida').forEach((chk) => {
    chk.addEventListener('change', () => {
      const j = datosJuegosPartidas[Number(chk.dataset.juego)];
      if (!j) return;
      j.seleccionado = chk.checked;
      (j.rutasGuardado || []).forEach((r) => {
        if (r.existe) r.seleccionado = chk.checked;
      });
      renderizarListaJuegosPartidas();
    });
  });

  contenedor.querySelectorAll('.check-ruta-partida').forEach((chk) => {
    chk.addEventListener('change', () => {
      const ji = Number(chk.dataset.juego);
      const ri = Number(chk.dataset.ruta);
      const j = datosJuegosPartidas[ji];
      if (!j || !j.rutasGuardado[ri]) return;
      j.rutasGuardado[ri].seleccionado = chk.checked;
      j.seleccionado = j.rutasGuardado.some((r) => r.existe && r.seleccionado);
      actualizarBotonRespaldoPartidas();
    });
  });

  actualizarBotonRespaldoPartidas();
}

// =============================================================
// MÓDULO 7 — CERTIFICADOS DIGITALES
// =============================================================

let datosCertificados = [];

document.getElementById('btn-escanear-certificados')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-escanear-certificados');
  const estado = document.getElementById('estado-certificados');
  const tablaContenedor = document.getElementById('tabla-certificados');
  const barraProgreso = document.getElementById('barra-export-certificados');
  
  btn.disabled = true;
  btn.textContent = '⏳ Leyendo almacén...';
  estado.classList.remove('oculto');
  tablaContenedor.classList.add('oculto');
  barraProgreso.classList.add('oculto');

  try {
    const resultado = await window.electronAPI.escanearCertificados();
    if (resultado.exito) {
      datosCertificados = resultado.datos.map(c => ({
        ...c,
        // Parseamos nombres complejos (CN=Nombre, OU=Dpto...) para extraer el Nombre Común si es posible
        sujetoLimpio: extraerCN(c.Subject),
        emisorLimpio: extraerCN(c.Issuer),
        seleccionado: false
      }));
      renderizarTablaCertificados();
      tablaContenedor.classList.remove('oculto');
    } else {
      alert(`Error al detectar certificados: ${resultado.error}`);
    }
  } catch (err) {
    console.error('[Módulo 7] Error en escaneo:', err);
    alert('Error inesperado al escanear los certificados.');
  } finally {
    estado.classList.add('oculto');
    btn.disabled = false;
    btn.textContent = '🔍 Escanear mis certificados';
  }
});

function extraerCN(cadenaFull) {
  if (!cadenaFull) return 'Desconocido';
  const match = cadenaFull.match(/CN=([^,]+)/);
  return match ? match[1].trim() : cadenaFull;
}

function renderizarTablaCertificados() {
  const tbody = document.getElementById('tbody-certificados');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (datosCertificados.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="texto-dim" style="text-align:center">No se encontraron certificados personales instalados en este equipo.</td></tr>`;
    actualizarResumenCertificados();
    return;
  }

  datosCertificados.forEach((cert, idx) => {
    const tr = document.createElement('tr');
    if (cert.seleccionado) tr.classList.add('fila-seleccionada');

    const chipClave = cert.HasPrivateKey
      ? `<span class="chip usuario">Sí (.pfx)</span>`
      : `<span class="chip sistema">Público (.cer)</span>`;

    tr.innerHTML = `
      <td style="text-align:center">
        <input type="checkbox" class="check-cert" data-idx="${idx}" ${cert.seleccionado ? 'checked' : ''} />
      </td>
      <td title="${escaparHTML(cert.Subject)}">${escaparHTML(cert.sujetoLimpio)}</td>
      <td title="${escaparHTML(cert.Issuer)}" class="texto-dim">${escaparHTML(cert.emisorLimpio)}</td>
      <td>${escaparHTML(cert.Expira || '—')}</td>
      <td style="text-align:center">${chipClave}</td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.check-cert').forEach(chk => {
    chk.addEventListener('change', () => {
      datosCertificados[Number(chk.dataset.idx)].seleccionado = chk.checked;
      renderizarTablaCertificados();
    });
  });

  const checkTodos = document.getElementById('check-todos-certificados');
  if (checkTodos) {
    const todosMarcados = datosCertificados.length > 0 && datosCertificados.every(c => c.seleccionado);
    checkTodos.checked = todosMarcados;
    checkTodos.indeterminate = !todosMarcados && datosCertificados.some(c => c.seleccionado);
  }

  actualizarResumenCertificados();
}

document.getElementById('check-todos-certificados')?.addEventListener('change', (e) => {
  const estado = e.target.checked;
  datosCertificados.forEach(c => c.seleccionado = estado);
  renderizarTablaCertificados();
});

function actualizarResumenCertificados() {
  const seleccionados = datosCertificados.filter(c => c.seleccionado).length;
  const btn = document.getElementById('btn-exportar-certificados');
  const resumen = document.getElementById('resumen-seleccion-certificados');
  if (btn) btn.disabled = seleccionados === 0;
  if (resumen) resumen.textContent = `${seleccionados} certificados seleccionados`;
}

document.getElementById('btn-exportar-certificados')?.addEventListener('click', async () => {
  const seleccionados = datosCertificados.filter(c => c.seleccionado);
  if (seleccionados.length === 0) return;

  // Mapeamos lo que necesita el backend (thumbprint y si tiene clave)
  const certsParaBackend = seleccionados.map(c => ({ thumbprint: c.Thumbprint, tieneClavePrivada: c.HasPrivateKey }));
  const tienePFX = certsParaBackend.some(c => c.tieneClavePrivada);

  let passwordStr = 'sin-contraseña'; // Solo para los .cer

  if (tienePFX) {
    passwordStr = await solicitarPasswordCertificado();
    if (passwordStr === null) return; // Usuario canceló en el modal
  } else {
    const confirmo = await window.mostrarConfirmacion('¿Exportar certificados?', `Se exportarán ${seleccionados.length} certificado(s) públicos (.cer).\nNo requieren contraseña porque no contienen clave privada.`);
    if (!confirmo) return;
  }

  const respuestaDestino = await window.electronAPI.seleccionarCarpeta();
  if (!respuestaDestino || !respuestaDestino.exito) return;
  const destino = respuestaDestino.ruta;

  const btn = document.getElementById('btn-exportar-certificados');
  const barraProgreso = document.getElementById('barra-export-certificados');
  
  btn.disabled = true;
  barraProgreso.classList.remove('oculto');

  window.electronAPI.quitarListenersCertificados();
  window.electronAPI.onProgresoExportacionCertificados(({ actual, total, nombre }) => {
    document.getElementById('export-cert-actual').textContent = nombre;
    document.getElementById('export-cert-contador').textContent = `${actual} / ${total}`;
    document.getElementById('progreso-export-cert-relleno').style.width = `${Math.round((actual/total)*100)}%`;
  });

  try {
    const res = await window.electronAPI.exportarCertificadosConfirmado(certsParaBackend, destino, passwordStr);
    if (res.exito) {
      let msg = `✅ ${res.datos.exportados} certificados exportados con éxito.`;
      if (res.datos.errores.length > 0) {
        msg += `\n\n⚠️ ${res.datos.errores.length} errores (algunos certificados podrían no ser exportables por política del SO):`;
        res.datos.errores.forEach(err => msg += `\n- ${err.error}`);
      }
      if (confirm(msg + '\n\n¿Quieres abrir la carpeta destino?')) {
        await window.electronAPI.abrirCarpeta(destino);
      }
    } else {
      alert(`Error en la exportación: ${res.error}`);
    }
  } catch (err) {
    alert('Error inesperado al exportar.');
  } finally {
    btn.disabled = false;
    barraProgreso.classList.add('oculto');
    document.getElementById('progreso-export-cert-relleno').style.width = '0%';
  }
});

function solicitarPasswordCertificado() {
  return new Promise(resolve => {
    const modal = document.getElementById('modal-password-certificado');
    const input1 = document.getElementById('input-pass-cert');
    const input2 = document.getElementById('input-pass-cert-conf');
    const errorMsg = document.getElementById('error-pass-cert');
    const btnOk = document.getElementById('btn-confirmar-pass-cert');
    const btnCancel = document.getElementById('btn-cancelar-pass-cert');

    input1.value = '';
    input2.value = '';
    errorMsg.classList.add('oculto');
    modal.classList.remove('oculto');

    const limpiarYCerrar = () => {
      input1.value = '';
      input2.value = '';
      modal.classList.add('oculto');
      btnOk.removeEventListener('click', okHandler);
      btnCancel.removeEventListener('click', cancelHandler);
    };

    const cancelHandler = () => { limpiarYCerrar(); resolve(null); };
    const okHandler = () => {
      if (!input1.value || input1.value !== input2.value) {
        errorMsg.classList.remove('oculto');
        return;
      }
      const pass = input1.value;
      limpiarYCerrar();
      resolve(pass);
    };

    btnCancel.addEventListener('click', cancelHandler);
    btnOk.addEventListener('click', okHandler);
  });
}

// =============================================================
// MÓDULO 5 — CONTRASEÑAS Y CREDENCIALES
// =============================================================
//
// DISEÑO DE SEGURIDAD DE ESTE MÓDULO:
//
//   Este módulo tiene una filosofía diferente a los anteriores:
//   NO accede a ningún dato sensible automáticamente.
//   En su lugar, GUÍA al usuario para que exporte sus propios datos.
//
//   El único momento en que manejamos algo sensible es cuando el
//   usuario introduce una contraseña para cifrar su archivo exportado.
//   Esa contraseña:
//     - Se lee del input una sola vez
//     - Se pasa al main mediante IPC (comunicación interna, no por red)
//     - Se limpia del input inmediatamente después
//     - NUNCA se loggea ni se almacena en ningún sitio
//
// FLUJO:
//   1. Detectar qué gestores y navegadores están instalados
//   2. Mostrar guía paso a paso para cada uno detectado
//   3. El usuario exporta manualmente desde cada aplicación
//   4. El usuario usa la herramienta de cifrado para proteger el resultado
//
// =============================================================

// ── Botón "Detectar mis gestores y navegadores" ──────────────
const btnDetectarTodo = document.getElementById('btn-detectar-todo');
if (btnDetectarTodo) {
  btnDetectarTodo.addEventListener('click', async () => {

    document.getElementById('estado-contrasenas').classList.remove('oculto');
    document.getElementById('resultados-contrasenas').classList.add('oculto');
    btnDetectarTodo.disabled = true;
    btnDetectarTodo.textContent = '⏳ Detectando...';

    try {
      // Lanzamos las dos detecciones en paralelo con Promise.all.
      // Esto es más rápido que hacerlas una tras otra porque ambas
      // solo leen el sistema de archivos y no dependen la una de la otra.
      const [resGestores, resNavegadores] = await Promise.all([
        window.electronAPI.detectarGestores(),
        window.electronAPI.detectarNavegadores(),
      ]);

      if (resGestores.exito && resNavegadores.exito) {
        renderizarGestores(resGestores.datos);
        renderizarNavegadores(resNavegadores.datos);
        document.getElementById('resultados-contrasenas').classList.remove('oculto');
      } else {
        alert('Error al detectar aplicaciones. Revisa la consola.');
      }
    } catch (err) {
      console.error('[Módulo 5] Error inesperado:', err);
      alert('Error inesperado. Revisa la consola (Ctrl+Shift+I).');
    } finally {
      document.getElementById('estado-contrasenas').classList.add('oculto');
      btnDetectarTodo.disabled = false;
      btnDetectarTodo.textContent = '🔍 Detectar mis gestores y navegadores';
    }
  });
}

// =============================================================
// RENDERIZADO DE GESTORES Y NAVEGADORES
// =============================================================

/**
 * Construye las tarjetas de los gestores de contraseñas detectados.
 * Cada tarjeta tiene los pasos de exportación expandibles.
 *
 * @param {Array} gestores - Array devuelto por credentialHelper.detectarGestores()
 */
function renderizarGestores(gestores) {
  const contenedor = document.getElementById('lista-gestores');

  if (gestores.length === 0) {
    // Si no se detecta ninguno, lo indicamos claramente
    contenedor.innerHTML = `
      <p class="sin-deteccion">
        No se detectaron gestores de contraseñas instalados.
        Si usas uno que no aparece aquí, consulta su documentación oficial
        para exportar tus datos.
      </p>`;
    return;
  }

  contenedor.innerHTML = '';
  gestores.forEach(gestor => {
    contenedor.appendChild(crearTarjetaCredencial(gestor, 'gestor'));
  });
}

/**
 * Construye las tarjetas de los navegadores detectados.
 *
 * @param {Array} navegadores - Array devuelto por credentialHelper.detectarNavegadores()
 */
function renderizarNavegadores(navegadores) {
  const contenedor = document.getElementById('lista-navegadores');

  if (navegadores.length === 0) {
    contenedor.innerHTML = `
      <p class="sin-deteccion">
        No se detectaron navegadores con perfiles de usuario instalados.
      </p>`;
    return;
  }

  contenedor.innerHTML = '';
  navegadores.forEach(nav => {
    contenedor.appendChild(crearTarjetaCredencial(nav, 'navegador'));
  });
}

/**
 * Crea el elemento DOM de una tarjeta de gestor o navegador.
 * Reutilizamos la misma función para ambos porque tienen la misma estructura.
 *
 * @param {Object} app  - Objeto con { nombre, icono, pasos, advertencia }
 * @param {string} tipo - 'gestor' o 'navegador' (para el atributo data)
 * @returns {HTMLElement}
 */
function crearTarjetaCredencial(app, tipo) {
  const tarjeta = document.createElement('div');
  tarjeta.className = 'tarjeta-credencial';
  tarjeta.dataset.tipo = tipo;

  // Si el gestor/navegador tiene una advertencia especial (ej: "archivo en texto plano"),
  // la mostramos en rojo de forma destacada para que no pase desapercibida.
  const htmlAdvertencia = app.advertencia
    ? `<div class="credencial-advertencia">⚠️ ${escaparHTML(app.advertencia)}</div>`
    : '';

  // Numeramos los pasos automáticamente con un contador CSS
  const htmlPasos = app.pasos.map((paso, i) =>
    `<li class="paso-item">
      <span class="paso-numero">${i + 1}</span>
      <span class="paso-texto">${escaparHTML(paso)}</span>
    </li>`
  ).join('');

  // Generamos un ID único para este acordeón usando el nombre de la app
  const idAcordeon = `pasos-${tipo}-${app.nombre.replace(/\s+/g, '-').toLowerCase()}`;

  tarjeta.innerHTML = `
    <div class="credencial-cabecera">
      <div class="credencial-identidad">
        <span class="credencial-icono">${app.icono}</span>
        <span class="credencial-nombre">${escaparHTML(app.nombre)}</span>
      </div>
      <button class="btn-expandir" data-acordeon="${idAcordeon}">
        Ver guía de exportación ▼
      </button>
    </div>
    ${htmlAdvertencia}
    <ol class="pasos-lista oculto" id="${idAcordeon}">
      ${htmlPasos}
    </ol>
  `;

  // Adjuntamos el evento al botón de expandir
  tarjeta.querySelector('.btn-expandir').addEventListener('click', (e) => {
    const btn   = e.currentTarget;
    const lista = document.getElementById(btn.dataset.acordeon);
    if (!lista) return;

    const expandido = !lista.classList.contains('oculto');
    lista.classList.toggle('oculto', expandido);
    btn.textContent = expandido
      ? 'Ver guía de exportación ▼'
      : 'Ocultar guía ▲';
  });

  return tarjeta;
}

// =============================================================
// HERRAMIENTA DE CIFRADO AES-256
// =============================================================

// Guardamos la ruta del archivo seleccionado para cifrar.
// No guardamos la contraseña — se lee en el momento del cifrado y se descarta.
let rutaArchivoCifrar = null;

// ── Seleccionar archivo a cifrar ────────────────────────────
document.getElementById('btn-seleccionar-archivo-cifrar')
  ?.addEventListener('click', async () => {
    // Abrimos el diálogo de selección de archivo sin restricción de tipo,
    // porque el usuario puede exportar en .csv, .json, .xml, .1pux, etc.
    const ruta = await window.electronAPI.seleccionarArchivo([
      { name: 'Archivos exportados', extensions: ['csv', 'json', 'xml', '1pux', 'txt'] },
      { name: 'Todos los archivos', extensions: ['*'] },
    ]);

    if (ruta) {
      rutaArchivoCifrar = ruta;
      document.getElementById('input-archivo-cifrar').value = ruta;
      validarFormularioCifrado();
    }
  });

// ── Indicador de fortaleza de contraseña ────────────────────
// Calculamos la fortaleza mientras el usuario escribe para que
// elija una contraseña suficientemente segura antes de cifrar.
document.getElementById('input-contrasena-cifrado')
  ?.addEventListener('input', () => {
    const contrasena = document.getElementById('input-contrasena-cifrado').value;
    actualizarFortaleza(contrasena);
    validarFormularioCifrado();
  });

document.getElementById('input-contrasena-confirmar')
  ?.addEventListener('input', () => validarFormularioCifrado());

/**
 * Calcula y muestra visualmente la fortaleza de la contraseña.
 * Basamos la puntuación en criterios objetivos: longitud, mayúsculas,
 * minúsculas, números y símbolos.
 *
 * @param {string} contrasena
 */
function actualizarFortaleza(contrasena) {
  const barra  = document.getElementById('fortaleza-barra');
  const texto  = document.getElementById('fortaleza-texto');
  if (!barra || !texto) return;

  // Calculamos una puntuación de 0 a 5 según criterios
  let puntos = 0;
  if (contrasena.length >= 8)  puntos++;  // Longitud mínima
  if (contrasena.length >= 14) puntos++;  // Longitud buena
  if (/[A-Z]/.test(contrasena)) puntos++; // Tiene mayúsculas
  if (/[0-9]/.test(contrasena)) puntos++; // Tiene números
  if (/[^A-Za-z0-9]/.test(contrasena)) puntos++; // Tiene símbolos

  // Mapeamos la puntuación a niveles visuales
  const niveles = [
    { clase: '',           label: '' },
    { clase: 'muy-debil',  label: 'Muy débil' },
    { clase: 'debil',      label: 'Débil' },
    { clase: 'media',      label: 'Media' },
    { clase: 'fuerte',     label: 'Fuerte' },
    { clase: 'muy-fuerte', label: 'Muy fuerte ✅' },
  ];

  const nivel = niveles[puntos] || niveles[0];

  // Limpiamos clases anteriores y aplicamos la nueva
  barra.className = `fortaleza-barra ${nivel.clase}`;
  texto.textContent = nivel.label;
  texto.className   = `fortaleza-texto ${nivel.clase}`;
}

/**
 * Comprueba si el formulario de cifrado está completo y válido.
 * Habilita o deshabilita el botón de cifrar según el resultado.
 */
function validarFormularioCifrado() {
  const contrasena  = document.getElementById('input-contrasena-cifrado')?.value  || '';
  const confirmacion = document.getElementById('input-contrasena-confirmar')?.value || '';
  const errorMismatch = document.getElementById('error-contrasena-mismatch');
  const btnCifrar   = document.getElementById('btn-cifrar-archivo');

  // Mostramos el error de mismatch solo si ambos campos tienen texto
  const hayMismatch = contrasena && confirmacion && contrasena !== confirmacion;
  errorMismatch?.classList.toggle('oculto', !hayMismatch);

  // El botón se activa solo cuando todo está correcto
  const formularioValido = rutaArchivoCifrar &&
                           contrasena.length >= 8 &&
                           contrasena === confirmacion;

  if (btnCifrar) btnCifrar.disabled = !formularioValido;
}

// ── Botón "Cifrar con AES-256" ───────────────────────────────
document.getElementById('btn-cifrar-archivo')
  ?.addEventListener('click', async () => {

    // Leemos la contraseña del input
    const inputContrasena   = document.getElementById('input-contrasena-cifrado');
    const inputConfirmacion = document.getElementById('input-contrasena-confirmar');
    const contrasena        = inputContrasena.value;

    // Verificación final antes de enviar al main
    if (!rutaArchivoCifrar || !contrasena) return;

    // Generamos la ruta de destino: mismo nombre + extensión .enc
    // Ejemplo: "contraseñas.csv" → "contraseñas.csv.enc"
    const rutaDestino = rutaArchivoCifrar + '.enc';

    const btnCifrar = document.getElementById('btn-cifrar-archivo');
    btnCifrar.disabled = true;
    btnCifrar.textContent = '⏳ Cifrando...';

    try {
      const resultado = await window.electronAPI.cifrarArchivo(
        rutaArchivoCifrar,
        rutaDestino,
        contrasena  // La contraseña se pasa aquí y se descarta tras el cifrado
      );

      if (resultado.exito) {
        // ✅ Cifrado completado: limpiamos los campos inmediatamente
        // Limpiar los inputs de contraseña tan pronto como sea posible
        // reduce el tiempo que el valor está en memoria del DOM.
        inputContrasena.value   = '';
        inputConfirmacion.value = '';
        document.getElementById('input-archivo-cifrar').value = '';
        rutaArchivoCifrar = null;
        actualizarFortaleza('');
        validarFormularioCifrado();

        const abrirCarpeta = confirm(
          `✅ Archivo cifrado correctamente.\n\n` +
          `📄 Archivo original: ${rutaArchivoCifrar || 'seleccionado'}\n` +
          `🔒 Archivo cifrado:  ${rutaDestino}\n\n` +
          `⚠️ Recuerda:\n` +
          `• Guarda el archivo .enc en un lugar seguro\n` +
          `• Apunta la contraseña por separado\n` +
          `• Considera borrar el archivo original sin cifrar\n\n` +
          `¿Abrir la carpeta donde está el archivo cifrado?`
        );

        if (abrirCarpeta) {
          // Extraemos la carpeta del path completo
          const carpeta = rutaDestino.substring(0, rutaDestino.lastIndexOf('\\'));
          await window.electronAPI.abrirCarpeta(carpeta);
        }
      } else {
        alert(`Error al cifrar: ${resultado.error}`);
        // No limpiamos los campos si hay error para que el usuario pueda reintentar
      }
    } catch (err) {
      console.error('[Módulo 5] Error inesperado al cifrar:', err);
      alert('Error inesperado al cifrar. Revisa la consola.');
    } finally {
      btnCifrar.disabled = false;
      btnCifrar.textContent = '🔒 Cifrar con AES-256';
    }
  });

// =============================================================
// Para operaciones destructivas (borrar archivos, etc.)
// =============================================================

/**
 * Muestra un modal de confirmación y devuelve una promesa.
 * La promesa se resuelve con true (confirmar) o false (cancelar).
 *
 * EJEMPLO DE USO:
 *   const confirmo = await mostrarConfirmacion(
 *     '¿Borrar archivos?',
 *     'Se eliminarán 34 archivos temporales. Irán a la papelera de reciclaje.'
 *   );
 *   if (confirmo) { ... hacer algo ... }
 *
 * @param {string} titulo
 * @param {string} mensaje
 * @returns {Promise<boolean>}
 */
function mostrarConfirmacion(titulo, mensaje) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('modal-confirmacion');
    document.getElementById('modal-titulo').textContent = titulo;
    document.getElementById('modal-mensaje').textContent = mensaje;

    overlay.classList.remove('oculto');

    const btnConfirmar = document.getElementById('modal-confirmar');
    const btnCancelar  = document.getElementById('modal-cancelar');

    // Usamos funciones con nombre para poder remover los listeners después
    function alConfirmar() {
      overlay.classList.add('oculto');
      limpiarListeners();
      resolve(true);
    }

    function alCancelar() {
      overlay.classList.add('oculto');
      limpiarListeners();
      resolve(false);
    }

    function limpiarListeners() {
      btnConfirmar.removeEventListener('click', alConfirmar);
      btnCancelar.removeEventListener('click', alCancelar);
    }

    btnConfirmar.addEventListener('click', alConfirmar);
    btnCancelar.addEventListener('click', alCancelar);
  });
}

// =============================================================
// UTILIDADES
// =============================================================

/**
 * Escapa caracteres especiales para evitar inyección de HTML.
 * Siempre que muestres texto de fuentes externas (como el registro
 * de Windows), pásalo por esta función antes de insertarlo en el DOM.
 * @param {string} texto
 * @returns {string}
 */
function escaparHTML(texto) {
  if (typeof texto !== 'string') return String(texto || '');
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Formatea bytes a una cadena legible (KB, MB, GB).
 * @param {number} bytes
 * @returns {string}
 */
function formatearBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Exponemos la función del modal globalmente por si otros módulos la necesitan
window.mostrarConfirmacion = mostrarConfirmacion;
window.formatearBytes = formatearBytes;