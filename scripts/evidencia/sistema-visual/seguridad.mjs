// Seguridad de la cuenta y Recuperaciones clicadas en un tema y un tamaño.
// Uso: ADMIN_URL=postgres://<superusuario>@127.0.0.1:<puerto>/plataforma node seguridad.mjs <tema> <escritorio|movil>
// ADMIN_URL solo se usa para envejecer el factor de la sesión 6 minutos en la base desechable local
// (el trigger de sessions no deja mover el sello hacia atrás): así aparece «Confirma que eres tú» sin esperar.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { ALTAMAR_ID, BASE, CLAVE, EVIDENCIA, SV, abrir, capturador, totp } from "./comun.mjs";

const { Client } = createRequire(`${process.cwd()}/package.json`)("pg");
const [tema = "oscuro", forma = "escritorio"] = process.argv.slice(2);
const movil = forma === "movil";
const [ancho, alto] = movil ? [390, 844] : [1440, 900];
const sufijo = `${tema}-${ancho}`;
const semilla = (quien) => readFileSync(`${SV}/semilla-${quien}.txt`, "utf8").trim();
const checks = [];
const comprobar = (nombre, ok, detalle = "") => {
  checks.push({ nombre, ok: Boolean(ok), detalle });
  console.log(`${ok ? "OK " : "MAL"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
};

async function envejecerFactor(correo) {
  const c = new Client({ connectionString: process.env.ADMIN_URL });
  await c.connect();
  try {
    await c.query("begin");
    await c.query("set local session_replication_role = replica");
    const r = await c.query(
      `update sessions s set segundo_factor_en = now() - interval '6 minutes'
         from users u where u.id = s.user_id and u.correo = $1 and s.segundo_factor_en is not null`,
      [correo],
    );
    await c.query("commit");
    return r.rowCount;
  } finally {
    await c.end();
  }
}

const sinRuido = (errores) => errores.filter((e) => !/Failed to load resource.*404/.test(e));

// 1. Laura (consola): menú → Mi perfil y seguridad → Confirma que eres tú → Volver a la consola.
{
  const { nav, p, errores } = await abrir({ tema, ancho, alto, movil });
  const foto = capturador(p, EVIDENCIA, sufijo);
  await p.goto(`${BASE}/entrar`);
  await p.getByLabel("Correo").fill("laura@lever.test");
  await p.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
  await p.locator("form button[type=submit]").first().click();
  await p.waitForURL(/continuar/);
  await p.locator("#codigo").fill(await totp(semilla("laura")));
  await p.getByRole("button", { name: "Entrar con el código" }).click();
  await p.waitForURL((u) => !/^\/entrar/.test(u.pathname), { timeout: 30000 });
  await p.goto(`${BASE}/c/${ALTAMAR_ID}/consola`);
  await p.waitForLoadState("networkidle");

  await p.locator(".cuenta .menu-desplegable-boton").click();
  await p.getByRole("menuitem", { name: "Mi perfil y seguridad" }).click();
  await p.waitForURL(/\/entrar\/seguridad/, { timeout: 20000 });
  await p.waitForLoadState("networkidle");
  comprobar("Laura: el menú abre Seguridad", /\/entrar\/seguridad/.test(p.url()), p.url());
  comprobar("tema en <html>", (await p.locator("html").getAttribute("data-tema")) === tema);
  const volver = p.getByRole("link", { name: "← Volver a la consola" });
  comprobar("Seguridad: enlace para volver a la consola", await volver.isVisible());
  await foto("A7-seguridad");

  const envejecidas = await envejecerFactor("laura@lever.test");
  await p.reload();
  await p.waitForLoadState("networkidle");
  const confirma = p.getByRole("heading", { name: "Confirma que eres tú" });
  comprobar("factor de hace 6 min: pide «Confirma que eres tú»", (await confirma.isVisible()) && envejecidas > 0, `${envejecidas} sesiones`);
  await foto("A8-seguridad-confirma");
  await p.locator("#confirmar-codigo").fill(await totp(semilla("laura")));
  await p.locator("#confirmar-codigo").press("Enter");
  await confirma.waitFor({ state: "hidden", timeout: 20000 });
  comprobar("Confirma que eres tú: el código TOTP la cierra", !(await confirma.isVisible()));
  await foto("A9-seguridad-confirmada");

  await volver.click();
  await p.waitForURL((u) => /\/consola/.test(u.pathname), { timeout: 20000 });
  comprobar("«Volver a la consola» regresa a la consola", /\/consola/.test(new URL(p.url()).pathname), p.url());
  const errs = sinRuido(errores);
  comprobar("Laura: sin errores de consola", errs.length === 0, errs.slice(0, 3).join(" || "));
  await nav.close();
}

// 2. Laura pide recuperación desde «Perdí el segundo factor».
{
  const { nav, p, errores } = await abrir({ tema, ancho, alto, movil });
  const foto = capturador(p, EVIDENCIA, sufijo);
  await p.goto(`${BASE}/entrar`);
  await p.getByLabel("Correo").fill("laura@lever.test");
  await p.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
  await p.locator("form button[type=submit]").first().click();
  await p.waitForURL(/continuar/);
  await p.getByRole("button", { name: "Perdí el segundo factor", exact: true }).click();
  await p.locator("#motivo").fill(`Prueba del sistema visual ${sufijo}`);
  await p.getByRole("button", { name: "Pedir recuperación" }).click();
  await p.waitForURL(/\/entrar\?aviso=recuperacion/, { timeout: 20000 });
  const enRevision = p.getByText("Tu solicitud quedó en revisión.", { exact: false });
  await enRevision.waitFor({ timeout: 20000 });
  comprobar("Laura: la recuperación queda en revisión y el aviso lo dice", await enRevision.isVisible(), p.url());
  await foto("A10-recuperacion-pedida");
  const errs = sinRuido(errores);
  comprobar("pedir recuperación: sin errores de consola", errs.length === 0, errs.slice(0, 3).join(" || "));
  await nav.close();
}

// 3. op (Operación): Recuperaciones → Confirma que eres tú → rechaza con nota; Seguridad → Volver a Operación.
{
  const { nav, p, errores } = await abrir({ tema, ancho, alto, movil });
  const foto = capturador(p, EVIDENCIA, sufijo);
  await p.goto(`${BASE}/operacion/entrar`);
  await p.getByLabel("Correo").fill("op@lever.test");
  await p.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
  await p.getByRole("button", { name: "Continuar" }).click();
  await p.waitForURL(/operacion\/continuar/);
  await p.locator("#codigo").fill(await totp(semilla("op")));
  await p.getByRole("button", { name: "Entrar con el código" }).click();
  await p.waitForTimeout(1500);
  const abrirOp = p.getByRole("button", { name: "Abrir operación" });
  if (await abrirOp.count()) await abrirOp.click();
  await p.waitForURL((u) => u.pathname === "/operacion", { timeout: 20000 });

  await envejecerFactor("op@lever.test");
  const antes = p.url();
  await p.locator(".operacion-nav").getByRole("link", { name: "Recuperaciones" }).click();
  await p.waitForURL((u) => u.href !== antes, { timeout: 15000 });
  await p.waitForLoadState("networkidle");
  comprobar("Operación: sección Recuperaciones", /operacion\/recuperaciones/.test(p.url()), p.url());
  const fila = p.locator(".operacion-lista > li").filter({ hasText: `Prueba del sistema visual ${sufijo}` });
  comprobar("la solicitud de Laura aparece", (await fila.count()) === 1);
  const confirma = p.getByRole("heading", { name: "Confirma que eres tú" });
  comprobar("Recuperaciones: pide «Confirma que eres tú»", await confirma.isVisible());
  await foto("A11-recuperaciones-confirma");
  await p.locator("#confirmar-codigo").fill(await totp(semilla("op")));
  await p.locator("#confirmar-codigo").press("Enter");
  await confirma.waitFor({ state: "hidden", timeout: 20000 });
  comprobar("Recuperaciones: el código TOTP confirma", !(await confirma.isVisible()));
  await fila.locator('input[name="nota"]').fill("Rechazada en la prueba del sistema visual");
  await fila.scrollIntoViewIfNeeded();
  await foto("A12-recuperaciones-solicitud");
  await fila.getByRole("button", { name: "Rechazar" }).click();
  await fila.waitFor({ state: "detached", timeout: 20000 });
  comprobar("Rechazar quita la solicitud de la lista", (await fila.count()) === 0);
  await p.waitForLoadState("networkidle");
  await foto("A13-recuperaciones-rechazada");

  await p.goto(`${BASE}/entrar/seguridad`);
  await p.waitForLoadState("networkidle");
  const volver = p.getByRole("link", { name: "← Volver a Operación" });
  comprobar("Seguridad con sesión SOFIPO: enlace a Operación", await volver.isVisible());
  await volver.click();
  await p.waitForURL((u) => u.pathname === "/operacion", { timeout: 20000 });
  comprobar("«Volver a Operación» regresa a /operacion", new URL(p.url()).pathname === "/operacion", p.url());
  const errs = sinRuido(errores);
  comprobar("op: sin errores de consola", errs.length === 0, errs.slice(0, 3).join(" || "));
  await nav.close();
}

writeFileSync(`${SV}/checks-seguridad-${sufijo}.json`, JSON.stringify(checks, null, 2));
process.exit(checks.every((c) => c.ok) ? 0 : 1);
