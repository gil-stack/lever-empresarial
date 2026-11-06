// Teclado y capas del marco, clicados en un tema y un tamaño (hallazgos del revisor del PR #50).
// Escritorio: Tab y Escape del menú de la persona, menú de empresa completo con razón social larga.
// Móvil: cajón sin checkVisibility (Safari < 17.4), Escape del menú de empresa dentro del cajón,
// velo con foco de regreso y fondo inert, pie regulatorio al final de la página.
// Las dos: /empresas sin «Apariencia». Uso: node marco.mjs <tema> <escritorio|movil>
import { readFileSync, writeFileSync } from "node:fs";
import { ALTAMAR_ID, BASE, CLAVE, EVIDENCIA, SV, abrir, capturador, totp } from "./comun.mjs";

const [tema = "oscuro", forma = "escritorio"] = process.argv.slice(2);
const movil = forma === "movil";
const [ancho, alto] = movil ? [390, 844] : [1440, 900];
const sufijo = `${tema}-${ancho}`;
const checks = [];
const comprobar = (nombre, ok, detalle = "") => {
  checks.push({ nombre, ok: Boolean(ok), detalle });
  console.log(`${ok ? "OK " : "MAL"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
};

const { nav, ctx, p, errores } = await abrir({ tema, ancho, alto, movil });
// Safari anterior a 17.4 no tiene checkVisibility: en móvil se recorre el cajón sin él.
if (movil) await ctx.addInitScript(() => delete Element.prototype.checkVisibility);
const foto = capturador(p, EVIDENCIA, sufijo);
const activo = () => p.evaluate(() => {
  const e = document.activeElement;
  return e ? `${e.tagName.toLowerCase()}.${e.className}|${(e.textContent ?? "").trim().slice(0, 40)}` : "";
});

await p.goto(`${BASE}/entrar`);
await p.getByLabel("Correo").fill("laura@lever.test");
await p.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
await p.locator("form button[type=submit]").first().click();
await p.waitForURL(/continuar/);
await p.locator("#codigo").fill(await totp(readFileSync(`${SV}/semilla-laura.txt`, "utf8").trim()));
await p.getByRole("button", { name: "Entrar con el código" }).click();
await p.waitForURL((u) => !/^\/entrar/.test(u.pathname), { timeout: 30000 });

// /empresas: sin empresa elegida no hay Apariencia a la cual ir.
await p.goto(`${BASE}/empresas`);
await p.waitForLoadState("networkidle");
await p.locator(".cuenta .menu-desplegable-boton").click();
await p.waitForTimeout(300);
const opcionesEmpresas = await p.locator(".cuenta [role=menuitem]").allTextContents();
comprobar("/empresas: el menú no ofrece Apariencia", !opcionesEmpresas.some((t) => t.includes("Apariencia")), opcionesEmpresas.map((t) => t.trim()).join(" · "));
await p.keyboard.press("Escape");

await p.goto(`${BASE}/c/${ALTAMAR_ID}/consola`);
await p.waitForLoadState("networkidle");
comprobar("tema en <html>", (await p.locator("html").getAttribute("data-tema")) === tema);

// Menú de la persona: las opciones no entran al Tab; Tab cierra y el foco regresa al botón.
const botonCuenta = p.locator(".cuenta .menu-desplegable-boton");
await botonCuenta.click();
await p.waitForTimeout(300);
const tabindex = await p.locator(".cuenta [role=menuitem]").evaluateAll((os) => os.map((o) => o.getAttribute("tabindex")));
comprobar("opciones del menú con tabindex -1", tabindex.length > 0 && tabindex.every((t) => t === "-1"), tabindex.join(","));
comprobar("al abrir, el foco va a la primera opción", (await activo()).includes("Mi perfil y seguridad"), await activo());
await p.keyboard.press("Tab");
await p.waitForTimeout(300);
comprobar(
  "Tab cierra el menú y el foco regresa al botón",
  (await botonCuenta.getAttribute("aria-expanded")) === "false" && (await activo()).includes("menu-desplegable-boton"),
  await activo(),
);
await botonCuenta.click();
await p.waitForTimeout(300);
await p.keyboard.press("Escape");
await p.waitForTimeout(300);
comprobar("Escape cierra el menú y el foco regresa al botón", (await botonCuenta.getAttribute("aria-expanded")) === "false" && (await activo()).includes("menu-desplegable-boton"));

if (!movil) {
  // Menú de empresa: completo aunque el lateral mida 240 px y la razón social sea larga.
  const botonEmpresa = p.locator(".lateral .empresa-lateral .menu-desplegable-boton");
  await botonEmpresa.click();
  await p.waitForTimeout(400);
  const menu = p.locator(".lateral .empresa-lateral [role=menu]");
  const larga = menu.getByRole("menuitem").filter({ hasText: "S.A.P.I. de C.V." });
  const caja = await menu.boundingBox();
  const lateral = await p.locator(".lateral").boundingBox();
  const deLarga = await larga.boundingBox();
  const encima = await p.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("[role=menu]") !== null, { x: (deLarga?.x ?? 0) + (deLarga?.width ?? 0) - 6, y: (deLarga?.y ?? 0) + (deLarga?.height ?? 0) / 2 });
  comprobar("el menú de empresa sale del lateral (no se recorta)", caja && lateral && caja.x + caja.width > lateral.x + lateral.width, `menú ${Math.round(caja?.width ?? 0)} px, lateral ${Math.round(lateral?.width ?? 0)} px`);
  comprobar("la razón social larga se ve completa y encima de la página", encima && (await larga.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)));
  await foto("M1-menu-empresa-larga");
  await p.keyboard.press("Escape");
} else {
  // Pie regulatorio al final de la página, sin abrir el cajón.
  const pie = p.locator(".pie-movil");
  await pie.scrollIntoViewIfNeeded();
  comprobar("móvil: pie regulatorio visible al final de Inicio", (await pie.isVisible()) && /El saldo vive con el participante de la CLABE/.test((await pie.textContent()) ?? ""));
  await foto("M2-pie-movil");
  await p.evaluate(() => scrollTo(0, 0));

  // Cajón sin checkVisibility.
  comprobar("simulación Safari < 17.4: checkVisibility ausente", await p.evaluate(() => typeof Element.prototype.checkVisibility === "undefined"));
  const secciones = p.getByRole("button", { name: "Secciones" });
  await secciones.click();
  await p.waitForTimeout(400);
  comprobar("cajón abre sin checkVisibility", (await p.locator("#lateral").getAttribute("data-abierto")) === "si");
  comprobar("con el cajón abierto, la página queda inert", (await p.locator(".lienzo").getAttribute("inert")) !== null);
  for (let i = 0; i < 25; i++) await p.keyboard.press("Tab");
  comprobar("Tab no sale del cajón", await p.evaluate(() => document.querySelector("#lateral")?.contains(document.activeElement) || document.activeElement?.classList.contains("boton-menu")));

  // Menú de empresa dentro del cajón: el primer Escape cierra solo el menú; el segundo, el cajón.
  const botonEmpresa = p.locator("#lateral .empresa-lateral .menu-desplegable-boton");
  await botonEmpresa.click();
  await p.waitForTimeout(400);
  comprobar("menú de empresa abre dentro del cajón", (await botonEmpresa.getAttribute("aria-expanded")) === "true");
  await foto("M3-cajon-menu-empresa");
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
  comprobar(
    "primer Escape: cierra el menú, el cajón sigue abierto y el foco en el botón de empresa",
    (await botonEmpresa.getAttribute("aria-expanded")) === "false" && (await p.locator("#lateral").getAttribute("data-abierto")) === "si" && (await activo()).includes("menu-desplegable-boton"),
    await activo(),
  );
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
  comprobar(
    "segundo Escape: cierra el cajón y el foco regresa a «Secciones»",
    (await p.locator("#lateral").getAttribute("data-abierto")) === "no" && (await activo()).includes("boton-menu"),
    await activo(),
  );

  // Velo: cierra, regresa el foco y quita el inert.
  await secciones.click();
  await p.waitForTimeout(400);
  await p.mouse.click(375, 500);
  await p.waitForTimeout(400);
  comprobar(
    "tocar el velo cierra, regresa el foco a «Secciones» y quita el inert",
    (await p.locator("#lateral").getAttribute("data-abierto")) === "no" && (await activo()).includes("boton-menu") && (await p.locator(".lienzo").getAttribute("inert")) === null,
    await activo(),
  );
}

const errs = errores.filter((e) => !/Failed to load resource.*404/.test(e));
comprobar("sin errores de consola", errs.length === 0, errs.slice(0, 3).join(" || "));
writeFileSync(`${SV}/checks-marco-${sufijo}.json`, JSON.stringify(checks, null, 2));
await nav.close();
process.exit(checks.every((c) => c.ok) ? 0 : 1);
