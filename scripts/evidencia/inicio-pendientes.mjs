// Recorrido funcional de Inicio y Pendientes (PR #43) sobre main integrado
// (#44 pagos a proveedores y #45 Personas), con Playwright headless.
//
// Solo corre contra una base local desechable: rechaza un DUENO_URL que no sea
// 127.0.0.1 o localhost. Pasos previos y variables en
// docs/evidencia/inicio-pendientes/README.md.
//
//   [PLAYWRIGHT_DESDE=/ruta/con/node_modules/] \
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
const PDF = process.env.PDF_PRUEBA ?? "tests/e2e/fixtures/soporte-prueba.pdf";
const CLAVE = "Clave-local-43!";
const CLABE = "002180701150123452";
const ROLES = { administrador: "Administrador", liberador: "Liberador", tarjetahabiente: "Tarjetahabiente", contador: "Contador" };

if (!/^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost)(:\d+)?\//.test(DUENO)) {
  throw new Error("DUENO_URL tiene que apuntar a un Postgres local desechable (127.0.0.1 o localhost).");
}
if (!INVITACION_ADMIN.startsWith(`${BASE}/invitacion/`)) throw new Error("Falta INVITACION_ADMIN (enlace de empresa:alta).");

const requerir = createRequire(process.env.PLAYWRIGHT_DESDE ?? import.meta.url);
const { chromium } = requerir("playwright");

mkdirSync(SALIDA, { recursive: true });

function anotar(texto) {
  console.log(`OK ${texto}`);
}

function exigir(condicion, texto) {
  if (!condicion) throw new Error(`FALLO ${texto}`);
  anotar(texto);
}

function sql(consulta) {
  return execFileSync("psql", [DUENO, "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-c", consulta], { encoding: "utf8" }).trim();
}

function rolesDe(correo) {
  return sql(`select coalesce(string_agg(rol, ',' order by rol), '') from membership_roles r join users u on u.id = r.user_id where u.correo = '${correo}'`);
}

function fecha(dias) {
  const valor = new Date();
  valor.setUTCDate(valor.getUTCDate() + dias);
  return valor.toISOString().slice(0, 10);
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

function vigilar(pagina, nombre) {
  pagina.on("pageerror", (error) => {
    throw new Error(`FALLO error de página en ${nombre}: ${error.message}`);
  });
  pagina.on("console", (mensaje) => {
    if (mensaje.type() === "error" || mensaje.type() === "warning") console.log(`CONSOLA ${nombre} ${mensaje.type()} ${pagina.url()} :: ${mensaje.text().slice(0, 400)}`);
  });
}

async function cifra(pagina, rotulo) {
  return (await pagina.locator(".inicio-metricas div", { hasText: rotulo }).locator("dd").textContent()).trim();
}

/** Tamaño de letra en pantalla de una etiqueta de eje (texto HTML, sin escala de SVG). */
async function tamanoReal(texto) {
  return texto.evaluate((nodo) => parseFloat(getComputedStyle(nodo).fontSize));
}

async function pendientesVisibles(pagina) {
  return (await pagina.locator("main h3").allTextContents()).map((texto) => texto.trim());
}

const navegador = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
try {
  // (a) Inicio con datos, como administradora.
  const admin = await contexto(navegador);
  const laura = await admin.newPage();
  vigilar(laura, "administradora");
  await entrarPorInvitacion(laura, INVITACION_ADMIN);
  const empresa = /\/c\/([0-9a-f-]{36})\//.exec(laura.url())?.[1];
  exigir(Boolean(empresa) && laura.url().endsWith("/consola"), `la administradora aterriza en Inicio (${laura.url()})`);
  const raiz = `${BASE}/c/${empresa}`;
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

  // Personas nueva (#45): área y altas desde la pantalla.
  await laura.goto(`${raiz}/consola/personas/areas`);
  await laura.getByLabel("Área", { exact: true }).fill("Operación");
  await laura.getByLabel("Presupuesto mensual").fill("200000");
  await laura.getByRole("button", { name: "Crear área" }).click();
  await laura.getByText("El área quedó creada con su presupuesto.").waitFor();

  async function alta({ nombre, nomina = false, acceso = "no", correo = "", roles = [], finanzas = false }) {
    await laura.goto(`${raiz}/consola/personas/nueva`);
    await laura.getByLabel("Nombre completo").fill(nombre);
    await laura.getByLabel("Área", { exact: true }).selectOption({ label: "Operación" });
    if (nomina) {
      await laura.getByLabel("Neto por pago").fill("12000");
      await laura.getByLabel("Frecuencia").selectOption("mensual");
      await laura.getByLabel("CLABE", { exact: true }).fill(CLABE);
    } else {
      await laura.locator('input[name="conNomina"][value="no"]').check();
    }
    await laura.getByLabel("Usuario de plataforma").selectOption(acceso);
    if (acceso !== "no") await laura.getByLabel("Correo", { exact: true }).fill(correo);
    for (const rol of roles) await laura.getByRole("checkbox", { name: ROLES[rol], exact: true }).check();
    if (finanzas) await laura.getByRole("checkbox", { name: "Ver Inicio financiero" }).check();
    await laura.getByRole("button", { name: "Dar de alta colaborador" }).click();
  }

  // (c) El alta nueva rechaza a alguien solo con Finanzas.
  await alta({ nombre: "Sofía Solo Finanzas", acceso: "nueva", correo: "sofia@lever.test", finanzas: true });
  const avisoAlta = laura.locator(".alta-roles").getByText("Finanzas es un acceso adicional. Elige también el rol de trabajo de la persona.");
  await avisoAlta.waitFor();
  await laura.locator(".alta-roles").scrollIntoViewIfNeeded();
  await captura(laura, "04-alta-nueva-solo-finanzas-rechazada.png", false);
  exigir(sql("select count(*) from users where correo = 'sofia@lever.test'") === "0", "el alta solo con Finanzas no creó a la persona");

  for (const persona of [
    { nombre: "Operativo Nómina", nomina: true },
    { nombre: "Carlos Contador", acceso: "nueva", correo: "carlos@lever.test", roles: ["contador"] },
    { nombre: "Lucía Liberadora", acceso: "nueva", correo: "lucia@lever.test", roles: ["liberador"] },
    { nombre: "Mateo Liberador", acceso: "nueva", correo: "mateo@lever.test", roles: ["liberador"] },
  ]) {
    await alta(persona);
    await laura.waitForURL(/\/consola\/personas\/[0-9a-f-]{36}$/);
  }
  anotar("alta nueva de Operativo Nómina (nómina hoy), Carlos (contador), Lucía y Mateo (liberadores)");

  // Un rechazo del servidor no desmarca en pantalla lo que sí se enviaría.
  await alta({ nombre: "Correo Repetido", acceso: "nueva", correo: "carlos@lever.test", roles: ["tarjetahabiente"], finanzas: true });
  await laura.getByText("Ese correo ya entra").first().waitFor();
  exigir(
    (await laura.getByRole("checkbox", { name: "Tarjetahabiente", exact: true }).isChecked()) &&
      (await laura.getByRole("checkbox", { name: "Ver Inicio financiero" }).isChecked()),
    "tras el rechazo del servidor, el alta conserva marcados Tarjetahabiente y Finanzas",
  );
  exigir(sql("select count(*) from employees where nombre = 'Correo Repetido'") === "0", "el alta rechazada no creó a la persona");

  // (c) Otorgar Finanzas desde el alta nueva: tarjetahabiente + Ver Inicio financiero.
  await alta({ nombre: "Tomás Tarjeta", acceso: "nueva", correo: "tomas@lever.test", roles: ["tarjetahabiente"], finanzas: true });
  await laura.waitForURL(/\/consola\/personas\/[0-9a-f-]{36}$/);
  const fichaTomas = laura.url();
  exigir(rolesDe("tomas@lever.test") === "finanzas,tarjetahabiente", "el alta nueva guarda Finanzas + tarjetahabiente");

  // (b) Contador y liberadores entran por la invitación y por /c/<id> y llegan a Pendientes.
  // Un pago solo se solicita con dos liberadores activos, así que entran antes del pago.
  const equipo = [];
  for (const persona of [
    { nombre: "Carlos Contador", correo: "carlos@lever.test", archivo: "02-contador-pendientes.png" },
    { nombre: "Lucía Liberadora", correo: "lucia@lever.test", archivo: "03-liberadora-pendientes-pagos-nomina.png" },
    { nombre: "Mateo Liberador", correo: "mateo@lever.test" },
  ]) {
    const ctx = await contexto(navegador);
    const pagina = await ctx.newPage();
    vigilar(pagina, persona.nombre);
    await entrarPorInvitacion(pagina, invitacionLocal(persona.correo));
    exigir(pagina.url().endsWith(`/c/${empresa}/consola/pendientes`), `${persona.nombre} aterriza en Pendientes al entrar`);
    for (const ruta of [`/c/${empresa}`, `/c/${empresa}/consola`]) {
      const respuesta = await pagina.goto(`${BASE}${ruta}`);
      exigir(
        respuesta.status() === 200 && pagina.url().endsWith(`/c/${empresa}/consola/pendientes`),
        `${persona.nombre} abre ${ruta} y llega a Pendientes (HTTP ${respuesta.status()})`,
      );
    }
    equipo.push({ ...persona, ctx, pagina });
  }
  const lucia = equipo[1].pagina;
  exigir(!(await pendientesVisibles(lucia)).includes("Autoriza un pago a proveedor"), "antes de la solicitud la liberadora no tiene pagos por autorizar");

  // Pagos a proveedores (#44): un pago queda por autorizar.
  await laura.goto(`${raiz}/consola/proveedores/nuevo-proveedor`);
  await laura.getByLabel("RFC", { exact: true }).fill("DDD040404DA7");
  await laura.getByLabel("Razón social", { exact: true }).fill("Diesel del Bajío");
  await laura.getByLabel("Nombre comercial").fill("Diesel Bajío");
  await laura.getByLabel("Correo de contacto").fill("facturas@dieselbajio.mx");
  await laura.getByLabel("CLABE", { exact: true }).fill(CLABE);
  await laura.locator("#constancia").setInputFiles(PDF);
  await laura.getByRole("button", { name: "Dar de alta" }).click();
  await laura.getByText("Quedó asentado", { exact: true }).waitFor();
  await laura.goto(`${raiz}/consola/proveedores/nuevo`);
  await laura.getByLabel("Proveedor", { exact: true }).selectOption({ label: "Diesel del Bajío · DDD040404DA7" });
  await laura.getByRole("button", { name: /Excepción Motivo/ }).click();
  await laura.locator("#pdf").setInputFiles(PDF);
  await laura.getByLabel("Importe MXN").fill("8450.00");
  await laura.getByLabel("Referencia", { exact: true }).fill("Diésel ruta Bajío");
  await laura.getByLabel("Fecha de la obligación").fill(fecha(-2));
  await laura.getByLabel("Vencimiento", { exact: true }).fill(fecha(25));
  await laura.getByLabel("Fecha prevista de pago").fill(fecha(6));
  await laura.getByLabel("Por qué no hay factura").fill("Carga urgente sin factura del proveedor todavía");
  await laura.getByRole("button", { name: "Revisar y solicitar" }).click();
  await laura.getByText("El pago quedó enviado a autorización. Todavía no se mueve dinero.").waitFor();
  exigir(sql(`select count(*) from supplier_payment_requests where company_id = '${empresa}' and estado = 'por_autorizar'`) === "1", "la base tiene un pago por autorizar");

  // Al recargar, la liberadora ve el pago por autorizar y la nómina; el contador entra a Pendientes sin el pago como tarea.
  for (const { nombre, correo, archivo, ctx, pagina } of equipo) {
    await pagina.goto(`${raiz}/consola/pendientes`);
    await pagina.getByRole("heading", { level: 1 }).first().waitFor();
    const vistos = await pendientesVisibles(pagina);
    if (correo === "lucia@lever.test") {
      exigir(vistos.includes("Autoriza un pago a proveedor"), `la liberadora ve el pago por autorizar: ${vistos.join(" | ")}`);
      exigir(vistos.some((texto) => texto.startsWith("Prepara el lote de nómina del ")), "la liberadora ve la nómina por preparar");
      await captura(pagina, archivo, false);
      await pagina.getByRole("link", { name: /Revisar pagos/ }).click();
      await pagina.waitForURL(/\/consola\/proveedores$/);
      await pagina.getByText("Diesel del Bajío").first().waitFor();
      anotar("«Revisar pagos» abre la mesa de Proveedores con el pago de Diesel del Bajío");
    } else if (correo === "carlos@lever.test") {
      exigir(!vistos.includes("Autoriza un pago a proveedor"), `${nombre} entra a Pendientes y no recibe el pago como tarea suya: ${vistos.join(" | ") || "sin tareas"}`);
      await captura(pagina, archivo, false);
    }
    await ctx.close();
  }

  // La administradora ve la nómina por preparar (no autoriza pagos: no es liberadora).
  await laura.goto(`${raiz}/consola/pendientes`);
  const deLaura = await pendientesVisibles(laura);
  exigir(deLaura.some((texto) => texto.startsWith("Prepara el lote de nómina del ")) && !deLaura.includes("Autoriza un pago a proveedor"), `la administradora ve la nómina y no el pago: ${deLaura.join(" | ")}`);

  // (c) Otorgar y quitar Finanzas desde la ficha nueva.
  const tomasCtx = await contexto(navegador, { tema: "oscuro", ancho: 390, alto: 844 });
  const tomas = await tomasCtx.newPage();
  vigilar(tomas, "Tomás");
  await entrarPorInvitacion(tomas, invitacionLocal("tomas@lever.test"));
  exigir(tomas.url().endsWith(`/c/${empresa}/consola`), `Tomás (tarjetahabiente + Finanzas) aterriza en Inicio (${tomas.url()})`);

  await laura.goto(fichaTomas);
  const bloque = laura.getByRole("region", { name: "Plataforma y tarjeta" });
  const casilla = bloque.getByLabel("Puede ver Inicio financiero");
  exigir(await casilla.isChecked(), "la ficha nueva muestra la casilla de Finanzas marcada");
  await casilla.uncheck();
  await bloque.getByRole("button", { name: "Guardar acceso financiero" }).click();
  await bloque.getByText("Se retiró el acceso a Inicio financiero.").waitFor();
  exigir(rolesDe("tomas@lever.test") === "tarjetahabiente", "quitar desde la ficha deja solo tarjetahabiente");
  const sinFinanzas = await tomas.goto(`${raiz}/consola`);
  exigir(sinFinanzas.status() === 404, `sin Finanzas, Inicio no existe para Tomás (HTTP ${sinFinanzas.status()})`);

  await laura.reload();
  await casilla.check();
  await bloque.getByRole("button", { name: "Guardar acceso financiero" }).click();
  await bloque.getByText("La persona ya puede ver Inicio financiero.").waitFor();
  exigir(await casilla.isChecked(), "tras otorgar, la casilla de la ficha queda marcada (no se reinicia)");
  await bloque.scrollIntoViewIfNeeded();
  await captura(laura, "05-ficha-nueva-finanzas-otorgado.png", false);
  exigir(rolesDe("tomas@lever.test") === "finanzas,tarjetahabiente", "otorgar desde la ficha vuelve a guardar Finanzas");
  const conFinanzas = await tomas.goto(`${raiz}/consola`);
  exigir(conFinanzas.status() === 200 && (await tomas.locator(".inicio-metricas").count()) === 1, "con Finanzas, Tomás vuelve a ver Inicio");

  // (c) Membresía heredada con solo Finanzas: quitarla no deja a nadie sin rol, el aviso lo dice y la casilla regresa.
  // La aplicación ya no deja crear este estado; se simula como dueño de la base, con su evento de bitácora.
  sql(`
    insert into audit_log (operator_id, company_id, actor_tipo, superficie, accion, entidad, identificador)
      select c.operator_id, c.id, 'sistema', 'sistema', 'simular_membresia_heredada', 'membership_roles', u.id
      from companies c, users u where c.id = '${empresa}' and u.correo = 'tomas@lever.test';
    delete from membership_roles where rol = 'tarjetahabiente'
      and user_id = (select id from users where correo = 'tomas@lever.test');`);
  await laura.reload();
  exigir(await casilla.isChecked(), "la ficha muestra a Tomás con solo Finanzas");
  await casilla.uncheck();
  await bloque.getByRole("button", { name: "Guardar acceso financiero" }).click();
  await bloque.getByText("Finanzas es su único rol y nadie queda sin rol. Dale primero su rol de trabajo.").waitFor();
  exigir(await casilla.isChecked(), "tras el rechazo la casilla regresa a marcada (valor real)");
  await bloque.scrollIntoViewIfNeeded();
  await captura(laura, "06-quitar-unico-rol-rechazado.png", false);

  // (d) Finanzas no abre el teléfono.
  const telefono = await tomas.goto(`${raiz}/telefono`);
  await tomas.getByRole("heading", { name: "No encontramos esta página." }).waitFor();
  exigir(
    telefono.status() === 404 && (await tomas.locator(".telefono").count()) === 0,
    `con solo Finanzas, el teléfono responde 404 con la página de la marca y ningún dato (HTTP ${telefono.status()})`,
  );
  await captura(tomas, "07-finanzas-sin-telefono.png", false);

  // (e) Gráfica a 390 px: mes actual y eje, sin barra de desplazamiento. (f) oscuro.
  await tomas.goto(`${raiz}/consola`);
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
  await movilClaro.addCookies((await admin.cookies()).filter((cookie) => cookie.name !== "tema"));
  await lauraMovil.goto(`${raiz}/consola`);
  await lauraMovil.locator(".grafica-mensual-compacta").evaluate((nodo) => nodo.scrollIntoView({ block: "center" }));
  await captura(lauraMovil, "09-grafica-movil-claro.png", false);
  await movilClaro.close();

  await admin.addCookies([{ name: "tema", value: "oscuro", url: BASE }]);
  await laura.goto(`${raiz}/consola`);
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
