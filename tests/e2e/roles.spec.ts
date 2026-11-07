import { expect, test, type Page } from "@playwright/test";

import { altamar, sesionDe, vigilarConsola } from "./apoyo";
import { CORREOS } from "./siembra";

/**
 * Cada rol de Altamar E2E ve en el lateral solo sus secciones, y las demás no
 * se abren escribiendo la dirección: responden 404 o «Tu rol no abre…», nunca
 * la pantalla con datos. Los títulos son los que ve la administradora.
 */

const TITULOS: Record<string, string> = {
  "/consola": "Inicio",
  "/consola/pendientes": "Pendientes",
  "/consola/politica": "Política de comprobantes",
  "/consola/proveedores": "Pagos a proveedores",
  "/consola/lista-69b": "Listado del artículo 69-B",
  "/consola/personas": "Personas",
  "/consola/poliza": "Póliza contable",
  "/consola/flujo": "Saldo y alertas",
  "/consola/cobros": "Cobros esperados",
  "/consola/calendario": "Calendario de obligaciones",
  "/consola/presupuestos": "Presupuestos",
  "/consola/configuracion": "Configuración",
};
const RUTAS = Object.keys(TITULOS);
const OPERACION = ["/consola/pendientes", "/consola/politica", "/consola/proveedores", "/consola/lista-69b"];
const FLUJO = ["/consola/flujo", "/consola/cobros", "/consola/calendario", "/consola/presupuestos"];

type Caso = { rol: string; correo: string; lateral: string[] | null };

const CASOS: Caso[] = [
  {
    rol: "administrador",
    correo: CORREOS.laura,
    lateral: ["/consola", ...OPERACION, "/consola/personas", "/consola/poliza", ...FLUJO, "/consola/configuracion", "/telefono"],
  },
  { rol: "finanzas (con tarjeta)", correo: CORREOS.fernanda, lateral: ["/consola", "/consola/pendientes", ...FLUJO, "/telefono"] },
  { rol: "contador", correo: CORREOS.diego, lateral: [...OPERACION, "/consola/personas", "/consola/poliza", ...FLUJO, "/telefono"] },
  { rol: "liberador", correo: CORREOS.rosa, lateral: [...OPERACION, "/consola/personas", "/telefono"] },
  { rol: "solicitante (con tarjeta)", correo: CORREOS.sol, lateral: [...OPERACION, "/telefono"] },
  { rol: "tarjetahabiente", correo: CORREOS.ernesto, lateral: null },
];

/** Las rutas del lateral, sin la empresa, en el orden en que se ven. */
async function lateral(page: Page): Promise<string[]> {
  const nav = page.getByRole("navigation", { name: "Secciones" });
  await expect(nav).toBeVisible();
  return nav.locator("a.seccion").evaluateAll((enlaces, empresa) =>
    enlaces.map((a) => (a.getAttribute("href") ?? "").replace(`/c/${empresa}`, "")), altamar());
}

/** El primer h1 del HTML que manda el servidor, sin etiquetas. */
function tituloDe(html: string): string {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "";
  return h1.replace(/<[^>]+>/g, "").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ").trim();
}

for (const caso of CASOS) {
  test(`${caso.rol}: el lateral muestra solo sus secciones y las demás no abren`, async ({ page, context }) => {
    const errores = vigilarConsola(page);
    await sesionDe(context, caso.correo);

    if (caso.lateral) {
      await page.goto(`/c/${altamar()}/consola/pendientes`);
      expect(await lateral(page)).toEqual(caso.lateral);
    }

    // Lo que no está en el lateral tampoco abre por dirección. Se pide con la
    // misma sesión, sin pintar: el HTML del servidor ya dice si hubo pantalla.
    for (const ruta of RUTAS.filter((r) => !caso.lateral?.includes(r))) {
      const respuesta = await context.request.get(`/c/${altamar()}${ruta}`, { maxRedirects: 0 });
      const donde = `${caso.rol} → ${ruta}`;
      if (ruta === "/consola" && caso.lateral) {
        // Sin resumen, Inicio lleva a Pendientes.
        expect(respuesta.status(), donde).toBe(307);
        expect(respuesta.headers().location, donde).toBe(`/c/${altamar()}/consola/pendientes`);
        continue;
      }
      const html = await respuesta.text();
      const titulo = tituloDe(html);
      // Un 404 de notFound() llega con su h1 en la carga de React, no en el HTML.
      const negada = respuesta.status() === 404 ? html.includes("No encontramos esta página.") : /^Tu rol no abre/.test(titulo);
      expect(negada, `${donde}: ${respuesta.status()} «${titulo}»`).toBe(true);
      expect(titulo, donde).not.toBe(TITULOS[ruta]);
    }

    // El teléfono abre para todos estos roles; el tarjetahabiente vive ahí.
    await page.goto(`/c/${altamar()}/telefono`);
    await expect(page.getByRole("navigation", { name: "Teléfono" })).toBeVisible();
    if (!caso.lateral) await expect(page.getByRole("link", { name: "Abrir consola" })).toHaveCount(0);
    expect(errores).toEqual([]);
  });
}
