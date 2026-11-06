// Recorrido clicado del sistema visual en un tema y un tamaño. Uso: node recorrido.mjs <tema> <escritorio|movil>
import { readFileSync, writeFileSync } from "node:fs";
import { BASE, CLAVE, EVIDENCIA, SV, abrir, capturador, totp } from "./comun.mjs";

const [tema = "oscuro", forma = "escritorio"] = process.argv.slice(2);
const movil = forma === "movil";
const [ancho, alto] = movil ? [390, 844] : [1440, 900];
const DIR = EVIDENCIA;
const sufijo = `${tema}-${ancho}`;
const ALTAMAR = "Altamar Logística";
const TALLER = "Taller del Cierre";
const semilla = (quien) => readFileSync(`${SV}/semilla-${quien}.txt`, "utf8").trim();
const checks = [];
function comprobar(nombre, ok, detalle = "") {
  checks.push({ nombre, ok: Boolean(ok), detalle });
  console.log(`${ok ? "OK " : "MAL"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
}

const { nav, p, errores } = await abrir({ tema, ancho, alto, movil });
const foto = capturador(p, DIR, sufijo);

async function esperar() {
  await p.waitForLoadState("networkidle").catch(() => {});
}

/** Clic que navega: espera a que cambie la dirección (la navegación del cliente no dispara load). */
async function clicNavega(objetivo, patron) {
  const antes = p.url();
  await objetivo.click();
  await p.waitForURL((u) => u.href !== antes && (!patron || patron.test(u.href)), { timeout: 20000 }).catch(() => {});
  await esperar();
  await p.waitForTimeout(400);
}

/** En móvil se navega abriendo el cajón; en escritorio, con el lateral. */
async function irA(seccion) {
  if (movil) await p.getByRole("button", { name: "Secciones" }).click();
  const enlace = p.locator("#lateral").getByRole("link", { name: seccion }).first();
  if ((await enlace.getAttribute("aria-current")) === "page") {
    if (movil) await p.getByRole("button", { name: "Cerrar" }).click();
    return;
  }
  await clicNavega(enlace);
}

async function menuPersona() {
  await p.locator(".cuenta .menu-desplegable-boton").click();
  await p.locator(".cuenta [role=menu]").waitFor();
}

// 1. Entrada con contraseña y TOTP
await p.goto(`${BASE}/entrar`);
await esperar();
comprobar("tema en <html>", (await p.locator("html").getAttribute("data-tema")) === tema);
await foto("01-entrar");
await p.getByLabel("Correo").fill("laura@lever.test");
await p.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
await p.locator("form button[type=submit]").first().click();
await p.waitForURL(/continuar/);
await esperar();
await foto("02-entrar-totp");
await p.locator("#codigo").fill(await totp(semilla("laura")));
await p.getByRole("button", { name: "Entrar con el código" }).click();
await p.waitForURL((u) => !/^\/entrar/.test(u.pathname), { timeout: 30000 });
await esperar();
comprobar("entrada con contraseña y TOTP", /\/consola|\/empresas/.test(p.url()), p.url());
if (/\/empresas/.test(p.url())) {
  await foto("03-empresas");
  await clicNavega(p.locator("dl > div").filter({ hasText: ALTAMAR }).getByRole("link", { name: "Abrir consola" }).first(), /\/c\/[0-9a-f-]{36}\//);
}
const empresaActual = (await p.locator(".empresa-lateral").first().textContent().catch(() => "")) || "";
if (!empresaActual.includes(ALTAMAR)) {
  // La última empresa usada manda; cambiamos a Altamar con la tarjeta del lateral.
  if (movil) await p.getByRole("button", { name: "Secciones" }).click();
  await p.locator(".empresa-lateral .menu-desplegable-boton").click();
  await clicNavega(p.locator(".empresa-lateral [role=menu]").getByRole("menuitem", { name: new RegExp(ALTAMAR) }), /\/c\/[0-9a-f-]{36}\//);
}

// 2. Inicio
await irA("Inicio");
comprobar("Inicio con aria-current", ((await p.locator('#lateral a[aria-current="page"]').textContent()) ?? "").includes("Inicio"));
comprobar("título de la barra", (await p.locator(".barra-titulo").innerText()).length > 0, await p.locator(".barra-titulo").innerText());
await foto("10-inicio");

if (movil) {
  // Cajón: abre, el foco queda dentro, navega y cierra con Escape devolviendo el foco
  const abrirCajon = p.getByRole("button", { name: "Secciones" });
  await abrirCajon.click();
  await p.waitForTimeout(300);
  await foto("11-cajon-abierto");
  let fuera = 0;
  for (let i = 0; i < 25; i += 1) {
    await p.keyboard.press("Tab");
    const dentro = await p.evaluate(() => {
      const a = document.activeElement;
      return Boolean(a && (a.closest("#lateral") || a.closest(".barra-movil")));
    });
    if (!dentro) fuera += 1;
  }
  comprobar("cajón: Tab no sale (25 pulsaciones)", fuera === 0, `fuera=${fuera}`);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(200);
  const enfocado = await p.evaluate(() => document.activeElement?.textContent?.trim());
  comprobar("cajón: Escape cierra y regresa el foco", (await p.locator(".velo").count()) === 0 && enfocado === "Secciones", `foco=${enfocado}`);
}

// 3. Pendientes
await irA("Pendientes");
comprobar("Pendientes abre", /\/consola\/pendientes/.test(p.url()));
if (movil) comprobar("cajón: navegar lo cierra", (await p.locator(".velo").count()) === 0);
await foto("12-pendientes");

// 4. Personas: directorio, buscador, ficha, nómina
await irA("Personas");
await foto("20-personas-directorio");
const buscar = p.locator("form.busqueda input[name=q]");
await buscar.fill("Tomás");
await buscar.press("Enter");
await p.waitForURL(/q=/, { timeout: 15000 }).catch(() => {});
await esperar();
comprobar("buscador lleva a Personas con q", /personas\?q=Tom/.test(decodeURIComponent(p.url())), p.url());
await foto("21-personas-busqueda");
await p.goto(p.url().split("?")[0]);
await clicNavega(p.locator("main").getByRole("link", { name: /Operativo Nómina/ }).first(), /personas\/[0-9a-f-]{36}/);
comprobar("ficha de persona", /\/consola\/personas\/[0-9a-f-]{36}/.test(p.url()));
await foto("22-personas-ficha");
await p.evaluate(() => window.scrollTo(0, 600));
await p.waitForTimeout(400);
comprobar("barra con desenfoque al hacer scroll", (await p.locator(".barra-superior").getAttribute("data-desplazada")) !== null);
await foto("23-personas-ficha-scroll");
await p.evaluate(() => window.scrollTo(0, 0));
await clicNavega(p.locator("main").getByRole("link", { name: "Nómina", exact: true }).first(), /nomina/);
comprobar("Nómina abre", /\/consola\/personas\/nomina/.test(p.url()));
await foto("24-nomina");

// 5. Política, 69-B, Configuración
await irA("Política");
await foto("30-politica");
await irA("Lista 69-B");
await foto("31-lista-69b");
await irA("Configuración");
await foto("32-configuracion");

// 6. Menú de la persona: cada opción
await menuPersona();
comprobar("menú abierto", (await p.locator('.cuenta [role=menu][data-abierto="si"]').count()) === 1);
await foto("40-menu-persona");
const opciones = await p.locator(".cuenta [role=menuitem]").allInnerTexts();
comprobar("menú de la persona: opciones", opciones.length >= 4, opciones.map((o) => o.trim()).join(" | "));
await p.keyboard.press("Escape");
await p.waitForTimeout(400); // el menú se desvanece en 250 ms antes de ocultarse
comprobar("menú: Escape cierra", (await p.locator('.cuenta [role=menu][data-abierto="si"]').count()) === 0 && !(await p.locator(".cuenta [role=menu]").isVisible()));
comprobar("menú: Escape regresa el foco al chip", await p.evaluate(() => document.activeElement?.classList.contains("menu-desplegable-boton") ?? false));
await menuPersona();
await clicNavega(p.getByRole("menuitem", { name: /Mi perfil y seguridad/ }), /seguridad/);
comprobar("Mi perfil y seguridad", /\/entrar\/seguridad/.test(p.url()), p.url());
await foto("41-seguridad");
await p.goBack();
await esperar();
await menuPersona();
await clicNavega(p.getByRole("menuitem", { name: "Apariencia" }), /apariencia/);
comprobar("Apariencia desde el menú", /\/consola\/apariencia/.test(p.url()));
await p.waitForFunction(() => document.querySelectorAll('canvas.miniatura-lienzo[data-pintada="si"]').length === 6, null, { timeout: 20000 }).catch(() => {});
comprobar("6 miniaturas pintadas", (await p.locator('canvas.miniatura-lienzo[data-pintada="si"]').count()) === 6);
await foto("42-apariencia");
await foto("42-apariencia-completa", { completa: true });

// 7. Cambiar de empresa y Proveedores en la empresa con pagos
await menuPersona();
await clicNavega(p.getByRole("menuitem", { name: /Cambiar de empresa/ }), /empresas/);
comprobar("Cambiar de empresa abre /empresas", /\/empresas/.test(p.url()));
await foto("43-empresas");
await clicNavega(p.locator("dl > div").filter({ hasText: TALLER }).getByRole("link", { name: "Abrir consola" }).first(), /33333333/);
comprobar("cambio de empresa", ((await p.locator(".empresa-lateral").first().textContent()) ?? "").includes(TALLER));
await foto("44-taller-inicio");
await irA("Pendientes");
await foto("45-taller-pendientes");
await irA("Proveedores");
await foto("50-proveedores-mesa");
await clicNavega(p.getByRole("link", { name: "Alta de proveedor" }).first(), /nuevo-proveedor/);
comprobar("alta de proveedor", /nuevo-proveedor/.test(p.url()));
await foto("51-proveedores-alta");
await p.goBack();
await esperar();
// Buscador de proveedores (sin Personas en esta empresa no hay maestro, el buscador va a Proveedores)
const buscarProveedor = p.locator("form.busqueda input[name=q]");
if (await buscarProveedor.count()) {
  const lugar = await buscarProveedor.getAttribute("placeholder");
  await buscarProveedor.fill("Papel");
  const antes = p.url();
  await buscarProveedor.press("Enter");
  await p.waitForURL((u) => u.href !== antes, { timeout: 15000 }).catch(() => {});
  await esperar();
  comprobar("buscador con q", /q=Papel/.test(p.url()), `${lugar} → ${p.url()}`);
  await foto("52-busqueda-taller");
}

// 8. Teléfono, cambio desde el lateral y 404
await irA("Teléfono");
comprobar("teléfono abre", /\/telefono/.test(p.url()), p.url());
await foto("60-telefono");
await p.goto(`${BASE}/esta-ruta-no-existe`);
await esperar();
await foto("61-404");

// 9. Muestrario: diálogo, panel lateral, aviso con Deshacer
if (!movil || tema === "oscuro") {
  await p.goto(`${BASE}/muestrario`);
  await esperar();
  const ejemplo = p.locator(".superficies-de-ejemplo");
  await ejemplo.scrollIntoViewIfNeeded();
  await ejemplo.getByRole("button", { name: "Ver detalle" }).first().click();
  await p.waitForTimeout(400);
  comprobar("panel lateral abre", await p.locator("dialog.panel-detalle[open]").count() === 1);
  const cierres = async () => Number(await ejemplo.locator("[data-cierres]").getAttribute("data-cierres"));
  const desplazamiento = await p.evaluate(() => scrollY);
  await p.mouse.wheel(0, 600);
  await p.waitForTimeout(300);
  comprobar(
    "con el panel abierto el fondo no se desplaza",
    (await p.evaluate(() => document.documentElement.style.overflow)) === "hidden" && (await p.evaluate(() => scrollY)) === desplazamiento,
  );
  // En móvil la rueda movía la vista (visualViewport) aunque la página estuviera bloqueada, y el panel se salía.
  const vista = await p.evaluate(() => ({ arriba: visualViewport.offsetTop, panel: document.querySelector("dialog.panel-detalle").getBoundingClientRect().top }));
  comprobar("con el panel abierto la vista no se mueve y el panel sigue arriba", vista.arriba === 0 && vista.panel === 0, JSON.stringify(vista));
  await foto("70-muestrario-panel");
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
  comprobar("panel lateral cierra con Escape", await p.locator("dialog.panel-detalle[open]").count() === 0);
  comprobar("Escape avisa el cierre una sola vez", (await cierres()) === 1, `${await cierres()}`);
  comprobar("al cerrar, el fondo vuelve a desplazarse", (await p.evaluate(() => document.documentElement.style.overflow)) === "");
  const filas = await ejemplo.locator("tbody tr").count();
  await ejemplo.getByRole("button", { name: "Archivar" }).first().click();
  await p.waitForTimeout(300);
  comprobar("aviso con Deshacer", await p.locator(".aviso-inferior").count() === 1);
  await foto("71-muestrario-aviso");
  await p.getByRole("button", { name: "Deshacer" }).click();
  await p.waitForTimeout(300);
  comprobar("Deshacer regresa la fila", (await ejemplo.locator("tbody tr").count()) === filas);
  await ejemplo.getByRole("button", { name: "Botones" }).click();
  await ejemplo.getByRole("button", { name: "Principal" }).click();
  await p.waitForTimeout(400);
  comprobar("diálogo abre", await p.locator("dialog.dialogo[open]").count() === 1);
  await foto("72-muestrario-dialogo");
  // Clic en el velo (fuera del cuerpo del diálogo).
  await p.mouse.click(6, 6);
  await p.waitForTimeout(300);
  comprobar("diálogo cierra con el velo", await p.locator("dialog.dialogo[open]").count() === 0);
  comprobar("el velo avisa el cierre una sola vez", (await cierres()) === 2, `${await cierres()}`);
}

// 10. Salir desde el menú de la persona
await p.goto(`${BASE}/consola`);
await esperar();
await menuPersona();
await clicNavega(p.getByRole("menuitem", { name: "Salir" }));
comprobar("Salir", /\/entrar|\/$/.test(new URL(p.url()).pathname), p.url());
await foto("80-salir");

const errs = errores.filter((e) => !/Failed to load resource.*404/.test(e));
comprobar("sin errores de consola", errs.length === 0, errs.slice(0, 5).join(" || "));
writeFileSync(`${SV}/checks-${sufijo}.json`, JSON.stringify(checks, null, 2));
await nav.close();
process.exit(checks.every((c) => c.ok) ? 0 : 1);
