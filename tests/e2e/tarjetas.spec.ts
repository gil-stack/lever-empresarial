import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { clienteHttpEfevoo } from "../../src/server/efevoo/cliente";
import { leerConfigEfevoo } from "../../src/server/efevoo/config";
import { ultimos8De } from "../efevoo/servidor-falso";
import { consultar, sesionDe, vigilarConsola } from "./apoyo";
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
  await sinNumerosDeTarjeta(context, ruta("/consola/tarjetas"));
  expect(errores).toEqual([]);
});

test("T1: el detalle trae los movimientos del emisor y ningún número largo; una tarjeta que no existe es 404", async ({ page, context }) => {
  await abrir(page, context, CORREOS_TARJETAS.tania, `/consola/tarjetas/${sembrado.tito.id}`);
  const movimientos = page.getByRole("region", { name: "Tabla de movimientos de la tarjeta" });
  await expect(movimientos).toContainText("$1,234.56");
  await expect(movimientos).toContainText("PAGO A TARJETA");
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
  for (const direccion of ["/consola/tarjetas", `/consola/tarjetas/${sembrado.tere.id}`, `/consola/tarjetas/${sembrado.tito.id}`]) {
    const respuesta = await page.goto(ruta(direccion));
    expect(respuesta?.status(), direccion).toBe(404);
  }
  expect(errores).toEqual([]);
});
