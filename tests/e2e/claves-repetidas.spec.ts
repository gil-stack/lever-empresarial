import { expect, test } from "@playwright/test";

import { sesionDe } from "./apoyo";

/**
 * N28: una clave repetida en la dirección (`?q=a&q=b`) llega a la página como lista, no como texto. Proveedores la
 * pasaba al servidor y `q.trim()` respondía 500. Cada página del portal que lee la dirección se pide con todas sus
 * claves repetidas y tiene que responder 200: la clave repetida se descarta, como si no viniera (mismo criterio que
 * `soloTexto` de Operación y que Personas). Solo lee: no cambia datos.
 */

/** Taller del Cierre (seed-pagos.sql): Gil la administra. */
const TALLER = "33333333-3333-4333-8333-333333333333";
const GIL = "gil-pagos@ejemplo.mx";

/** `?a=1&a=2&b=…`: cada clave dos veces, con valores que la página acepta por separado. */
function repetidas(claves: Record<string, [string, string]>): string {
  const busqueda = new URLSearchParams();
  for (const [clave, [uno, dos]] of Object.entries(claves)) {
    busqueda.append(clave, uno);
    busqueda.append(clave, dos);
  }
  return `?${busqueda.toString()}`;
}

const CONSOLA: [string, Record<string, [string, string]>][] = [
  ["", { periodo: ["mes", "trimestre"], mover: ["x", "y"], fecha: ["2026-11-10", "2026-11-11"] }],
  ["/aprobaciones", { vista: ["historial", "pendientes"] }],
  ["/calendario", { mes: ["2026-11", "2026-12"] }],
  ["/cobros", { estado: ["vencidos", "pagados"], vence: ["semana", "mes"] }],
  ["/lista-69b", { rfc: ["AAA010101AAA", "BBB010101BBB"] }],
  ["/movimientos", { periodo: ["7", "hoy"], persona: ["Carlos Méndez", "Daniela Ruiz"], desde: ["10", "20"], agrupar: ["persona", "area"] }],
  ["/personas", { q: ["a", "b"], estado: ["vigentes", "bajas"], area: ["x", "y"], pagina: ["1", "2"] }],
  [
    "/proveedores",
    { vista: ["pagos", "proveedores"], q: ["a", "b"], estado: ["pendiente", "pagado"], pagina: ["1", "2"], pago: ["x", "y"], proveedor: ["x", "y"] },
  ],
  ["/proveedores/nuevo", { proveedor: ["x", "y"], pago: ["x", "y"] }],
  ["/tarjetas", { vista: ["presupuestos", "todas"] }],
];

test("ninguna página del portal da 500 con una clave repetida en la dirección", async ({ page, context }) => {
  test.setTimeout(120_000);
  await sesionDe(context, GIL);
  for (const [ruta, claves] of CONSOLA) {
    const direccion = `/c/${TALLER}/consola${ruta}${repetidas(claves)}`;
    const respuesta = await page.goto(direccion);
    expect.soft(respuesta?.status(), direccion).toBe(200);
  }
  // La entrada también lee la dirección (a dónde seguir y qué aviso mostrar).
  for (const ruta of ["/entrar/destino", "/entrar/seguridad"]) {
    const direccion = `${ruta}${repetidas({ siguiente: ["/consola", "/consola/personas"], aviso: ["a", "b"] })}`;
    const respuesta = await page.goto(direccion);
    expect.soft(respuesta?.status(), direccion).toBe(200);
  }
  await context.clearCookies();
  for (const ruta of ["/entrar", "/entrar/continuar"]) {
    const direccion = `${ruta}${repetidas({ siguiente: ["/consola", "/consola/personas"], aviso: ["a", "b"] })}`;
    const respuesta = await page.goto(direccion);
    expect.soft(respuesta?.status(), direccion).toBe(200);
  }
});
