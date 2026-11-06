// Los 11 flujos de Ola 1B (consola), clicados en la aplicación con Playwright
// headless. Cada envío se hace con doble clic y la base confirma que quedó una
// sola operación. Lo llama scripts/evidencia/ola1b-consola.mjs flujos.

const CLABE = "002180701150123452";
const CLABE_NUEVA = "014180655012345678";
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
    await p.goto(`${BASE}${TALLER}/consola/proveedores`);
    await p.getByRole("link", { name: "Abrir pago de Proveedor Uno, S.A. de C.V." }).first().click();
    await p.getByRole("dialog").waitFor();
    await p.goto(`${BASE}${TALLER}/consola/proveedores?pago=${id}`);
    const panel = p.getByRole("dialog");
    await panel.getByRole("button", { name: "Autorizar para pagar" }).waitFor();
    await foto(p, "03-autorizacion-antes");
    const marcas = await dobleClic(p, panel.getByRole("button", { name: "Autorizar para pagar" }));
    await panel.locator(".detalle-cabeza").getByText("Listo para pagar", { exact: true }).waitFor({ timeout: 30000 });
    const vistas = await marcas();
    await foto(p, "03-autorizacion-listo");
    const estadoBase = sql(`select estado from supplier_payment_requests where id = '${id}'`);
    const autorizaciones = sql(`select count(*) from audit_log where identificador = '${id}' and accion = 'autorizar_pago_proveedor'`);
    const rechazo = vistas.find((v) => v.texto === "Rechazar");
    anotar(vistas.some((v) => v.disabled && v.busy === "true" && v.texto === "Enviando…"), "flujo 3: «Autorizar para pagar» se desactiva y dice «Enviando…»", JSON.stringify(vistas.slice(0, 3)));
    anotar(!rechazo || rechazo.busy !== "true", "flujo 3: «Rechazar» no anuncia que envía cuando se oprimió «Autorizar»");
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
      await panel.getByLabel("Motivo al rechazar").fill("La fecha no coincide con el contrato");
      const marcas = await dobleClic(p, panel.getByRole("button", { name: "Rechazar", exact: true }));
      await panel.locator(".detalle-cabeza").getByText("Rechazado", { exact: true }).waitFor({ timeout: 30000 });
      const vistas = await marcas();
      await foto(p, "04-rechazo-con-motivo");
      const rechazos = sql(`select count(*) from audit_log where identificador = '${pendiente}' and accion = 'rechazar_pago_proveedor'`);
      anotar(vistas.some((v) => v.busy === "true" && v.texto === "Enviando…"), "flujo 4: «Rechazar» se desactiva y dice «Enviando…»", JSON.stringify(vistas.slice(0, 3)));
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

  return { estado, hoyMexico, fecha, CLABE, CLABE_NUEVA, codigoTotp, ALTAMAR, ENTORNO };
}
