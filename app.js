// Administrador de licencias para el celular: mismas acciones que el administrador de escritorio
// (listar, aprobar firmando la clave aquí, rechazar, PC reemplazada) contra la aplicación web de Codigo.gs.
"use strict";

(() => {
  const ALMACEN = "adminLicencias.v1";
  const BLOQUEO_MS = 5 * 60 * 1000; // vuelve a pedir la contraseña tras 5 min en segundo plano
  const $ = (id) => document.getElementById(id);
  const esAnual = (s) => texto(s.Plan).toUpperCase() === "ANUAL";
  const planTexto = (s) => (esAnual(s) ? "Anual" : "De por vida");
  /** Aprobada y no vencida: ocupa un cupo del cliente. */
  const vigente = (s) => s.Estado === "Aprobada" && (!s.Vence || s.Vence >= Licencias.hoy());

  let sesion = null;       // { url, token, clave: CryptoKey }
  let solicitudes = [];
  let programas = {};      // codigo → { nombre, maxPc, ... }
  let actual = null;       // solicitud abierta en el detalle
  let ocultaDesde = 0;

  // ---------- utilidades ----------
  const leerAlmacen = () => { try { return JSON.parse(localStorage.getItem(ALMACEN) || "null"); } catch { return null; } };
  const guardarAlmacen = (v) => localStorage.setItem(ALMACEN, JSON.stringify(v));
  const digitos = (s) => String(s || "").replace(/\D/g, "");
  const texto = (s) => (s == null ? "" : String(s));

  function aviso(msg) {
    const t = $("aviso");
    t.textContent = msg;
    t.classList.remove("oculto");
    clearTimeout(aviso.t);
    aviso.t = setTimeout(() => t.classList.add("oculto"), 3500);
  }
  const ocupado = (si) => $("ocupado").classList.toggle("oculto", !si);

  function mostrar(vista) {
    for (const v of document.querySelectorAll(".vista")) v.classList.toggle("oculto", v.id !== vista);
    const dentro = vista === "vistaLista" || vista === "vistaDetalle";
    $("btnActualizar").classList.toggle("oculto", vista !== "vistaLista");
    $("btnMenu").classList.toggle("oculto", !dentro);
    $("btnVolver").classList.toggle("oculto", vista !== "vistaDetalle");
    $("titulo").textContent = vista === "vistaDetalle" && actual ? actual.Id : "Licencias";
    $("menu").classList.add("oculto");
    window.scrollTo(0, 0);
  }

  function esSimulacion(url) {
    try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname); } catch { return false; }
  }

  async function llamar(cuerpo) {
    const resp = await fetch(sesion.url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // sin "preflight" CORS (como el programa)
      body: JSON.stringify({ ...cuerpo, token: sesion.token }),
      redirect: "follow",
    });
    if (!resp.ok) throw new Error(`El registro respondió ${resp.status}.`);
    let r;
    try { r = await resp.json(); } catch { throw new Error("El registro no respondió con datos (¿URL correcta? ¿aplicación web publicada?)."); }
    if (!r || !r.ok) throw new Error((r && r.error) || "Respuesta vacía del registro.");
    return r;
  }

  async function copiar(t) {
    try {
      await navigator.clipboard.writeText(t);
    } catch {
      const a = document.createElement("textarea");
      a.value = t; document.body.appendChild(a); a.select();
      document.execCommand("copy"); a.remove();
    }
  }

  // ---------- inicio ----------
  function iniciar() {
    if (!Licencias.disponible()) { mostrar("vistaSinCripto"); return; }
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
    const guardado = leerAlmacen();
    if (guardado) { mostrar("vistaAcceso"); setTimeout(() => $("accClave").focus(), 50); }
    else abrirConfig(false);
  }

  // ---------- configuración (primera vez) ----------
  function abrirConfig(cancelable) {
    $("cfgError").textContent = "";
    $("cfgCancelar").classList.toggle("oculto", !cancelable);
    for (const id of ["cfgToken", "cfgPem", "cfgClave1", "cfgClave2"]) $(id).value = "";
    $("cfgArchivo").value = "";
    mostrar("vistaConfig");
  }

  $("cfgGuardar").addEventListener("click", async () => {
    const err = $("cfgError");
    err.textContent = "";
    const url = $("cfgUrl").value.trim();
    const token = $("cfgToken").value.trim();
    const c1 = $("cfgClave1").value, c2 = $("cfgClave2").value;
    if (!/^https?:\/\//i.test(url)) { err.textContent = "Escriba la URL de la aplicación web."; return; }
    if (token.length < 6) { err.textContent = "Escriba el token del administrador."; return; }
    let pem = $("cfgPem").value.trim();
    const archivo = $("cfgArchivo").files[0];
    if (archivo) pem = await archivo.text();
    if (!pem) { err.textContent = "Elija el archivo clave_privada.pem (o pegue su texto)."; return; }
    if (c1.length < 8) { err.textContent = "La contraseña debe tener al menos 8 caracteres."; return; }
    if (c1 !== c2) { err.textContent = "Las contraseñas no coinciden."; return; }
    ocupado(true);
    try {
      const clave = await Licencias.importarPrivada(pem);
      sesion = { url, token, clave };
      await llamar({ accion: "listar" }); // comprueba URL y token antes de guardar
      guardarAlmacen(await Licencias.cifrar({ url, token, pem }, c1));
      entrar();
    } catch (e) {
      sesion = null;
      err.textContent = e.message === "No autorizado" ? "El token no es correcto." : e.message;
    } finally {
      ocupado(false);
    }
  });
  $("cfgCancelar").addEventListener("click", () => (sesion ? mostrar("vistaLista") : mostrar("vistaAcceso")));

  // ---------- acceso ----------
  $("formAcceso").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    $("accError").textContent = "";
    ocupado(true);
    try {
      const datos = await Licencias.descifrar(leerAlmacen(), $("accClave").value);
      if (!datos) { $("accError").textContent = "Contraseña incorrecta."; $("accClave").value = ""; return; }
      sesion = { url: datos.url, token: datos.token, clave: await Licencias.importarPrivada(datos.pem) };
      $("accClave").value = "";
      entrar();
    } catch (e) {
      $("accError").textContent = e.message;
    } finally {
      ocupado(false);
    }
  });

  function entrar() {
    $("etiquetaSim").classList.toggle("oculto", !esSimulacion(sesion.url));
    mostrar("vistaLista");
    actualizar();
  }

  function bloquear() {
    sesion = null; solicitudes = []; actual = null;
    $("lista").innerHTML = "";
    mostrar("vistaAcceso");
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) ocultaDesde = Date.now();
    else if (sesion && ocultaDesde && Date.now() - ocultaDesde > BLOQUEO_MS) bloquear();
  });

  $("btnMenu").addEventListener("click", () => $("menu").classList.toggle("oculto"));
  $("btnBloquear").addEventListener("click", bloquear);
  $("btnReconfigurar").addEventListener("click", () => {
    $("menu").classList.add("oculto");
    if (confirm("Se volverán a pedir la URL, el token, la clave privada y una contraseña nueva. ¿Continuar?")) {
      $("cfgUrl").value = sesion ? sesion.url : "";
      abrirConfig(true);
    }
  });

  // ---------- lista ----------
  async function actualizar() {
    $("error").textContent = "";
    ocupado(true);
    try {
      const r = await llamar({ accion: "listar" });
      solicitudes = r.solicitudes || [];
      programas = {};
      for (const p of r.programas || []) programas[p.codigo] = p;
      const sel = $("filPrograma");
      const elegido = sel.value;
      const codigos = [...new Set([...Object.keys(programas), ...solicitudes.map((s) => s.Programa)])].filter(Boolean);
      sel.innerHTML = '<option value="">(Todos los programas)</option>' +
        codigos.map((c) => `<option>${escapar(c)}</option>`).join("");
      sel.value = codigos.includes(elegido) ? elegido : "";
      const pend = solicitudes.filter((s) => s.Estado === "Pendiente").length;
      $("estado").textContent = `${pend} pendiente(s) · ${solicitudes.length} solicitud(es) · ${new Date().toLocaleTimeString()}`;
      if (actual) actual = solicitudes.find((s) => s.Id === actual.Id) || null;
      pintarLista();
    } catch (e) {
      $("error").textContent = "No se pudo leer el registro: " + e.message;
    } finally {
      ocupado(false);
    }
  }

  function escapar(s) {
    return texto(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function filtradas() {
    const est = $("filEstado").value, prog = $("filPrograma").value;
    const b = $("filBuscar").value.trim().toLowerCase();
    return solicitudes
      .filter((s) => (!est || s.Estado === est) && (!prog || s.Programa === prog))
      .filter((s) => !b || [s.Id, s.Nombre, s.Correo, s.WhatsApp, s.Equipo, s.NombrePC, s.Operacion, s.Placa]
        .some((c) => texto(c).toLowerCase().includes(b)))
      .sort((a, z) => texto(z.Fecha).localeCompare(texto(a.Fecha)));
  }

  function pintarLista() {
    const filas = filtradas();
    $("lista").innerHTML = filas.length
      ? filas.map((s) => `<li data-id="${escapar(s.Id)}">
          <span class="nombre">${escapar(s.Nombre)}<span class="chip ${escapar(s.Estado)}">${escapar(s.Estado)}</span></span>
          <span class="monto">${escapar(s.Monto)}</span>
          <span class="sub">${escapar(s.Id)} · ${escapar(s.Fecha)} · ${escapar(s.Programa)} · <b>${planTexto(s)}</b>${s.Vence ? " · vence " + escapar(s.Vence) : ""}${s.Voucher ? " · 🧾 voucher" : ""}</span>
          <span class="sub">PC ${escapar(s.Equipo)} · ${escapar(s.NombrePC)}${s.WhatsApp ? " · " + escapar(s.WhatsApp) : ""}</span>
        </li>`).join("")
      : '<li class="vacia">No hay solicitudes con estos filtros.</li>';
  }

  for (const id of ["filEstado", "filPrograma"]) $(id).addEventListener("change", pintarLista);
  $("filBuscar").addEventListener("input", pintarLista);
  $("btnActualizar").addEventListener("click", actualizar);
  $("lista").addEventListener("click", (ev) => {
    const li = ev.target.closest("li[data-id]");
    if (!li) return;
    actual = solicitudes.find((s) => s.Id === li.dataset.id);
    if (actual) abrirDetalle();
  });
  $("btnVolver").addEventListener("click", () => { mostrar("vistaLista"); pintarLista(); });

  // ---------- detalle ----------
  const mismoCliente = (a, b) => a.Correo
    ? texto(a.Correo).toLowerCase() === texto(b.Correo).toLowerCase()
    : !!a.WhatsApp && digitos(a.WhatsApp) === digitos(b.WhatsApp);
  const maxPc = (s) => (programas[s.Programa] && Number(programas[s.Programa].maxPc)) || 10;
  const pcsActivas = (s) => solicitudes.filter((f) => f.Programa === s.Programa && vigente(f) && (f === s || mismoCliente(f, s))).length;
  const nombrePrograma = (s) => (programas[s.Programa] && programas[s.Programa].nombre) || s.Programa;

  function abrirDetalle() {
    const s = actual;
    $("detNombre").textContent = s.Nombre;
    $("detId").textContent = s.Id;
    $("detEstado").textContent = s.Estado;
    $("detFecha").textContent = s.Fecha;
    $("detCorreo").textContent = s.Correo || "—";
    $("detWhatsApp").textContent = s.WhatsApp || "—";
    $("detPrograma").textContent = nombrePrograma(s);
    const conVoucher = /^https?:\/\//i.test(texto(s.Voucher));
    $("detVoucher").innerHTML = conVoucher
      ? `cargando la imagen… · <a href="${escapar(s.Voucher)}" target="_blank" rel="noopener">abrir en Drive</a>`
      : "— (llegará por WhatsApp)";
    $("detVoucherCaja").classList.add("oculto");
    $("detVoucherCaja").classList.remove("grande");
    if (conVoucher) cargarVoucher(s);
    $("detPlan").textContent =planTexto(s) + (s.Vence ? ` · vence ${s.Vence}` : esAnual(s) && s.Estado === "Pendiente" ? " · 1 año desde la aprobación" : "");
    $("detEquipo").textContent = s.Equipo;
    $("detNombrePc").textContent = s.NombrePC || "—";
    $("detPlaca").textContent = s.Placa || "—";
    $("detBios").textContent = s.BIOS || "—";
    const activas = pcsActivas(s), max = maxPc(s);
    $("detCupo").textContent = `PC activas de este cliente: ${activas} de ${max}`;
    $("detExcede").classList.toggle("oculto", !(s.Estado === "Pendiente" && activas >= max));
    $("detOtras").innerHTML = solicitudes
      .filter((f) => f !== s && f.Programa === s.Programa && mismoCliente(f, s))
      .sort((a, z) => texto(a.Fecha).localeCompare(texto(z.Fecha)))
      .map((f) => `<li><span class="mono">${escapar(f.Equipo)}</span> ${escapar(f.NombrePC)} · ${escapar(f.Estado)}</li>`).join("");
    $("detNotas").textContent = s.Notas || "";

    const pendiente = s.Estado === "Pendiente", aprobada = s.Estado === "Aprobada";
    $("panelAprobar").classList.toggle("oculto", !pendiente);
    $("panelAprobada").classList.toggle("oculto", !aprobada);
    $("aprOperacion").value = s.Operacion || "";
    $("aprMonto").value = s.Monto || "";
    $("aprDatos").textContent = `Operación ${s.Operacion || "—"} · ${s.Monto || ""} · ${s.FechaAprobacion || ""}`;
    $("aprClave").value = s.Clave || "";
    $("btnWhatsApp").textContent = digitos(s.WhatsApp).length >= 9 ? "Enviar por WhatsApp" : "Copiar mensaje (sin WhatsApp)";
    $("btnRechazar").disabled = !pendiente;
    $("btnReemplazar").disabled = !aprobada;
    $("detNota").value = "";
    $("detError").textContent = "";
    mostrar("vistaDetalle");
  }

  /** Trae la imagen del voucher (el script la lee de su Drive) y la muestra en el detalle. */
  async function cargarVoucher(s) {
    try {
      const r = await llamar({ accion: "verVoucher", id: s.Id });
      if (actual !== s) return;
      const tipo = /^image\/(png|jpeg)$/.test(texto(r.tipo)) ? r.tipo : "image/jpeg";
      $("detVoucherImg").src = `data:${tipo};base64,${r.datos}`;
      $("detVoucherCaja").classList.remove("oculto");
      $("detVoucher").innerHTML = `🧾 abajo · <a href="${escapar(s.Voucher)}" target="_blank" rel="noopener">abrir en Drive</a>`;
    } catch (e) {
      if (actual === s) $("detVoucher").innerHTML = `no se pudo cargar (${escapar(e.message)}) · <a href="${escapar(s.Voucher)}" target="_blank" rel="noopener">abrir en Drive</a>`;
    }
  }
  $("detVoucherImg").addEventListener("click", () => $("detVoucherCaja").classList.toggle("grande"));

  $("btnGenerar").addEventListener("click", async () => {
    const s = actual;
    const operacion = $("aprOperacion").value.trim(), monto = $("aprMonto").value.trim();
    $("detError").textContent = "";
    const incluida = texto(s.Notas).startsWith("Incluida");
    if (!operacion && !incluida) { $("detError").textContent = "Escriba el número de operación del voucher."; $("aprOperacion").focus(); return; }
    const activas = pcsActivas(s), max = maxPc(s);
    if (activas >= max && !confirm(`Este cliente ya tiene ${activas} PC activas (máximo ${max}).\n\n¿Aprobar de todos modos?`)) return;
    // PC incluida en una compra anual: el mismo vencimiento de esa compra (viene en la fila).
    const vence = /^\d{4}-\d{2}-\d{2}$/.test(texto(s.Vence)) ? s.Vence : esAnual(s) ? Licencias.enUnAnio() : "";
    if (!confirm(`¿Pago verificado?\n\n${s.Nombre}\nPC ${s.Equipo} (${s.NombrePC})\nLicencia ${planTexto(s).toLowerCase()}${vence ? " (vence el " + vence + ")" : ""}\nMonto ${monto} · operación ${operacion}\n\nSe generará la clave y se enviará al programa del cliente.`)) return;
    ocupado(true);
    try {
      const clave = await Licencias.firmar(sesion.clave, {
        nombre: s.Nombre, equipo: s.Equipo, id: s.Id, correo: texto(s.Correo).trim() || null, programa: s.Programa, vence: vence || null,
      });
      await llamar({ accion: "aprobar", id: s.Id, clave, operacion, monto, vence });
      Object.assign(s, { Estado: "Aprobada", Clave: clave, Operacion: operacion, Monto: monto, Vence: vence, FechaAprobacion: new Date().toLocaleString() });
      abrirDetalle();
      aviso("Aprobada. Ahora pulse «Enviar por WhatsApp».");
    } catch (e) {
      $("detError").textContent = "No se pudo aprobar: " + e.message;
    } finally {
      ocupado(false);
    }
  });

  function mensajeCliente(s) {
    const plazo = s.Vence ? `licencia anual (vence el ${s.Vence.split("-").reverse().join("/")})` : "licencia de por vida";
    return `Hola ${s.Nombre}, su pago fue verificado. Su ${plazo} de ${nombrePrograma(s)} para la PC ${s.Equipo} ya está activa.\n\n` +
      "Si el programa está abierto en la ventana Activar Pro, se activa solo. Si no, abra Activar Pro, pegue esta clave y pulse Activar:\n\n" +
      s.Clave + "\n\nGuárdela: le servirá si formatea esta PC. ¡Gracias por su compra!";
  }

  // Se abre con el toque del botón (los navegadores bloquean ventanas abiertas sin un toque).
  $("btnWhatsApp").addEventListener("click", async () => {
    const s = actual, msg = mensajeCliente(s);
    let numero = digitos(s.WhatsApp);
    if (numero.length < 9) { await copiar(msg); aviso("El cliente no dejó WhatsApp: mensaje copiado para enviarlo por otro medio."); return; }
    if (numero.length === 9) numero = "51" + numero;
    window.open(`https://wa.me/${numero}?text=${encodeURIComponent(msg)}`, "_blank");
  });
  $("btnCopiar").addEventListener("click", async () => { await copiar(actual.Clave); aviso("Clave copiada."); });

  async function cambiar(accion, estado, pregunta) {
    if (!confirm(pregunta)) return;
    const notas = $("detNota").value.trim();
    ocupado(true);
    try {
      await llamar({ accion, id: actual.Id, notas });
      actual.Estado = estado;
      if (notas) actual.Notas = notas;
      abrirDetalle();
      aviso(`Solicitud ${actual.Id}: ${estado.toLowerCase()}.`);
    } catch (e) {
      $("detError").textContent = e.message;
    } finally {
      ocupado(false);
    }
  }
  $("btnRechazar").addEventListener("click", () =>
    cambiar("rechazar", "Rechazada", `¿Rechazar la solicitud ${actual.Id}? (el pago no se verificó)`));
  $("btnReemplazar").addEventListener("click", () =>
    cambiar("reemplazar", "Reemplazada", `¿Marcar la PC ${actual.Equipo} como reemplazada? Libera un cupo del cliente (su clave sigue funcionando en esa PC).`));

  iniciar();
})();
