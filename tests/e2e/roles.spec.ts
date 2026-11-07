import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { altamar, sesionDe, vigilarConsola } from "./apoyo";
import { CORREOS } from "./siembra";

/**
 * Cada rol de Altamar E2E ve en el lateral solo sus secciones, con los grupos
 * del diseño (Ola 2b), y en «Más» solo lo suyo. Lo que su puerta no abre
 * tampoco se abre escribiendo la dirección: responde 404 o «Tu rol no abre…»,
 * nunca la pantalla. Los títulos son los que ve la administradora.
 */

const TITULOS: Record<string, string> = {
  "/consola": "Inicio",
  "/consola/aprobaciones": "Aprobaciones",
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
  "/consola/conciliacion": "Conciliación",
  "/consola/gastos": "Gastos",
  "/consola/tarjetas": "Tarjetas",
  "/consola/movimientos": "Movimientos",
  "/consola/fiscal": "Fiscal",
  "/consola/cuenta": "Cuenta",
  "/consola/internacional": "Pagos internacionales",
  "/consola/credito": "Crédito",
  "/consola/inversion": "Inversión",
  "/consola/viajes": "Viajes y proyectos",
  "/consola/gasolina": "Gasolina",
  "/consola/ahorro": "Ahorro",
  "/consola/integraciones": "Integraciones",
};
const RUTAS = Object.keys(TITULOS);
const FLUJO = ["/consola/flujo", "/consola/cobros", "/consola/calendario", "/consola/presupuestos"];

type Caso = {
  rol: string;
  correo: string;
  /** El lateral en el orden en que se ve; `null` si el rol no abre la consola. */
  lateral: string[] | null;
  /** «Más», en el menú de la tarjeta de la empresa. */
  mas: string[];
  /** Pantallas que abren sin enlace propio: viven dentro de una sección (Fiscal, Nómina). */
  dentro: string[];
};

const CASOS: Caso[] = [
  {
    rol: "administrador",
    correo: CORREOS.laura,
    lateral: [
      "/consola", "/consola/conciliacion", "/consola/aprobaciones", "/consola/gastos", "/consola/tarjetas", "/consola/movimientos", "/consola/fiscal",
      ...FLUJO,
      "/consola/cuenta", "/consola/internacional", "/consola/proveedores", "/consola/personas/nomina", "/consola/credito", "/consola/inversion",
      "/consola/viajes", "/consola/gasolina", "/consola/ahorro",
    ],
    mas: ["/consola/perfil", "/consola/apariencia", "/telefono", "/consola/configuracion", "/consola/politica", "/consola/integraciones"],
    dentro: ["/consola/lista-69b", "/consola/poliza", "/consola/personas"],
  },
  {
    rol: "finanzas (con tarjeta)",
    correo: CORREOS.fernanda,
    lateral: [
      "/consola", "/consola/aprobaciones", "/consola/gastos", "/consola/tarjetas", "/consola/movimientos",
      ...FLUJO,
      "/consola/cuenta", "/consola/credito", "/consola/inversion", "/consola/ahorro",
    ],
    mas: ["/consola/perfil", "/consola/apariencia", "/telefono"],
    dentro: [],
  },
  {
    rol: "contador",
    correo: CORREOS.diego,
    lateral: [
      "/consola/conciliacion", "/consola/aprobaciones", "/consola/gastos", "/consola/movimientos", "/consola/fiscal",
      ...FLUJO,
      "/consola/internacional", "/consola/proveedores", "/consola/personas/nomina", "/consola/viajes", "/consola/gasolina", "/consola/ahorro",
    ],
    mas: ["/consola/perfil", "/consola/apariencia", "/telefono", "/consola/politica"],
    dentro: ["/consola/lista-69b", "/consola/poliza", "/consola/personas"],
  },
  {
    rol: "liberador",
    correo: CORREOS.rosa,
    lateral: [
      "/consola/aprobaciones", "/consola/fiscal", "/consola/internacional", "/consola/proveedores", "/consola/personas/nomina", "/consola/viajes",
      "/consola/gasolina",
    ],
    mas: ["/consola/perfil", "/consola/apariencia", "/telefono", "/consola/politica"],
    dentro: ["/consola/lista-69b", "/consola/personas"],
  },
  {
    rol: "solicitante (con tarjeta)",
    correo: CORREOS.sol,
    lateral: ["/consola/aprobaciones", "/consola/fiscal", "/consola/internacional", "/consola/proveedores", "/consola/viajes", "/consola/gasolina"],
    mas: ["/consola/perfil", "/consola/apariencia", "/telefono", "/consola/politica"],
    dentro: ["/consola/lista-69b"],
  },
  { rol: "tarjetahabiente", correo: CORREOS.ernesto, lateral: null, mas: [], dentro: [] },
];

const sinEmpresa = (href: string | null) => (href ?? "").replace(`/c/${altamar()}`, "");

/** Las rutas del lateral, sin la empresa, en el orden en que se ven. */
async function lateral(page: Page): Promise<string[]> {
  const nav = page.getByRole("navigation", { name: "Secciones" });
  await expect(nav).toBeVisible();
  return (await nav.locator("a.seccion").evaluateAll((enlaces) => enlaces.map((a) => a.getAttribute("href")))).map(sinEmpresa);
}

/** Las rutas de «Más», abriendo el menú de la tarjeta de la empresa con un clic. */
async function mas(page: Page): Promise<string[]> {
  await page.getByRole("button", { name: /Más: tu perfil y tu empresa/ }).click();
  const menu = page.getByRole("menu", { name: "Más: tu perfil y tu empresa" });
  await expect(menu).toBeVisible();
  const rutas = (await menu.getByRole("menuitem").evaluateAll((enlaces) => enlaces.map((a) => a.getAttribute("href")))).map(sinEmpresa);
  await page.keyboard.press("Escape");
  return rutas;
}

/** El primer h1 del HTML que manda el servidor, sin etiquetas. */
function tituloDe(html: string): string {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "";
  return h1.replace(/<[^>]+>/g, "").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ").trim();
}

async function pedir(context: BrowserContext, ruta: string) {
  return context.request.get(`/c/${altamar()}${ruta}`, { maxRedirects: 0 });
}

for (const caso of CASOS) {
  test(`${caso.rol}: el lateral y «Más» muestran solo sus secciones y las demás no abren`, async ({ page, context }) => {
    const errores = vigilarConsola(page);
    await sesionDe(context, caso.correo);

    if (caso.lateral) {
      await page.goto(`/c/${altamar()}/consola/aprobaciones`);
      expect(await lateral(page)).toEqual(caso.lateral);
      expect(await mas(page)).toEqual(caso.mas);
    }

    // Lo que no está en el lateral, en «Más» ni dentro de una sección tampoco abre por dirección.
    // Se pide con la misma sesión, sin pintar: el HTML del servidor ya dice si hubo pantalla.
    const abre = new Set([...(caso.lateral ?? []), ...caso.mas, ...caso.dentro]);
    for (const ruta of RUTAS.filter((r) => !abre.has(r))) {
      const respuesta = await pedir(context, ruta);
      const donde = `${caso.rol} → ${ruta}`;
      if (ruta === "/consola" && caso.lateral) {
        // Sin resumen, Inicio lleva a Aprobaciones.
        expect(respuesta.status(), donde).toBe(307);
        expect(respuesta.headers().location, donde).toBe(`/c/${altamar()}/consola/aprobaciones`);
        continue;
      }
      const html = await respuesta.text();
      const titulo = tituloDe(html);
      // Un 404 de notFound() llega con su h1 en la carga de React, no en el HTML.
      const negada = respuesta.status() === 404 ? html.includes("No encontramos esta página.") : /^Tu rol no abre/.test(titulo);
      expect(negada, `${donde}: ${respuesta.status()} «${titulo}»`).toBe(true);
      expect(titulo, donde).not.toBe(TITULOS[ruta]);
    }

    // Lo que vive dentro de una sección abre con su propia pantalla.
    for (const ruta of caso.dentro) {
      const respuesta = await pedir(context, ruta);
      expect(respuesta.status(), `${caso.rol} → ${ruta}`).toBe(200);
      expect(tituloDe(await respuesta.text()), `${caso.rol} → ${ruta}`).toBe(TITULOS[ruta]);
    }

    // Pendientes se unió con Aprobaciones: la dirección vieja redirige con la misma puerta.
    const vieja = await pedir(context, "/consola/pendientes");
    if (caso.lateral) {
      expect(vieja.status(), `${caso.rol} → /consola/pendientes`).toBe(307);
      expect(vieja.headers().location, `${caso.rol} → /consola/pendientes`).toBe(`/c/${altamar()}/consola/aprobaciones`);
    } else {
      expect(vieja.status(), `${caso.rol} → /consola/pendientes`).toBe(404);
    }

    // El teléfono abre para todos estos roles; el tarjetahabiente vive ahí.
    await page.goto(`/c/${altamar()}/telefono`);
    await expect(page.getByRole("navigation", { name: "Teléfono" })).toBeVisible();
    if (!caso.lateral) await expect(page.getByRole("link", { name: "Abrir consola" })).toHaveCount(0);
    expect(errores).toEqual([]);
  });
}
