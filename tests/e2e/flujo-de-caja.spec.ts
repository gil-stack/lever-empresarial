import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

import { altamar, consultar, contar, dobleClic, sesionDe, vigilarConsola } from "./apoyo";
import { CORREOS } from "./siembra";

/**
 * Flujo de caja de Altamar E2E (empresa real): saldo declarado, cobros (manual y
 * con XML), obligación recurrente, presupuesto al 80 % y al 100 %, escenario
 * «mover pago», faltante en Inicio y en Pendientes, y la nómina de una sola
 * persona reservada para quien no ve su detalle. Cada envío es un doble clic
 * rápido y la base debe quedar con una sola operación.
 */

const en = (ruta: string) => `/c/${altamar()}${ruta}`;

function hoy(): string {
  return process.env.E2E_TODAY ?? new Date().toISOString().slice(0, 10);
}

function desplazar(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

async function proyeccion(pagina: Page) {
  return pagina.locator('table[data-tabla="proyeccion"] tbody tr').evaluateAll((filas) =>
    filas.map((fila) => ({
      semana: fila.getAttribute("data-semana") ?? "",
      salidas: Number(fila.querySelector('td[data-cifra="salidas"]')?.getAttribute("data-centavos") ?? "NaN"),
      final: Number(fila.querySelector('td[data-cifra="saldo-final"]')?.getAttribute("data-centavos") ?? "NaN"),
    })),
  );
}

async function areaId(nombre: string): Promise<string> {
  const [fila] = await consultar<{ id: string }>("select id from cost_centers where company_id = $1 and nombre = $2", [altamar(), nombre]);
  if (!fila) throw new Error(`No existe el área ${nombre}.`);
  return fila.id;
}

test("saldo declarado: doble clic deja una sola declaración y Inicio dice de dónde viene", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  await sesionDe(context, CORREOS.laura);
  await page.goto(en("/consola/flujo"));
  const forma = page.locator('form[data-formulario="saldo"]');
  const antes = await contar("select 1 from cash_balance_declarations where company_id = $1", [altamar()]);
  await forma.locator("#saldo").fill("120000.00");
  await forma.locator("#alDia").fill(hoy());
  const { envios } = await dobleClic(forma.getByRole("button", { name: "Declarar el saldo" }));
  await expect(forma.locator(".alerta-asentado")).toBeVisible();
  expect(envios).toBe(1);
  expect(await contar("select 1 from cash_balance_declarations where company_id = $1", [altamar()])).toBe(antes + 1);
  expect(await contar("select 1 from audit_log where company_id = $1 and accion = 'declarar_saldo'", [altamar()])).toBe(antes + 1);

  await page.goto(en("/consola"));
  const saldo = page.locator('.flujo-saldo[data-estado="declarado"]');
  await expect(saldo).toContainText("$120,000.00");
  await expect(saldo).toContainText("Declarado por tu empresa");
  await expect(saldo).toContainText("No es un saldo confirmado por el banco.");
  expect(errores).toEqual([]);
});

test("cobro esperado y cobro con XML: cada doble clic deja un solo cobro", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  await sesionDe(context, CORREOS.laura);
  await page.goto(en("/consola/cobros"));

  const cobro = page.locator('form[data-formulario="cobro"]');
  await cobro.locator("#clienteNombre").fill("Abarrotes del Puerto");
  await cobro.locator("#concepto").fill("Fletes de noviembre");
  await cobro.locator("#monto").fill("22500.50");
  await cobro.locator("#fechaProbable").fill(desplazar(hoy(), 10));
  const manual = await dobleClic(cobro.getByRole("button", { name: "Registrar el cobro" }));
  await expect(cobro.locator(".alerta-asentado")).toBeVisible();
  expect(manual.envios).toBe(1);
  const abarrotes = "select id from expected_collections where company_id = $1 and cliente_nombre = 'Abarrotes del Puerto'";
  expect(await contar(abarrotes, [altamar()])).toBe(1);
  expect(await contar(`select 1 from audit_log where accion = 'registrar_cobro' and identificador in (${abarrotes})`, [altamar()])).toBe(1);
  const [guardado] = await consultar<{ monto: string; origen: string }>(
    "select monto_centavos::text as monto, origen from expected_collections where company_id = $1 and cliente_nombre = 'Abarrotes del Puerto'",
    [altamar()],
  );
  expect(guardado).toEqual({ monto: "2250050", origen: "manual" });

  const uuid = randomUUID().toUpperCase();
  const xml = (emisor: string) => Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Fecha="${hoy()}T10:00:00" TipoDeComprobante="I" Moneda="MXN" Total="45000.00" Serie="F" Folio="1041">
  <cfdi:Emisor Rfc="${emisor}" Nombre="Altamar E2E" RegimenFiscal="601" />
  <cfdi:Receptor Rfc="CLM120101AB2" Nombre="Comercializadora La Moderna" DomicilioFiscalReceptor="06600" RegimenFiscalReceptor="601" UsoCFDI="G03" />
  <cfdi:Complemento><tfd:TimbreFiscalDigital UUID="${uuid}" /></cfdi:Complemento>
</cfdi:Comprobante>`);
  const conXml = page.locator('form[data-formulario="cobro-xml"]');
  // Una factura emitida por otro RFC no es un cobro de esta empresa.
  await conXml.locator("#xml").setInputFiles({ name: "ajena.xml", mimeType: "text/xml", buffer: xml("XAX010101000") });
  await conXml.locator("#fechaProbableXml").fill(desplazar(hoy(), 12));
  await conXml.getByRole("button", { name: "Registrar con el XML" }).click();
  await expect(conXml.locator(".alerta-revisar")).toContainText("XAX010101000");
  expect(await contar("select 1 from expected_collections where cfdi_uuid = $1", [uuid])).toBe(0);

  await conXml.locator("#xml").setInputFiles({ name: "emitida.xml", mimeType: "text/xml", buffer: xml("AEE180312AB1") });
  await conXml.locator("#fechaProbableXml").fill(desplazar(hoy(), 12));
  const conFactura = await dobleClic(conXml.getByRole("button", { name: "Registrar con el XML" }));
  await expect(conXml.locator(".alerta-asentado")).toBeVisible();
  expect(conFactura.envios).toBe(1);
  const [factura] = await consultar<{ n: string; dato: string }>(
    `select count(*)::text as n, max(origen || '|' || cliente_nombre || '|' || monto_centavos) as dato
     from expected_collections where cfdi_uuid = $1`,
    [uuid],
  );
  expect(factura).toEqual({ n: "1", dato: "cfdi|Comercializadora La Moderna|4500000" });
  expect(errores).toEqual([]);
});

test("obligación recurrente con doble clic y presupuesto al 80 % y al 100 % en Presupuestos, Inicio y Pendientes", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  await sesionDe(context, CORREOS.laura);
  const mercadotecnia = await areaId("Mercadotecnia");
  const tarjeta = page.locator(`[data-presupuesto="${mercadotecnia}"]`);
  await page.goto(en("/consola/presupuestos"));
  await expect(tarjeta).toHaveAttribute("data-estado", "en_rango");

  async function registrar(concepto: string, monto: string) {
    await page.goto(en("/consola/calendario"));
    const forma = page.locator('form[data-formulario="obligacion"]');
    await forma.locator('input[name="concepto"]').fill(concepto);
    await forma.locator('input[name="monto"]').fill(monto);
    await forma.locator('select[name="frecuencia"]').selectOption("mensual");
    await forma.locator('input[name="proximaFecha"]').fill(hoy());
    await forma.locator('select[name="areaId"]').selectOption({ label: "Mercadotecnia" });
    const { envios } = await dobleClic(forma.getByRole("button", { name: "Registrar la obligación" }));
    await expect(forma.locator(".alerta-asentado")).toBeVisible();
    expect(envios).toBe(1);
    const filas = "select id from recurring_obligations where company_id = $1 and concepto = $2";
    expect(await contar(filas, [altamar(), concepto])).toBe(1);
    expect(await contar(`select 1 from audit_log where accion = 'registrar_obligacion' and identificador in (${filas})`, [altamar(), concepto])).toBe(1);
  }

  // $8,000.00 de $10,000.00: el 80 % exacto ya es «atención».
  await registrar("Pauta digital", "8000.00");
  await page.goto(en("/consola/presupuestos"));
  await expect(tarjeta).toHaveAttribute("data-estado", "atencion");
  await expect(tarjeta.locator('[data-cifra="gasto"]')).toHaveAttribute("data-centavos", "800000");
  await page.goto(en("/consola"));
  await expect(page.locator('[data-alerta="presupuesto"]')).toContainText("Mercadotecnia");
  await page.goto(en("/consola/pendientes"));
  await expect(page.locator("main")).toContainText("El presupuesto del área Mercadotecnia está por agotarse");

  // $10,000.00 de $10,000.00: el 100 % es «excedido».
  await registrar("Diseño de campaña", "2000.00");
  await page.goto(en("/consola/presupuestos"));
  await expect(tarjeta).toHaveAttribute("data-estado", "excedido");
  await expect(tarjeta.locator('[data-cifra="gasto"]')).toHaveAttribute("data-centavos", "1000000");
  await page.goto(en("/consola/pendientes"));
  await expect(page.locator("main")).toContainText("El presupuesto del área Mercadotecnia está excedido");
  expect(errores).toEqual([]);
});

test("escenario «mover pago»: la semana cambia en pantalla y la base no", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  await sesionDe(context, CORREOS.laura);
  const [cargo] = await consultar<{ id: string; programada: string; total: string }>(
    "select id, programada_el::text as programada, total_centavos::text as total from supplier_payables where company_id = $1 and folio = '501'",
    [altamar()],
  );
  if (!cargo) throw new Error("Falta el cargo TN-501 de la siembra.");
  const bitacora = await contar("select 1 from audit_log where company_id = $1", [altamar()]);

  await page.goto(en("/consola"));
  const real = await proyeccion(page);
  expect(real).toHaveLength(13);
  const nueva = desplazar(cargo.programada, 7);
  const semanaDe = (fecha: string) => real.findIndex((s) => s.semana <= fecha && fecha <= desplazar(s.semana, 6));
  const origen = semanaDe(cargo.programada);
  const destino = semanaDe(nueva);
  expect(origen).toBeGreaterThanOrEqual(0);
  expect(destino).toBe(origen + 1);

  await page.locator("#mover").selectOption(`cxp:${cargo.id}`);
  await page.locator("#fecha-escenario").fill(nueva);
  await page.getByRole("button", { name: "Ver el escenario" }).click();
  await expect(page.locator('[data-escenario="activo"]')).toBeVisible();
  const movido = await proyeccion(page);
  const total = Number(cargo.total);
  expect(movido[origen]!.salidas).toBe(real[origen]!.salidas - total);
  expect(movido[destino]!.salidas).toBe(real[destino]!.salidas + total);
  expect(movido.at(-1)!.final).toBe(real.at(-1)!.final);

  const [despues] = await consultar<{ programada: string }>("select programada_el::text as programada from supplier_payables where id = $1", [cargo.id]);
  expect(despues!.programada).toBe(cargo.programada);
  expect(await contar("select 1 from audit_log where company_id = $1", [altamar()])).toBe(bitacora);

  await page.getByRole("link", { name: "Quitar el escenario" }).click();
  await expect(page.locator('[data-escenario="activo"]')).toHaveCount(0);
  expect(errores).toEqual([]);
});

test("faltante: con poco saldo, Inicio y Pendientes avisan en qué semana", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  await sesionDe(context, CORREOS.laura);
  await page.goto(en("/consola/flujo"));
  const forma = page.locator('form[data-formulario="saldo"]');
  await forma.locator("#saldo").fill("1000.00");
  await forma.locator("#alDia").fill(hoy());
  await forma.getByRole("button", { name: "Declarar el saldo" }).click();
  await expect(forma.locator(".alerta-asentado")).toBeVisible();

  await page.goto(en("/consola"));
  const semanas = await proyeccion(page);
  const primera = semanas.find((s) => s.final < 0);
  expect(primera, JSON.stringify(semanas)).toBeTruthy();
  const alerta = page.locator('[data-alerta="faltante"]');
  await expect(alerta).toContainText("Faltante: el saldo queda en negativo");
  await expect(alerta).toContainText("Lo provoca:");
  await expect(page.locator(`tr[data-semana="${primera!.semana}"] .insignia`)).toHaveText("Faltante");

  await page.goto(en("/consola/pendientes"));
  const enPendientes = page.locator('[data-alerta="faltante"]');
  await expect(enPendientes).toContainText("Faltante: el saldo queda en negativo");
  await enPendientes.getByRole("link", { name: "Ver la proyección" }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${altamar()}/consola#proyeccion-titulo$`));
  expect(errores).toEqual([]);
});

test("nómina de una sola persona: finanzas ve «Monto reservado» y administración ve el monto", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  await sesionDe(context, CORREOS.fernanda);
  await page.goto(en("/consola"));
  const reservados = page.locator('.flujo-movimientos [data-reservado="true"]');
  await expect(reservados.first()).toHaveText("Monto reservado");
  for (const texto of await page.locator(".flujo-movimientos li").filter({ has: page.locator('[data-reservado="true"]') }).allInnerTexts()) {
    expect(texto).not.toContain("$");
  }
  await expect(page.locator(".flujo-movimientos")).not.toContainText("$10,000.00");

  await sesionDe(context, CORREOS.laura);
  await page.goto(en("/consola"));
  await expect(page.locator('.flujo-movimientos [data-reservado="true"]')).toHaveCount(0);
  await expect(page.locator(".flujo-movimientos")).toContainText("$10,000.00");
  expect(errores).toEqual([]);
});
