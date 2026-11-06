// Apariencia: cambia tema, escena, tono, «Tu color», luz y movimiento; recarga y comprueba que persiste.
// También comprueba «reducir movimiento» (escena quieta) y que la paleta se oculta en Lever.
import { readFileSync, writeFileSync } from "node:fs";
import { ALTAMAR_ID, BASE, CLAVE, EVIDENCIA, SV, abrir, capturador, totp } from "./comun.mjs";

const DIR = EVIDENCIA;
const checks = [];
const comprobar = (nombre, ok, detalle = "") => {
  checks.push({ nombre, ok: Boolean(ok), detalle });
  console.log(`${ok ? "OK " : "MAL"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
};

const { nav, ctx, p, errores } = await abrir({ tema: "oscuro" });
const foto = capturador(p, DIR, "apariencia");
await p.goto(`${BASE}/entrar`);
await p.getByLabel("Correo").fill("laura@lever.test");
await p.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
await p.locator("form button[type=submit]").first().click();
await p.waitForURL(/continuar/);
await p.locator("#codigo").fill(await totp(readFileSync(`${SV}/semilla-laura.txt`, "utf8").trim()));
await p.getByRole("button", { name: "Entrar con el código" }).click();
await p.waitForURL((u) => !/^\/entrar/.test(u.pathname), { timeout: 30000 });
const empresa = ALTAMAR_ID;
const ruta = `${BASE}/c/${empresa}/consola/apariencia`;
await p.goto(ruta);
await p.waitForLoadState("networkidle");
await foto("A0-inicial");

const escenaDelFondo = () => p.locator(".escena-fondo canvas").first().getAttribute("data-estado");
comprobar("escena del marco viva (movimiento encendido)", ["vivo", "lento"].includes(await escenaDelFondo()), await escenaDelFondo());

// Cambios
await p.locator(".temas").getByRole("button", { name: "Claro" }).click();
await p.getByRole("button", { name: "Fondo Halo" }).click();
await p.locator(".tonos").getByRole("button", { name: "Arena" }).click();
await p.getByRole("switch", { name: "Fondo animado" }).click();
await p.getByRole("switch", { name: "La luz sigue al cursor" }).click();
await p.waitForTimeout(800);
comprobar("tema cambia al instante", (await p.locator("html").getAttribute("data-tema")) === "claro");
comprobar("cookie de tema", (await ctx.cookies()).some((c) => c.name === "tema" && c.value === "claro"));
comprobar("escena quieta al apagar el movimiento", ["quieto", "lento"].includes(await escenaDelFondo()), await escenaDelFondo());
await foto("A1-cambiada");

await p.reload();
await p.waitForLoadState("networkidle");
await p.waitForTimeout(800);
comprobar("tras recargar: tema Claro", (await p.locator("html").getAttribute("data-tema")) === "claro" && (await p.locator(".temas").getByRole("button", { name: "Claro" }).getAttribute("aria-pressed")) === "true");
comprobar("tras recargar: escena Halo", (await p.getByRole("button", { name: "Fondo Halo" }).getAttribute("aria-pressed")) === "true");
comprobar("tras recargar: tono Arena", (await p.locator(".tonos").getByRole("button", { name: "Arena" }).getAttribute("aria-pressed")) === "true");
comprobar("tras recargar: fondo animado apagado", (await p.getByRole("switch", { name: "Fondo animado" }).getAttribute("aria-checked")) === "false");
comprobar("tras recargar: luz apagada", (await p.getByRole("switch", { name: "La luz sigue al cursor" }).getAttribute("aria-checked")) === "false");
await foto("A2-recargada");

// «Tu color»
const accAntes = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--acc").trim());
await p.getByLabel("Elige tu color").fill("#3cc48f");
await p.waitForTimeout(500);
const accDespues = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--acc").trim());
comprobar("«Tu color» queda elegido", (await p.locator('.tono[data-elegido="si"]').count()) === 1);
comprobar("«Tu color» cambia el acento", accAntes !== accDespues, `${accAntes} → ${accDespues}`);
await foto("A3-tu-color");

// El tema se ve en otra página
await p.goto(`${BASE}/c/${empresa}/consola`);
await p.waitForLoadState("networkidle");
comprobar("el tema viaja a Inicio", (await p.locator("html").getAttribute("data-tema")) === "claro");
await foto("A4-inicio-con-preferencias");

// Lever oculta la paleta
await p.goto(ruta);
await p.waitForLoadState("networkidle");
await p.locator(".temas").getByRole("button", { name: "Lever" }).click();
await p.waitForTimeout(500);
comprobar("Lever oculta la paleta", !(await p.locator(".paleta").isVisible()));
await foto("A5-lever");

// Regresa a Oscuro, movimiento encendido y escena Bruma para el resto del recorrido
await p.locator(".temas").getByRole("button", { name: "Oscuro" }).click();
await p.getByRole("switch", { name: "Fondo animado" }).click();
await p.getByRole("button", { name: "Fondo Bruma" }).click();
await p.waitForTimeout(800);
comprobar("movimiento encendido otra vez: escena viva", ["vivo", "lento"].includes(await escenaDelFondo()), await escenaDelFondo());

// Reducir movimiento del sistema deja la escena quieta aunque la preferencia diga animado
await p.emulateMedia({ reducedMotion: "reduce" });
await p.reload();
await p.waitForLoadState("networkidle");
await p.waitForTimeout(1200);
comprobar("prefers-reduced-motion: escena quieta", (await escenaDelFondo()) === "quieto", await escenaDelFondo());
await foto("A6-reducir-movimiento");

const errs = errores.filter((e) => !/Failed to load resource.*404/.test(e));
comprobar("sin errores de consola", errs.length === 0, errs.slice(0, 5).join(" || "));
writeFileSync(`${SV}/checks-apariencia.json`, JSON.stringify(checks, null, 2));
await nav.close();
process.exit(checks.every((c) => c.ok) ? 0 : 1);
