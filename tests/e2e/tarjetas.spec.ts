import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { clienteHttpEfevoo } from "../../src/server/efevoo/cliente";
import { leerConfigEfevoo } from "../../src/server/efevoo/config";
import { ultimos8De } from "../efevoo/servidor-falso";
import { consultar, dobleClic, sesionDe, vigilarConsola } from "./apoyo";
import { CORREOS_TARJETAS } from "./siembra-tarjetas";

/**
 * Tarjetas con Efevoo Pay (E2), contra el Efevoo falso: la empresa «Tarjetas E2E» queda vinculada a un cliente del
 * falso con dos tarjetas activas, la de Tito y la de Tere. La prueba prepara el falso con el cliente de Efevoo de la
 * aplicación y escribe el vínculo y las tarjetas como dueña (lo que en el producto hace Operación, de E1).
 */
test.describe.configure({ mode: "serial" });

const EMPRESA = () => {
  const id = process.env.E2E_TARJETAS_ID;
  if (!id) throw new Error("Falta E2E_TARJETAS_ID: lo define tests/e2e/siembra-tarjetas.ts.");
  return id;
};
const ruta = (r: string) => `/c/${EMPRESA()}${r}`;
/** El saldo de la empresa en el falso y lo que se le carga a la tarjeta de Tito al sembrar. */
const SALDO_EMPRESA = 5_000_000;
const CARGA_TITO = 123_456;

type Sembrado = { tito: { id: string; terminacion: string }; tere: { id: string; terminacion: string } };
let sembrado: Sembrado;

async function vincular(): Promise<Sembrado> {
  const leida = leerConfigEfevoo(process.env);
  if (!leida.config) throw new Error("La e2e no dejó configurado el Efevoo falso.");
  const efevoo = clienteHttpEfevoo(leida.config);
  const { idepCliente } = await efevoo.crearCliente({ correo: "tarjetas-e2e@lever.test", razonSocial: "Tarjetas E2E" });
  await efevoo.moverSaldoCliente(idepCliente, SALDO_EMPRESA, "deposit");
  const inventario = (await efevoo.listarTarjetas({ estados: ["inStock"], pagina: 1, tamano: 50 })).tarjetas;
  if (inventario.length < 2) throw new Error("El Efevoo falso no tiene dos plásticos en inventario.");
  const [empresa] = await consultar<{ operator_id: string; tania: string }>(
    "select c.operator_id, (select id from users where correo = $2) as tania from companies c where c.id = $1", [EMPRESA(), CORREOS_TARJETAS.tania]);
  await consultar(
    "insert into efevoo_clientes (company_id, operator_id, ambiente, idep_cliente, operacion_id, vinculado_por) values ($1, $2, 'sandbox', $3, gen_random_uuid(), $4)",
    [EMPRESA(), empresa!.operator_id, idepCliente, empresa!.tania]);
  const tarjeta = async (plastico: (typeof inventario)[number], nombre: string, correoUsuario: string, correoTarjeta: string) => {
    const asignada = await efevoo.asignarTarjeta({
      producto: 16, subproducto: 19, idepCliente, ultimos8: ultimos8De(plastico.terminacion),
      titular: { nombre, primerApellido: "Titular", segundoApellido: "E2E", nombreEmbozar: `${nombre.toUpperCase()} TITULAR`, telefono: "5512345678",
        correo: correoTarjeta, paisNacimiento: "MEX", domicilio: "Calle 1, CDMX" },
    });
    await efevoo.activarTarjeta(asignada.id, correoTarjeta);
    await efevoo.asignarTarjetasACliente(idepCliente, [asignada.id]);
    const [fila] = await consultar<{ id: string }>(
      `insert into efevoo_tarjetas (id, company_id, operator_id, ambiente, id_efevoo, employee_id, terminacion, nombre_tarjeta, estado, creada_por)
       select gen_random_uuid(), $1, $2, 'sandbox', $3, e.id, $4, $5, 'activa', $6
         from employees e join users u on u.id = e.user_id where e.company_id = $1 and u.correo = $7
       returning id`,
      [EMPRESA(), empresa!.operator_id, asignada.id, asignada.terminacion, `${nombre.toUpperCase()} TITULAR`, empresa!.tania, correoUsuario]);
    return { id: fila!.id, idEfevoo: asignada.id, terminacion: asignada.terminacion, correo: correoTarjeta };
  };
  const tito = await tarjeta(inventario[0]!, "Tito", CORREOS_TARJETAS.tito, "tito-tarjeta@lever.test");
  const tere = await tarjeta(inventario[1]!, "Tere", CORREOS_TARJETAS.tere, "tere-tarjeta@lever.test");
  // Un movimiento en la tarjeta de Tito. El concepto lo pone el emisor; el filtro de números largos lo prueba vista.test.ts.
  await efevoo.cargarTarjeta(tito.idEfevoo, tito.correo, CARGA_TITO, "9999001", "Siembra 4111111111111111");
  return { tito, tere };
}

test.beforeAll(async () => {
  sembrado = await vincular();
});

/** Ninguna secuencia de 13 a 19 dígitos en lo que manda el servidor (HTML y carga RSC). */
async function sinNumerosDeTarjeta(context: BrowserContext, direccion: string): Promise<void> {
  for (const encabezados of [{}, { RSC: "1" }]) {
    const respuesta = await context.request.get(direccion, { headers: encabezados });
    const cuerpo = await respuesta.text();
    expect(cuerpo.match(/(?<![0-9])[0-9]{13,19}(?![0-9])/g) ?? [], `${direccion} ${JSON.stringify(encabezados)}`).toEqual([]);
  }
}

async function abrir(page: Page, context: BrowserContext, correo: string, direccion: string) {
  await sesionDe(context, correo);
  return page.goto(ruta(direccion));
}

test("T1: administración ve el saldo para tarjetas, cada tarjeta con su terminación, titular y saldo, y las acciones", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  await abrir(page, context, CORREOS_TARJETAS.tania, "/consola/tarjetas");
  // El falso descuenta del saldo de la empresa la carga de la siembra: 50,000.00 − 1,234.56.
  const cifras = page.getByLabel("Tarjetas en cifras");
  await expect(cifras).toContainText("Saldo para tarjetas$48,765.44");
  await expect(cifras).toContainText("Repartido en tarjetas$1,234.56");
  const tabla = page.getByRole("region", { name: "Tabla de las tarjetas de la empresa" });
  await expect(tabla.getByRole("row")).toHaveCount(3);
  const filaTito = tabla.getByRole("row").filter({ hasText: `••${sembrado.tito.terminacion}` });
  await expect(filaTito).toContainText("Tito Titular");
  await expect(filaTito).toContainText("$1,234.56");
  await expect(filaTito).toContainText("Activa");
  await expect(filaTito.getByRole("button", { name: "Cargar" })).toBeEnabled();
  await expect(filaTito.getByRole("button", { name: "Bloquear" })).toBeEnabled();
  // r-e2-4: el nombre de la tarjeta va en negritas, como la demostración, sin subrayado de enlace.
  expect(await filaTito.getByRole("link").first().evaluate((a) => getComputedStyle(a).textDecorationLine)).toBe("none");
  await sinNumerosDeTarjeta(context, ruta("/consola/tarjetas"));
  expect(errores).toEqual([]);
});

test("T1: el detalle trae los movimientos del emisor y ningún número largo; una tarjeta que no existe es 404", async ({ page, context }) => {
  // Un movimiento cuyo concepto trae un número de tarjeta partido con espacios: se pinta solo su terminación.
  // De hace una hora: el emisor ya dice que es un cargo (recién hecho llega sin tipo y, con este concepto, no se deduce).
  await falso("/simular", {
    metodo: "movimiento", idCard: await idEfevooDe(sembrado.tito.id), concepto: "COMPRA OXXO 4111 1111 1111 1111", importe: 12.34, tipo: "Cargo",
    fecha: new Date(Date.now() - 60 * 60_000).toISOString(),
  });
  await abrir(page, context, CORREOS_TARJETAS.tania, `/consola/tarjetas/${sembrado.tito.id}`);
  const movimientos = page.getByRole("region", { name: "Tabla de movimientos de la tarjeta" });
  await expect(movimientos).toContainText("$1,234.56");
  await expect(movimientos).toContainText("PAGO A TARJETA");
  await expect(movimientos).toContainText("COMPRA OXXO ••1111");
  // El signo sale del tipo: el cargo con «−», la carga de la siembra (abono) con «+».
  await expect(movimientos.getByRole("row").filter({ hasText: "COMPRA OXXO" })).toContainText("−$12.34");
  await expect(movimientos.getByRole("row").filter({ hasText: "PAGO A TARJETA" })).toContainText("+$1,234.56");
  expect(await page.content()).not.toContain("4111 1111");
  await sinNumerosDeTarjeta(context, ruta(`/consola/tarjetas/${sembrado.tito.id}`));
  const ajena = await page.goto(ruta("/consola/tarjetas/00000000-0000-4000-8000-000000000000"));
  expect(ajena?.status()).toBe(404);
});

test("r-e2-2: en el detalle, cargar avisa antes de enviar si no alcanza el saldo de la empresa", async ({ page, context }) => {
  await abrir(page, context, CORREOS_TARJETAS.tania, `/consola/tarjetas/${sembrado.tito.id}`);
  await page.getByRole("button", { name: "Cargar" }).click();
  const dialogo = page.getByRole("dialog");
  await dialogo.getByLabel("Monto en pesos").fill("48765.45");
  await expect(dialogo.getByText("No alcanza el saldo para ese monto.")).toBeVisible();
  await dialogo.getByLabel("Monto en pesos").fill("48765.44");
  await expect(dialogo.getByText("No alcanza el saldo para ese monto.")).toHaveCount(0);
});

test("r-e2-3: el monto escrito en «Cargar» no aparece al abrir «Retirar»", async ({ page, context }) => {
  await abrir(page, context, CORREOS_TARJETAS.tania, "/consola/tarjetas");
  const fila = page.getByRole("row").filter({ hasText: `••${sembrado.tito.terminacion}` });
  await fila.getByRole("button", { name: "Cargar" }).click();
  await page.getByRole("dialog").getByLabel("Monto en pesos").fill("10.00");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await fila.getByRole("button", { name: "Retirar" }).click();
  await expect(page.getByRole("dialog").getByLabel("Monto en pesos")).toHaveValue("");
});

test("finanzas ve todas las tarjetas sin botones; el contador no abre Tarjetas", async ({ page, context }) => {
  await abrir(page, context, CORREOS_TARJETAS.fina, "/consola/tarjetas");
  const tabla = page.getByRole("region", { name: "Tabla de las tarjetas de la empresa" });
  await expect(tabla.getByRole("row")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Cargar" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Bloquear|Desbloquear/ })).toHaveCount(0);
  const contador = await abrir(page, context, CORREOS_TARJETAS.cuco, "/consola/tarjetas");
  expect(contador?.status()).toBe(404);
});

test("T5: el titular ve solo su tarjeta en el teléfono, con saldo y movimientos, y no abre la consola de Tarjetas", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  await abrir(page, context, CORREOS_TARJETAS.tito, "/telefono/tarjetas");
  const lista = page.locator(".tarjetas-app > li");
  await expect(lista).toHaveCount(1);
  await expect(lista).toContainText(`••${sembrado.tito.terminacion}`);
  await expect(lista).toContainText("$1,234.56");
  await expect(lista).toContainText("PAGO A TARJETA");
  await expect(page.getByText(`••${sembrado.tere.terminacion}`)).toHaveCount(0);
  await sinNumerosDeTarjeta(context, ruta("/telefono/tarjetas"));
  // r-e2-5: con «Tarjetas» la barra del teléfono tiene 4 secciones, todas en una fila (390 y 320 px).
  for (const ancho of [390, 320]) {
    await page.setViewportSize({ width: ancho, height: 800 });
    const alturas = await page.getByRole("navigation", { name: "Teléfono" }).getByRole("link").evaluateAll((enlaces) => enlaces.map((a) => (a as HTMLElement).offsetTop));
    expect(alturas.length, `${ancho} px`).toBe(4);
    expect(new Set(alturas).size, `${ancho} px: ${alturas.join(", ")}`).toBe(1);
  }
  for (const direccion of ["/consola/tarjetas", `/consola/tarjetas/${sembrado.tere.id}`, `/consola/tarjetas/${sembrado.tito.id}`]) {
    const respuesta = await page.goto(ruta(direccion));
    expect(respuesta?.status(), direccion).toBe(404);
  }
  expect(errores).toEqual([]);
});

// Operaciones: T2 a T6 -------------------------------------------------------------------------------------------

/** El control del Efevoo falso (sin credenciales, solo en 127.0.0.1). */
async function falso(ruta: string, cuerpo?: unknown): Promise<unknown> {
  const base = process.env.E2E_EFEVOO_URL;
  if (!base) throw new Error("Falta E2E_EFEVOO_URL.");
  const r = await fetch(new URL(ruta, base), cuerpo === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
  if (!r.ok) throw new Error(`El Efevoo falso respondió ${r.status} en ${ruta}`);
  return r.json();
}
const simular = (metodo: string, falla: string, idCard: number) => falso("/simular", { metodo, falla, idCard });
async function saldoEnEfevoo(idEfevoo: number): Promise<number> {
  const estado = (await falso("/estado")) as { tarjetas: { id: number; saldoCentavos: number; estado: string }[] };
  return estado.tarjetas.find((t) => t.id === idEfevoo)!.saldoCentavos;
}
async function idEfevooDe(tarjetaId: string): Promise<number> {
  const [fila] = await consultar<{ id_efevoo: number }>("select id_efevoo from efevoo_tarjetas where id = $1", [tarjetaId]);
  return fila!.id_efevoo;
}
type Op = { id: string; tipo: string; estado: string; monto: string | null; codigo: string | null; reintento_de: string | null; referencia: string };
const operaciones = (tarjetaId: string) => consultar<Op>(
  `select id, tipo, estado, monto_centavos::text as monto, codigo_efevoo as codigo, reintento_de, referencia
     from efevoo_operaciones where tarjeta_id = $1 order by creada_en`, [tarjetaId]);

/** Abre el diálogo de una acción en la fila de la tarjeta. */
async function dialogoDe(page: Page, terminacion: string, accion: "Cargar" | "Retirar" | "Bloquear" | "Desbloquear") {
  await page.getByRole("row").filter({ hasText: `••${terminacion}` }).getByRole("button", { name: accion, exact: true }).click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo).toBeVisible();
  return dialogo;
}

test("T2 y T3: liberación carga $100.00 con doble clic (una sola operación) y retira $25.50 al centavo", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  const tito = sembrado.tito;
  const idEfevoo = await idEfevooDe(tito.id);
  const antes = await saldoEnEfevoo(idEfevoo);
  const previas = (await operaciones(tito.id)).length;
  await abrir(page, context, CORREOS_TARJETAS.leo, "/consola/tarjetas");
  let dialogo = await dialogoDe(page, tito.terminacion, "Cargar");
  await dialogo.getByLabel("Monto en pesos").fill("100.00");
  await dobleClic(dialogo.getByRole("button", { name: "Cargar", exact: true }));
  await expect(page.getByText(/Se cargó el saldo a la tarjeta\. Referencia \d{7}\./)).toBeVisible();
  const tras = await operaciones(tito.id);
  expect(tras.slice(previas).map((o) => [o.tipo, o.estado, o.monto])).toEqual([["carga", "confirmada", "10000"]]);
  expect(await saldoEnEfevoo(idEfevoo)).toBe(antes + 10_000);

  dialogo = await dialogoDe(page, tito.terminacion, "Retirar");
  await dialogo.getByLabel("Monto en pesos").fill("25.50");
  await dialogo.getByRole("button", { name: "Retirar", exact: true }).click();
  await expect(page.getByText(/Se retiró el saldo de la tarjeta\. Referencia \d{7}\./)).toBeVisible();
  expect((await operaciones(tito.id)).slice(previas).map((o) => [o.tipo, o.estado, o.monto])).toEqual([["carga", "confirmada", "10000"], ["retiro", "confirmada", "2550"]]);
  expect(await saldoEnEfevoo(idEfevoo)).toBe(antes + 10_000 - 2_550);
  await expect(page.getByRole("row").filter({ hasText: `••${tito.terminacion}` })).toContainText(pesosDe(antes + 10_000 - 2_550));
  expect(errores).toEqual([]);
});

test("T3: un retiro mayor al saldo de la tarjeta lo rechaza Lever antes de llamar al emisor", async ({ page, context }) => {
  const tere = sembrado.tere;
  const idEfevoo = await idEfevooDe(tere.id);
  const antes = await saldoEnEfevoo(idEfevoo);
  await abrir(page, context, CORREOS_TARJETAS.leo, "/consola/tarjetas");
  const dialogo = await dialogoDe(page, tere.terminacion, "Retirar");
  await dialogo.getByLabel("Monto en pesos").fill("1.00");
  await expect(dialogo.getByText("No alcanza el saldo para ese monto.")).toBeVisible();
  await dialogo.getByRole("button", { name: "Retirar", exact: true }).click();
  await expect(dialogo.getByText(/No alcanza el saldo de la tarjeta para ese retiro\. No se llamó al emisor/)).toBeVisible();
  const [op] = (await operaciones(tere.id)).slice(-1);
  expect([op?.tipo, op?.estado, op?.codigo]).toEqual(["retiro", "fallida", "saldo_insuficiente"]);
  expect(await saldoEnEfevoo(idEfevoo)).toBe(antes);
});

test("r-e2-1: el emisor rechaza una carga, se corrige el monto en el mismo diálogo y la carga nueva sí se hace", async ({ page, context }) => {
  const tito = sembrado.tito;
  const idEfevoo = await idEfevooDe(tito.id);
  const previas = (await operaciones(tito.id)).length;
  await simular("fundCard", "401", idEfevoo);
  await abrir(page, context, CORREOS_TARJETAS.leo, "/consola/tarjetas");
  const dialogo = await dialogoDe(page, tito.terminacion, "Cargar");
  await dialogo.getByLabel("Monto en pesos").fill("10.00");
  await dialogo.getByRole("button", { name: "Cargar", exact: true }).click();
  await expect(dialogo.getByText(/El emisor la rechazó \(código 401\)/)).toBeVisible();
  await dialogo.getByLabel("Monto en pesos").fill("11.00");
  await dialogo.getByRole("button", { name: "Cargar", exact: true }).click();
  await expect(page.getByText(/Se cargó el saldo a la tarjeta\./)).toBeVisible();
  expect((await operaciones(tito.id)).slice(previas).map((o) => [o.tipo, o.estado, o.monto, o.codigo])).toEqual([
    ["carga", "fallida", "1000", "401"],
    ["carga", "confirmada", "1100", null],
  ]);
});

test("T4: bloquear y desbloquear; el estado se ve en la lista y en el emisor", async ({ page, context }) => {
  const tere = sembrado.tere;
  const idEfevoo = await idEfevooDe(tere.id);
  await abrir(page, context, CORREOS_TARJETAS.tania, "/consola/tarjetas");
  let dialogo = await dialogoDe(page, tere.terminacion, "Bloquear");
  await dialogo.getByRole("button", { name: "Bloquear", exact: true }).click();
  await expect(page.getByText("La tarjeta quedó bloqueada.", { exact: false })).toBeVisible();
  const fila = page.getByRole("row").filter({ hasText: `••${tere.terminacion}` });
  await expect(fila).toContainText("Bloqueada");
  expect(((await falso("/estado")) as { tarjetas: { id: number; estado: string }[] }).tarjetas.find((t) => t.id === idEfevoo)?.estado).toBe("blocked");
  dialogo = await dialogoDe(page, tere.terminacion, "Desbloquear");
  await dialogo.getByRole("button", { name: "Desbloquear", exact: true }).click();
  await expect(page.getByText("La tarjeta quedó desbloqueada.", { exact: false })).toBeVisible();
  await expect(fila).toContainText("Activa");
  expect(((await falso("/estado")) as { tarjetas: { id: number; estado: string }[] }).tarjetas.find((t) => t.id === idEfevoo)?.estado).toBe("active");
});

test("T6: un timeout con efecto deja la carga sin confirmar; «Conciliar» la encuentra por su referencia y la confirma", async ({ page, context }) => {
  test.setTimeout(120_000);
  const tito = sembrado.tito;
  const idEfevoo = await idEfevooDe(tito.id);
  const antes = await saldoEnEfevoo(idEfevoo);
  await simular("fundCard", "timeout", idEfevoo);
  await abrir(page, context, CORREOS_TARJETAS.leo, "/consola/tarjetas");
  const dialogo = await dialogoDe(page, tito.terminacion, "Cargar");
  await dialogo.getByLabel("Monto en pesos").fill("7.00");
  await dialogo.getByRole("button", { name: "Cargar", exact: true }).click();
  await expect(page.getByText(/El emisor no confirmó la operación \d{7}\. No se repite sola/)).toBeVisible({ timeout: 40_000 });
  const [op] = (await operaciones(tito.id)).slice(-1);
  expect([op?.estado, op?.monto]).toEqual(["incierta", "700"]);
  // Efevoo sí la hizo: el saldo ya subió, sin que Lever lo supiera.
  expect(await saldoEnEfevoo(idEfevoo)).toBe(antes + 700);
  await page.reload();
  const pendiente = page.locator(`[data-operacion="${op!.referencia}"]`);
  await pendiente.getByRole("button", { name: "Conciliar" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Buscar en el emisor" }).click();
  await expect(page.getByText(`La operación ${op!.referencia} sí se hizo en el emisor. Quedó confirmada.`)).toBeVisible();
  expect((await operaciones(tito.id)).slice(-1).map((o) => o.estado)).toEqual(["confirmada"]);
  // No se repitió: el saldo subió una sola vez.
  expect(await saldoEnEfevoo(idEfevoo)).toBe(antes + 700);
});

test("T6: un timeout sin efecto se queda sin confirmar 10 minutos; después no aparece y «Reintentar» la hace con referencia nueva", async ({ page, context }) => {
  test.setTimeout(120_000);
  const tito = sembrado.tito;
  const idEfevoo = await idEfevooDe(tito.id);
  const antes = await saldoEnEfevoo(idEfevoo);
  await simular("fundCard", "timeout_sin_efecto", idEfevoo);
  await abrir(page, context, CORREOS_TARJETAS.leo, "/consola/tarjetas");
  const dialogo = await dialogoDe(page, tito.terminacion, "Cargar");
  await dialogo.getByLabel("Monto en pesos").fill("3.00");
  await dialogo.getByRole("button", { name: "Cargar", exact: true }).click();
  await expect(page.getByText(/El emisor no confirmó la operación \d{7}/)).toBeVisible({ timeout: 40_000 });
  const [op] = (await operaciones(tito.id)).slice(-1);
  expect(op?.estado).toBe("incierta");
  await page.reload();
  const pendiente = page.locator(`[data-operacion="${op!.referencia}"]`);
  await expect(pendiente).toContainText(/vuelve a conciliar en \d+ min/);
  await expect(pendiente.getByRole("button", { name: "Reintentar" })).toHaveCount(0);
  await pendiente.getByRole("button", { name: "Conciliar" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Buscar en el emisor" }).click();
  await expect(page.getByRole("dialog").getByText(/Vuelve a conciliar en \d+ min/)).toBeVisible();
  expect((await operaciones(tito.id)).slice(-1).map((o) => o.estado)).toEqual(["incierta"]);

  // Pasan los 10 minutos: se mueve la hora de la operación (en la base desechable, como dueña, por la transición).
  // La 0033 exige un evento de la bitácora en la misma transacción que toca la operación.
  await consultar(`begin; select set_config('efevoo.resolviendo', '${op!.id}', true);
    insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, origen)
      select c.operator_id, c.id, 'miembro', (select id from users where correo = '${CORREOS_TARJETAS.leo}'), 'cliente', 'efevoo_incierta',
             'efevoo_operaciones', '${op!.id}', 'consola' from companies c where c.id = '${EMPRESA()}';
    update efevoo_operaciones set creada_en = now() - interval '11 minutes' where id = '${op!.id}'; commit;`);
  await page.reload();
  await page.locator(`[data-operacion="${op!.referencia}"]`).getByRole("button", { name: "Conciliar" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Buscar en el emisor" }).click();
  await expect(page.getByText(`La operación ${op!.referencia} no aparece en el emisor. No se movió dinero; puedes reintentarla.`)).toBeVisible();
  await page.locator(`[data-operacion="${op!.referencia}"]`).getByRole("button", { name: "Reintentar" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reintentar", exact: true }).click();
  await expect(page.getByText(/Se reintentó con una referencia nueva\. Referencia \d{7}\./)).toBeVisible();
  const todas = await operaciones(tito.id);
  const anterior = todas.find((o) => o.id === op!.id);
  const nueva = todas.find((o) => o.reintento_de === op!.id);
  expect([anterior?.estado, anterior?.codigo]).toEqual(["fallida", "no_aparecio"]);
  expect([nueva?.estado, nueva?.monto, nueva?.reintento_de]).toEqual(["confirmada", "300", anterior?.id]);
  expect(nueva?.referencia).not.toBe(anterior?.referencia);
  expect(await saldoEnEfevoo(idEfevoo)).toBe(antes + 300);
});

test("empresa suspendida: no se carga ni se bloquea; la base lo impide", async ({ page, context }) => {
  const tito = sembrado.tito;
  const previas = (await operaciones(tito.id)).length;
  await consultar("begin; set local session_replication_role = replica; update companies set estado = 'suspendida' where id = $1; commit;".replace("$1", `'${EMPRESA()}'`));
  try {
    await abrir(page, context, CORREOS_TARJETAS.tania, "/consola/tarjetas");
    const dialogo = await dialogoDe(page, tito.terminacion, "Cargar");
    await dialogo.getByLabel("Monto en pesos").fill("5.00");
    await dialogo.getByRole("button", { name: "Cargar", exact: true }).click();
    await expect(dialogo.getByText(/La empresa está suspendida/)).toBeVisible();
    expect((await operaciones(tito.id)).length).toBe(previas);
  } finally {
    await consultar(`begin; set local session_replication_role = replica; update companies set estado = 'activa' where id = '${EMPRESA()}'; commit;`);
  }
});

/** $1,234.56 como la pinta la tabla. */
function pesosDe(centavos: number): string {
  return `$${Math.trunc(centavos / 100).toLocaleString("en-US")}.${String(centavos % 100).padStart(2, "0")}`;
}
