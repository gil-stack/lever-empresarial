import { createHash } from "node:crypto";

import { expect, test, type BrowserContext, type Page, type Request } from "@playwright/test";
import { Client } from "pg";

import { arrecife, codigoTotp, consultar, contar, sesionDe, vigilarConsola } from "./apoyo";
import { CORREOS } from "./siembra";

/**
 * Aprobaciones (antes Pendientes) se refresca cuando un pendiente se resuelve en
 * su módulo: Personas, Política, Proveedores y Flujo de caja revalidan la ruta de
 * Aprobaciones, y al volver con un clic en el lateral el pendiente ya no está (o
 * aparece el aviso nuevo). Arrecife E2E es una empresa recién dada de alta que
 * solo usa este spec. Los atajos de la bandeja no deciden desde un diálogo abierto
 * en la fila: el pago E-12 de Taller del Cierre (tests/e2e/seed-pagos.sql) es solo
 * para esa prueba.
 */

const en = (ruta: string) => `/c/${arrecife()}${ruta}`;

/**
 * El segundo factor de la sesión de este navegador se probó hace `minutos`. Solo esta: la sesión de Rosa que siembra
 * seed-pagos.sql la usan las pruebas de Proveedores (envejecerFactor de apoyo.ts las envejece todas).
 */
async function envejecerEstaSesion(contexto: BrowserContext, minutos: number): Promise<void> {
  const token = (await contexto.cookies()).find((cookie) => cookie.name === "__Host-sesion")?.value;
  if (!token) throw new Error("El navegador no tiene sesión.");
  const cliente = new Client({ connectionString: process.env.E2E_OWNER_DATABASE_URL });
  await cliente.connect();
  try {
    await cliente.query("begin");
    await cliente.query("set local session_replication_role = replica");
    const { rowCount } = await cliente.query(
      "update sessions set segundo_factor_en = now() - make_interval(mins => $2::int) where token_hash = $1",
      [createHash("sha256").update(token).digest("hex"), minutos],
    );
    if (rowCount !== 1) throw new Error("La sesión del navegador no está en la base.");
    await cliente.query("commit");
  } finally {
    await cliente.end();
  }
}

function hoy(): string {
  return process.env.E2E_TODAY ?? new Date().toISOString().slice(0, 10);
}

test("Aprobaciones se refresca al volver por el lateral tras una acción en Personas, Política, Proveedores y Flujo", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  await sesionDe(context, CORREOS.marina);
  const renglon = (titulo: string | RegExp) =>
    page.locator(".aprobaciones-renglones li").filter({ has: page.getByRole("heading", { name: titulo }) });
  const cuenta = async () => Number((await page.locator(".aprobaciones-vistas a").first().innerText()).match(/· (\d+)/)?.[1] ?? "NaN");
  async function volver() {
    await page.getByRole("navigation", { name: "Secciones" }).getByRole("link", { name: /^Aprobaciones/ }).click();
    await expect(page).toHaveURL(new RegExp(`/c/${arrecife()}/consola/aprobaciones$`));
  }

  await page.goto(en("/consola/aprobaciones"));
  for (const titulo of ["Crea la primera área", "Crea la primera categoría", "Registra el primer proveedor"]) {
    await expect(renglon(titulo)).toBeVisible();
  }
  const inicial = await cuenta();

  // Personas: la primera área, desde el enlace del renglón. Su lugar lo toma el siguiente paso.
  await renglon("Crea la primera área").getByRole("link", { name: "Crear área" }).click();
  await expect(page).toHaveURL(/\/consola\/personas\/areas$/);
  await page.getByLabel("Área", { exact: true }).fill("Ventas");
  await page.getByLabel("Presupuesto mensual").fill("1000");
  await page.getByRole("button", { name: "Crear área" }).click();
  await expect(page.getByText("El área quedó creada con su presupuesto.")).toBeVisible();
  await volver();
  await expect(renglon("Crea la primera área")).toHaveCount(0);
  await expect(renglon("Da de alta al primer colaborador")).toBeVisible();
  expect(await cuenta()).toBe(inicial);

  // Política: la primera categoría. Sin tope escrito, deja el pendiente de topes en su lugar.
  await renglon("Crea la primera categoría").getByRole("link", { name: "Configurar política" }).click();
  await expect(page).toHaveURL(/\/consola\/politica$/);
  const categorias = page.locator("section").filter({ has: page.getByRole("heading", { name: "Categorías", exact: true }) });
  await categorias.getByLabel("Nombre", { exact: true }).fill("Viáticos");
  await categorias.getByRole("button", { name: "Agregar categoría" }).click();
  await expect(categorias.getByRole("heading", { name: "Viáticos" })).toBeVisible();
  await volver();
  await expect(renglon("Crea la primera categoría")).toHaveCount(0);
  await expect(renglon(/sin tope escrito/)).toBeVisible();
  expect(await cuenta()).toBe(inicial);

  // Proveedores: el primero, con su constancia en el emulador de Blob.
  await renglon("Registra el primer proveedor").getByRole("link", { name: "Configurar proveedores" }).click();
  await expect(page).toHaveURL(/\/consola\/proveedores$/);
  await page.getByRole("navigation", { name: "Espacios de proveedores" }).getByRole("link", { name: /^Proveedores/ }).click();
  await page.getByRole("link", { name: "Alta de proveedor" }).click();
  await expect(page).toHaveURL(/\/consola\/proveedores\/nuevo-proveedor$/);
  await page.getByLabel("RFC", { exact: true }).fill("EEE050505EA1");
  await page.getByLabel("Razón social", { exact: true }).fill("Embarques del Golfo");
  await page.getByLabel("CLABE", { exact: true }).fill("002180701150123452");
  await page.locator("#constancia").setInputFiles("tests/e2e/fixtures/soporte-prueba.pdf");
  await page.getByRole("button", { name: "Dar de alta" }).click();
  await expect(page.getByText("Quedó asentado", { exact: true })).toBeVisible();
  await volver();
  await expect(renglon("Registra el primer proveedor")).toHaveCount(0);
  expect(await cuenta()).toBe(inicial - 1);

  // Flujo de caja: una obligación que rebasa el presupuesto del área enciende su aviso.
  await page.getByRole("navigation", { name: "Secciones" }).getByRole("link", { name: "Calendario", exact: true }).click();
  await expect(page).toHaveURL(/\/consola\/calendario$/);
  const obligacion = page.locator('form[data-formulario="obligacion"]');
  await obligacion.locator('input[name="concepto"]').fill("Renta de bodega");
  await obligacion.locator('input[name="monto"]').fill("1500.00");
  await obligacion.locator('select[name="frecuencia"]').selectOption("mensual");
  await obligacion.locator('input[name="proximaFecha"]').fill(hoy());
  await obligacion.locator('select[name="areaId"]').selectOption({ label: "Ventas" });
  await obligacion.getByRole("button", { name: "Registrar la obligación" }).click();
  await expect(obligacion.locator(".alerta-asentado")).toBeVisible();
  await volver();
  await expect(renglon("El presupuesto del área Ventas está excedido")).toBeVisible();
  expect(await cuenta()).toBe(inicial);
  expect(errores).toEqual([]);
});

test("con el rechazo abierto, A y R no deciden el pago; con el foco en la fila, A lo autoriza una sola vez", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  await sesionDe(context, "rosa-pagos@ejemplo.mx");
  const PAGO = "88888888-8888-4888-8888-888888888889";
  const estado = async () =>
    (await consultar<{ estado: string }>("select estado from supplier_payment_requests where id = $1", [PAGO]))[0]?.estado;
  const eventos = (accion: string) => contar("select 1 from audit_log where accion = $1 and identificador = $2", [accion, PAGO]);
  const envios: string[] = [];
  page.on("request", (peticion) => {
    if (peticion.method() === "POST") envios.push(peticion.url());
  });

  await page.goto("/c/33333333-3333-4333-8333-333333333333/consola/aprobaciones");
  const fila = page.locator("li.decision").filter({ hasText: "E-12" });
  await expect(fila).toBeVisible();
  await fila.getByRole("button", { name: "Rechazar" }).click();
  const dialogo = page.getByRole("dialog", { name: "Rechazar el pago" });
  await expect(dialogo).toBeVisible();
  // pressSequentially, no fill: cada letra llega como keydown, igual que al teclear.
  await dialogo.getByLabel("Motivo").pressSequentially("Falta la orden de compra");
  // Una autorización por atajo sale en el mismo cuadro; un segundo da tiempo de sobra a que salga.
  async function sinDecidir(paso: string) {
    await page.waitForTimeout(1000);
    expect(envios, paso).toEqual([]);
    await expect(dialogo, paso).toBeVisible();
  }
  await page.keyboard.press("Tab");
  await expect(dialogo.getByRole("button", { name: "Cancelar" })).toBeFocused();
  await page.keyboard.press("a");
  await sinDecidir("A con el foco en Cancelar");
  await page.keyboard.press("Tab");
  await expect(dialogo.getByRole("button", { name: "Rechazar", exact: true })).toBeFocused();
  await page.keyboard.press("a");
  await sinDecidir("A con el foco en Rechazar del diálogo");
  await page.keyboard.press("r");
  await sinDecidir("R con el foco en Rechazar del diálogo");
  await expect(dialogo.getByLabel("Motivo")).toHaveValue("Falta la orden de compra");
  expect(await estado()).toBe("por_autorizar");
  expect(await eventos("autorizar_pago_proveedor")).toBe(0);
  expect(await eventos("rechazar_pago_proveedor")).toBe(0);

  // Control: fuera del diálogo, con el foco en la fila, A autoriza una sola vez.
  await page.keyboard.press("Escape");
  await expect(dialogo).toBeHidden();
  await fila.focus();
  await page.keyboard.press("a");
  await expect(fila).toHaveCount(0);
  expect(envios).toHaveLength(1);
  expect(await estado()).toBe("listo_para_pagar");
  expect(await eventos("autorizar_pago_proveedor")).toBe(1);
  expect(await eventos("rechazar_pago_proveedor")).toBe(0);
  expect(errores).toEqual([]);
});

test("con JavaScript y el segundo factor vencido, el diálogo de rechazo pide el código y conserva el motivo", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  const ROSA = "rosa-pagos@ejemplo.mx";
  const E17 = "88888888-8888-4888-8888-88888888888e";
  await sesionDe(context, ROSA);
  await envejecerEstaSesion(context, 31);
  await page.goto("/c/33333333-3333-4333-8333-333333333333/consola/aprobaciones");
  await page.locator("li.decision").filter({ hasText: "E-17" }).getByRole("button", { name: "Rechazar" }).click();
  const dialogo = page.getByRole("dialog", { name: "Rechazar el pago" });
  await dialogo.getByLabel("Motivo").fill("Falta el contrato vigente");
  await dialogo.getByRole("button", { name: "Rechazar", exact: true }).click();
  const codigo = dialogo.getByLabel("Código de tu app autenticadora");
  await expect(codigo).toBeFocused();
  await expect(dialogo.getByLabel("Motivo")).toHaveValue("Falta el contrato vigente");
  await codigo.fill(await codigoTotp(ROSA));
  await dialogo.getByRole("button", { name: "Rechazar", exact: true }).click();
  await expect(page.getByText("Decisión asentada")).toBeVisible();
  await expect(dialogo).toBeHidden();
  const [fila] = await consultar<{ estado: string; motivo_resolucion: string }>(
    "select estado, motivo_resolucion from supplier_payment_requests where id = $1",
    [E17],
  );
  expect(fila).toEqual({ estado: "rechazado", motivo_resolucion: "Falta el contrato vigente" });
  expect(errores).toEqual([]);
});

// Sin JavaScript (o antes de que la página hidrate), «Rechazar» era un botón con onClick y no abría nada, y «Autorizar»
// era un formulario sin acción: mandaba el pago, la versión y el importe en la dirección (GET) y no decidía. Los pagos
// E-13 a E-16 de Taller del Cierre (tests/e2e/seed-pagos.sql) son solo para estas pruebas, que corren en orden.
test.describe("sin JavaScript se decide desde la bandeja", () => {
  test.use({ javaScriptEnabled: false });
  const ROSA = "rosa-pagos@ejemplo.mx";
  const TALLER = "33333333-3333-4333-8333-333333333333";
  const BANDEJA = `/c/${TALLER}/consola/aprobaciones`;
  const E13 = "88888888-8888-4888-8888-88888888888a";
  const E14 = "88888888-8888-4888-8888-88888888888b";
  const E15 = "88888888-8888-4888-8888-88888888888c";
  const E16 = "88888888-8888-4888-8888-88888888888d";
  const SIN_FACTOR =
    "Tu segundo factor ya no es reciente: para decidir tiene que ser de los últimos 30 minutos. Escribe el código de tu app autenticadora; lo que escribiste se conserva.";
  const CAMBIO = "La solicitud cambió mientras la revisabas (otra decisión, una corrección o un regreso a revisión). Recarga y revisa la versión vigente antes de decidir.";
  const leer = async (pago: string) =>
    (await consultar<{ estado: string; motivo_resolucion: string | null }>(
      "select estado, motivo_resolucion from supplier_payment_requests where id = $1",
      [pago],
    ))[0];
  const eventos = (pago: string) =>
    contar("select 1 from audit_log where accion in ('autorizar_pago_proveedor', 'rechazar_pago_proveedor') and identificador = $1", [pago]);
  const fila = (page: Page, folio: string) => page.locator("li.decision").filter({ hasText: folio });

  /** Los POST de la página: el último es el que el navegador reenvía con F5. */
  function envios(page: Page): Request[] {
    const lista: Request[] = [];
    page.on("request", (peticion) => {
      if (peticion.method() === "POST") lista.push(peticion);
    });
    return lista;
  }

  /** F5 sobre la página que dejó un POST: el navegador manda otra vez el mismo cuerpo, con la misma sesión. */
  async function reenviar(page: Page, peticion: Request) {
    const encabezados = peticion.headers();
    const respuesta = await page.request.fetch(peticion.url(), {
      method: "POST",
      headers: { "content-type": encabezados["content-type"] ?? "", origin: encabezados.origin ?? "" },
      data: peticion.postDataBuffer() ?? Buffer.alloc(0),
      maxRedirects: 0,
    });
    return { estado: respuesta.status(), html: await respuesta.text() };
  }

  test("«Rechazar» con la dirección solo abre el motivo; un pago ajeno se ve como uno que no existe", async ({ page, context }) => {
    await sesionDe(context, ROSA);
    const antes = { pago: await leer(E13), eventos: await contar("select 1 from audit_log where company_id = $1", [TALLER]) };
    await page.goto(`${BANDEJA}?rechazar=${E13}`);
    await expect(fila(page, "E-13").getByRole("dialog", { name: "Rechazar el pago" })).toBeVisible();
    await page.reload();
    expect(await leer(E13)).toEqual(antes.pago);
    expect(await contar("select 1 from audit_log where company_id = $1", [TALLER])).toBe(antes.eventos);

    // Un pago de otra empresa y uno que no existe: sin diálogo y el mismo HTML, salvo el id que viene en la dirección
    // (Next la repite en la página); nada dice que el ajeno exista.
    const [ajeno] = await consultar<{ id: string }>("select id from supplier_payment_requests where company_id <> $1 limit 1", [TALLER]);
    expect(ajeno, "la siembra trae un pago de otra empresa").toBeTruthy();
    const paginas: string[] = [];
    for (const id of [ajeno!.id, "88888888-8888-4888-8888-000000000000"]) {
      const respuesta = await page.goto(`${BANDEJA}?rechazar=${id}`);
      expect(respuesta?.status(), id).toBe(200);
      await expect(page.getByRole("dialog"), id).toHaveCount(0);
      paginas.push((await page.content()).replaceAll(id, "ID-PEDIDO"));
    }
    expect(paginas[0]).toBe(paginas[1]);
  });

  test("«Rechazar» abre el motivo; uno en blanco vuelve con el aviso junto al campo; doble clic y F5 deciden una vez", async ({ page, context }) => {
    await sesionDe(context, ROSA);
    const posts = envios(page);
    await page.goto(BANDEJA);
    await fila(page, "E-13").getByRole("button", { name: "Rechazar" }).click();
    await expect(page).toHaveURL(new RegExp(`/consola/aprobaciones\\?rechazar=${E13}$`));
    const rechazo = fila(page, "E-13").getByRole("dialog", { name: "Rechazar el pago" });
    const motivo = rechazo.getByLabel("Motivo");
    await expect(motivo).toBeFocused();

    // Cinco espacios pasan el minLength del navegador, no al servidor: el motivo se recorta.
    await motivo.fill("     ");
    await rechazo.getByRole("button", { name: "Rechazar", exact: true }).click();
    const aviso = rechazo.getByRole("alert");
    await expect(aviso).toHaveText("Explica el motivo con al menos 10 caracteres. Al rechazar o cancelar bastan 5.");
    await expect(motivo).toHaveAttribute("aria-invalid", "true");
    await expect(motivo).toHaveAttribute("aria-describedby", (await aviso.getAttribute("id")) ?? "sin id");
    await expect(motivo).toBeFocused();
    await expect(motivo).toHaveValue("     ");
    expect((await leer(E13))?.estado).toBe("por_autorizar");

    // Doble clic: el segundo envío llega con la solicitud ya decidida y da su aviso, nunca un 500.
    await motivo.fill("Falta la orden de compra firmada");
    await rechazo.getByRole("button", { name: "Rechazar", exact: true }).dblclick();
    await expect(page.getByText("Decisión asentada").or(page.getByText("Esa solicitud ya cambió"))).toBeVisible();
    await expect(fila(page, "E-13")).toHaveCount(0);
    expect(await leer(E13)).toEqual({ estado: "rechazado", motivo_resolucion: "Falta la orden de compra firmada" });
    expect(await eventos(E13)).toBe(1);

    // F5 sobre la página que dejó el POST: el mismo envío otra vez, con el aviso de que la solicitud ya cambió.
    const otraVez = await reenviar(page, posts.at(-1)!);
    expect(otraVez.estado).toBe(200);
    expect(otraVez.html).toContain("Esa solicitud ya cambió");
    expect(otraVez.html).toContain(CAMBIO);
    expect(await eventos(E13)).toBe(1);
  });

  test("«Autorizar» decide con la acción del servidor, no con la dirección; doble clic y F5 deciden una vez", async ({ page, context }) => {
    await sesionDe(context, ROSA);
    const posts = envios(page);
    await page.goto(BANDEJA);
    await fila(page, "E-14").getByRole("button", { name: "Autorizar" }).dblclick();
    await expect(page.getByText("Decisión asentada").or(page.getByText("Esa solicitud ya cambió"))).toBeVisible();
    expect(page.url()).not.toContain(E14);
    await expect(fila(page, "E-14")).toHaveCount(0);
    expect((await leer(E14))?.estado).toBe("listo_para_pagar");
    expect(await eventos(E14)).toBe(1);

    // El título solo existe si el aviso se pinta (el mensaje solo también viaja en el estado serializado de la página).
    const otraVez = await reenviar(page, posts.at(-1)!);
    expect(otraVez.estado).toBe(200);
    expect(otraVez.html).toContain("Esa solicitud ya cambió");
    expect(otraVez.html).toContain(CAMBIO);
    expect(await eventos(E14)).toBe(1);
  });

  test("con el segundo factor vencido, el rechazo pide el código ahí mismo y conserva el motivo", async ({ page, context }) => {
    await sesionDe(context, ROSA);
    await envejecerEstaSesion(context, 31);
    await page.goto(`${BANDEJA}?rechazar=${E15}`);
    const rechazo = fila(page, "E-15").getByRole("dialog", { name: "Rechazar el pago" });
    const motivo = rechazo.getByLabel("Motivo");
    await motivo.fill("El importe no coincide con la orden");
    await rechazo.getByRole("button", { name: "Rechazar", exact: true }).click();

    const codigo = rechazo.getByLabel("Código de tu app autenticadora");
    await expect(codigo).toBeFocused();
    await expect(rechazo.getByRole("alert")).toHaveText(SIN_FACTOR);
    await expect(motivo).toHaveValue("El importe no coincide con la orden");
    expect((await leer(E15))?.estado).toBe("por_autorizar");

    // Un código que no coincide: el aviso lo dice junto al campo y el motivo sigue ahí.
    await codigo.fill("000000");
    await rechazo.getByRole("button", { name: "Rechazar", exact: true }).click();
    await expect(rechazo.getByRole("alert")).toHaveText("Ese código no coincide. Vuelve a intentar.");
    await expect(codigo).toHaveAttribute("aria-invalid", "true");
    await expect(motivo).toHaveValue("El importe no coincide con la orden");
    expect(await eventos(E15)).toBe(0);

    await codigo.fill(await codigoTotp(ROSA));
    await rechazo.getByRole("button", { name: "Rechazar", exact: true }).click();
    await expect(page.getByText("Decisión asentada")).toBeVisible();
    expect(await leer(E15)).toEqual({ estado: "rechazado", motivo_resolucion: "El importe no coincide con la orden" });
    expect(await eventos(E15)).toBe(1);
  });

  test("con el segundo factor vencido, «Autorizar» pide el código en la misma fila", async ({ page, context }) => {
    await sesionDe(context, ROSA);
    await envejecerEstaSesion(context, 31);
    await page.goto(BANDEJA);
    await fila(page, "E-16").getByRole("button", { name: "Autorizar" }).click();
    const confirmar = fila(page, "E-16").getByRole("dialog", { name: "Confirma que eres tú" });
    const codigo = confirmar.getByLabel("Código de tu app autenticadora");
    await expect(codigo).toBeFocused();
    await expect(confirmar.getByRole("alert")).toHaveText(SIN_FACTOR);
    expect((await leer(E16))?.estado).toBe("por_autorizar");

    await codigo.fill(await codigoTotp(ROSA));
    await confirmar.getByRole("button", { name: "Autorizar" }).click();
    await expect(page.getByText("Decisión asentada")).toBeVisible();
    expect((await leer(E16))?.estado).toBe("listo_para_pagar");
    expect(await eventos(E16)).toBe(1);
  });
});
