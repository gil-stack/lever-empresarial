import { expect, test, type Page } from "@playwright/test";

const EMPRESA = "33333333-3333-4333-8333-333333333333";
const INICIO = `/c/${EMPRESA}/consola`;
const GIL = "a".repeat(43);
const ORIGEN = process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_PUERTO ?? "3109"}`;

async function entrar(page: Page, token = GIL) {
  await page.context().clearCookies();
  // `next start` corre en producción: la cookie de sesión lleva el prefijo __Host- (Secure, Path=/, sin Domain).
  await page.context().addCookies([
    { name: "__Host-sesion", value: token, domain: new URL(ORIGEN).hostname, path: "/", httpOnly: true, secure: true, sameSite: "Lax" },
  ]);
}

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
