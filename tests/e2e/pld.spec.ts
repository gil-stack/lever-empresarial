import { expect, type Locator, type Page, test } from "@playwright/test";

import { consultar, contar, dobleClic, idDe, llegaSinScript, sesionDe, vigilarConsola } from "./apoyo";
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
    // Las llaves que trae todo objeto de JavaScript no son avisos: ni 500 ni el texto de una función en la página.
    for (const clave of ["constructor", "__proto__", "toString"]) {
      const conClave = await page.goto(`${ruta}?aviso=${clave}`);
      expect(conClave?.status(), `${ruta} ?aviso=${clave}`).toBe(200);
      await expect(page.locator("h1"), `${ruta} ?aviso=${clave}`).toBeVisible();
      await expect(page.locator("main"), `${ruta} ?aviso=${clave}`).not.toContainText(/\[native code\]|\[object Object\]|function /);
    }
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
  // lo escrito y el campo marcado. Sexta vuelta (decisión del líder): la dirección lleva el fragmento del mensaje, que va
  // entre la etiqueta y el control; el mensaje y el campo quedan bajo las barras y el primer Tab entra al campo. Nada de
  // lo escrito ni el aviso pasan por la dirección.
  test("sin JavaScript, un rechazo de PLD conserva lo escrito y llega al mensaje junto al campo (fragmento, bajo las barras, primer Tab): clave CASFIM, nota y RFC del auditor, a 1440 y 390", async ({ page, context }) => {
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
        texto: "Escribe la nota, entre 2 y 4,000 caracteres que se vean.",
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
        expect(url.pathname + url.search, donde).toBe(rechazo.ruta);
        for (const [selector, valor] of Object.entries(rechazo.escrito)) await expect(page.locator(selector), `${donde} ${selector}`).toHaveValue(valor);
        const control = page.locator(rechazo.campo);
        await expect(control, donde).toHaveAttribute("aria-invalid", "true");
        await expect(control, donde).toHaveAttribute("aria-describedby", new RegExp(`(^| )${rechazo.idMensaje}$`));
        const mensaje = page.locator(`[id="${rechazo.idMensaje}"]`);
        await expect(mensaje, donde).toHaveText(rechazo.texto);
        // El mensaje va entre la etiqueta y el control (como en el #59), justo arriba de él.
        const [cajaCampo, cajaMensaje] = [(await control.boundingBox())!, (await mensaje.boundingBox())!];
        const separacion = cajaCampo.y - (cajaMensaje.y + cajaMensaje.height);
        expect(separacion, donde).toBeGreaterThanOrEqual(0);
        expect(separacion, donde).toBeLessThanOrEqual(24);
        await llegaSinScript(page, rechazo.campo, rechazo.idMensaje, donde);
        expect(await rechazo.conteo(), donde).toBe(antes);
      }
    }
  });

  // El manifiesto es una descarga (GET): un periodo rechazado vuelve a Conservación con la empresa y las fechas que se
  // eligieron. Sexta vuelta: la redirección lleva el fragmento del mensaje del campo (fragmentoDelError) y el primer Tab
  // entra a «Desde».
  test("sin JavaScript, el manifiesto con un periodo al revés vuelve con lo elegido y llega al mensaje del periodo (fragmento, primer Tab)", async ({ page, context }) => {
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
    await expect(page.locator("#manifiesto-empresa")).toHaveValue(ceiba);
    await expect(page.locator("#manifiesto-desde")).toHaveValue("2026-03-01");
    await expect(page.locator("#manifiesto-hasta")).toHaveValue("2026-02-01");
    await expect(page.locator('[id="aviso-operacion-campo"]')).toHaveText("Revisa el periodo.");
    await llegaSinScript(page, "#manifiesto-desde", "aviso-operacion-campo", "periodo");
    expect(await descargas()).toBe(antes);
  });

  // r2-serv-N24: la página y el cursor se revisan antes de la base. Una página 0, una fecha que no es la de «siguiente» o
  // un documento que no es un identificador vuelven a Conservación con lo capturado y el aviso en su campo, al que se
  // llega por el fragmento (el primer Tab entra al campo); la bitácora no registra una descarga.
  test("sin JavaScript, una página o un cursor que no sirven vuelven con el aviso en su campo, se llega a él y no hay descarga", async ({ page, context }) => {
    const descargas = () => contar("select 1 from audit_log where accion = 'pld_manifiesto_descargado'");
    const antes = await descargas();
    await sesionDe(context, CORREOS.op3, { superficie: "sofipo" });
    const casos = [
      { pagina: "0", despuesEn: "", despuesId: "", campo: "#manifiesto-pagina", codigo: "manifiesto_pagina_invalida", texto: "Escribe la página que dice «siguiente», un número desde 1. La página 1 va sin «después de»." },
      { pagina: "2", despuesEn: "ayer", despuesId: "0b6d3f8e-6c1a-4c1e-9d2a-3f4b5c6d7e8f", campo: "#manifiesto-despues-en", codigo: "manifiesto_despues_en_invalido", texto: "De la página 2 en adelante, copia la fecha y hora de «siguiente» tal como viene, con sus decimales." },
      { pagina: "2", despuesEn: "2026-03-01T18:00:00.001999Z", despuesId: "no-es-un-documento", campo: "#manifiesto-despues-id", codigo: "manifiesto_despues_id_invalido", texto: "De la página 2 en adelante, copia el documento de «siguiente» tal como viene." },
    ];
    for (const caso of casos) {
      await page.goto("/operacion/conservacion");
      await page.locator("#manifiesto-empresa").selectOption(ceiba);
      await page.locator("#manifiesto-desde").fill("2026-02-01");
      await page.locator("#manifiesto-hasta").fill("2026-03-01");
      await page.getByText("Continuar un manifiesto de varias páginas").click();
      await page.locator("#manifiesto-pagina").fill(caso.pagina);
      await page.locator("#manifiesto-despues-en").fill(caso.despuesEn);
      await page.locator("#manifiesto-despues-id").fill(caso.despuesId);
      const [envio] = await Promise.all([
        page.waitForResponse((respuesta) => respuesta.url().includes("/operacion/conservacion/manifiesto")),
        page.getByRole("button", { name: "Descargar manifiesto" }).click(),
      ]);
      expect(envio.status(), caso.codigo).toBe(303);
      await page.waitForURL(new RegExp(`/operacion/conservacion\\?aviso=${caso.codigo}`));
      await expect(page.locator("#manifiesto-empresa"), caso.codigo).toHaveValue(ceiba);
      await expect(page.locator("#manifiesto-pagina"), caso.codigo).toHaveValue(caso.pagina);
      await expect(page.locator("#manifiesto-despues-en"), caso.codigo).toHaveValue(caso.despuesEn);
      await expect(page.locator("#manifiesto-despues-id"), caso.codigo).toHaveValue(caso.despuesId);
      await expect(page.locator(caso.campo), caso.codigo).toHaveAttribute("aria-invalid", "true");
      await expect(page.locator('[id="aviso-operacion-campo"]'), caso.codigo).toHaveText(caso.texto);
      await llegaSinScript(page, caso.campo, "aviso-operacion-campo", caso.codigo);
    }
    expect(await descargas()).toBe(antes);
  });

  // B (25ª): la bandeja de Cumplimiento enlaza al perfil del expediente. Sin JavaScript, quien entra por ese enlace y ve
  // rechazado el formulario del perfil llega al mensaje del campo por el fragmento de la respuesta, aunque el enlace
  // traiga el suyo, y el primer Tab entra al campo.
  test("sin JavaScript, quien entra al perfil por un enlace de la bandeja y ve su formulario rechazado llega al campo", async ({ page, context }) => {
    const [fresno] = await consultar<{ id: string }>(
      `with alta as (
         insert into companies (id, rfc, razon_social, codigo_postal, regimen, uso_cfdi, operator_id, estado, demostracion)
         values (gen_random_uuid(), 'FPE200303AB5', 'Fresno PLD E2E', '06600', '601', 'G03', (select id from operators order by alta_en limit 1), 'activa', false)
         returning id, operator_id)
       insert into audit_log (operator_id, company_id, actor_tipo, superficie, accion, entidad, identificador)
       select operator_id, id, 'sistema', 'sistema', 'alta_empresa', 'companies', id from alta returning company_id as id`,
    );
    const empresa = fresno!.id;
    const enviarRechazado = async (boton: string) => {
      const [envio] = await Promise.all([
        page.waitForResponse((respuesta) => respuesta.request().method() === "POST"),
        page.getByRole("button", { name: boton }).click(),
      ]);
      expect(envio.status(), boton).toBe(200);
      await page.waitForLoadState();
    };

    // Empresa activa sin perfil: Cumplimiento la ve en la bandeja; Originación entra por ese enlace y propone.
    await sesionDe(context, CORREOS.op3, { superficie: "sofipo" });
    await page.goto("/operacion/cumplimiento");
    const sinPerfil = page.locator('section[aria-labelledby="pld-sin-perfil-titulo"]').getByRole("link", { name: "Fresno PLD E2E" });
    const enlace = await sinPerfil.getAttribute("href");
    expect(enlace).toMatch(new RegExp(`^/operacion/clientes/${empresa}/expediente`));
    await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
    await page.goto(enlace!);
    await page.locator("#perfil-pagos-monto").fill("80,000.00");
    await page.locator("#perfil-pagos-operaciones").fill("8");
    await page.locator("#perfil-nomina-monto").fill("noventa mil");
    await page.locator("#perfil-nomina-operaciones").fill("2");
    await page.locator("#perfil-motivo").fill("Cliente que operaba antes del registro de perfiles.");
    await enviarRechazado("Proponer el cambio a Cumplimiento");
    await expect(page.locator("#perfil-nomina-monto")).toHaveValue("noventa mil");
    await expect(page.locator("#perfil-nomina-monto")).toHaveAttribute("aria-invalid", "true");
    await llegaSinScript(page, "#perfil-nomina-monto", "aviso-perfil-campo", "monto rechazado");
    expect(await contar("select 1 from pld_perfil_propuestas where company_id = $1", [empresa])).toBe(0);

    // Con la propuesta, Cumplimiento entra por «Por resolver» y su resolución se rechaza: el foco va al motivo.
    await page.locator("#perfil-nomina-monto").fill("90,000.00");
    const [propuesta] = await Promise.all([
      page.waitForResponse((respuesta) => respuesta.request().method() === "POST"),
      page.getByRole("button", { name: "Proponer el cambio a Cumplimiento" }).click(),
    ]);
    expect(propuesta.status()).toBe(303);
    expect(await contar("select 1 from pld_perfil_propuestas where company_id = $1", [empresa])).toBe(1);
    await sesionDe(context, CORREOS.op3, { superficie: "sofipo" });
    await page.goto("/operacion/cumplimiento");
    await page.locator("li", { hasText: "Por resolver" }).getByRole("link", { name: "Fresno PLD E2E" }).click();
    await page.waitForURL(new RegExp(`/operacion/clientes/${empresa}/expediente`));
    // «Revisar» con tres U+3164 pasa el mínimo del navegador (10) y el servidor cuenta 7 que se ven.
    await page.locator("#perfil-resolucion-motivo").fill("Revisar\u3164\u3164\u3164");
    await enviarRechazado("Aprobar el cambio");
    await expect(page.locator("#perfil-resolucion-motivo")).toHaveAttribute("aria-invalid", "true");
    await llegaSinScript(page, "#perfil-resolucion-motivo", "aviso-resolucion-campo", "motivo rechazado");
    expect(await contar("select 1 from pld_perfil_resoluciones where company_id = $1", [empresa])).toBe(0);
  });
});

// r2-fix3-N3 (60ª): un caso cuyo aviso excluye a alguien del personal se vota en su propia sesión del Comité. En la
// sesión que ya votó un caso sin reserva, votarlo dice «Este caso va en otra sesión del Comité.», sin nombrar a nadie ni
// decir por qué, y no queda el voto.
test("Comité: un caso con reserva no se vota en la sesión de un caso sin reserva, y la pantalla no dice por qué", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  // Otro aviso sobre Ceiba, ahora sin mencionar a nadie: su caso no excluye a nadie.
  await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
  await page.goto("/operacion/avisos");
  await page.locator("#aviso-tipo").selectOption("posible_inusual");
  await page.locator("#aviso-empresa").selectOption(ceiba);
  await page.locator("#aviso-descripcion").fill("Tres pagos seguidos a un proveedor recién dado de alta, sin factura de por medio.");
  await dobleClic(page.getByRole("button", { name: "Enviar aviso" }), { esperar: /aviso=pld_aviso_emitido/ });

  await context.clearCookies();
  await sesionDe(context, CORREOS.op3, { superficie: "sofipo" });
  await page.goto("/operacion/pld");
  await dobleClic(page.locator("li", { hasText: `Aviso del personal · ${CEIBA.razonSocial}` }).getByRole("button", { name: "Abrir caso" }),
    { esperar: /\/operacion\/pld\/casos\/[0-9a-f-]{36}\?aviso=pld_caso_abierto/ });
  const sinReserva = new URL(page.url()).pathname.split("/").pop() ?? "";
  const [conReserva] = await consultar<{ id: string }>(
    `select distinct c.id from pld_casos c join pld_caso_alertas ca on ca.caso_id = c.id join pld_alertas a on a.id = ca.alerta_id
     join pld_aviso_excluidos e on e.aviso_id = a.aviso_id where c.company_id = $1`, [ceiba]);
  for (const casoId of [sinReserva, conReserva!.id]) {
    await page.goto(`/operacion/pld/casos/${casoId}#propuesta-titulo`);
    await page.locator("#propuesta-propuesta").selectOption("no_reportar");
    await page.locator("#propuesta-justificacion").fill("El representante entregó el contrato y los pagos corresponden a su giro.");
    await dobleClic(page.getByRole("button", { name: "Registrar propuesta" }), { esperar: /aviso=pld_propuesta_registrada/ });
  }

  // Tres titulares del Comité (con su Oficial) y una sesión con los tres presentes.
  const integrantes = [
    { nombres: "Pedro", primer: "Ramos", segundo: "Luna", cargo: "PRESIDENTE", rfc: "RALP700101AB1", curp: "RALP700101HDFMNDA1", area: "Direccion General", puesto: "Director general" },
    { nombres: "Sofia", primer: "Torres", segundo: "Diaz", cargo: "SECRETARIO", rfc: "TODS750202AB2", curp: "TODS750202MDFRZFA2", area: "Juridico", puesto: "Directora juridica" },
    { nombres: "Celia", primer: "Morales", segundo: "Vega", cargo: "INTEGRANTE", rfc: "MOVC800303AB3", curp: "MOVC800303MDFRGLA3", area: "Cumplimiento", puesto: "Oficial de Cumplimiento" },
  ];
  await page.goto("/operacion/comite#integrantes-titulo");
  for (const [i, persona] of integrantes.entries()) {
    await page.locator(`#integrante-nombres-${i}`).fill(persona.nombres);
    await page.locator(`#integrante-primer-${i}`).fill(persona.primer);
    await page.locator(`#integrante-segundo-${i}`).fill(persona.segundo);
    await page.locator(`#integrante-cargo-${i}`).selectOption(persona.cargo);
    await page.locator(`#integrante-titularidad-${i}`).selectOption("TITULAR");
    await page.locator(`#integrante-rfc-${i}`).fill(persona.rfc);
    await page.locator(`#integrante-curp-${i}`).fill(persona.curp);
    await page.locator(`#integrante-area-${i}`).fill(persona.area);
    await page.locator(`#integrante-cargo-entidad-${i}`).fill(persona.puesto);
    await page.locator(`#integrante-designado-${i}`).fill(hoy);
  }
  await page.locator('input[name="esOficial-2"]').check();
  await dobleClic(page.getByRole("button", { name: "Registrar en el Comité" }), { esperar: /aviso=pld_integrantes_registrados/ });
  await page.goto("/operacion/comite#sesiones-titulo");
  await page.locator("#sesion-fecha").fill(hoy);
  for (const persona of integrantes) await page.getByLabel(new RegExp(`${persona.nombres} ${persona.primer} ${persona.segundo} · `, "i")).check();
  await dobleClic(page.getByRole("button", { name: "Registrar sesión" }), { esperar: /\/operacion\/comite\/sesiones\/[0-9a-f-]{36}\?aviso=pld_sesion_registrada/ });
  const sesion = new URL(page.url()).pathname.split("/").pop() ?? "";

  // El caso sin reserva se vota; el que excluye a alguien ya no entra a esta sesión.
  const tema = (casoId: string) => page.locator('section[aria-labelledby="votaciones-titulo"] > ul > li').filter({ has: page.locator(`a[href="/operacion/pld/casos/${casoId}"]`) });
  const votos = (casoId: string) => contar("select 1 from pld_votos where sesion_id = $1 and caso_id = $2", [sesion, casoId]);
  await dobleClic(tema(sinReserva).getByRole("button", { name: /Pedro Ramos Luna vota a favor/i }), { esperar: /aviso=pld_voto_registrado/ });
  expect(await votos(sinReserva)).toBe(1);
  await tema(conReserva!.id).getByRole("button", { name: /Pedro Ramos Luna vota a favor/i }).click();
  await page.waitForURL(/aviso=sesion_con_otra_reserva/);
  await expect(page.locator("#aviso-operacion")).toHaveText(/^\s*Este caso va en otra sesión del Comité\.\s*$/);
  const [mencionada] = await consultar<{ nombre: string }>("select nombre from users where correo = $1", [CORREOS.op2]);
  await expect(page.locator("#aviso-operacion")).not.toContainText(mencionada!.nombre);
  expect(await votos(conReserva!.id)).toBe(0);
  expect(errores).toEqual([]);
});

// ── Doceava del #59 en PLD: r2-serv-N20 (sin fragmento y sin el aviso viejo), r2-serv-N21 (rechazo sin formulario) y B5
// (destinos de fragmento con sufijo en la respuesta a un envío sin JavaScript).

/** Fecha y hora de Ciudad de México para un campo datetime-local, un minuto antes de ahora (el máximo es «ahora»). */
function ahoraParaCampo(): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(Date.now() - 60_000));
  const de = (tipo: string) => partes.find((parte) => parte.type === tipo)!.value;
  return `${de("year")}-${de("month")}-${de("day")}T${de("hour")}:${de("minute")}`;
}

function mananaEnMexico(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + 86_400_000));
}

/** Los casos de Ceiba sin dictamen, del más viejo al más nuevo. */
async function casosAbiertos(): Promise<string[]> {
  const filas = await consultar<{ id: string }>(
    "select c.id from pld_casos c where c.company_id = $1 and not exists (select 1 from pld_dictamenes d where d.caso_id = c.id) order by c.registrado_en, c.id",
    [ceiba],
  );
  return filas.map((fila) => fila.id);
}

/** Envía y espera la respuesta del POST (sin JavaScript: 200 si se rechaza, 303 si se aplica). */
async function enviarPost(page: Page, boton: Locator): Promise<number> {
  const [respuesta] = await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), boton.click()]);
  await page.waitForLoadState();
  return respuesta.status();
}

/**
 * Lo que N20 revisa tras el rechazo de la propuesta: sin el aviso de la nota arriba y con el suyo. Con JavaScript, el
 * foco en su campo y la dirección sin fragmento; sin JavaScript, el fragmento de su mensaje y el primer Tab en el campo.
 */
async function propuestaRechazadaSinAvisoViejo(page: Page, donde: string, conScript: boolean) {
  await expect(page.locator("#propuesta-justificacion"), donde).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#aviso-propuesta"), donde).toBeVisible();
  await expect(page.locator("#aviso-operacion"), `${donde}: el aviso de la nota ya no va arriba`).toHaveCount(0);
  await expect(page.locator("#aviso-rechazo"), `${donde}: el formulario muestra su aviso`).toBeHidden();
  if (conScript) {
    await expect(page.locator("#propuesta-justificacion:focus"), `${donde}: foco en la justificación`).toHaveCount(1);
    expect(new URL(page.url()).hash, donde).toBe("");
  } else {
    await llegaSinScript(page, "#propuesta-justificacion", "aviso-propuesta-campo", donde);
  }
}

// r2-serv-N20: una nota que se agrega deja su aviso arriba; si después la propuesta (otra tarjeta) se rechaza, ese aviso
// ya no aplica y el foco va al campo rechazado. Rojo con el `listo` de antes (fragmento #notas-titulo) y sin el aviso
// vigente del #59 en los formularios de PLD.
test("r2-serv-N20 con JavaScript: tras agregar una nota, la propuesta rechazada quita el aviso de la nota y deja el foco en su campo", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  const [caso] = await casosAbiertos();
  await sesionDe(context, CORREOS.op3, { superficie: "sofipo" });
  await page.goto(`/operacion/pld/casos/${caso}`);
  await page.locator("#nota-texto").fill("Antes de proponer, el contrato con el tercero ya está en el expediente.");
  await page.getByRole("button", { name: "Agregar nota" }).click();
  await page.waitForURL(/aviso=pld_nota_agregada/);
  expect(new URL(page.url()).hash).toBe("");
  await expect(page.locator("#aviso-operacion")).toContainText("Nota agregada al análisis.");
  await page.locator("#propuesta-propuesta").selectOption("no_reportar");
  // «Revisar» con tres U+3164 pasa el mínimo del navegador (10) y el servidor cuenta 7 que se ven.
  await page.locator("#propuesta-justificacion").fill("Revisarㅤㅤㅤ");
  await page.getByRole("button", { name: "Registrar propuesta" }).click();
  await propuestaRechazadaSinAvisoViejo(page, "con JavaScript", true);
  // Un solo campo marcado a la vez (regla del #59, useAvisoVigente): si ahora se rechaza la nota, el aviso de la
  // propuesta se descarta y lo escrito en ella se queda.
  await page.locator("#nota-texto").fill("aㅤ");
  await page.getByRole("button", { name: "Agregar nota" }).click();
  await expect(page.locator("#nota-texto")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#nota-texto:focus")).toHaveCount(1);
  await expect(page.locator("#aviso-propuesta"), "el aviso de la propuesta se descarta").toHaveCount(0);
  await expect(page.locator("#propuesta-justificacion")).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#propuesta-justificacion")).toHaveValue("Revisarㅤㅤㅤ");
  expect(errores).toEqual([]);
});

test.describe("doceava del #59 sin JavaScript, antes de cambiar quién dictamina", () => {
  test.use({ javaScriptEnabled: false });

  test("r2-serv-N20 sin JavaScript: tras agregar una nota, la propuesta rechazada no pinta el aviso de la nota y se llega a su campo", async ({ page, context }) => {
    const [caso] = await casosAbiertos();
    await sesionDe(context, CORREOS.op3, { superficie: "sofipo" });
    await page.goto(`/operacion/pld/casos/${caso}`);
    await page.locator("#nota-texto").fill("Segunda nota antes de proponer, sin JavaScript.");
    expect(await enviarPost(page, page.getByRole("button", { name: "Agregar nota" }))).toBe(303);
    await page.waitForURL(/aviso=pld_nota_agregada/);
    await expect(page.locator("#aviso-operacion")).toContainText("Nota agregada al análisis.");
    await page.locator("#propuesta-propuesta").selectOption("no_reportar");
    await page.locator("#propuesta-justificacion").fill("Revisarㅤㅤㅤ");
    expect(await enviarPost(page, page.getByRole("button", { name: "Registrar propuesta" }))).toBe(200);
    await propuestaRechazadaSinAvisoViejo(page, "sin JavaScript", false);
  });

  // B5: quien llega por un enlace con fragmento (bandeja, Comité) y ve su formulario rechazado llega a su campo: la
  // respuesta trae el fragmento del mensaje (permalinkDelRechazo) en lugar del del enlace, y la página pinta el destino
  // del enlace con sufijo (idDeAncla del #59).
  test("B5 sin JavaScript: llegando por #evaluacion-titulo, #sesiones-titulo, #comunicaciones-titulo y #reporte-<r>-<p>, el rechazo lleva a su campo", async ({ page, context }) => {
    await sesionDe(context, CORREOS.op3, { superficie: "sofipo" });
    await page.goto("/operacion/reportes");
    // Sin las claves de la entidad, el acuse de la 36ª se rechaza por eso (falta_clave_entidad) y no por su folio.
    await page.locator("#entidad-casfim").fill("123456");
    await page.locator("#entidad-supervisor").fill("654321");
    expect(await enviarPost(page, page.getByRole("button", { name: /^Registrar claves/ }))).toBe(303);
    await page.waitForURL(/aviso=pld_entidad_registrada/);
    const periodico = page.locator("li", { has: page.getByRole("button", { name: "Registrar envío" }) }).first();
    const anclaPeriodico = (await periodico.getAttribute("id"))!;
    expect(anclaPeriodico).toMatch(/^reporte-36-\d{6}$/);
    const destinos = [
      {
        ruta: `/operacion/clientes/${ceiba}/expediente`, ancla: "evaluacion-titulo", campo: "#evaluacion-justificacion", boton: page.getByRole("button", { name: "Registrar evaluación" }),
        llenar: async () => {
          await page.locator('input[name="perfil"][value="mantiene"]').check();
          await page.locator("#evaluacion-justificacion").fill("Revisarㅤㅤㅤ");
        },
      },
      {
        ruta: "/operacion/comite", ancla: "sesiones-titulo", campo: "#sesion-fecha", boton: page.getByRole("button", { name: "Registrar sesión" }),
        llenar: async () => {
          // El navegador no deja una fecha futura (max); sin el máximo, la rechaza el servidor.
          await page.locator("#sesion-fecha").evaluate((campo) => campo.removeAttribute("max"));
          await page.locator("#sesion-fecha").fill(mananaEnMexico());
          await page.locator('input[name="presentes"]').first().check();
        },
      },
      {
        ruta: "/operacion/comite", ancla: "comunicaciones-titulo", campo: "#comunicacion-folio", boton: page.getByRole("button", { name: "Registrar comunicación" }),
        llenar: async () => {
          await page.locator("#comunicacion-folio").fill("SITI​2026");
          await page.locator("#comunicacion-recibido").fill(ahoraParaCampo());
        },
      },
      {
        ruta: "/operacion/reportes", ancla: anclaPeriodico, campo: `[id="${anclaPeriodico}-folio"]`,
        boton: page.locator(`[id="${anclaPeriodico}"]`).getByRole("button", { name: "Registrar envío" }),
        llenar: async () => {
          await page.locator(`[id="${anclaPeriodico}-folio"]`).fill("REL​2026");
          await page.locator(`[id="${anclaPeriodico}-recibido"]`).fill(ahoraParaCampo());
        },
      },
    ];
    for (const destino of destinos) {
      await page.goto(`${destino.ruta}#${destino.ancla}`);
      await destino.llenar();
      expect(await enviarPost(page, destino.boton), destino.ancla).toBe(200);
      await expect(page.locator(destino.campo), destino.ancla).toHaveAttribute("aria-invalid", "true");
      await llegaSinScript(page, destino.campo, "", destino.ancla);
      await expect(page.locator(`[id="${destino.ancla}"]`), `${destino.ancla}: el destino lleva sufijo`).toHaveCount(0);
      const ids = await page.locator(`[id^="${destino.ancla}-"]`).evaluateAll((nodos) => nodos.map((nodo) => nodo.id));
      expect(ids.some((id) => new RegExp(`^${destino.ancla}-[0-9a-f]{8}$`).test(id)), `${destino.ancla}: ${ids.join(", ")}`).toBe(true);
    }
  });

  // r2-serv-N22: con tope + 1 (sin el maxlength del navegador: lo mismo que un POST directo), el aviso dice el rango
  // completo y no solo el mínimo, el campo queda marcado y no se guarda nada.
  test("r2-serv-N22 sin JavaScript: con tope + 1 en nota, aviso, área, cargo, nombres y nombre del auditor, el aviso dice el rango", async ({ page, context }) => {
    const [caso] = await casosAbiertos();
    const largo = (n: number) => "a".repeat(n);
    const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const integrante = (cambios: Record<string, string>) => async () => {
      const campos: Record<string, string> = {
        "#integrante-nombres-0": "Ramiro", "#integrante-primer-0": "Vega", "#integrante-segundo-0": "Lara", "#integrante-rfc-0": "VELR800101AB4",
        "#integrante-curp-0": "VELR800101HDFGRM04", "#integrante-area-0": "Finanzas", "#integrante-cargo-entidad-0": "Director de finanzas",
        "#integrante-designado-0": hoy, ...cambios,
      };
      await page.locator("#integrante-cargo-0").selectOption("INTEGRANTE");
      await page.locator("#integrante-titularidad-0").selectOption("TITULAR");
      for (const [selector, valor] of Object.entries(campos)) await page.locator(selector).fill(valor);
    };
    const casosDePrueba = [
      {
        quien: CORREOS.op3, ruta: `/operacion/pld/casos/${caso}`, campo: "#nota-texto", boton: /^Agregar nota$/,
        texto: "Escribe la nota, entre 2 y 4,000 caracteres que se vean.",
        llenar: async () => page.locator("#nota-texto").fill(largo(4001)),
        conteo: () => contar("select 1 from pld_notas"),
      },
      {
        quien: CORREOS.op1, ruta: "/operacion/avisos", campo: "#aviso-descripcion", boton: /^Enviar aviso$/,
        texto: "Describe lo que viste, entre 20 y 4,000 caracteres que se vean.",
        llenar: async () => {
          await page.locator("#aviso-tipo").selectOption("posible_inusual");
          await page.locator("#aviso-descripcion").fill(largo(4001));
        },
        conteo: () => contar("select 1 from pld_avisos"),
      },
      {
        quien: CORREOS.op3, ruta: "/operacion/comite", campo: "#integrante-area-0", boton: /^Registrar en el Comité$/,
        texto: "Escribe el área de la entidad, entre 1 y 120 caracteres.", llenar: integrante({ "#integrante-area-0": largo(121) }),
        conteo: () => contar("select 1 from pld_comite_integrantes"),
      },
      {
        quien: CORREOS.op3, ruta: "/operacion/comite", campo: "#integrante-cargo-entidad-0", boton: /^Registrar en el Comité$/,
        texto: "Escribe el cargo en la entidad, entre 1 y 120 caracteres.", llenar: integrante({ "#integrante-cargo-entidad-0": largo(121) }),
        conteo: () => contar("select 1 from pld_comite_integrantes"),
      },
      {
        quien: CORREOS.op3, ruta: "/operacion/comite", campo: "#integrante-nombres-0", boton: /^Registrar en el Comité$/,
        texto: "Escribe el nombre o los nombres, sin abreviaturas, entre 1 y 80 caracteres.", llenar: integrante({ "#integrante-nombres-0": largo(81) }),
        conteo: () => contar("select 1 from pld_comite_integrantes"),
      },
      {
        quien: CORREOS.op3, ruta: "/operacion/comite", campo: "#auditor-nombre", boton: /^Registrar (otro )?auditor$/,
        texto: "Escribe el nombre completo del auditor, entre 1 y 200 caracteres.",
        llenar: async () => {
          await page.locator("#auditor-nombre").fill(largo(201));
          await page.locator("#auditor-cargo").fill("Auditora interna");
          await page.locator("#auditor-rfc").fill("AUIA900101AB1");
          await page.locator("#auditor-curp").fill("AUIA900101MDFLRN09");
        },
        conteo: () => contar("select 1 from pld_comite_auditores"),
      },
    ];
    for (const prueba of casosDePrueba) {
      await sesionDe(context, prueba.quien, { superficie: "sofipo" });
      const antes = await prueba.conteo();
      await page.goto(prueba.ruta);
      await page.locator(prueba.campo).evaluate((campo) => campo.removeAttribute("maxlength"));
      await prueba.llenar();
      expect(await enviarPost(page, page.getByRole("button", { name: prueba.boton })), prueba.campo).toBe(200);
      await expect(page.locator(prueba.campo), prueba.campo).toHaveAttribute("aria-invalid", "true");
      const mensaje = page.locator(`[id="${(await page.locator(prueba.campo).getAttribute("aria-describedby"))!.split(" ").pop()}"]`);
      await expect(mensaje, prueba.campo).toHaveText(prueba.texto);
      expect(await prueba.conteo(), prueba.campo).toBe(antes);
    }
  });
});

// r2-serv-N21: si otra pestaña ya registró el dictamen o el periódico, el formulario deja de pintarse y su aviso se iría
// con él. El rechazo va en la cookie de `rechazado` (#59) y la página lo pinta arriba (#aviso-rechazo).
async function rechazoSinFormulario(page: Page, texto: RegExp, donde: string) {
  await expect(page.locator("#aviso-rechazo"), donde).toBeVisible();
  await expect(page.locator("#aviso-rechazo"), donde).toContainText(texto);
}

async function dictamenEnDosPestanas(page: Page, otra: Page, caso: string, resultado: string, enviar: (pestana: Page) => Promise<void>) {
  for (const pestana of [page, otra]) {
    await pestana.goto(`/operacion/pld/casos/${caso}`);
    await pestana.locator("#dictamen-resultado").selectOption(resultado);
    await pestana.locator("#dictamen-justificacion").fill("Los pagos al tercero no corresponden al giro declarado por la empresa.");
  }
  await enviar(otra);
  await otra.waitForURL(/aviso=pld_dictamen_registrado/);
  await enviar(page);
}

async function constanciaEnDosPestanas(page: Page, otra: Page, enviar: (pestana: Page, boton: Locator) => Promise<void>): Promise<string> {
  await page.goto("/operacion/reportes");
  const ancla = (await page.locator("li", { has: page.getByRole("button", { name: "Registrar constancia" }) }).first().getAttribute("id"))!;
  expect(ancla).toMatch(/^reporte-38-\d{6}$/);
  await otra.goto("/operacion/reportes");
  await enviar(otra, otra.locator(`[id="${ancla}"]`).getByRole("button", { name: "Registrar constancia" }));
  await otra.waitForURL(/aviso=pld_periodico_registrado/);
  await enviar(page, page.locator(`[id="${ancla}"]`).getByRole("button", { name: "Registrar constancia" }));
  return ancla;
}

// Para dictaminar sin sesión del Comité: quien dictamina pasa a ser el Oficial de Cumplimiento (op3).
test("quién dictamina: Cumplimiento elige al Oficial para los dictámenes que siguen", async ({ page, context }) => {
  await sesionDe(context, CORREOS.op3, { superficie: "sofipo" });
  await page.goto("/operacion/comite");
  await page.locator('input[name="modo"][value="oficial"]').check();
  await page.locator("#modo-oficial").selectOption(await idDe(CORREOS.op3));
  await page.locator("#modo-motivo").fill("El Oficial dictamina mientras el Comité termina de integrarse.");
  await page.getByRole("button", { name: "Guardar quién dictamina" }).click();
  await page.waitForURL(/aviso=pld_modo_cambiado/);
});

test("r2-serv-N21 con JavaScript: el dictamen y la constancia 38ª que otra pestaña ya registró se rechazan con el aviso arriba", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  await sesionDe(context, CORREOS.op3, { superficie: "sofipo" });
  const [caso] = await casosAbiertos();
  const otra = await context.newPage();
  await dictamenEnDosPestanas(page, otra, caso!, "reportar_inusual", (pestana) => pestana.getByRole("button", { name: "Registrar dictamen" }).click());
  await rechazoSinFormulario(page, /El caso ya tiene dictamen/, "dictamen con JavaScript");
  await expect(page.locator("#dictamen-justificacion")).toHaveCount(0);
  expect(await contar("select 1 from pld_dictamenes where caso_id = $1", [caso])).toBe(1);

  const ancla = await constanciaEnDosPestanas(page, otra, (_pestana, boton) => boton.click());
  await rechazoSinFormulario(page, /Ese reporte ya tiene su envío registrado/, "38ª con JavaScript");
  await expect(page.locator(`[id="${ancla}"]`).getByRole("button", { name: "Registrar constancia" })).toHaveCount(0);
  await otra.close();
  expect(errores).toEqual([]);
});

test.describe("doceava del #59 sin JavaScript, con el Oficial dictaminando", () => {
  test.use({ javaScriptEnabled: false });

  test("r2-serv-N21 sin JavaScript: el dictamen y la constancia 38ª que otra pestaña ya registró se rechazan con el aviso arriba", async ({ page, context }) => {
    await sesionDe(context, CORREOS.op3, { superficie: "sofipo" });
    const [caso] = await casosAbiertos();
    const otra = await context.newPage();
    const estados: number[] = [];
    const enviar = async (pestana: Page, boton: Locator) => { estados.push(await enviarPost(pestana, boton)); };
    await dictamenEnDosPestanas(page, otra, caso!, "reportar_inusual", (pestana) => enviar(pestana, pestana.getByRole("button", { name: "Registrar dictamen" })));
    expect(estados).toEqual([303, 200]);
    await rechazoSinFormulario(page, /El caso ya tiene dictamen/, "dictamen sin JavaScript");
    await expect(page.locator("#dictamen-justificacion")).toHaveCount(0);
    expect(await contar("select 1 from pld_dictamenes where caso_id = $1", [caso])).toBe(1);

    estados.length = 0;
    await constanciaEnDosPestanas(page, otra, enviar);
    expect(estados).toEqual([303, 200]);
    await rechazoSinFormulario(page, /Ese reporte ya tiene su envío registrado/, "38ª sin JavaScript");
    await otra.close();
  });

  test("B5 sin JavaScript: llegando por #reporte-titulo, el acuse rechazado lleva al folio", async ({ page, context }) => {
    const [conReporte] = await consultar<{ id: string }>(
      "select c.id from pld_casos c join pld_dictamenes d on d.caso_id = c.id where c.company_id = $1 and d.resultado = 'reportar_inusual' order by d.caso_id limit 1",
      [ceiba],
    );
    await sesionDe(context, CORREOS.op3, { superficie: "sofipo" });
    await page.goto(`/operacion/pld/casos/${conReporte!.id}#reporte-titulo`);
    await page.locator("#reporte-folio").fill("SITI​0001");
    await page.locator("#reporte-recibido").fill(ahoraParaCampo());
    expect(await enviarPost(page, page.getByRole("button", { name: "Registrar acuse" }))).toBe(200);
    await llegaSinScript(page, "#reporte-folio", "aviso-acuse-campo", "folio");
    await expect(page.locator('[id="reporte-titulo"]')).toHaveCount(0);
    expect(await page.locator('[id^="reporte-titulo-"]').evaluateAll((nodos) => nodos.map((nodo) => nodo.id))).toEqual([expect.stringMatching(/^reporte-titulo-[0-9a-f]{8}$/)]);
  });
});

// B5 con JavaScript: los destinos van sin sufijo y cada enlace con fragmento sigue llevando a su sección.
test("B5 con JavaScript: cada enlace con fragmento de PLD lleva a su sección, sin sufijo", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  const [conReporte] = await consultar<{ id: string }>(
    "select c.id from pld_casos c join pld_dictamenes d on d.caso_id = c.id where c.company_id = $1 and d.resultado = 'reportar_inusual' order by d.caso_id limit 1",
    [ceiba],
  );
  await sesionDe(context, CORREOS.op3, { superficie: "sofipo" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/operacion/reportes");
  const periodico = (await page.locator("li", { has: page.getByRole("button", { name: "Registrar envío" }) }).first().getAttribute("id"))!;
  for (const [ruta, ancla] of [
    [`/operacion/clientes/${ceiba}/expediente`, "perfil-titulo"],
    [`/operacion/clientes/${ceiba}/expediente`, "evaluacion-titulo"],
    [`/operacion/pld/casos/${conReporte!.id}`, "reporte-titulo"],
    ["/operacion/reportes", periodico],
    ["/operacion/comite", "sesiones-titulo"],
    ["/operacion/comite", "comunicaciones-titulo"],
    ["/operacion/pld", "alertas-titulo"],
  ] as const) {
    await page.goto("/operacion");
    await page.goto(`${ruta}#${ancla}`);
    const destino = page.locator(`[id="${ancla}"]`);
    await expect(destino, ancla).toHaveCount(1);
    await expect(destino, ancla).toBeInViewport();
  }
  expect(errores).toEqual([]);
});
