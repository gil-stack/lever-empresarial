// Siembra por la interfaz: Laura y op aceptan su invitación e inscriben TOTP; Laura crea un área y dos personas.
import { writeFileSync } from "node:fs";
import { ALTAMAR_ID, BASE, CLAVE, SV, abrir, capturador, totp } from "./comun.mjs";

// Enlaces de invitación que imprimen `empresa:alta --mostrar-enlace` y la invitación de personal.
const TOKEN_LAURA = process.env.TOKEN_LAURA ?? "";
const TOKEN_OP = process.env.TOKEN_OP ?? "";
const paso = process.argv[2] ?? "todo";

async function aceptarEInscribir({ token, correo, entrar, archivo, operacion }) {
  const { nav, p, errores } = await abrir();
  const foto = capturador(p, `${SV}/prep`, archivo);
  await p.goto(`${BASE}/invitacion/${token}`);
  await p.getByLabel(/Contraseña nueva|Tu contraseña/).fill(CLAVE);
  const repite = p.getByLabel("Repite la contraseña");
  if (await repite.count()) await repite.fill(CLAVE);
  await foto("invitacion");
  await p.locator("form button[type=submit]").first().click();
  await p.waitForLoadState("networkidle");
  console.log("tras invitación:", p.url());
  if (!/continuar/.test(p.url())) {
    await p.goto(`${BASE}${entrar}`);
    await p.getByLabel("Correo").fill(correo);
    await p.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
    await p.locator("form button[type=submit]").first().click();
    await p.waitForURL(/continuar/);
  }
  await p.locator(".arco-semilla").waitFor();
  const semilla = (await p.locator(".arco-semilla").innerText()).replace(/\s+/g, "");
  writeFileSync(`${SV}/semilla-${archivo}.txt`, semilla);
  await foto("inscripcion");
  await p.locator("#codigo-alta").fill(await totp(semilla));
  await p.getByRole("button", { name: "Confirmar el código" }).click();
  await p.waitForTimeout(1500);
  await foto("respaldos");
  const codigos = await p.locator(".arco-codigos li").allInnerTexts();
  writeFileSync(`${SV}/respaldos-${archivo}.txt`, codigos.join("\n"));
  const guardados = p.getByLabel("Ya los guardé en un lugar seguro");
  if (await guardados.count()) {
    await guardados.check();
    await p.getByRole("button", { name: /Entrar al portal|Continuar/ }).first().click();
  }
  await p.waitForLoadState("networkidle");
  if (operacion) {
    const abrirOp = p.getByRole("button", { name: "Abrir operación" });
    if (await abrirOp.count()) await abrirOp.click();
    await p.waitForLoadState("networkidle");
  }
  console.log("destino:", p.url());
  await foto("destino");
  console.log(errores.join("\n") || "sin errores de consola");
  await nav.close();
}

async function entrarComoLaura(p) {
  const semilla = (await import("node:fs")).readFileSync(`${SV}/semilla-laura.txt`, "utf8").trim();
  await p.goto(`${BASE}/entrar`);
  await p.getByLabel("Correo").fill("laura@lever.test");
  await p.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
  await p.locator("form button[type=submit]").first().click();
  await p.waitForURL(/continuar/);
  await p.locator("#codigo").fill(await totp(semilla));
  await p.getByRole("button", { name: /Entrar con el código|Confirmar|Entrar/ }).first().click();
  await p.waitForURL((u) => !/entrar/.test(u.pathname), { timeout: 20000 });
}

async function sembrarPersonas() {
  const { nav, p, errores } = await abrir();
  const foto = capturador(p, `${SV}/prep`, "personas");
  await entrarComoLaura(p);
  console.log("entró:", p.url());
  const empresa = ALTAMAR_ID;
  await p.goto(`${BASE}/c/${empresa}/consola/personas/areas`).catch(() => {});
  if (!/areas/.test(p.url()) || (await p.title()).includes("404")) await p.goto(`${BASE}/consola/personas/areas`);
  console.log("áreas:", p.url());
  if (!process.env.SOLO) {
    await p.locator("[name=centroNombre]").first().fill("Operación");
    await p.locator("[name=centroPresupuesto]").first().fill("50000.00");
    await foto("area");
    await p.locator("form:has([name=centroNombre]) button[type=submit]").first().click();
    await p.waitForTimeout(2000);
    await foto("area-guardada");
  }
  for (const persona of [
    { nombre: "Operativo Nómina", nomina: true },
    { nombre: "Tomás Tarjeta", nomina: false },
  ].filter((x) => !process.env.SOLO || x.nombre === process.env.SOLO)) {
    await p.goto(p.url().replace(/\/consola\/personas.*$/, "/consola/personas/nueva"));
    await p.locator("#nombre").fill(persona.nombre);
    await p.locator("#centro").selectOption({ label: "Operación" });
    await p.locator("#presupuesto").fill("8000.00");
    if (persona.nomina) {
      await p.locator("input[name=conNomina][value=si]").check({ force: true });
      await p.locator("#neto").fill("12500.00");
      await p.locator("#frecuencia").selectOption("quincenal");
      await p.locator("#primerPago").fill("2026-11-15");
      await p.locator("input[name=destino][value=clabe]").check({ force: true });
      await p.locator("#clabe").fill("002180701150123452");
    } else {
      await p.locator("input[name=conNomina][value=no]").check({ force: true });
    }
    await p.locator("#acceso").selectOption("no");
    await foto(`alta-${persona.nomina ? "nomina" : "ficha"}`, { completa: true });
    await p.locator("form:has(#nombre) button[type=submit]").click();
    await p.waitForTimeout(2500);
    console.log(persona.nombre, "→", p.url());
    await foto(`alta-${persona.nomina ? "nomina" : "ficha"}-guardada`, { completa: true });
  }
  console.log(errores.join("\n") || "sin errores de consola");
  await nav.close();
}

if (paso === "todo" || paso === "laura") await aceptarEInscribir({ token: TOKEN_LAURA, correo: "laura@lever.test", entrar: "/entrar", archivo: "laura" });
if (paso === "todo" || paso === "op") await aceptarEInscribir({ token: TOKEN_OP, correo: "op@lever.test", entrar: "/operacion/entrar", archivo: "op", operacion: true });
if (paso === "todo" || paso === "personas") await sembrarPersonas();
