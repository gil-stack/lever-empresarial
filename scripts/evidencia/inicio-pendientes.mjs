// Recorrido funcional de Inicio y Pendientes (PR #43) con Playwright headless.
//
// Solo corre contra una base local desechable: rechaza un DUENO_URL que no sea
// 127.0.0.1 o localhost. Pasos previos y variables en
// docs/evidencia/inicio-pendientes/README.md.
//
//   PLAYWRIGHT_DESDE=/ruta/con/node_modules/ \
//   BASE=http://localhost:4813 \
//   DUENO_URL=postgres://dueno@127.0.0.1:5513/plataforma \
//   INVITACION_ADMIN=http://localhost:4813/invitacion/<token> \
//   [CHROMIUM=/ruta/a/chrome-headless-shell] \
//   node scripts/evidencia/inicio-pendientes.mjs
//
// El correo no está configurado en local, así que las personas nuevas no
// reciben su enlace. Para que entren por la pantalla real de invitación, el
// script emite como dueño de la base una invitación de sistema con un token
// conocido. Todo lo demás pasa por clics en la aplicación.

import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const BASE = process.env.BASE ?? "http://localhost:4813";
const DUENO = process.env.DUENO_URL ?? "";
const INVITACION_ADMIN = process.env.INVITACION_ADMIN ?? "";
const SALIDA = process.env.SALIDA ?? "docs/evidencia/inicio-pendientes";
const CLAVE = "Clave-local-43!";
const CLABE = "002180701150123452";

if (!/^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost)(:\d+)?\//.test(DUENO)) {
  throw new Error("DUENO_URL tiene que apuntar a un Postgres local desechable (127.0.0.1 o localhost).");
}
if (!INVITACION_ADMIN.startsWith(`${BASE}/invitacion/`)) throw new Error("Falta INVITACION_ADMIN (enlace de empresa:alta).");

const requerir = createRequire(process.env.PLAYWRIGHT_DESDE ?? import.meta.url);
const { chromium } = requerir("playwright");

mkdirSync(SALIDA, { recursive: true });
const hechos = [];

function anotar(texto) {
  hechos.push(texto);
  console.log(`OK ${texto}`);
}

function exigir(condicion, texto) {
  if (!condicion) throw new Error(`FALLO ${texto}`);
  anotar(texto);
}

function sql(consulta) {
  return execFileSync("psql", [DUENO, "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-c", consulta], { encoding: "utf8" }).trim();
}

function totp(semilla) {
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const letra of semilla.replace(/\s+/g, "").toUpperCase()) bits += alfabeto.indexOf(letra).toString(2).padStart(5, "0");
  const llave = Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)));
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hmac = createHmac("sha1", llave).update(contador).digest();
  const desplazamiento = hmac[hmac.length - 1] & 15;
  return String((hmac.readUInt32BE(desplazamiento) & 0x7fffffff) % 1e6).padStart(6, "0");
}

/** Invitación de sistema con token conocido para una persona ya dada de alta por la aplicación. */
function invitacionLocal(correo) {
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  const filas = sql(`
    insert into invitations (id, operator_id, company_id, user_id, token_hash, emitida_por_tipo, expira_en)
    select '${randomUUID()}', i.operator_id, i.company_id, i.user_id, '${hash}', 'sistema', now() + interval '1 day'
    from invitations i join users u on u.id = i.user_id
    where u.correo = '${correo}' and i.company_id is not null
    order by i.emitida_en desc limit 1
    returning 1`);
  if (filas !== "1") throw new Error(`No se pudo emitir la invitación local de ${correo}`);
  return `${BASE}/invitacion/${token}`;
}

async function entrarPorInvitacion(pagina, enlace) {
  await pagina.goto(enlace);
  await pagina.fill("#contrasena", CLAVE);
  await pagina.fill("#confirmacion", CLAVE);
  await pagina.locator("form button[type=submit]").first().click();
  await pagina.waitForURL(/\/entrar\/continuar/);
  const semilla = (await pagina.locator(".arco-semilla").textContent()).trim();
  const guardados = pagina.getByText("Ya los guardé en un lugar seguro");
  // Un código emitido al filo de la ventana de 30 s puede vencer en el viaje: se espera la siguiente y se reintenta.
  for (let intento = 1; ; intento += 1) {
    await pagina.fill("#codigo-alta", totp(semilla));
    await pagina.getByRole("button", { name: "Confirmar el código" }).click();
    try {
      await guardados.waitFor({ timeout: 8000 });
      break;
    } catch (error) {
      if (intento === 3) throw error;
      await pagina.waitForTimeout(30000 - (Date.now() % 30000) + 500);
    }
  }
  await guardados.click();
  await pagina.getByRole("button", { name: "Entrar al portal" }).click();
  await pagina.waitForURL((url) => !url.pathname.startsWith("/entrar"));
}

async function contexto(navegador, { tema = "claro", ancho = 1440, alto = 900 } = {}) {
  const ctx = await navegador.newContext({ viewport: { width: ancho, height: alto }, locale: "es-MX", timezoneId: "America/Mexico_City" });
  await ctx.addCookies([{ name: "tema", value: tema, url: BASE }]);
  return ctx;
}

async function captura(pagina, archivo, completa = true) {
  // El indicador de next dev no es parte de la aplicación.
  await pagina.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await pagina.screenshot({ path: `${SALIDA}/${archivo}`, fullPage: completa });
  anotar(`captura ${archivo}`);
}

async function vigilar(pagina, nombre) {
  pagina.on("pageerror", (error) => {
    throw new Error(`FALLO error de página en ${nombre}: ${error.message}`);
  });
}

/** Tamaño de letra en pantalla de una etiqueta de eje (texto HTML, sin escala de SVG). */
async function tamanoReal(texto) {
  return texto.evaluate((nodo) => parseFloat(getComputedStyle(nodo).fontSize));
}

async function cifra(pagina, rotulo) {
  return (await pagina.locator(".inicio-metricas div", { hasText: rotulo }).locator("dd").textContent()).trim();
}

// CHROMIUM permite usar un navegador ya descargado si la versión de Playwright pide otro build.
const navegador = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
try {
  // (a) Inicio con datos, como administradora.
  const admin = await contexto(navegador);
  const laura = await admin.newPage();
  await vigilar(laura, "administradora");
  await entrarPorInvitacion(laura, INVITACION_ADMIN);
  const empresa = /\/c\/([0-9a-f-]{36})\//.exec(laura.url())?.[1];
  exigir(Boolean(empresa) && laura.url().endsWith("/consola"), `la administradora aterriza en Inicio (${laura.url()})`);
  await laura.getByRole("heading", { name: "Entradas y salidas" }).waitFor();
  const salidas = await cifra(laura, "Salidas del mes");
  const categorias = await laura.locator(".grafica-categorias li").evaluateAll((filas) =>
    filas.map((fila) => ({
      nombre: fila.querySelector(".grafica-categoria-cabeza span")?.textContent?.trim() ?? "",
      monto: fila.querySelector(".grafica-categoria-cabeza strong")?.textContent?.trim() ?? "",
    })),
  );
  const aCentavos = (texto) => Math.round(Number(texto.replace(/[^0-9.-]/g, "")) * 100);
  exigir(salidas === "$111,800.00", `Salidas del mes de noviembre = ${salidas}`);
  exigir(!categorias.some((categoria) => categoria.nombre === "Viáticos"), `Salidas por categoría sin el asiento del 31-oct 20:00: ${categorias.map((c) => `${c.nombre} ${c.monto}`).join(", ")}`);
  exigir(categorias.reduce((suma, categoria) => suma + aCentavos(categoria.monto), 0) === aCentavos(salidas), "las categorías suman lo mismo que Salidas del mes");
  const octubre = await laura.locator(".grafica-mensual-amplia rect.grafica-gasto title", { hasText: "Oct" }).textContent();
  exigir(octubre.includes("$151,250.00"), `el 31-oct cuenta en octubre: ${octubre}`);
  const ejeEscritorio = await tamanoReal(laura.locator(".grafica-mensual-amplia .grafica-eje-y li").first());
  exigir(ejeEscritorio >= 11 && ejeEscritorio <= 13, `texto del eje en escritorio (1440 px) = ${ejeEscritorio.toFixed(1)} px reales`);
  await captura(laura, "01-inicio-datos-claro.png");

  // (b) Contador y liberador entran por /c/<id> y llegan a Pendientes, no a un 404.
  await laura.goto(`${BASE}/c/${empresa}/consola/personas`);
  await laura.fill("#centroNombre", "Operación");
  await laura.getByRole("button", { name: "Nombrar centro" }).click();
  await laura.getByText("El centro de costo quedó nombrado.").waitFor();
  const personas = [
    { nombre: "Carlos Contador", correo: "carlos@lever.test", roles: ["contador"] },
    { nombre: "Lucía Liberadora", correo: "lucia@lever.test", roles: ["liberador"] },
    { nombre: "Tomás Tarjeta", correo: "tomas@lever.test", roles: ["tarjetahabiente"] },
  ];
  async function llenarAlta(persona, conFinanzas) {
    const alta = laura.locator("form.formulario-maestro");
    await alta.locator("#nombre").fill(persona.nombre);
    await alta.locator("#alta").selectOption("2");
    await alta.locator("select[aria-label=Mes]").first().selectOption("11");
    await alta.locator("select[aria-label=Año]").first().selectOption("2026");
    await alta.locator("#centro").selectOption({ label: "Operación" });
    await alta.locator("#clabe").fill(CLABE);
    await alta.locator("#acceso").selectOption("nueva");
    await alta.locator("#correo").fill(persona.correo);
    for (const rol of persona.roles) await alta.locator(`input[name=rol][value=${rol}]`).check();
    if (conFinanzas) await alta.locator("#verFinanzas").check();
    await alta.getByRole("button", { name: "Dar de alta a la persona" }).click();
  }
  for (const persona of personas) {
    await llenarAlta(persona, false);
    await laura.getByText(/La persona quedó en el maestro/).first().waitFor();
    await laura.reload();
  }
  anotar("alta por la pantalla de Carlos (contador), Lucía (liberadora) y Tomás (tarjetahabiente)");

  // (c) Alta solo con Finanzas: rechazada con su mensaje.
  await llenarAlta({ nombre: "Sofía Solo Finanzas", correo: "sofia@lever.test", roles: [] }, true);
  const avisoAlta = laura.getByText("Finanzas es un acceso adicional. Elige también el rol de trabajo de la persona.").first();
  await avisoAlta.waitFor();
  await avisoAlta.scrollIntoViewIfNeeded();
  await captura(laura, "04-alta-solo-finanzas-rechazada.png", false);
  exigir(sql("select count(*) from users where correo = 'sofia@lever.test'") === "0", "el alta solo con Finanzas no creó a la persona");

  for (const persona of personas.slice(0, 2)) {
    const ctx = await contexto(navegador);
    const pagina = await ctx.newPage();
    await vigilar(pagina, persona.nombre);
    await entrarPorInvitacion(pagina, invitacionLocal(persona.correo));
    exigir(pagina.url().endsWith(`/c/${empresa}/consola/pendientes`), `${persona.nombre} aterriza en Pendientes al entrar`);
    for (const ruta of [`/c/${empresa}`, `/c/${empresa}/consola`]) {
      const respuesta = await pagina.goto(`${BASE}${ruta}`);
      exigir(
        respuesta.status() === 200 && pagina.url().endsWith(`/c/${empresa}/consola/pendientes`),
        `${persona.nombre} abre ${ruta} y llega a Pendientes (HTTP ${respuesta.status()})`,
      );
    }
    await pagina.getByRole("heading", { level: 1 }).first().waitFor();
    if (persona.roles.includes("contador")) await captura(pagina, "02-contador-redirige-a-pendientes.png", false);
    else await captura(pagina, "03-liberador-redirige-a-pendientes.png", false);
    await ctx.close();
  }

  // (c) Otorgar y quitar Finanzas desde la ficha de Tomás (solo tarjetahabiente: misma regla que el alta).
  const tomasCtx = await contexto(navegador, { tema: "oscuro", ancho: 390, alto: 844 });
  const tomas = await tomasCtx.newPage();
  await vigilar(tomas, "Tomás");
  await entrarPorInvitacion(tomas, invitacionLocal("tomas@lever.test"));
  exigir(tomas.url().endsWith(`/c/${empresa}/telefono`), "Tomás (tarjetahabiente) entra al teléfono");

  await laura.goto(`${BASE}/c/${empresa}/consola/personas`);
  const fichaTomas = laura.locator("article.persona", { hasText: "Tomás Tarjeta" });
  await fichaTomas.getByLabel("Puede ver Inicio financiero").check();
  await fichaTomas.getByRole("button", { name: "Guardar acceso financiero" }).click();
  await fichaTomas.getByText("La persona ya puede ver Inicio financiero.").waitFor();
  await fichaTomas.scrollIntoViewIfNeeded();
  await captura(laura, "05-finanzas-otorgado.png", false);
  exigir(sql("select string_agg(rol, ',' order by rol) from membership_roles r join users u on u.id = r.user_id where u.correo = 'tomas@lever.test'") === "finanzas,tarjetahabiente", "la base guarda Finanzas + tarjetahabiente");

  const inicioTomas = await tomas.goto(`${BASE}/c/${empresa}/consola`);
  exigir(inicioTomas.status() === 200 && (await tomas.locator(".inicio-metricas").count()) === 1, "con Finanzas, Tomás ve Inicio");

  await laura.reload();
  await fichaTomas.getByLabel("Puede ver Inicio financiero").uncheck();
  await fichaTomas.getByRole("button", { name: "Guardar acceso financiero" }).click();
  await fichaTomas.getByText("Se retiró el acceso a Inicio financiero.").waitFor();
  exigir(sql("select string_agg(rol, ',' order by rol) from membership_roles r join users u on u.id = r.user_id where u.correo = 'tomas@lever.test'") === "tarjetahabiente", "la base vuelve a solo tarjetahabiente");
  const sinFinanzas = await tomas.goto(`${BASE}/c/${empresa}/consola`);
  exigir(sinFinanzas.status() === 404, `sin Finanzas, Inicio no existe para Tomás (HTTP ${sinFinanzas.status()})`);

  // (c) Membresía heredada con solo Finanzas: quitarla no deja a nadie sin rol, el aviso lo dice y la casilla regresa.
  // La aplicación ya no deja crear este estado; se simula como dueño de la base, con su evento de bitácora.
  sql(`
    insert into audit_log (operator_id, company_id, actor_tipo, superficie, accion, entidad, identificador)
      select c.operator_id, c.id, 'sistema', 'sistema', 'simular_membresia_heredada', 'membership_roles', u.id
      from companies c, users u where c.id = '${empresa}' and u.correo = 'tomas@lever.test';
    insert into membership_roles (user_id, company_id, rol)
      select id, '${empresa}', 'finanzas' from users where correo = 'tomas@lever.test';
    delete from membership_roles where rol = 'tarjetahabiente'
      and user_id = (select id from users where correo = 'tomas@lever.test');`);
  await laura.reload();
  const casilla = fichaTomas.getByLabel("Puede ver Inicio financiero");
  exigir(await casilla.isChecked(), "la ficha muestra a Tomás con solo Finanzas");
  await casilla.uncheck();
  await fichaTomas.getByRole("button", { name: "Guardar acceso financiero" }).click();
  await fichaTomas.getByText("Finanzas es su único rol y nadie queda sin rol. Dale primero su rol de trabajo.").waitFor();
  exigir(await casilla.isChecked(), "tras el rechazo la casilla regresa a marcada (valor real)");
  await fichaTomas.scrollIntoViewIfNeeded();
  await captura(laura, "06-quitar-unico-rol-rechazado.png", false);

  // (d) Finanzas no abre el teléfono.
  // /telefono tiene loading.tsx: la respuesta ya salió con 200 cuando la página llama a notFound(),
  // así que se comprueba lo que se pinta (la página 404) y no el código HTTP.
  await tomas.goto(`${BASE}/c/${empresa}/telefono`);
  await tomas.getByText("This page could not be found.").waitFor();
  exigir((await tomas.locator(".telefono").count()) === 0, "con solo Finanzas, el teléfono pinta la página 404 y ningún dato");
  await captura(tomas, "07-finanzas-sin-telefono.png", false);

  // (e) Gráfica a 390 px: mes actual y eje, sin barra de desplazamiento. (f) oscuro.
  await tomas.goto(`${BASE}/c/${empresa}/consola`);
  const compacta = tomas.locator(".grafica-mensual-compacta");
  await compacta.waitFor();
  exigir(await tomas.locator(".grafica-mensual-amplia").isHidden(), "a 390 px la gráfica amplia se oculta");
  const meses = await compacta.locator(".grafica-eje-x li").allTextContents();
  exigir(meses.join(",") === "Sep,Oct,Nov", `a 390 px se ven los últimos tres meses, con el actual: ${meses.join(", ")}`);
  const eje = await compacta.locator(".grafica-eje-y li").evaluateAll((textos) => textos.map((texto) => texto.getBoundingClientRect().height > 0));
  exigir(eje.length === 5 && eje.every(Boolean), "a 390 px el eje Y se ve con sus cinco marcas");
  const ejeMovil = await tamanoReal(compacta.locator(".grafica-eje-x li").first());
  exigir(ejeMovil >= 11 && ejeMovil <= 13, `texto de los ejes a 390 px = ${ejeMovil.toFixed(1)} px reales`);
  const desborda = await tomas.locator(".grafica-mensual").evaluate((caja) => caja.scrollWidth > caja.clientWidth + 1);
  exigir(!desborda, "a 390 px la gráfica no necesita desplazamiento horizontal");
  const navegacion = await tomas.locator("nav.secciones a").allTextContents();
  exigir(!navegacion.some((texto) => /Política|Proveedores|Personas/.test(texto)), `Finanzas solo ve: ${navegacion.map((t) => t.trim()).filter(Boolean).join(", ")}`);
  await compacta.evaluate((nodo) => nodo.scrollIntoView({ block: "center" }));
  await captura(tomas, "08-grafica-movil-oscuro.png", false);

  const movilClaro = await contexto(navegador, { tema: "claro", ancho: 390, alto: 844 });
  const lauraMovil = await movilClaro.newPage();
  await movilClaro.addCookies(await admin.cookies());
  await lauraMovil.goto(`${BASE}/c/${empresa}/consola`);
  await lauraMovil.locator(".grafica-mensual-compacta").evaluate((nodo) => nodo.scrollIntoView({ block: "center" }));
  await captura(lauraMovil, "09-grafica-movil-claro.png", false);
  await movilClaro.close();

  await admin.addCookies([{ name: "tema", value: "oscuro", url: BASE }]);
  await laura.goto(`${BASE}/c/${empresa}/consola`);
  await laura.getByRole("link", { name: "12 meses" }).click();
  await laura.waitForURL(/periodo=12/);
  exigir((await laura.locator(".grafica-mensual-amplia .grafica-eje-x li").count()) === 12, "el selector de 12 meses dibuja doce meses");
  const encimadas = await laura.locator(".grafica-mensual-amplia .grafica-eje-x li").evaluateAll((etiquetas) =>
    etiquetas.some((etiqueta) => etiqueta.scrollWidth > etiqueta.clientWidth + 1),
  );
  exigir(!encimadas, "las doce etiquetas de mes caben sin encimarse");
  await captura(laura, "10-inicio-12-meses-oscuro.png");

  console.log("VALIDACION_FUNCIONAL_OK");
} finally {
  await navegador.close();
}
