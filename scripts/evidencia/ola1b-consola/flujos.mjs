import { createHash, randomUUID } from "node:crypto";

// Los 11 flujos de Ola 1B (consola), clicados en la aplicación con Playwright
// headless. Cada envío se hace con doble clic y la base confirma que quedó una
// sola operación. Lo llama scripts/evidencia/ola1b-consola.mjs flujos.

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

  const EMPRESA_ALTAMAR = ENTORNO.EMPRESA_ALTAMAR;
  const COLABORADORA = "Mariana López Ruiz";

  // ---------- 5. Alta de colaborador con nómina ----------
  if (corre(5)) {
    const { nav, p, errores } = await abrir({ quien: "laura" });
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
      // La sesión sembrada probó su segundo factor hace más de 30 minutos.
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

  return { estado, hoyMexico, fecha, CLABE, CLABE_NUEVA, codigoTotp, ALTAMAR, ENTORNO };
}
