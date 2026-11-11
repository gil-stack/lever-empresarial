import { expect, test } from "@playwright/test";

import { altamar, sesionDe } from "./apoyo";
import { EMPRESA, INICIO, ORIGEN, entrar } from "./marco-apoyo";
import { CORREOS } from "./siembra";

// Cada prueba entra con su propia cookie y no comparte estado: «parallel» solo para que el reparto de la e2e pueda partir
// el archivo (con workers: 1 siguen corriendo una tras otra). El fondo animado vive en fondo-pruebas.ts.
test.describe.configure({ mode: "parallel" });

test.describe("marco de la consola en escritorio", () => {
  test("menú de la persona: cuatro opciones fuera del Tab; Tab y Escape cierran y regresan el foco al botón", async ({ page }) => {
    await entrar(page);
    await page.goto(INICIO);
    const boton = page.locator(".cuenta .menu-desplegable-boton");
    await boton.click();
    const opciones = page.locator(".cuenta [role=menuitem]");
    await expect(opciones).toHaveText([/Mi perfil y seguridad/, /Apariencia/, /Salir/]);
    await expect(opciones.first()).toBeFocused();
    expect(await opciones.evaluateAll((todas) => todas.map((o) => o.getAttribute("tabindex")))).toEqual(["-1", "-1", "-1"]);
    await page.keyboard.press("ArrowDown");
    await expect(opciones.nth(1)).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(boton).toHaveAttribute("aria-expanded", "false");
    await expect(boton).toBeFocused();

    await boton.click();
    await page.keyboard.press("Escape");
    await expect(boton).toHaveAttribute("aria-expanded", "false");
    await expect(boton).toBeFocused();

    await boton.click();
    await opciones.filter({ hasText: "Apariencia" }).click();
    await expect(page).toHaveURL(new RegExp(`/c/${EMPRESA}/consola/apariencia$`));
  });

  test("el buscador de la barra lleva a su sección con lo escrito", async ({ page }) => {
    await entrar(page);
    await page.goto(INICIO);
    const busqueda = page.getByRole("search").getByRole("searchbox");
    await busqueda.fill("Rosa");
    await busqueda.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/c/${EMPRESA}/consola/(personas|proveedores)\\?.*q=Rosa`));
  });

  test("Apariencia: con sesión y empresa se abre; sin sesión manda a entrar; otra empresa no la muestra", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto(`${INICIO}/apariencia`);
    await expect(page).toHaveURL(/\/entrar/);

    await entrar(page);
    const respuesta = await page.goto(`${INICIO}/apariencia`);
    expect(respuesta?.status()).toBe(200);
    await expect(page.locator(".apariencia")).toBeVisible();
    await expect(page.locator(".temas").getByRole("button", { name: "Oscuro", exact: true })).toBeVisible();

    // Las cookies de preferencia (acento al pintar, tema al cambiarlo): todo el sitio y Lax. Por http (localhost) van
    // sin Secure para que el navegador las guarde; por https llevan Secure (cookie-preferencia.test.ts).
    await page.locator(".temas").getByRole("button", { name: "Claro", exact: true }).click();
    await expect.poll(async () => (await page.context().cookies()).filter((c) => c.name === "acento" || c.name === "tema").length).toBe(2);
    for (const cookie of (await page.context().cookies()).filter((c) => c.name === "acento" || c.name === "tema")) {
      expect({ nombre: cookie.name, path: cookie.path, sameSite: cookie.sameSite, secure: cookie.secure }).toEqual({
        nombre: cookie.name, path: "/", sameSite: "Lax", secure: false,
      });
    }

    await page.goto("/c/00000000-0000-4000-8000-000000000000/consola/apariencia");
    await expect(page.locator(".apariencia")).toHaveCount(0);
  });
});

test.describe("cajón móvil", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("sin checkVisibility (Safari < 17.4): abre, atrapa el foco, deja el fondo inert; Escape y el velo regresan el foco", async ({ page }) => {
    const errores: string[] = [];
    page.on("pageerror", (error) => errores.push(error.message));
    await page.addInitScript(() => {
      delete (Element.prototype as { checkVisibility?: unknown }).checkVisibility;
    });
    await entrar(page);
    await page.goto(INICIO);
    const secciones = page.getByRole("button", { name: "Secciones" });
    const cajon = page.locator("#lateral");

    await secciones.click();
    await expect(cajon).toHaveAttribute("data-abierto", "si");
    await expect(page.locator(".lienzo")).toHaveAttribute("inert", "");
    for (let i = 0; i < 20; i++) await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.querySelector("#lateral")?.contains(document.activeElement) || document.activeElement?.classList.contains("boton-menu")))).toBe(true);

    await page.keyboard.press("Escape");
    await expect(cajon).toHaveAttribute("data-abierto", "no");
    await expect(page.getByRole("button", { name: "Secciones" })).toBeFocused();
    await expect(page.locator(".lienzo")).not.toHaveAttribute("inert", "");

    await secciones.click();
    await expect(cajon).toHaveAttribute("data-abierto", "si");
    await page.locator(".velo").click({ position: { x: 370, y: 400 } });
    await expect(cajon).toHaveAttribute("data-abierto", "no");
    await expect(page.getByRole("button", { name: "Secciones" })).toBeFocused();

    await expect(page.locator(".pie-movil")).toHaveText("El saldo vive con el participante de la CLABE. El plástico vive con el emisor.");
    expect(errores).toEqual([]);
  });
});

// r60b-N1 (revisión del #60): Laura (Altamar) en /c/<Taller>/consola/… recibía HTTP 200 con «Error 404» dentro del marco de
// su propia empresa. Tiene que ser un 404 de verdad y el mismo que para una empresa que no existe: la respuesta no dice si la
// empresa existe. En los dos sentidos: Laura hacia Taller y Gil hacia Altamar.
const INEXISTENTE = "99999999-9999-4999-8999-999999999999";
const RUTAS_DE_LA_CONSOLA = ["/consola", "/consola/aprobaciones", "/consola/perfil", "/consola/proveedores", "/consola/personas"];
test.describe("una empresa ajena o inexistente en la dirección", () => {
  for (const conJs of [true, false]) {
    for (const quien of ["laura", "gil"] as const) {
      test(`${quien}: responde 404 de verdad, igual para la ajena y la inexistente (${conJs ? "con" : "sin"} JavaScript)`, async ({ browser }) => {
        const contexto = await browser.newContext({ javaScriptEnabled: conJs });
        const page = await contexto.newPage();
        if (quien === "laura") await sesionDe(contexto, CORREOS.laura);
        else await entrar(page);
        const [propia, ajena] = quien === "laura" ? [altamar(), EMPRESA] : [EMPRESA, altamar()];
        const textos: Record<string, string> = {};
        for (const [cual, empresa] of [["ajena", ajena], ["inexistente", INEXISTENTE]] as const) {
          for (const ruta of RUTAS_DE_LA_CONSOLA) {
            const respuesta = await page.goto(`${ORIGEN}/c/${empresa}${ruta}`);
            expect.soft(respuesta?.status(), `${cual} ${ruta}`).toBe(404);
            textos[`${cual} ${ruta}`] = (await page.locator("body").innerText()).replaceAll(empresa, "EMPRESA");
          }
        }
        for (const ruta of RUTAS_DE_LA_CONSOLA) {
          expect.soft(textos[`ajena ${ruta}`], `${ruta}: lo mismo para la ajena que para la inexistente`).toBe(textos[`inexistente ${ruta}`]);
        }
        // Y la empresa propia sigue abriendo.
        expect((await page.goto(`${ORIGEN}/c/${propia}/consola`))?.status()).toBe(200);
        await contexto.close();
      });
    }
  }
});
