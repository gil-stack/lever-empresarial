import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { leerConfiguracionCorreo, leerUrlPublica } from "./configuracion.ts";
import { enviadorDesdeEntorno } from "./enviar.ts";
import { ErrorDeCorreo, explicarErrorDeCorreo } from "./errores.ts";
import { plantillaInvitacionEmpresa } from "./plantillas/invitacion-empresa.ts";
import { plantillaInvitacionUsuario } from "./plantillas/invitacion-usuario.ts";
import { escapar } from "./plantillas/marco.ts";
import { plantillaRecuperarContrasena } from "./plantillas/recuperar-contrasena.ts";
import { enviadorResend } from "./resend.ts";
import type { MensajeCorreo } from "./tipos.ts";

const CLAVE = "re_secretoDePrueba1234567890";
const REMITENTE = "Plataforma <avisos@ejemplo.mx>";
const VENCE = new Date("2026-11-07T18:30:00.000Z");
const ENLACE = `https://app.ejemplo.mx/invitacion/${"a".repeat(43)}`;

const MENSAJE: MensajeCorreo = {
  para: "ana@ejemplo.mx",
  asunto: "Asunto",
  html: "<p>hola</p>",
  texto: "hola",
  idempotencia: "invitacion/6f0d1c2a-7b3e-4d5f-8a91-0c2b4e6d8f10",
  etiqueta: "invitacion_usuario",
};

describe("configuración del correo", () => {
  it("sin clave ni remitente no arma nada y nombra las dos variables, sin valores", () => {
    const error = capturar(() => leerConfiguracionCorreo({}));
    assert.ok(error instanceof ErrorDeCorreo);
    assert.equal(error.codigo, "correo_no_configurado");
    assert.deepEqual([...error.faltan], ["RESEND_API_KEY", "CORREO_REMITENTE"]);
    assert.equal(
      explicarErrorDeCorreo(error),
      "El correo transaccional no está configurado. Falta RESEND_API_KEY y CORREO_REMITENTE en el entorno. No se envió nada.",
    );
  });

  it("acepta el remitente con nombre o solo la dirección, y rechaza saltos de línea", () => {
    assert.deepEqual(leerConfiguracionCorreo({ RESEND_API_KEY: CLAVE, CORREO_REMITENTE: REMITENTE }), {
      apiKey: CLAVE,
      remitente: REMITENTE,
    });
    assert.equal(
      leerConfiguracionCorreo({ RESEND_API_KEY: CLAVE, CORREO_REMITENTE: "avisos@ejemplo.mx" }).remitente,
      "avisos@ejemplo.mx",
    );
    for (const malo of ["avisos", "Plataforma <avisos>", "a@b.mx\r\nBcc: x@y.mx", "Plat <a@b.mx> extra"]) {
      const error = capturar(() => leerConfiguracionCorreo({ RESEND_API_KEY: CLAVE, CORREO_REMITENTE: malo }));
      assert.ok(error instanceof ErrorDeCorreo);
      assert.deepEqual([...error.faltan], ["CORREO_REMITENTE"]);
      assert.equal(`${error.message}${error.stack}`.includes(CLAVE), false);
    }
  });

  it("la URL de los enlaces sale de la configuración, nunca de la petición", () => {
    assert.equal(leerUrlPublica({ URL_APLICACION: "https://app.ejemplo.mx/" }), "https://app.ejemplo.mx");
    assert.equal(leerUrlPublica({ URL_APLICACION: "http://localhost:3000" }), "http://localhost:3000");
    assert.equal(
      leerUrlPublica({ VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "plataforma.vercel.app" }),
      "https://plataforma.vercel.app",
    );
    assert.equal(
      leerUrlPublica({ VERCEL_ENV: "preview", VERCEL_BRANCH_URL: "rama-equipo.vercel.app" }),
      "https://rama-equipo.vercel.app",
    );
    for (const mala of ["http://app.ejemplo.mx", "https://u:p@app.ejemplo.mx", "https://app.ejemplo.mx/?x=1", "nada"]) {
      const error = capturar(() => leerUrlPublica({ URL_APLICACION: mala }));
      assert.ok(error instanceof ErrorDeCorreo);
      assert.deepEqual([...error.faltan], ["URL_APLICACION"]);
    }
  });
});

describe("adaptador de Resend", () => {
  it("manda la clave solo en Authorization, con llave de idempotencia y etiqueta", async () => {
    const llamadas: Array<{ url: string; init: RequestInit }> = [];
    const enviar = enviadorResend({ apiKey: CLAVE, remitente: REMITENTE }, async (url, init) => {
      llamadas.push({ url, init });
      return Response.json({ id: "correo-1" });
    });
    assert.deepEqual(await enviar(MENSAJE), { id: "correo-1" });
    assert.equal(llamadas.length, 1);
    const { url, init } = llamadas[0];
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(init.method, "POST");
    const encabezados = init.headers as Record<string, string>;
    assert.equal(encabezados.Authorization, `Bearer ${CLAVE}`);
    assert.equal(encabezados["Idempotency-Key"], MENSAJE.idempotencia);
    const cuerpo = JSON.parse(String(init.body));
    assert.deepEqual(cuerpo, {
      from: REMITENTE,
      to: ["ana@ejemplo.mx"],
      subject: "Asunto",
      html: "<p>hola</p>",
      text: "hola",
      tags: [{ name: "tipo", value: "invitacion_usuario" }],
    });
    assert.equal(String(init.body).includes(CLAVE), false);
  });

  it("traduce el estado del proveedor y no copia la clave ni la respuesta al error", async () => {
    const casos: Array<[number, string]> = [
      [401, "correo_rechazado"],
      [403, "correo_rechazado"],
      [422, "correo_destinatario_invalido"],
      [429, "correo_limite"],
      [500, "correo_no_disponible"],
    ];
    for (const [estado, codigo] of casos) {
      const enviar = enviadorResend({ apiKey: CLAVE, remitente: REMITENTE }, async () =>
        Response.json({ message: `clave ${CLAVE} rechazada` }, { status: estado }),
      );
      const error = await capturarAsync(() => enviar(MENSAJE));
      assert.ok(error instanceof ErrorDeCorreo);
      assert.equal(error.codigo, codigo);
      assert.equal(`${error.message}${error.stack}`.includes(CLAVE), false);
      assert.equal(`${error.message}${error.stack}`.includes("rechazada"), false);
    }
    const caida = enviadorResend({ apiKey: CLAVE, remitente: REMITENTE }, async () => {
      throw new Error(`fetch failed Bearer ${CLAVE}`);
    });
    const error = await capturarAsync(() => caida(MENSAJE));
    assert.ok(error instanceof ErrorDeCorreo);
    assert.equal(error.codigo, "correo_no_disponible");
    assert.equal(`${error.message}${error.stack}`.includes(CLAVE), false);
  });

  it("sin configuración no toca la red", () => {
    let llamadas = 0;
    const error = capturar(() =>
      enviadorDesdeEntorno({}, async () => {
        llamadas += 1;
        return Response.json({ id: "x" });
      }),
    );
    assert.ok(error instanceof ErrorDeCorreo);
    assert.equal(error.codigo, "correo_no_configurado");
    assert.equal(llamadas, 0);
  });
});

describe("plantillas", () => {
  it("invitación a una empresa: razón social, RFC, rol, enlace y vencimiento en hora de México", () => {
    const correo = plantillaInvitacionEmpresa({
      nombre: "Ana Pérez",
      razonSocial: "Talleres del Norte",
      rfc: "TNO010101AB1",
      enlace: ENLACE,
      venceEn: VENCE,
    });
    assert.equal(correo.asunto, "Tu acceso a Talleres del Norte");
    for (const parte of [correo.html, correo.texto]) {
      assert.match(parte, /Talleres del Norte/);
      assert.match(parte, /TNO010101AB1/);
      assert.match(parte, /Administrador/);
      assert.ok(parte.includes(ENLACE));
      assert.match(parte, /7 de noviembre de 2026/);
      assert.match(parte, /12:30/);
      assert.match(parte, /sirve una sola vez/);
    }
    assert.match(correo.html, /<html lang="es-MX">/);
  });

  it("invitación de un usuario: quién invita y los roles", () => {
    const correo = plantillaInvitacionUsuario({
      nombre: "Luis",
      razonSocial: "Talleres del Norte",
      quienInvita: "Ana Pérez",
      roles: ["liberador", "tarjetahabiente"],
      enlace: ENLACE,
      venceEn: VENCE,
    });
    assert.equal(correo.asunto, "Ana Pérez te invitó a Talleres del Norte");
    assert.match(correo.texto, /Roles: Liberador, Tarjetahabiente/);
    assert.match(correo.html, /Aceptar la invitación/);
  });

  it("recuperar contraseña: avisa que se cierran las sesiones y que se puede ignorar", () => {
    const correo = plantillaRecuperarContrasena({ nombre: "Ana", enlace: ENLACE, venceEn: VENCE });
    assert.equal(correo.asunto, "Cambia tu contraseña");
    assert.match(correo.texto, /se cierran las sesiones/);
    assert.match(correo.texto, /tu contraseña sigue igual/);
  });

  it("escapa lo que llega de la base y no deja saltos en el asunto", () => {
    const correo = plantillaInvitacionUsuario({
      nombre: `<img src=x onerror="alert(1)">`,
      razonSocial: "Acme\r\nBcc: otro@x.mx & <b>Hijos</b>",
      quienInvita: null,
      roles: ["contador"],
      enlace: `${ENLACE}"><script>`,
      venceEn: VENCE,
    });
    assert.equal(correo.html.includes("<img src=x"), false);
    assert.equal(correo.html.includes("<b>Hijos</b>"), false);
    assert.equal(correo.html.includes('"><script>'), false);
    assert.ok(correo.html.includes("&lt;b&gt;Hijos&lt;/b&gt;"));
    assert.equal(/[\r\n]/.test(correo.asunto), false);
    assert.equal(escapar(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });

  it("ningún atributo style se corta con una comilla", () => {
    const html = plantillaInvitacionEmpresa({
      nombre: "Ana",
      razonSocial: "Talleres",
      rfc: "TNO010101AB1",
      enlace: ENLACE,
      venceEn: VENCE,
    }).html;
    const atributos = [...html.matchAll(/style="([^"]*)"(.)/g)];
    assert.ok(atributos.length > 10);
    for (const [, valor, siguiente] of atributos) {
      assert.match(siguiente, /[\s>]/, `style cortado: ${valor.slice(0, 60)}`);
      assert.doesNotMatch(valor, /font-family:[^;]*$/, "la pila de fuentes quedó abierta");
    }
  });

  it("usa los colores de src/estilo/tokens.css, en claro y en oscuro", () => {
    const tokens = readFileSync(new URL("../../estilo/tokens.css", import.meta.url), "utf8");
    const html = plantillaRecuperarContrasena({ nombre: "Ana", enlace: ENLACE, venceEn: VENCE }).html;
    for (const token of ["--papel", "--hoja", "--tinta", "--linea", "--sello", "--sobre-sello"]) {
      const linea = new RegExp(`${token}: light-dark\\((#[0-9a-f]{6}), (#[0-9a-f]{6})\\)`).exec(tokens);
      assert.ok(linea, token);
      assert.ok(html.includes(linea[1]), `${token} claro`);
      assert.ok(html.includes(linea[2]), `${token} oscuro`);
    }
  });
});

describe("el módulo no imprime ni lee de más", () => {
  it("solo configuracion.ts lee el entorno, y nadie escribe en consola", () => {
    const raiz = dirname(fileURLToPath(import.meta.url));
    const archivos = [
      ...readdirSync(raiz).map((n) => join(raiz, n)),
      ...readdirSync(join(raiz, "plantillas")).map((n) => join(raiz, "plantillas", n)),
    ].filter((a) => a.endsWith(".ts") && !a.endsWith(".test.ts"));
    assert.ok(archivos.length >= 9);
    for (const archivo of archivos) {
      const fuente = readFileSync(archivo, "utf8");
      assert.doesNotMatch(fuente, /\bconsole\b/);
      assert.doesNotMatch(fuente, /process\.(stdout|stderr)/);
      assert.doesNotMatch(fuente, /re_[A-Za-z0-9]{8,}/);
      if (!archivo.endsWith("configuracion.ts")) assert.doesNotMatch(fuente, /process\.env/);
    }
  });
});

function capturar(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("no lanzó");
}

async function capturarAsync(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error("no lanzó");
}
