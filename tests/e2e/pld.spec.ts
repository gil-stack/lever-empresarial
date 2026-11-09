import { expect, test } from "@playwright/test";

import { consultar, contar, dobleClic, idDe, sesionDe, vigilarConsola } from "./apoyo";
import { CORREOS } from "./siembra";

/**
 * PLD (Ola R2): Originación declara el perfil transaccional de un prospecto y
 * Aprobación lo ve sin nada de alertas ni casos (55ª); un aviso del personal
 * que menciona a otra persona llega a Cumplimiento, que abre el caso y agrega
 * una nota, mientras la persona mencionada (Aprobación) no ve ni el menú de PLD.
 * Cada envío con doble clic real y conteo en la base.
 */

test.describe.configure({ mode: "serial" });

const CEIBA = { razonSocial: "Ceiba PLD E2E", rfc: "CPE210202AB4" };
let ceiba = "";

test("perfil transaccional: Originación lo declara con doble clic y Aprobación lo ve sin alertas ni casos", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
  await page.goto("/operacion/clientes");
  await page.getByLabel("Razón social").fill(CEIBA.razonSocial);
  await page.getByLabel("RFC").fill(CEIBA.rfc);
  await page.getByLabel("Código postal").fill("64000");
  await dobleClic(page.getByRole("button", { name: "Registrar prospecto" }), { esperar: /\/operacion\/clientes\/[0-9a-f-]{36}\?aviso=prospecto_registrado/ });
  ceiba = new URL(page.url()).pathname.split("/").pop() ?? "";

  await page.goto(`/operacion/clientes/${ceiba}/expediente#perfil-titulo`);
  await page.locator("#perfil-pagos-monto").fill("120,000.00");
  await page.locator("#perfil-pagos-operaciones").fill("15");
  await page.locator("#perfil-nomina-monto").fill("80000");
  await page.locator("#perfil-nomina-operaciones").fill("2");
  const envio = await dobleClic(page.getByRole("button", { name: "Registrar perfil" }), { esperar: /aviso=perfil_declarado/ });
  expect(envio.envios).toBe(1);
  expect(await contar("select 1 from pld_perfiles where company_id = $1", [ceiba])).toBe(1);
  expect(await contar("select 1 from pld_perfiles where company_id = $1 and pagos_monto_mensual_centavos = 12000000", [ceiba])).toBe(1);

  await context.clearCookies();
  await sesionDe(context, CORREOS.op2, { superficie: "sofipo" });
  await page.goto(`/operacion/clientes/${ceiba}/expediente`);
  const perfil = page.locator('section[aria-labelledby="perfil-titulo"]');
  await expect(perfil).toContainText("$120,000.00");
  await expect(page.locator('section[aria-labelledby="evaluacion-titulo"]')).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(/Alertas PLD|Excede el perfil|caso de análisis/);
  expect(errores).toEqual([]);
});

test("aviso del personal: confidencial; Cumplimiento abre el caso y agrega una nota; Aprobación no ve PLD", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  const op2 = await idDe(CORREOS.op2);
  const avisos = () => contar("select 1 from pld_avisos where company_id = $1", [ceiba]);
  expect(await avisos()).toBe(0);

  await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
  await page.goto("/operacion/avisos");
  await page.locator("#aviso-tipo").selectOption("posible_inusual");
  await page.locator("#aviso-empresa").selectOption(ceiba);
  await page.locator("#aviso-descripcion").fill("El representante pidió que el primer pago saliera a la cuenta de un tercero sin relación.");
  await page.locator("#aviso-mencionada").selectOption(op2);
  const envio = await dobleClic(page.getByRole("button", { name: "Enviar aviso" }), { esperar: /aviso=pld_aviso_emitido/ });
  expect(envio.envios).toBe(1);
  expect(await avisos()).toBe(1);
  await expect(page.locator('section[aria-labelledby="acuses-titulo"]')).toContainText("Posible operación inusual de un cliente");

  await context.clearCookies();
  await sesionDe(context, CORREOS.op3, { superficie: "sofipo" });
  await page.goto("/operacion/pld");
  const alerta = page.locator("li", { hasText: `Aviso del personal · ${CEIBA.razonSocial}` });
  await expect(alerta).toContainText("Quedan 60 días");
  await dobleClic(alerta.getByRole("button", { name: "Abrir caso" }), { esperar: /\/operacion\/pld\/casos\/[0-9a-f-]{36}\?aviso=pld_caso_abierto/ });
  expect(await contar("select 1 from pld_casos where company_id = $1", [ceiba])).toBe(1);
  await page.locator("#nota-texto").fill("Pido al representante el contrato con el tercero antes de proponer.");
  await dobleClic(page.getByRole("button", { name: "Agregar nota" }), { esperar: /aviso=pld_nota_agregada/ });
  expect(await contar("select 1 from pld_notas n join pld_casos c on c.id = n.caso_id where c.company_id = $1", [ceiba])).toBe(1);

  // La persona mencionada (op2, Aprobación) no ve el menú de PLD ni la pantalla; sí puede avisar.
  await context.clearCookies();
  await sesionDe(context, CORREOS.op2, { superficie: "sofipo" });
  await page.goto("/operacion");
  const menu = page.locator("nav").first();
  await expect(menu).not.toContainText("Alertas PLD");
  await expect(menu).toContainText("Avisar a Cumplimiento");
  await page.goto("/operacion/pld");
  await expect(page.locator("#sin-permiso-titulo")).toBeVisible();
  await expect(page.locator("main")).not.toContainText(CEIBA.razonSocial);
  expect(errores).toEqual([]);
});

// Décima ronda del #59: una clave repetida (?aviso=a&aviso=b) llega como lista; las páginas de PLD la descartan
// (soloTexto) en lugar de tumbarse con un 500.
test("una clave repetida en la dirección no tumba ninguna página de PLD", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  const [caso] = await consultar<{ id: string }>("select id from pld_casos where company_id = $1", [ceiba]);
  await sesionDe(context, CORREOS.op3, { superficie: "sofipo" });
  for (const ruta of [
    "/operacion/pld", "/operacion/pld/parametros", `/operacion/pld/casos/${caso!.id}`, "/operacion/avisos", "/operacion/comite",
    "/operacion/reportes", "/operacion/conservacion", "/operacion/cumplimiento",
  ]) {
    const respuesta = await page.goto(`${ruta}?aviso=a&aviso=b&en=x&en=y`);
    expect(respuesta?.status(), ruta).toBe(200);
    await expect(page.locator("h1"), ruta).toBeVisible();
  }
  expect(errores).toEqual([]);
});

test.describe("sin JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  // Con Referrer-Policy: same-origin (décima ronda del #59) el envío nativo lleva su Origin y la acción de PLD
  // responde: 303 con su aviso y la nota en la base.
  test("sin JavaScript, agregar una nota al caso responde 303 con su aviso", async ({ page, context }) => {
    const [caso] = await consultar<{ id: string }>("select id from pld_casos where company_id = $1", [ceiba]);
    const notas = () => contar("select 1 from pld_notas where caso_id = $1", [caso!.id]);
    const antes = await notas();
    await sesionDe(context, CORREOS.op3, { superficie: "sofipo" });
    await page.goto(`/operacion/pld/casos/${caso!.id}`);
    await page.locator("#nota-texto").fill("El representante entregó el contrato con el tercero; sigue el análisis.");
    const [envio] = await Promise.all([
      page.waitForResponse((respuesta) => respuesta.request().method() === "POST"),
      page.getByRole("button", { name: "Agregar nota" }).click(),
    ]);
    expect(await envio.request().headerValue("origin")).toBe(new URL(envio.url()).origin);
    expect(envio.status()).toBe(303);
    await page.waitForURL(/aviso=pld_nota_agregada/);
    await expect(page.locator("#aviso-operacion")).toContainText("Nota agregada al análisis.");
    expect(await notas()).toBe(antes + 1);
  });

  // Inventario de la ronda 12: un rechazo de PLD ya no redirige. Sin JavaScript, el servidor pinta la misma página con
  // lo escrito, el campo marcado con el foco (autofocus, sin fragmento: r2-serv-N19) y su mensaje justo debajo. Nada de
  // lo escrito ni el aviso pasan por la dirección.
  test("sin JavaScript, un rechazo de PLD conserva lo escrito, con el foco y su mensaje junto al campo: clave CASFIM, nota y RFC del auditor, a 1440 y 390", async ({ page, context }) => {
    const [caso] = await consultar<{ id: string }>("select id from pld_casos where company_id = $1", [ceiba]);
    const generico = "Revisa el campo marcado: el dato no tiene el formato esperado.";
    const rechazos = [
      {
        ruta: "/operacion/reportes", campo: "#entidad-casfim", boton: /^Registrar claves/, idMensaje: "aviso-entidad-campo", texto: generico,
        escrito: { "#entidad-casfim": "12345", "#entidad-supervisor": "123456" },
        conteo: () => contar("select 1 from pld_entidad"),
        // El navegador no deja enviar algo fuera del patrón de 6 dígitos; sin el patrón, rechaza el servidor.
        antes: () => page.locator("#entidad-casfim").evaluate((campo) => campo.removeAttribute("pattern")),
      },
      {
        ruta: `/operacion/pld/casos/${caso!.id}`, campo: "#nota-texto", boton: "Agregar nota", idMensaje: "aviso-nota-campo",
        texto: "Escribe la nota, con al menos 2 caracteres que se vean.",
        escrito: { "#nota-texto": "a\u3164" },
        conteo: () => contar("select 1 from pld_notas where caso_id = $1", [caso!.id]),
        antes: async () => {},
      },
      {
        ruta: "/operacion/comite", campo: "#auditor-rfc", boton: /^Registrar (otro )?auditor$/, idMensaje: "aviso-auditor-campo", texto: generico,
        escrito: { "#auditor-nombre": "Auditora Sin Script", "#auditor-cargo": "Auditora interna", "#auditor-rfc": "ASS9001", "#auditor-curp": "ASSA900101MDFLRN09" },
        conteo: () => contar("select 1 from pld_comite_auditores"),
        antes: async () => {},
      },
    ];
    await sesionDe(context, CORREOS.op3, { superficie: "sofipo" });
    for (const ancho of [1440, 390]) {
      await page.setViewportSize({ width: ancho, height: ancho < 600 ? 844 : 900 });
      for (const rechazo of rechazos) {
        const donde = `${rechazo.campo} ${ancho}`;
        const antes = await rechazo.conteo();
        await page.goto(rechazo.ruta);
        await rechazo.antes();
        for (const [selector, valor] of Object.entries(rechazo.escrito)) await page.locator(selector).fill(valor);
        const [envio] = await Promise.all([
          page.waitForResponse((respuesta) => respuesta.request().method() === "POST"),
          page.getByRole("button", { name: rechazo.boton }).click(),
        ]);
        expect(envio.status(), donde).toBe(200);
        await page.waitForLoadState();
        const url = new URL(page.url());
        expect(url.pathname + url.search + url.hash, donde).toBe(rechazo.ruta);
        for (const [selector, valor] of Object.entries(rechazo.escrito)) await expect(page.locator(selector), `${donde} ${selector}`).toHaveValue(valor);
        const control = page.locator(rechazo.campo);
        await expect(page.locator(`${rechazo.campo}:focus`), donde).toHaveCount(1);
        await expect(control, donde).toHaveAttribute("aria-invalid", "true");
        await expect(control, donde).toHaveAttribute("aria-describedby", new RegExp(`(^| )${rechazo.idMensaje}$`));
        const mensaje = page.locator(`[id="${rechazo.idMensaje}"]`);
        await expect(mensaje, donde).toHaveText(rechazo.texto);
        // Sin JavaScript nadie desplaza la página: el foco la lleva al campo y el mensaje va justo debajo, a la vista.
        const [cajaCampo, cajaMensaje] = [(await control.boundingBox())!, (await mensaje.boundingBox())!];
        const separacion = cajaMensaje.y - (cajaCampo.y + cajaCampo.height);
        expect(separacion, donde).toBeGreaterThanOrEqual(0);
        expect(separacion, donde).toBeLessThanOrEqual(24);
        expect(cajaMensaje.y + cajaMensaje.height, donde).toBeLessThanOrEqual(page.viewportSize()!.height);
        expect(await rechazo.conteo(), donde).toBe(antes);
      }
    }
  });

  // El manifiesto es una descarga (GET): un periodo rechazado vuelve a Conservación con la empresa y las fechas que se
  // eligieron, sin fragmento (r2-serv-N19) y con el foco en «Desde».
  test("sin JavaScript, el manifiesto con un periodo al revés vuelve con lo elegido, sin fragmento y con el foco en el periodo", async ({ page, context }) => {
    const descargas = () => contar("select 1 from audit_log where accion = 'pld_manifiesto_descargado'");
    const antes = await descargas();
    await sesionDe(context, CORREOS.op3, { superficie: "sofipo" });
    await page.goto("/operacion/conservacion");
    await page.locator("#manifiesto-empresa").selectOption(ceiba);
    await page.locator("#manifiesto-desde").fill("2026-03-01");
    await page.locator("#manifiesto-hasta").fill("2026-02-01");
    const [envio] = await Promise.all([
      page.waitForResponse((respuesta) => respuesta.url().includes("/operacion/conservacion/manifiesto")),
      page.getByRole("button", { name: "Descargar manifiesto" }).click(),
    ]);
    expect(envio.status()).toBe(303);
    await page.waitForURL(/\/operacion\/conservacion\?aviso=periodo_invalido/);
    expect(new URL(page.url()).hash).toBe("");
    await expect(page.locator("#manifiesto-empresa")).toHaveValue(ceiba);
    await expect(page.locator("#manifiesto-desde")).toHaveValue("2026-03-01");
    await expect(page.locator("#manifiesto-hasta")).toHaveValue("2026-02-01");
    await expect(page.locator("#manifiesto-desde:focus")).toHaveCount(1);
    await expect(page.locator('[id="aviso-operacion-campo"]')).toHaveText("Revisa el periodo.");
    expect(await descargas()).toBe(antes);
  });
});
