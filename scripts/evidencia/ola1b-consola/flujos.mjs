import { createHash, randomBytes, randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";

// Los 11 flujos de Ola 1B (consola), el 12 (alta de proveedor con área, #52), el 13
// (nómina de una sola persona en Inicio) y el 14 (faltante que no se puede calcular y
// error de la consola), clicados en la aplicación con Playwright headless. Cada envío se hace con
// doble clic y la base confirma que quedó una sola operación. Lo llama
// scripts/evidencia/ola1b-consola.mjs flujos.

const CLABE = "002180701150123452";
const CLABE_NUEVA = "014180655012345674";
const UUID_FACTURA = "123E4567-E89B-42D3-A456-426614174998";
const PDF = "tests/e2e/fixtures/soporte-prueba.pdf";
const XML = "tests/e2e/fixtures/factura-prueba.xml";

function fecha(dias) {
  const valor = new Date();
  valor.setUTCDate(valor.getUTCDate() + dias);
  return valor.toISOString().slice(0, 10);
}

/** Hoy en la Ciudad de México, como lo calcula la aplicación. */
function hoyMexico() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
}

/** Vuelve a sembrar una sesión con el mismo valor de cookie (como preparar.ts). */
function reponerSesion(sql, userId, valor, superficie) {
  const entradaId = randomUUID();
  sql(`
    insert into auth_entradas (id, user_id, token_hash, creada_en, vence_en, verificada_con, verificada_en, consumida_en)
      values ('${entradaId}', '${userId}', '${createHash("sha256").update(entradaId).digest("hex")}', now(), now() + interval '10 minutes', 'totp', now(), now());
    insert into sessions (id, user_id, token_hash, expires_at, superficie, segundo_factor, entrada_id)
      values ('${randomUUID()}', '${userId}', '${createHash("sha256").update(valor).digest("hex")}', now() + interval '12 hours', '${superficie}', 'totp', '${entradaId}');
  `);
}

/**
 * Doble clic en un botón de un formulario con varios botones de envío. Cada
 * cambio guarda el estado de TODOS los botones del formulario (valor, texto,
 * disabled, aria-busy), para comprobar que solo el oprimido anuncia que envía.
 */
async function dobleClicEnFormulario(p, boton) {
  await boton.evaluate((el) => new Promise((resolver) => {
    const forma = el.closest("form");
    const vistas = [];
    const foto = () => vistas.push([...forma.querySelectorAll("button[type=submit]")].map((b) => ({ valor: b.value, texto: b.textContent.trim(), disabled: b.disabled, busy: b.getAttribute("aria-busy") })));
    const observador = new MutationObserver(foto);
    observador.observe(forma, { attributes: true, childList: true, subtree: true, characterData: true });
    window.__marcasFormulario = () => {
      observador.disconnect();
      return vistas;
    };
    resolver(true);
  }));
  await boton.dblclick();
  await p.waitForTimeout(150);
  return async () => p.evaluate(() => (window.__marcasFormulario ? window.__marcasFormulario() : []));
}

/** Solo el botón `valor` dijo `enviando` con aria-busy; los demás se desactivaron sin anunciarlo. */
function soloElOprimido(vistas, valor, enviando) {
  const anuncia = vistas.some((foto) => foto.some((b) => b.valor === valor && b.disabled && b.busy === "true" && b.texto === enviando));
  const otros = vistas.flat().filter((b) => b.valor !== valor);
  const otrosCallan = otros.every((b) => b.busy !== "true" && !/…$/.test(b.texto));
  const otrosEsperan = vistas.some((foto) => foto.some((b) => b.valor === valor && b.busy === "true") && foto.filter((b) => b.valor !== valor).every((b) => b.disabled));
  return { ok: anuncia && otrosCallan && otrosEsperan && otros.length > 0, anuncia, otrosCallan, otrosEsperan };
}

/**
 * Un pendiente aparece en Aprobaciones (antes Pendientes, Ola 2b) y su acción lleva a la
 * pantalla que lo resuelve. Lo que se decide ahí mismo (un pago que la persona puede
 * autorizar, la nómina por preparar) se pinta como decisión: con `decision` se busca esa
 * fila y, si trae `accion` como enlace, se sigue; el botón que prepara no se oprime aquí.
 */
async function pendiente(p, { BASE, empresa, titulo, accion, destino, anotar, foto, nombre, decision = null }) {
  await p.goto(`${BASE}${empresa}/consola/aprobaciones`);
  const renglon = p.locator(".aprobaciones-renglones li").filter({ has: p.getByRole("heading", { name: titulo }) });
  const enBandeja = decision ? p.locator("li.decision").filter({ has: p.locator(".decision-titulo", { hasText: decision }) }) : null;
  const fila = (await renglon.count()) === 1 || !enBandeja ? renglon : enBandeja;
  const visible = (await fila.count()) === 1;
  if (visible && foto) await foto(p, nombre);
  const enlace = visible ? fila.getByRole("link", { name: accion, exact: true }) : null;
  if (enlace && (await enlace.count()) === 1) {
    await enlace.click();
    await p.waitForURL(destino, { timeout: 20000 });
  }
  const llego = destino.test(p.url()) || (fila === enBandeja && visible);
  anotar(visible && llego, `flujo 11: «${typeof titulo === "string" ? titulo : titulo.source}» aparece en Aprobaciones y «${accion}» lleva a su pantalla (o se decide ahí)`, p.url().replace(BASE, ""));
}

/** El botón queda desactivado y anuncia que trabaja entre el primer clic y la respuesta. */
async function dobleClic(p, boton) {
  const marcas = await boton.evaluate((el) => new Promise((resolver) => {
    const vistas = [];
    const observador = new MutationObserver(() => {
      vistas.push({ disabled: el.disabled, busy: el.getAttribute("aria-busy"), texto: el.textContent.trim() });
    });
    observador.observe(el, { attributes: true, childList: true, subtree: true, characterData: true });
    window.__marcasBoton = () => {
      observador.disconnect();
      return vistas;
    };
    resolver(true);
  }));
  void marcas;
  await boton.dblclick();
  await p.waitForTimeout(150);
  return async () => p.evaluate(() => (window.__marcasBoton ? window.__marcasBoton() : []));
}

export async function flujos({ abrir, capturar, anotar, sql, renovarSesiones, codigoTotp, BASE, DIR, TALLER, ALTAMAR, ENTORNO }) {
  const foto = (p, nombre) => capturar(p, `${DIR}/flujos/${nombre}.webp`, { completa: false });
  const solo = process.env.FLUJOS ? process.env.FLUJOS.split(",").map(Number) : null;
  const corre = (n) => !solo || solo.includes(n);
  renovarSesiones();
  // Autorizar un pago y cambiar una CLABE exigen un segundo factor de menos de 30 minutos.
  const edad = Number(sql("select coalesce(extract(epoch from now() - min(segundo_factor_en)), 0)::int from sessions"));
  if (edad > 25 * 60) throw new Error(`Las sesiones sembradas probaron su segundo factor hace ${Math.round(edad / 60)} minutos: vuelve a correr preparar.ts justo antes de los flujos.`);
  const estado = {};

  // ---------- 1. Alta de proveedor con CLABE ----------
  if (corre(1)) {
    const { nav, p, errores } = await abrir({ quien: "gil" });
    const rfc = `OLA061106A${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${Math.floor(Math.random() * 9) + 1}`;
    await p.goto(`${BASE}${TALLER}/consola/proveedores?vista=proveedores`);
    await p.getByRole("link", { name: "Alta de proveedor" }).click();
    await p.waitForURL(/nuevo-proveedor/);
    await p.getByLabel("RFC", { exact: true }).fill(rfc);
    await p.getByLabel("Razón social", { exact: true }).fill("Fletes Ola Uno, S.A. de C.V.");
    await p.getByLabel("Nombre comercial").fill("Fletes Ola");
    await p.getByLabel("Correo de contacto").fill("facturas@fletes-ola.mx");
    await p.getByLabel("CLABE", { exact: true }).fill(CLABE);
    await p.locator("#constancia").setInputFiles(PDF);
    await foto(p, "01-alta-proveedor-llena");
    const marcas = await dobleClic(p, p.getByRole("button", { name: "Dar de alta" }));
    await p.getByText("Quedó asentado", { exact: true }).waitFor({ timeout: 30000 });
    const vistas = await marcas();
    await foto(p, "01-alta-proveedor-asentada");
    const filas = sql(`select count(*) from suppliers where rfc = '${rfc}'`);
    const clabes = sql(`select count(*) from supplier_clabes c join suppliers s on s.id = c.supplier_id where s.rfc = '${rfc}' and c.clabe = '${CLABE}'`);
    const auditoria = sql(`select count(*) from audit_log a join suppliers s on s.id = a.identificador where s.rfc = '${rfc}' and a.accion = 'alta_proveedor'`);
    anotar(vistas.some((v) => v.disabled && v.busy === "true" && v.texto === "Enviando…"), "flujo 1: el botón se desactiva y dice «Enviando…» con aria-busy", JSON.stringify(vistas.slice(0, 3)));
    anotar(filas === "1" && clabes === "1" && auditoria === "1", "flujo 1: doble clic deja un proveedor, una CLABE y un asiento", `proveedores=${filas} clabes=${clabes} bitácora=${auditoria}`);
    const sinArea = sql(`select count(*) from suppliers where rfc = '${rfc}' and cost_center_id is null`);
    anotar(sinArea === "1", "flujo 1: con «Sin área» el proveedor queda sin área", `sin_area=${sinArea}`);
    anotar(errores.length === 0, "flujo 1: sin errores de consola", errores.join(" | "));
    estado.rfc = rfc;
    await nav.close();
  }

  // ---------- 2. Cuenta por pagar con XML ----------
  if (corre(2)) {
    const { nav, p, errores } = await abrir({ quien: "gil" });
    await p.goto(`${BASE}${TALLER}/consola/proveedores`);
    await p.getByRole("link", { name: "Nuevo pago" }).click();
    await p.waitForURL(/proveedores\/nuevo/);
    await p.getByLabel("Proveedor", { exact: true }).selectOption({ label: "Proveedor Uno, S.A. de C.V. · AAA010101AAA" });
    await p.locator("#xml").setInputFiles(XML);
    await p.getByText(UUID_FACTURA).waitFor({ timeout: 20000 });
    await p.locator("#pdf").setInputFiles(PDF);
    await p.getByLabel("Vencimiento", { exact: true }).fill(fecha(20));
    await p.getByLabel("Fecha prevista de pago").fill(fecha(5));
    await foto(p, "02-cuenta-xml-leida");
    const marcas = await dobleClic(p, p.getByRole("button", { name: "Revisar y solicitar" }));
    await p.getByText("El pago quedó en autorización. Otra persona lo revisa.").waitFor({ timeout: 30000 });
    const vistas = await marcas();
    await foto(p, "02-cuenta-xml-en-autorizacion");
    const cargos = sql(`select count(*) from supplier_payables where cfdi_uuid = '${UUID_FACTURA}'`);
    const solicitudes = sql(`select count(*) from supplier_payment_requests r join supplier_payables p on p.id = r.payable_id where p.cfdi_uuid = '${UUID_FACTURA}'`);
    const documentos = sql(`select count(*) from supplier_payable_documents d join supplier_payables p on p.id = d.payable_id where p.cfdi_uuid = '${UUID_FACTURA}'`);
    estado.solicitud = sql(`select r.id from supplier_payment_requests r join supplier_payables p on p.id = r.payable_id where p.cfdi_uuid = '${UUID_FACTURA}'`);
    anotar(vistas.some((v) => v.disabled && v.busy === "true"), "flujo 2: el botón se desactiva con aria-busy mientras se guarda", JSON.stringify(vistas.slice(0, 3)));
    anotar(cargos === "1" && solicitudes === "1" && documentos === "2", "flujo 2: doble clic deja una cuenta por pagar, una solicitud y sus dos archivos (XML y PDF)", `cargos=${cargos} solicitudes=${solicitudes} documentos=${documentos}`);
    await p.getByRole("link", { name: "Ver el detalle del pago" }).click();
    await p.getByRole("dialog").waitFor();
    const descarga = await p.getByRole("dialog").locator(".detalle-documentos a").filter({ hasText: "factura-prueba.xml" }).getAttribute("href");
    const respuesta = await p.request.get(`${BASE}${descarga}`);
    anotar(respuesta.status() === 200 && (await respuesta.text()).includes("cfdi:Comprobante"), "flujo 2: el XML guardado se descarga del almacén privado", `HTTP ${respuesta.status()}`);
    await foto(p, "02-cuenta-xml-detalle");
    // Gil la solicitó: no ve «Autorizar para pagar» en su propia solicitud.
    anotar((await p.getByRole("button", { name: "Autorizar para pagar" }).count()) === 0, "flujo 2: quien solicita no puede autorizar su propio pago");
    anotar(errores.length === 0, "flujo 2: sin errores de consola", errores.join(" | "));
    await nav.close();
  }

  // ---------- 3. Autorización por un segundo liberador ----------
  if (corre(3)) {
    const id = estado.solicitud || sql(`select r.id from supplier_payment_requests r join supplier_payables p on p.id = r.payable_id where p.cfdi_uuid = '${UUID_FACTURA}'`);
    const { nav, p, errores } = await abrir({ quien: "rosa" });
    if (corre(11)) await pendiente(p, { BASE, empresa: TALLER, titulo: /^Autoriza (un pago|\d+ pagos)/, accion: "Revisar pagos", destino: /\/consola\/proveedores/, decision: /^Pago a proveedor · /, anotar, foto, nombre: "11-pendiente-pago-por-autorizar" });
    await p.goto(`${BASE}${TALLER}/consola/proveedores`);
    await p.getByRole("link", { name: "Abrir pago de Proveedor Uno, S.A. de C.V." }).first().click();
    await p.getByRole("dialog").waitFor();
    await p.goto(`${BASE}${TALLER}/consola/proveedores?pago=${id}`);
    const panel = p.getByRole("dialog");
    await panel.getByRole("button", { name: "Autorizar para pagar" }).waitFor();
    await foto(p, "03-autorizacion-antes");
    const marcas = await dobleClicEnFormulario(p, panel.getByRole("button", { name: "Autorizar para pagar" }));
    await panel.locator(".detalle-cabeza").getByText("Listo para pagar", { exact: true }).waitFor({ timeout: 30000 });
    const vistas = await marcas();
    await foto(p, "03-autorizacion-listo");
    const estadoBase = sql(`select estado from supplier_payment_requests where id = '${id}'`);
    const autorizaciones = sql(`select count(*) from audit_log where identificador = '${id}' and accion = 'autorizar_pago_proveedor'`);
    const decision = soloElOprimido(vistas, "autorizar", "Enviando…");
    anotar(decision.anuncia, "flujo 3: «Autorizar para pagar» se desactiva y dice «Enviando…»", JSON.stringify(vistas.slice(0, 2)));
    anotar(decision.ok, "flujo 3: «Rechazar» se desactiva sin decir «Enviando…» mientras se autoriza (se observan los dos botones)", JSON.stringify(decision));
    anotar(estadoBase === "listo_para_pagar" && autorizaciones === "1", "flujo 3: doble clic de otra persona deja una sola autorización", `estado=${estadoBase} autorizaciones=${autorizaciones}`);
    anotar(errores.length === 0, "flujo 3: sin errores de consola", errores.join(" | "));
    estado.listo = id;
    await nav.close();
  }

  // ---------- 4. Rechazo y cancelación con motivo ----------
  if (corre(4)) {
    const pendiente = "88888888-8888-4888-8888-888888888882";
    {
      const { nav, p, errores } = await abrir({ quien: "rosa" });
      await p.goto(`${BASE}${TALLER}/consola/proveedores?pago=${pendiente}`);
      const panel = p.getByRole("dialog");
      const motivo = panel.getByLabel("Motivo al rechazar");
      // Sin motivo: el error queda ligado al campo del motivo y el pago no cambia.
      await panel.getByRole("button", { name: "Rechazar", exact: true }).click();
      await panel.getByRole("alert").first().waitFor({ timeout: 20000 });
      const avisoId = await panel.locator("[id$='-aviso']").first().getAttribute("id");
      const describe = (await motivo.getAttribute("aria-describedby")) ?? "";
      await foto(p, "04-rechazo-sin-motivo");
      anotar(describe.split(" ").includes(avisoId) && (await motivo.getAttribute("aria-invalid")) === "true" && sql(`select count(*) from audit_log where identificador = '${pendiente}' and accion = 'rechazar_pago_proveedor'`) === "0", "flujo 4: rechazar sin motivo no rechaza y el error queda ligado al campo del motivo", `aria-describedby=${describe}`);
      await motivo.fill("La fecha no coincide con el contrato");
      const marcas = await dobleClicEnFormulario(p, panel.getByRole("button", { name: "Rechazar", exact: true }));
      await panel.locator(".detalle-cabeza").getByText("Rechazado", { exact: true }).waitFor({ timeout: 30000 });
      const vistas = await marcas();
      await foto(p, "04-rechazo-con-motivo");
      const rechazos = sql(`select count(*) from audit_log where identificador = '${pendiente}' and accion = 'rechazar_pago_proveedor'`);
      const decision = soloElOprimido(vistas, "rechazar", "Enviando…");
      anotar(decision.anuncia, "flujo 4: «Rechazar» se desactiva y dice «Enviando…»", JSON.stringify(vistas.slice(0, 2)));
      anotar(decision.ok, "flujo 4: «Autorizar para pagar» se desactiva sin decir «Enviando…» mientras se rechaza", JSON.stringify(decision));
      anotar(rechazos === "1", "flujo 4: doble clic deja un solo rechazo con su motivo", `rechazos=${rechazos}`);
      anotar(errores.length === 0, "flujo 4: sin errores de consola (rechazo)", errores.join(" | "));
      await nav.close();
    }
    {
      const id = estado.listo || sql(`select r.id from supplier_payment_requests r join supplier_payables p on p.id = r.payable_id where p.cfdi_uuid = '${UUID_FACTURA}'`);
      const { nav, p, errores } = await abrir({ quien: "gil" });
      await p.goto(`${BASE}${TALLER}/consola/proveedores?pago=${id}`);
      const panel = p.getByRole("dialog");
      await panel.getByText("Cancelar el pago autorizado").click();
      // Sin motivo, el navegador no deja enviar: el estado no cambia.
      await panel.getByRole("button", { name: "Confirmar cancelación" }).click();
      await p.waitForTimeout(800);
      anotar(sql(`select estado from supplier_payment_requests where id = '${id}'`) === "listo_para_pagar", "flujo 4: sin motivo no se cancela");
      await panel.getByLabel("Motivo de cancelación").fill("Se reprograma con el proveedor");
      await foto(p, "04-cancelacion-motivo");
      const marcas = await dobleClic(p, panel.getByRole("button", { name: "Confirmar cancelación" }));
      await panel.locator(".detalle-cabeza").getByText("Cancelado", { exact: true }).waitFor({ timeout: 30000 });
      const vistas = await marcas();
      await foto(p, "04-cancelacion-asentada");
      const cancelaciones = sql(`select count(*) from audit_log where identificador = '${id}' and accion = 'cancelar_pago_proveedor'`);
      const motivo = sql(`select motivo from audit_log where identificador = '${id}' and accion = 'cancelar_pago_proveedor'`);
      anotar(vistas.some((v) => v.busy === "true" && v.texto === "Enviando…"), "flujo 4: «Confirmar cancelación» se desactiva y dice «Enviando…»", JSON.stringify(vistas.slice(0, 3)));
      anotar(cancelaciones === "1" && motivo === "Se reprograma con el proveedor", "flujo 4: doble clic deja una sola cancelación con su motivo", `cancelaciones=${cancelaciones} motivo=${motivo}`);
      anotar(errores.length === 0, "flujo 4: sin errores de consola (cancelación)", errores.join(" | "));
      await nav.close();
    }
  }

  const EMPRESA_ALTAMAR = ENTORNO.EMPRESA_ALTAMAR;
  const COLABORADORA = "Mariana López Ruiz";

  // ---------- 5. Alta de colaborador con nómina ----------
  if (corre(5)) {
    const { nav, p, errores } = await abrir({ quien: "laura" });
    if (corre(11)) await pendiente(p, { BASE, empresa: ALTAMAR, titulo: "Crea la primera área", accion: "Crear área", destino: /\/consola\/personas\/areas/, anotar, foto, nombre: "11-pendiente-area" });
    // Primero el área: un presupuesto mal escrito no se pierde al volver con el error.
    await p.goto(`${BASE}${ALTAMAR}/consola/personas/areas`);
    const forma = p.locator("section.area-nueva");
    // La corrida es repetible: si el área ya existe, se crea otra con nombre distinto.
    const nombreArea = sql(`select count(*) from cost_centers where company_id = '${EMPRESA_ALTAMAR}' and nombre = 'Operaciones'`) === "0" ? "Operaciones" : `Operaciones ${Date.now() % 10000}`;
    await forma.getByLabel("Área", { exact: true }).fill(nombreArea);
    await forma.getByLabel("Presupuesto mensual").fill("ciento cincuenta mil");
    await forma.getByRole("button", { name: "Crear área" }).click();
    await forma.getByText("Revisa antes de continuar").waitFor({ timeout: 20000 });
    const presupuesto = forma.getByLabel("Presupuesto mensual");
    const conserva = await presupuesto.inputValue();
    const describe = await presupuesto.getAttribute("aria-describedby");
    const invalido = await presupuesto.getAttribute("aria-invalid");
    await foto(p, "05-area-error-ligado");
    anotar(conserva === "ciento cincuenta mil", "flujo 5: tras el error, el presupuesto escrito sigue en el campo", `valor=${conserva}`);
    anotar(invalido === "true" && (describe ?? "").includes("centroPresupuesto-error"), "flujo 5: el error del presupuesto queda ligado a su campo", `aria-describedby=${describe}`);
    await presupuesto.fill("150000");
    const marcasArea = await dobleClic(p, forma.getByRole("button", { name: "Crear área" }));
    await forma.getByText("El área quedó creada con su presupuesto.").waitFor({ timeout: 20000 });
    const vistasArea = await marcasArea();
    const areas = sql(`select count(*) from cost_centers where company_id = '${EMPRESA_ALTAMAR}' and nombre = '${nombreArea}'`);
    anotar(vistasArea.some((v) => v.disabled && v.busy === "true" && v.texto === "Guardando…"), "flujo 5: «Crear área» se desactiva y dice «Guardando…»", JSON.stringify(vistasArea.slice(0, 3)));
    anotar(areas === "1", "flujo 5: doble clic deja una sola área", `áreas=${areas}`);

    if (corre(11)) await pendiente(p, { BASE, empresa: ALTAMAR, titulo: "Da de alta al primer colaborador", accion: "Dar de alta", destino: /\/consola\/personas\/nueva/, anotar, foto, nombre: "11-pendiente-primer-colaborador" });
    // El alta, desde la acción de la barra.
    await p.goto(`${BASE}${ALTAMAR}/consola/personas`);
    await p.locator(".barra-superior").getByRole("link", { name: "Dar de alta" }).click();
    await p.waitForURL(/personas\/nueva/);
    await p.getByLabel("Nombre completo").fill(COLABORADORA);
    await p.getByLabel("Área", { exact: true }).selectOption({ label: "Operaciones" });
    await p.getByLabel("Presupuesto individual mensual").fill("8000");
    await p.getByLabel("Neto por pago").fill("12500");
    await p.getByLabel("Frecuencia").selectOption("mensual");
    await p.getByLabel("Primer pago").fill(hoyMexico());
    await p.getByLabel("CLABE", { exact: true }).fill(CLABE);
    await p.getByLabel("Usuario de plataforma").selectOption("no");
    await foto(p, "05-alta-colaborador-llena");
    const marcas = await dobleClic(p, p.getByRole("button", { name: "Dar de alta colaborador" }));
    await p.waitForURL(/\/consola\/personas\/[0-9a-f-]{36}/, { timeout: 30000 });
    await p.getByRole("heading", { name: COLABORADORA, exact: true }).waitFor();
    const vistas = await marcas();
    await foto(p, "05-alta-colaborador-expediente");
    const personas = sql(`select count(*) from employees where company_id = '${EMPRESA_ALTAMAR}' and nombre = '${COLABORADORA}'`);
    const nominas = sql(`select count(*) from employee_payroll_profiles n join employees e on e.id = n.employee_id where e.nombre = '${COLABORADORA}' and n.neto_centavos = 1250000 and n.activa`);
    const altas = sql(`select count(*) from audit_log a join employees e on e.id = a.identificador where e.nombre = '${COLABORADORA}' and a.accion = 'alta_persona'`);
    anotar(vistas.some((v) => v.disabled && v.busy === "true" && v.texto === "Guardando expediente…"), "flujo 5: «Dar de alta colaborador» se desactiva y dice «Guardando expediente…»", JSON.stringify(vistas.slice(0, 3)));
    anotar(personas === "1" && nominas === "1" && altas === "1", "flujo 5: doble clic deja una persona, una nómina y un asiento de alta", `personas=${personas} nóminas=${nominas} altas=${altas}`);
    anotar(errores.length === 0, "flujo 5: sin errores de consola", errores.join(" | "));
    estado.colaboradora = sql(`select id from employees where company_id = '${EMPRESA_ALTAMAR}' and nombre = '${COLABORADORA}'`);
    await nav.close();
  }

  // ---------- 6. Cambio de CLABE de nómina con reautenticación ----------
  if (corre(6)) {
    const id = estado.colaboradora || sql(`select id from employees where company_id = '${EMPRESA_ALTAMAR}' and nombre = '${COLABORADORA}'`);
    const ruta = `${BASE}${ALTAMAR}/consola/personas/${id}`;
    {
      // Envejece el segundo factor de la sesión de Laura a 31 minutos. El trigger de sessions no deja
      // reescribirlo; en la base desechable, el dueño lo salta solo en esta transacción (como seguridad-cuentas.mjs).
      sql(`begin; set local session_replication_role = replica;
           update sessions set segundo_factor_en = now() - interval '31 minutes' where user_id = '${ENTORNO.LAURA_ID}'; commit;`);
      const { nav, p, errores } = await abrir({ quien: "laura" });
      await p.goto(ruta);
      const hoja = p.locator("section:has(#expediente-clabe)");
      await hoja.getByLabel("CLABE nueva").fill(CLABE_NUEVA);
      await hoja.getByRole("button", { name: "Cambiar CLABE de nómina" }).click();
      await hoja.getByText("Confirma que eres tú").waitFor({ timeout: 20000 });
      await foto(p, "06-clabe-pide-reautenticar");
      anotar(sql(`select clabe from employees where id = '${id}'`) === CLABE, "flujo 6: sin segundo factor reciente, la CLABE no cambia");
      anotar(errores.length === 0, "flujo 6: sin errores de consola (rechazo)", errores.join(" | "));
      await nav.close();
    }
    {
      // Vuelve a entrar con contraseña y app autenticadora.
      const { nav, p, errores } = await abrir({});
      await p.goto(`${BASE}/entrar`);
      await p.getByLabel("Correo").fill("laura@lever.test");
      await p.getByLabel("Contraseña", { exact: true }).fill(ENTORNO.CLAVE_LAURA);
      await p.getByRole("button", { name: "Continuar" }).click();
      await p.waitForURL(/entrar\/continuar/, { timeout: 30000 });
      const semilla = (await p.locator(".arco-semilla").textContent()).trim();
      await p.getByLabel("Código que muestra la app").fill(codigoTotp(semilla));
      await p.getByRole("button", { name: "Confirmar el código" }).click();
      await p.getByText("Ya los guardé en un lugar seguro").click();
      await p.getByRole("button", { name: "Entrar al portal" }).click();
      await p.waitForURL(/\/consola/, { timeout: 30000 });
      await p.goto(ruta);
      const hoja = p.locator("section:has(#expediente-clabe)");
      await hoja.getByLabel("CLABE nueva").fill(CLABE_NUEVA);
      await foto(p, "06-clabe-tras-entrar");
      const marcas = await dobleClic(p, hoja.getByRole("button", { name: "Cambiar CLABE de nómina" }));
      await hoja.getByText("Quedó asentado").waitFor({ timeout: 30000 });
      const vistas = await marcas();
      await foto(p, "06-clabe-cambiada");
      const vigente = sql(`select clabe from employees where id = '${id}'`);
      const historial = sql(`select count(*) from employee_payroll_clabes where employee_id = '${id}'`);
      const cambios = sql(`select count(*) from audit_log where identificador = '${id}' and accion = 'cambiar_clabe_nomina'`);
      anotar(vistas.some((v) => v.disabled && v.busy === "true" && v.texto === "Guardando…"), "flujo 6: «Cambiar CLABE de nómina» se desactiva y dice «Guardando…»", JSON.stringify(vistas.slice(0, 3)));
      anotar(vigente === CLABE_NUEVA && historial === "2" && cambios === "1", "flujo 6: tras volver a entrar, doble clic deja un solo cambio y la anterior en el historial", `vigente=${vigente} historial=${historial} cambios=${cambios}`);
      anotar(errores.length === 0, "flujo 6: sin errores de consola (cambio)", errores.join(" | "));
      await nav.close();
    }
    // Entrar de nuevo cierra las demás sesiones de Laura: se repone la sembrada para los flujos que siguen.
    reponerSesion(sql, ENTORNO.LAURA_ID, ENTORNO.SESION_LAURA, "cliente");
  }

  // ---------- 7. Preparar el lote de nómina ----------
  if (corre(7)) {
    const { nav, p, errores } = await abrir({ quien: "laura" });
    if (corre(11)) await pendiente(p, { BASE, empresa: ALTAMAR, titulo: /^Prepara el lote de nómina del /, accion: "Preparar nómina", destino: /\/consola\/personas\/nomina$/, decision: /^Lote de nómina · /, anotar, foto, nombre: "11-pendiente-nomina" });
    await p.goto(`${BASE}${ALTAMAR}/consola/personas/nomina`);
    const boton = p.getByRole("button", { name: /^Preparar nómina del / });
    await boton.waitFor();
    await foto(p, "07-nomina-por-preparar");
    const marcas = await dobleClic(p, boton);
    await p.waitForURL(/personas\/nomina\/[0-9a-f-]{36}/, { timeout: 30000 });
    await p.getByText("Personas e importes congelados").waitFor();
    const vistas = await marcas();
    await foto(p, "07-lote-preparado");
    const lotes = sql(`select count(*) from payroll_batches where company_id = '${EMPRESA_ALTAMAR}'`);
    const renglones = sql(`select count(*) from payroll_batch_items i join payroll_batches b on b.id = i.batch_id where b.company_id = '${EMPRESA_ALTAMAR}'`);
    const total = sql(`select total_centavos from payroll_batches where company_id = '${EMPRESA_ALTAMAR}'`);
    anotar(vistas.some((v) => v.disabled && v.busy === "true" && v.texto === "Preparando…"), "flujo 7: «Preparar nómina» se desactiva y dice «Preparando…»", JSON.stringify(vistas.slice(0, 3)));
    anotar(lotes === "1" && renglones === "1" && total === "1250000", "flujo 7: doble clic deja un solo lote con su renglón", `lotes=${lotes} renglones=${renglones} total=${total}`);
    anotar(errores.length === 0, "flujo 7: sin errores de consola", errores.join(" | "));
    await nav.close();
  }

  const EMPRESA_TALLER = ENTORNO.EMPRESA_TALLER;

  // ---------- 8. Editar la política ----------
  if (corre(8)) {
    const { nav, p, errores } = await abrir({ quien: "gil" });
    await p.goto(`${BASE}${TALLER}/consola/politica`);
    const plazo = p.locator("section").filter({ has: p.getByRole("heading", { name: "Plazo de la empresa" }) });
    const dias = plazo.getByLabel("Días para pasar de «todavía no» a «ya se pasó»");
    await dias.fill("muchos");
    await plazo.getByRole("button", { name: "Guardar el plazo" }).click();
    await plazo.getByRole("alert").waitFor({ timeout: 20000 });
    const conserva = await dias.inputValue();
    const describe = await dias.getAttribute("aria-describedby");
    const alerta = await plazo.getByRole("alert").getAttribute("id");
    await foto(p, "08-politica-error-ligado");
    anotar(conserva === "muchos", "flujo 8: tras el error, el plazo escrito sigue en el campo", `valor=${conserva}`);
    anotar(Boolean(describe) && describe === alerta && (await dias.getAttribute("aria-invalid")) === "true", "flujo 8: el error del plazo queda ligado a su campo", `aria-describedby=${describe}`);
    const nuevo = sql(`select dias_comprobante from policies where company_id = '${EMPRESA_TALLER}'`) === "7" ? "8" : "7";
    await dias.fill(nuevo);
    const antes = Number(sql(`select count(*) from audit_log where company_id = '${EMPRESA_TALLER}' and accion = 'editar_politica'`));
    const marcas = await dobleClic(p, plazo.getByRole("button", { name: "Guardar el plazo" }));
    await plazo.getByRole("status").waitFor({ timeout: 20000 });
    const vistas = await marcas();
    await p.getByText(`${nuevo} días para pasar de «todavía no» a «ya se pasó»`).first().waitFor({ timeout: 20000 });
    const despues = Number(sql(`select count(*) from audit_log where company_id = '${EMPRESA_TALLER}' and accion = 'editar_politica'`));
    const guardado = sql(`select dias_comprobante from policies where company_id = '${EMPRESA_TALLER}'`);
    anotar(vistas.some((v) => v.disabled && v.busy === "true" && v.texto === "Guardando…"), "flujo 8: «Guardar el plazo» se desactiva y dice «Guardando…»", JSON.stringify(vistas.slice(0, 3)));
    anotar(guardado === nuevo && despues - antes === 1, "flujo 8: doble clic guarda el plazo una sola vez", `días=${guardado} asientos nuevos=${despues - antes}`);
    // Una categoría sin tope: deja el pendiente «topes» para el flujo 11.
    const categorias = p.locator("section").filter({ has: p.getByRole("heading", { name: "Categorías", exact: true }) });
    const nombre = `Viáticos de campo ${Date.now() % 10000}`;
    await categorias.getByLabel("Nombre", { exact: true }).fill(nombre);
    const marcasCategoria = await dobleClic(p, categorias.getByRole("button", { name: "Agregar categoría" }));
    await categorias.getByRole("heading", { name: nombre }).waitFor({ timeout: 20000 });
    const vistasCategoria = await marcasCategoria();
    await foto(p, "08-politica-guardada");
    const creadas = sql(`select count(*) from policy_categories where company_id = '${EMPRESA_TALLER}' and nombre = '${nombre}'`);
    anotar(vistasCategoria.some((v) => v.disabled && v.busy === "true"), "flujo 8: «Agregar categoría» se desactiva mientras guarda", JSON.stringify(vistasCategoria.slice(0, 3)));
    anotar(creadas === "1" && (await categorias.getByLabel("Nombre", { exact: true }).inputValue()) === "", "flujo 8: doble clic crea una sola categoría y la forma queda lista para otra", `categorías=${creadas}`);
    // Umbral: un formulario con dos botones. Al quitarlo, solo «Quitar el umbral» dice «Quitando…».
    const umbral = p.locator("section").filter({ has: p.getByRole("heading", { name: "Umbral de proveedores" }) });
    if ((await umbral.getByRole("button", { name: "Quitar el umbral" }).count()) === 0) {
      await umbral.getByLabel("Umbral en pesos, con centavos").fill("25000.00");
      await umbral.getByRole("button", { name: "Escribir umbral" }).click();
      await umbral.getByRole("button", { name: "Quitar el umbral" }).waitFor({ timeout: 20000 });
    }
    const escrito = sql(`select coalesce(umbral_proveedores_centavos::text, 'sin monto') from policies where company_id = '${EMPRESA_TALLER}'`);
    const marcasUmbral = await dobleClicEnFormulario(p, umbral.getByRole("button", { name: "Quitar el umbral" }));
    await umbral.getByText("La empresa todavía no escribe el umbral de proveedores.").waitFor({ timeout: 20000 });
    const vistasUmbral = await marcasUmbral();
    await foto(p, "08-politica-umbral-quitado");
    const quitado = sql(`select coalesce(umbral_proveedores_centavos::text, 'sin monto') from policies where company_id = '${EMPRESA_TALLER}'`);
    const umbralSolo = soloElOprimido(vistasUmbral, "quitar", "Quitando…");
    anotar(umbralSolo.ok, "flujo 8: al quitar el umbral solo «Quitar el umbral» dice «Quitando…»; «Escribir umbral» se desactiva sin anunciarlo", JSON.stringify(umbralSolo));
    anotar(escrito !== "sin monto" && quitado === "sin monto", "flujo 8: el umbral escrito se quita con el doble clic", `antes=${escrito} después=${quitado}`);
    anotar(errores.length === 0, "flujo 8: sin errores de consola", errores.join(" | "));
    await nav.close();
  }

  // ---------- 9 con «SAT simulado» (scripts/evidencia/ola1b-consola/sat-simulado.mjs) ----------
  // SAT_SIMULADO=ok: el servidor corre con el preload y la IP pública de documentación.
  // SAT_SIMULADO=ip-privada: el mismo preload resuelve a una IP privada y la carga tiene que fallar.
  const simulado = process.env.SAT_SIMULADO ?? null;
  if (corre(9) && simulado) {
    const rotular = (p) => p.evaluate((texto) => {
      const rotulo = document.createElement("div");
      rotulo.textContent = texto;
      rotulo.setAttribute("aria-hidden", "true");
      rotulo.style.cssText = "position:fixed;top:12px;right:12px;z-index:2147483647;padding:8px 14px;border-radius:999px;background:#FFD23F;color:#141210;font:600 14px/1.2 system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.35)";
      document.body.append(rotulo);
    }, simulado === "ok" ? "SAT simulado · evidencia" : "SAT simulado · IP privada");
    const copias = () => Number(sql("select count(*) from lista_69b_snapshots"));
    {
      const { nav, p, errores } = await abrir({ quien: "ofelia" });
      await p.goto(`${BASE}/consola/lista-69b`);
      const antes = copias();
      const marcas = await dobleClic(p, p.getByRole("button", { name: "Guardar el listado" }));
      await p.locator("#carga-69b").locator("xpath=..").locator(".alerta").first().waitFor({ timeout: 70000 });
      const vistas = await marcas();
      await p.waitForTimeout(1500);
      const aviso = (await p.locator(".alerta").first().textContent()).trim();
      const despues = copias();
      await rotular(p);
      anotar(vistas.some((v) => v.disabled && v.busy === "true" && v.texto === "Descargando…"), `flujo 9 (SAT simulado, ${simulado}): «Guardar el listado» se desactiva y dice «Descargando…»`, JSON.stringify(vistas.slice(0, 3)));
      if (simulado === "ok") {
        await foto(p, "09s-lista-69b-guardada");
        const ultima = sql("select fecha_archivo::text || ' filas=' || (select count(*) from lista_69b_rows r where r.snapshot_id = s.id) from lista_69b_snapshots s order by cargado_en desc limit 1");
        anotar(despues - antes === 1 && /31 de octubre de 2026/.test(aviso), "flujo 9 (SAT simulado): doble clic guarda una sola copia con la fecha del archivo", `copias antes=${antes} después=${despues} · última=${ultima} · aviso=${aviso.slice(0, 160)}`);
      } else {
        await foto(p, "09s-lista-69b-ip-privada");
        anotar(despues === antes && /No se pudo leer el listado/.test(aviso), "flujo 9 (SAT simulado, IP privada): la carga se niega y no guarda copia", `copias antes=${antes} después=${despues} · aviso=${aviso.slice(0, 160)}`);
      }
      anotar(errores.length === 0, `flujo 9 (SAT simulado, ${simulado}): sin errores de consola (copia)`, errores.join(" | "));
      await nav.close();
    }
    if (simulado === "ok") {
      const { nav, p, errores } = await abrir({ quien: "gil" });
      await p.goto(`${BASE}${TALLER}/consola/lista-69b`);
      await p.getByLabel("RFC del proveedor").fill("PAL7202161U0");
      await p.getByRole("button", { name: "Consultar" }).click();
      await p.locator(".resultado-69b").waitFor({ timeout: 20000 });
      const resultado = (await p.locator(".resultado-69b").first().textContent()).replace(/\s+/g, " ").trim();
      await rotular(p);
      await foto(p, "09s-lista-69b-consulta");
      anotar(/El pago no\./.test(resultado) && /Definitivo/.test(resultado), "flujo 9 (SAT simulado): la consulta usa la copia nueva y bloquea el pago a un RFC definitivo", resultado.slice(0, 200));
      anotar(errores.length === 0, "flujo 9 (SAT simulado): sin errores de consola (consulta)", errores.join(" | "));
      await nav.close();
    }
  }

  // ---------- 9. Lista 69-B: copia como personal SOFIPO y consulta de un RFC ----------
  if (corre(9) && !simulado) {
    {
      const { nav, p, errores } = await abrir({ quien: "ofelia" });
      await p.goto(`${BASE}/consola/lista-69b`);
      const antes = sql("select count(*) from lista_69b_snapshots");
      await foto(p, "09-lista-69b-sofipo");
      const marcas = await dobleClic(p, p.getByRole("button", { name: "Guardar el listado" }));
      await p.locator("#carga-69b").locator("xpath=..").locator(".alerta").first().waitFor({ timeout: 70000 });
      const vistas = await marcas();
      const aviso = (await p.locator(".alerta").first().textContent()).trim();
      await foto(p, "09-lista-69b-resultado");
      const despues = sql("select count(*) from lista_69b_snapshots");
      anotar(vistas.some((v) => v.disabled && v.busy === "true" && v.texto === "Descargando…"), "flujo 9: «Guardar el listado» se desactiva y dice «Descargando…»", JSON.stringify(vistas.slice(0, 3)));
      const guardo = Number(despues) - Number(antes);
      anotar(guardo <= 1, "flujo 9: doble clic no guarda dos copias", `copias antes=${antes} después=${despues} · aviso=${aviso.slice(0, 160)}`);
      anotar(errores.length === 0, "flujo 9: sin errores de consola (copia)", errores.join(" | "));
      estado.copia69b = { guardo, aviso };
      await nav.close();
    }
    {
      const { nav, p, errores } = await abrir({ quien: "gil" });
      await p.goto(`${BASE}${TALLER}/consola/lista-69b`);
      await p.getByLabel("RFC del proveedor").fill("AAA010101AAA");
      await p.getByRole("button", { name: "Consultar" }).click();
      await p.locator(".resultado-69b").waitFor({ timeout: 20000 });
      const frase = (await p.locator(".resultado-69b .frase").first().textContent()).trim();
      await foto(p, "09-lista-69b-consulta");
      anotar(frase.length > 0 && !/no envía dinero/i.test(frase), "flujo 9: la consulta de un RFC responde con su situación", frase);
      anotar(errores.length === 0, "flujo 9: sin errores de consola (consulta)", errores.join(" | "));
      await nav.close();
    }
  }

  // ---------- 10. Configuración y plan ----------
  if (corre(10)) {
    const { nav, p, errores } = await abrir({ quien: "gil" });
    const destinos = [
      { nombre: "Plan", url: /\/consola\/configuracion\/plan/, ve: "Suscripción de esta empresa" },
      { nombre: "Póliza", url: /\/consola\/poliza/, ve: "Pólizas para tu contador" },
      { nombre: "Apariencia", url: /\/consola\/apariencia/, ve: null },
      { nombre: "Seguridad", url: /\/entrar\/seguridad/, ve: null },
    ];
    for (const destino of destinos) {
      await p.goto(`${BASE}${TALLER}/consola/configuracion`);
      if (destino.nombre === "Plan") await foto(p, "10-configuracion");
      await p.locator(".ajustes").getByRole("link", { name: new RegExp(`^${destino.nombre}`) }).click();
      await p.waitForURL(destino.url, { timeout: 20000 });
      if (destino.ve) await p.getByText(destino.ve).first().waitFor({ timeout: 20000 });
      const h1 = await p.locator("h1").count();
      if (destino.nombre === "Plan") await foto(p, "10-plan");
      anotar(destino.url.test(p.url()) && h1 === 1, `flujo 10: «${destino.nombre}» abre su pantalla con un solo h1`, p.url().replace(BASE, ""));
    }
    anotar(errores.length === 0, "flujo 10: sin errores de consola", errores.join(" | "));
    await nav.close();
  }

  // ---------- 11. Aprobaciones (antes Pendientes): los que quedan, con su acción clicada ----------
  if (corre(11)) {
    const { nav, p, errores } = await abrir({ quien: "laura" });
    await pendiente(p, { BASE, empresa: ALTAMAR, titulo: /^Falta(n)? (una|dos) personas? autorizadas? para liberar/, accion: "Revisar accesos", destino: /\/consola\/personas$/, anotar, foto, nombre: "11-pendiente-liberadores" });
    await pendiente(p, { BASE, empresa: ALTAMAR, titulo: "Crea la primera categoría", accion: "Configurar política", destino: /\/consola\/politica/, anotar, foto, nombre: "11-pendiente-categoria" });
    await pendiente(p, { BASE, empresa: ALTAMAR, titulo: "Registra el primer proveedor", accion: "Configurar proveedores", destino: /\/consola\/proveedores/, anotar, foto, nombre: "11-pendiente-proveedor" });
    await pendiente(p, { BASE, empresa: ALTAMAR, titulo: "Revisa el plan de esta empresa", accion: "Ver plan", destino: /\/consola\/configuracion\/plan/, anotar, foto, nombre: "11-pendiente-plan" });
    anotar(errores.length === 0, "flujo 11: sin errores de consola (Altamar)", errores.join(" | "));
    await nav.close();
    const gil = await abrir({ quien: "gil" });
    await pendiente(gil.p, { BASE, empresa: TALLER, titulo: /categorías? sin tope escrito/, accion: "Revisar topes", destino: /\/consola\/politica/, anotar, foto, nombre: "11-pendiente-topes" });
    anotar(gil.errores.length === 0, "flujo 11: sin errores de consola (Taller)", gil.errores.join(" | "));
    await gil.nav.close();

    // Alertas de #52 con el saldo corto de preparar.ts. Pendientes lleva el
    // faltante (mismo cálculo de Inicio) y la de presupuesto (la nómina de Marta
    // rebasa el tope del área Operación); Inicio, las dos.
    const presupuesto = /^El presupuesto del área Operación está excedido/;
    const faltanteEn = (p) => p.locator('main [data-alerta="faltante"]');
    for (const tema of ["oscuro", "claro", "lever"]) {
      for (const ancho of [1440, 390]) {
        const vista = `${tema} ${ancho}`;
        const { nav, p, errores } = await abrir({ quien: "gil", tema, ancho });
        await p.goto(`${BASE}${TALLER}/consola/aprobaciones`);
        const faltantePend = faltanteEn(p);
        const veFaltante = (await faltantePend.count()) === 1 && (await faltantePend.isVisible());
        const textoPendiente = veFaltante ? (await faltantePend.innerText()).replace(/\s+/g, " ") : "";
        const desbordaFaltante = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        let aInicio = false;
        if (veFaltante) {
          await faltantePend.scrollIntoViewIfNeeded();
          await foto(p, `11-pendiente-faltante-${tema}-${ancho}`);
          await faltantePend.getByRole("link", { name: "Ver la proyección", exact: true }).click();
          await p.waitForURL(/\/consola#proyeccion-titulo$/, { timeout: 20000 });
          aInicio = await p.getByRole("heading", { name: "Proyección a 13 semanas" }).isVisible();
        }
        anotar(veFaltante && /^Faltante: el saldo queda en negativo la semana del/.test(textoPendiente) && /Saldo proyectado al cierre de la semana: -\$/.test(textoPendiente) && /Nómina semanal \(1 persona\) \(\$18,500\.00\)/.test(textoPendiente) && aInicio && !desbordaFaltante, `flujo 11 ${vista}: Aprobaciones muestra el faltante (con la nómina desglosada para quien ve su detalle) y «Ver la proyección» lleva a la proyección de Inicio`, `${textoPendiente.slice(0, 170)} → ${p.url().replace(BASE, "")}${desbordaFaltante ? " (desborda)" : ""}`);
        await p.goto(`${BASE}${TALLER}/consola/aprobaciones`);
        const fila = p.locator(".aprobaciones-renglones li").filter({ has: p.getByRole("heading", { name: presupuesto }) });
        const visible = (await fila.count()) === 1 && (await fila.isVisible());
        const detalle = visible ? (await fila.innerText()).replace(/\s+/g, " ") : "";
        const desborda = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        if (visible) {
          await fila.scrollIntoViewIfNeeded();
          await foto(p, `11-pendiente-presupuesto-${tema}-${ancho}`);
          await fila.getByRole("link", { name: "Ver presupuestos", exact: true }).click();
          await p.waitForURL(/\/consola\/presupuestos/, { timeout: 20000 });
        }
        anotar(visible && /Lleva \$[\d,.]+ de \$80,000\.00/.test(detalle) && /\/consola\/presupuestos/.test(p.url()) && !desborda, `flujo 11 ${vista}: Aprobaciones muestra «El presupuesto del área Operación está excedido» y «Ver presupuestos» lleva a Presupuestos`, `${detalle.slice(0, 160)} → ${p.url().replace(BASE, "")}${desborda ? " (desborda)" : ""}`);

        await p.goto(`${BASE}${TALLER}/consola`);
        const alertas = p.locator(".flujo-alertas");
        const faltante = alertas.locator('[data-alerta="faltante"]');
        const enPresupuesto = alertas.locator('[data-alerta="presupuesto"]');
        const ambas = (await faltante.isVisible()) && (await enPresupuesto.isVisible());
        const textoFaltante = ambas ? (await faltante.innerText()).replace(/\s+/g, " ") : "";
        const textoPresupuesto = ambas ? (await enPresupuesto.innerText()).replace(/\s+/g, " ") : "";
        const desbordaInicio = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        if (ambas) {
          await alertas.scrollIntoViewIfNeeded();
          await foto(p, `11-inicio-alertas-${tema}-${ancho}`);
        }
        anotar(ambas && /Saldo proyectado al cierre de la semana/.test(textoFaltante) && /Operación/.test(textoPresupuesto) && !desbordaInicio, `flujo 11 ${vista}: Inicio muestra las alertas de faltante y de presupuesto`, `${textoFaltante.slice(0, 140)} | ${textoPresupuesto.slice(0, 120)}${desbordaInicio ? " (desborda)" : ""}`);
        anotar(errores.length === 0, `flujo 11 ${vista}: sin errores de consola en Aprobaciones, Presupuestos e Inicio`, errores.join(" | "));
        await nav.close();
      }
    }

    // Fernanda (finanzas): ve el faltante, pero sin cliente.nomina.detalle.ver la
    // nómina de una sola persona no se desglosa; va a la proyección de Inicio.
    for (const [tema, ancho] of [["oscuro", 1440], ["oscuro", 390], ["claro", 1440], ["claro", 390], ["lever", 1440], ["lever", 390]]) {
      const vista = `${tema} ${ancho}`;
      const { nav, p, errores } = await abrir({ quien: "fernanda", tema, ancho });
      await p.goto(`${BASE}${TALLER}/consola/aprobaciones`);
      const faltante = faltanteEn(p);
      const ve = (await faltante.count()) === 1;
      const texto = ve ? (await faltante.innerText()).replace(/\s+/g, " ") : "";
      if (ve) {
        await faltante.scrollIntoViewIfNeeded();
        await foto(p, `11-pendiente-faltante-finanzas-${tema}-${ancho}`);
        await faltante.getByRole("link", { name: "Ver la proyección", exact: true }).click();
        await p.waitForURL(/\/consola#proyeccion-titulo$/, { timeout: 20000 });
      }
      anotar(ve && /Nómina \(monto reservado\)/.test(texto) && !/1 persona|18,500/.test(texto) && /\/consola#proyeccion-titulo$/.test(p.url()), `flujo 11 ${vista}: finanzas ve el faltante con «Nómina (monto reservado)», sin el neto de una sola persona, y llega a la proyección`, `${texto.slice(0, 220)} → ${p.url().replace(BASE, "")}`);
      anotar(errores.length === 0, `flujo 11 ${vista}: sin errores de consola (finanzas)`, errores.join(" | "));
      await nav.close();
    }

    // Una contadora (cliente.flujo.ver sin las cifras de Inicio): el faltante la lleva a Saldo y alertas.
    {
      const contadoraId = randomUUID();
      sql(`
        select set_config('app.user_id', '11111111-1111-4111-8111-111111111111', false);
        select set_config('app.company_id', '${EMPRESA_TALLER}', false);
        insert into users (id, nombre, correo, password_hash)
          values ('${contadoraId}', 'Carmen Contadora', 'carmen-${contadoraId.slice(0, 8)}@lever.test', '$2b$12$${"a".repeat(53)}');
        insert into memberships (user_id, company_id, estado) values ('${contadoraId}', '${EMPRESA_TALLER}', 'activa');
        insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, cambio)
          select operator_id, id, 'miembro', '11111111-1111-4111-8111-111111111111', 'cliente', 'asignar_rol', 'membership_roles', '${contadoraId}', '{"rol":"contador"}'
          from companies where id = '${EMPRESA_TALLER}';
        insert into membership_roles (user_id, company_id, rol) values ('${contadoraId}', '${EMPRESA_TALLER}', 'contador');
      `);
      const valor = randomBytes(32).toString("base64url");
      reponerSesion(sql, contadoraId, valor, "cliente");
      const { nav, p, errores } = await abrir({ sesion: valor, tema: "lever", ancho: 390 });
      await p.goto(`${BASE}${TALLER}/consola/aprobaciones`);
      const faltante = faltanteEn(p);
      const ve = (await faltante.count()) === 1;
      const texto = ve ? (await faltante.innerText()).replace(/\s+/g, " ") : "";
      if (ve) {
        await faltante.scrollIntoViewIfNeeded();
        await foto(p, "11-pendiente-faltante-contadora-lever-390");
        await faltante.getByRole("link", { name: "Revisar saldo y alertas", exact: true }).click();
        await p.waitForURL(/\/consola\/flujo$/, { timeout: 20000 });
      }
      const h1 = await p.locator("h1").count();
      anotar(ve && /Nómina \(monto reservado\)/.test(texto) && !/1 persona|18,500/.test(texto) && /\/consola\/flujo$/.test(p.url()) && h1 === 1, "flujo 11: la contadora ve el faltante con la nómina reservada y «Revisar saldo y alertas» la lleva a Saldo y alertas", `${texto.slice(0, 220)} → ${p.url().replace(BASE, "")}`);
      anotar(errores.length === 0, "flujo 11: sin errores de consola (contadora)", errores.join(" | "));
      await nav.close();
    }

    // Caso negativo: Rosa (liberadora, sin cliente.flujo.ver) no ve el faltante ni alertas del flujo.
    for (const [tema, ancho] of [["oscuro", 1440], ["lever", 390]]) {
      const { nav, p, errores } = await abrir({ quien: "rosa", tema, ancho });
      await p.goto(`${BASE}${TALLER}/consola/aprobaciones`);
      await p.locator(".aprobaciones-vistas").waitFor({ timeout: 20000 });
      const alertas = await p.locator(".flujo-alertas, [data-alerta]").count();
      const cuerpo = await p.locator("main").innerText();
      await foto(p, `11-pendiente-sin-faltante-liberadora-${tema}-${ancho}`);
      anotar(alertas === 0 && !/Faltante|Saldo proyectado|presupuesto del área/i.test(cuerpo), `flujo 11 ${tema} ${ancho}: sin cliente.flujo.ver, Rosa no ve el faltante ni la alerta de presupuesto`, `alertas=${alertas}`);
      anotar(errores.length === 0, `flujo 11 ${tema} ${ancho}: sin errores de consola (liberadora)`, errores.join(" | "));
      await nav.close();
    }
  }

  // ---------- 12. Alta de proveedor con área (#52) ----------
  if (corre(12)) {
    const { nav, p, errores } = await abrir({ quien: "gil" });
    const rfc = `OLA061106B${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${Math.floor(Math.random() * 9) + 1}`;
    await p.goto(`${BASE}${TALLER}/consola/proveedores?vista=proveedores`);
    await p.getByRole("link", { name: "Alta de proveedor" }).click();
    await p.waitForURL(/nuevo-proveedor/);
    await p.getByLabel("RFC", { exact: true }).fill(rfc);
    await p.getByLabel("Razón social", { exact: true }).fill("Refacciones Área Doce, S.A. de C.V.");
    await p.getByLabel("CLABE", { exact: true }).fill(CLABE_NUEVA);
    await p.getByLabel("Área", { exact: true }).selectOption({ label: "Operación" });
    await p.locator("#constancia").setInputFiles(PDF);
    await foto(p, "12-alta-proveedor-area-llena");
    const marcas = await dobleClic(p, p.getByRole("button", { name: "Dar de alta" }));
    await p.getByText("Quedó asentado", { exact: true }).waitFor({ timeout: 30000 });
    const vistas = await marcas();
    await foto(p, "12-alta-proveedor-area-asentada");
    const filas = sql(`select count(*) from suppliers where rfc = '${rfc}'`);
    const area = sql(`select coalesce(string_agg(c.nombre, ','), '') from suppliers s join cost_centers c on c.id = s.cost_center_id and c.company_id = s.company_id where s.rfc = '${rfc}'`);
    const auditoria = sql(`select count(*) from audit_log a join suppliers s on s.id = a.identificador where s.rfc = '${rfc}' and a.accion = 'alta_proveedor' and a.cambio->>'area' = 'Operación'`);
    anotar(vistas.some((v) => v.disabled && v.busy === "true" && v.texto === "Enviando…"), "flujo 12: el botón se desactiva y dice «Enviando…» con aria-busy", JSON.stringify(vistas.slice(0, 3)));
    anotar(filas === "1" && area === "Operación" && auditoria === "1", "flujo 12: doble clic deja un proveedor con el área Operación y un asiento que la nombra", `proveedores=${filas} área=${area} bitácora=${auditoria}`);
    anotar(errores.length === 0, "flujo 12: sin errores de consola", errores.join(" | "));
    await nav.close();
  }

  // ---------- 13. Nómina de una sola persona en la proyección de Inicio ----------
  // Sin cliente.nomina.detalle.ver, el renglón juntado dice «Monto reservado» y la alerta no da el monto.
  // Los totales de la semana no cambian (residuo conocido): se cuentan las semanas cuya salida es solo esa nómina.
  if (corre(13)) {
    for (const quien of ["gil", "fernanda"]) {
      for (const tema of ["oscuro", "claro", "lever"]) {
        for (const ancho of [1440, 390]) {
          const vista = `${quien} ${tema} ${ancho}`;
          const { nav, p, errores } = await abrir({ quien, tema, ancho });
          await p.goto(`${BASE}${TALLER}/consola`);
          await p.getByRole("heading", { name: "Proyección a 13 semanas" }).waitFor({ timeout: 20000 });
          // Todas las semanas abiertas: el texto de los movimientos se revisa completo.
          await p.evaluate(() => document.querySelectorAll("details[data-movimientos]").forEach((d) => { d.open = true; }));
          const renglon = quien === "gil"
            ? p.locator("details[data-movimientos] li").filter({ hasText: "Nómina semanal (1 persona)" }).first()
            : p.locator("details[data-movimientos] li").filter({ has: p.locator('[data-reservado="true"]') }).first();
          const hay = (await renglon.count()) === 1;
          const texto = hay ? (await renglon.innerText()).replace(/\s+/g, " ") : "";
          const movimientos = (await p.locator(".flujo-movimientos").innerText()).replace(/\s+/g, " ");
          const alerta = (await p.locator('.flujo-alertas [data-alerta="faltante"]').innerText().catch(() => "")).replace(/\s+/g, " ");
          const soloNomina = await p.locator('[data-cifra="salidas"][data-centavos="1850000"]').count();
          const desborda = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
          if (hay) {
            await renglon.scrollIntoViewIfNeeded();
            await foto(p, `13-inicio-nomina-${quien}-${tema}-${ancho}`);
          }
          if (quien === "gil") {
            anotar(hay && /−\$18,500\.00/.test(texto) && /Nómina semanal \(1 persona\) \(\$18,500\.00\)/.test(alerta) && !desborda, `flujo 13 ${vista}: el administrador ve la nómina desglosada con su monto en los movimientos y en la alerta`, `${texto} | ${alerta.slice(0, 170)}`);
          } else {
            anotar(hay && /· Nómina/.test(texto) && /Monto reservado/.test(texto) && /Nómina \(monto reservado\)/.test(alerta) && !/18,500|1 persona/.test(movimientos + alerta) && !desborda, `flujo 13 ${vista}: finanzas ve «Monto reservado» en el renglón de nómina y la alerta sin monto; ningún movimiento ni alerta dice 18,500 ni «1 persona»`, `${texto} | ${alerta.slice(0, 170)} | semanas cuya columna Salidas es solo la nómina: ${soloNomina}`);
          }
          anotar(errores.length === 0, `flujo 13 ${vista}: sin errores de consola`, errores.join(" | "));
          await nav.close();
        }
      }
    }
  }

  // ---------- 14. Faltante que no se puede calcular y error de la consola ----------
  // Ninguna lectura de la base llega a consola/error.tsx: conTransaccion traduce cualquier error en
  // ErrorDeDominio y cada página lo pinta dentro del marco.
  // (A) Dos obligaciones de 9,000,000,000,000,000 centavos en la misma fecha hacen que la suma de salidas pase
  //     de Number.MAX_SAFE_INTEGER y la proyección lance. Inicio se queda en su propio estado dentro del marco;
  //     Aprobaciones se pinta con su bandeja y el aviso de faltante no disponible, y el servidor lo registra.
  // (B) Para ver el límite de error, error-forzado.mjs hace que dar formato a un saldo centinela lance al
  //     pintar Inicio. Al quitar el archivo, «Reintentar» vuelve a pedir la página y abre.
  if (corre(14)) {
    const GIL = "11111111-1111-4111-8111-111111111111";
    const contexto = `select set_config('app.user_id', '${GIL}', false); select set_config('app.company_id', '${EMPRESA_TALLER}', false);`;
    // Cada escritura del flujo de caja deja su evento en la misma transacción (flujo_exige_auditoria, 0026):
    // un -c de psql corre en una sola transacción implícita.
    const evento = (accion, entidad, id, cambio) => `insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, cambio)
        select operator_id, id, 'miembro', '${GIL}', 'cliente', '${accion}', '${entidad}', '${id}', '${JSON.stringify(cambio)}' from companies where id = '${EMPRESA_TALLER}';`;
    const provocado = (e) => /Server Components render|status of 500|digest|React error #441/i.test(e);

    // (A) Faltante que no se puede calcular.
    const obligaciones = [randomUUID(), randomUUID()];
    const dia = fecha(10);
    sql(`${contexto}
      ${obligaciones.map((id, i) => `insert into recurring_obligations (id, company_id, concepto, monto_centavos, frecuencia, proxima_fecha, ancla_dia, creado_por, actualizado_por)
        values ('${id}', '${EMPRESA_TALLER}', 'Prueba de error ${i + 1}', 9000000000000000, 'mensual', '${dia}', ${Number(dia.slice(8, 10))}, '${GIL}', '${GIL}');
      ${evento("registrar_obligacion", "recurring_obligations", id, { concepto: `Prueba de error ${i + 1}`, monto_centavos: 9000000000000000, frecuencia: "mensual", proxima_fecha: dia, area: null, proveedor: null })}`).join("\n")}`);
    try {
      for (const tema of ["oscuro", "claro", "lever"]) {
        for (const ancho of [1440, 390]) {
          const vista = `${tema} ${ancho}`;
          const { nav, p, errores } = await abrir({ quien: "gil", tema, ancho });
          await p.goto(`${BASE}${TALLER}/consola`);
          await p.getByRole("heading", { level: 1, name: "No se pudo consultar el resumen." }).waitFor({ timeout: 20000 });
          const marcoInicio = await p.locator(".barra-superior").isVisible();
          await foto(p, `14-inicio-calculo-no-disponible-${tema}-${ancho}`);
          const cuerpoInicio = (await p.locator("main").first().innerText()).replace(/\s+/g, " ");
          anotar(marcoInicio && (await p.locator("h1").count()) === 1 && /Vuelve a intentar\./.test(cuerpoInicio) && !/supuest/i.test(cuerpoInicio), `flujo 14 ${vista}: con la proyección rota, Inicio dice «No se pudo consultar el resumen.» y «Vuelve a intentar.» dentro del marco, sin «cifras supuestas» (no cae en consola/error.tsx)`, cuerpoInicio.slice(0, 160));
          const antes = errores.length;
          await p.goto(`${BASE}${TALLER}/consola/aprobaciones`);
          await p.locator(".aprobaciones-vistas").waitFor({ timeout: 20000 });
          const aviso = p.locator('main [data-alerta="faltante-no-disponible"]');
          const veAviso = (await aviso.count()) === 1 && (await aviso.isVisible());
          const textoAviso = veAviso ? (await aviso.innerText()).replace(/\s+/g, " ") : "";
          const enlace = veAviso ? await aviso.getByRole("link", { name: "Saldo y alertas", exact: true }).getAttribute("href") : null;
          const renglones = await p.locator(".aprobaciones-renglones li, li.decision").count();
          const h1Pendientes = await p.locator("h1").count();
          if (veAviso) await aviso.scrollIntoViewIfNeeded();
          await foto(p, `14-pendientes-faltante-no-disponible-${tema}-${ancho}`);
          anotar(veAviso && /^No se pudo calcular si te alcanza el dinero Revisa Saldo y alertas\.$/.test(textoAviso) && /\/consola\/flujo$/.test(enlace ?? "") && renglones > 0 && h1Pendientes === 1, `flujo 14 ${vista}: Aprobaciones se pinta con su bandeja y el aviso de faltante no disponible, con enlace a Saldo y alertas`, `${textoAviso} → ${enlace} · renglones=${renglones}`);
          anotar(errores.length === antes, `flujo 14 ${vista}: Aprobaciones sin errores de consola`, errores.slice(antes).join(" | "));
          await nav.close();
        }
      }
    } finally {
      sql(`${contexto} update recurring_obligations set activa = false, actualizado_por = '${GIL}', actualizado_en = now() where id in (${obligaciones.map((id) => `'${id}'`).join(", ")});
        ${obligaciones.map((id) => evento("desactivar_obligacion", "recurring_obligations", id, {})).join("\n")}`);
    }
    const activas = sql(`select count(*) from recurring_obligations where id in (${obligaciones.map((id) => `'${id}'`).join(", ")}) and activa`);
    anotar(activas === "0", "flujo 14: las obligaciones de prueba quedan desactivadas, con su evento en la bitácora", `activas=${activas}`);

    // (B) Error al pintar Inicio: consola/error.tsx.
    const bandera = process.env.ERROR_FORZADO_ARCHIVO ?? "";
    if (!bandera) {
      anotar(false, "flujo 14: el error de la consola necesita next start con error-forzado.mjs y ERROR_FORZADO_ARCHIVO");
    } else {
      const saldoId = randomUUID();
      const alDia = hoyMexico();
      sql(`${contexto}
        insert into cash_balance_declarations (id, company_id, saldo_centavos, al_dia, declarado_por) values ('${saldoId}', '${EMPRESA_TALLER}', 4242424242, '${alDia}', '${GIL}');
        ${evento("declarar_saldo", "cash_balance_declarations", saldoId, { saldo_centavos: 4242424242, al_dia: alDia })}`);
      writeFileSync(bandera, "flujo 14\n");
      let espera = null;
      try {
        for (const tema of ["oscuro", "claro", "lever"]) {
          for (const ancho of [1440, 390]) {
            const vista = `${tema} ${ancho}`;
            const { nav, p, errores } = await abrir({ quien: "gil", tema, ancho });
            await p.goto(`${BASE}${TALLER}/consola`);
            await p.getByRole("heading", { level: 1, name: "No se pudo abrir esta página." }).waitFor({ timeout: 20000 });
            const h1 = await p.locator("h1").count();
            const reintentar = await p.getByRole("button", { name: "Reintentar" }).isVisible();
            const cuerpo = (await p.locator("body").innerText()).replace(/\s+/g, " ");
            const desborda = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
            await foto(p, `14-error-consola-${tema}-${ancho}`);
            anotar(h1 === 1 && reintentar && /Vuelve a intentar/.test(cuerpo) && !/datos supuestos/i.test(cuerpo) && !/42,424,242/.test(cuerpo) && !desborda, `flujo 14 ${vista}: un error al pintar Inicio cae en el error de la consola, con un solo h1, «Reintentar» a la vista y sin «datos supuestos»`, `h1=${h1} reintentar=${reintentar}`);
            const ajenos = errores.filter((e) => !provocado(e));
            anotar(ajenos.length === 0, `flujo 14 ${vista}: solo quedan los errores de consola del error provocado`, ajenos.join(" | "));
            await nav.close();
          }
        }
        // Una pestaña se queda en el error para clicar «Reintentar» cuando la página ya se puede pintar.
        espera = await abrir({ quien: "gil", tema: "oscuro", ancho: 1440 });
        await espera.p.goto(`${BASE}${TALLER}/consola`);
        await espera.p.getByRole("heading", { level: 1, name: "No se pudo abrir esta página." }).waitFor({ timeout: 20000 });
      } finally {
        rmSync(bandera, { force: true });
      }
      await espera.p.getByRole("button", { name: "Reintentar" }).click();
      await espera.p.getByRole("heading", { name: "Proyección a 13 semanas" }).waitFor({ timeout: 20000 });
      const h1 = await espera.p.locator("h1").count();
      const saldo = (await espera.p.locator("body").innerText()).includes("42,424,242");
      await foto(espera.p, "14-reintentar-inicio-oscuro-1440");
      anotar(h1 === 1 && saldo && /\/consola$/.test(espera.p.url()), "flujo 14: «Reintentar» vuelve a pedir Inicio al servidor y la página abre con el saldo declarado", `h1=${h1} → ${espera.p.url().replace(BASE, "")}`);
      const ajenos = espera.errores.filter((e) => !provocado(e));
      anotar(ajenos.length === 0, "flujo 14: tras reintentar solo quedan los errores de consola del error provocado", ajenos.join(" | "));
      await espera.nav.close();
    }
  }

  return { estado, hoyMexico, fecha, CLABE, CLABE_NUEVA, codigoTotp, ALTAMAR, ENTORNO };
}
