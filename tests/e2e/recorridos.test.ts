import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { NextRequest } from "next/server";

import { capacidadesDe, tiene } from "../../src/nucleo/capacidades.ts";
import { CABECERA_EMPRESA, rutaConsola, rutaDe, separarEmpresa } from "../../src/nucleo/rutas.ts";
import { proxy } from "../../src/proxy.ts";
import { SQL_RESUMEN } from "../../src/server/inicio/resumen-repositorio.ts";

const EMPRESA = "11111111-1111-4111-8111-111111111111";
const SESION = `sesion=${"a".repeat(43)}`;
const RAIZ = new URL("../../", import.meta.url);

/** Recorridos HTTP del guardia real, sin sustituirlo por una regla de prueba. */
describe("recorridos de entrada y superficie", () => {
  it("teléfono sin sesión vuelve a entrar conservando la superficie", () => {
    const respuesta = proxy(new NextRequest("http://localhost/telefono"));
    assert.equal(respuesta.status, 307);
    assert.equal(respuesta.headers.get("location"), "http://localhost/entrar?siguiente=%2Ftelefono");
  });

  it("una petición sin sesión que escribe no recibe HTML ni un redirect", () => {
    const respuesta = proxy(new NextRequest("http://localhost/telefono", { method: "POST" }));
    assert.equal(respuesta.status, 401);
  });

  it("la empresa viaja por el prefijo y la ruta interna conserva Topes", () => {
    const respuesta = proxy(new NextRequest(`http://localhost/c/${EMPRESA}/telefono/topes`, { headers: { cookie: SESION } }));
    assert.equal(respuesta.status, 200);
    assert.equal(respuesta.headers.get("x-middleware-rewrite"), `http://localhost/telefono/topes`);
    assert.equal(respuesta.headers.get(`x-middleware-request-${CABECERA_EMPRESA}`), EMPRESA);
  });

  it("una empresa no puede prefijar una ruta pública y el segundo factor vuelve al resolvedor", () => {
    assert.equal(proxy(new NextRequest(`http://localhost/c/${EMPRESA}/entrar`)).status, 404);
    const respuesta = proxy(new NextRequest("http://localhost/entrar/continuar", { headers: { cookie: SESION } }));
    assert.equal(respuesta.status, 307);
    assert.match(respuesta.headers.get("location") ?? "", /\/entrar\/destino\?siguiente=/);
  });

  it("las tres pantallas del teléfono y Plan exigen capacidad y empresa", () => {
    for (const ruta of ["/telefono", "/telefono/topes", "/telefono/facturacion", "/consola/configuracion/plan"]) {
      const declarada = rutaDe(ruta);
      assert.equal(declarada?.conEmpresa, true, ruta);
      assert.equal(declarada?.acceso.tipo, "capacidad", ruta);
    }
  });

  it("separa el permiso financiero de Inicio del acceso general a Pendientes sin dejar un 404", () => {
    // /consola y /c/<empresa> abren con cualquier rol de consola; la página manda a Pendientes a quien no ve cifras.
    assert.deepEqual(rutaDe("/consola")?.acceso, { tipo: "capacidad", alguna: ["cliente.consola.ver"] });
    assert.deepEqual(rutaDe("/consola/pendientes")?.acceso, { tipo: "capacidad", alguna: ["cliente.consola.ver"] });
    assert.equal(separarEmpresa(`/c/${EMPRESA}`).resto, "/consola");
    for (const rol of ["contador", "liberador", "solicitante"] as const) {
      const capacidades = capacidadesDe({ rolesCliente: [rol], rolesPlataforma: [] });
      assert.equal(tiene(capacidades, "cliente.consola.ver"), true, rol);
      assert.equal(rutaConsola(capacidades), "/consola/pendientes", rol);
    }
    assert.equal(rutaConsola(capacidadesDe({ rolesCliente: ["contador", "finanzas"], rolesPlataforma: [] })), "/consola");
    const pagina = readFileSync(new URL("src/app/consola/page.tsx", RAIZ), "utf8");
    assert.match(
      pagina,
      /apertura\.tipo === "abierta" && rutaConsola\(apertura\.ctx\.capacidades\) !== "\/consola"\) \{\s*redirect\(enEmpresa\(apertura\.ctx\.empresa\?\.id, "\/consola\/pendientes"\)\)/,
    );
    // El redirect va antes de leer cifras; la lectura vuelve a exigir el permiso financiero.
    assert.ok(pagina.indexOf("redirect(") < pagina.indexOf("leerResumenInicio(apertura.ctx"));
  });

  it("Inicio consulta el resumen autorizado, Pendientes no lee tesorería (del flujo, solo el faltante con permiso) y el teléfono no llama a la política completa", () => {
    const consola = readFileSync(new URL("src/app/consola/page.tsx", RAIZ), "utf8");
    const pendientes = readFileSync(new URL("src/app/consola/pendientes/page.tsx", RAIZ), "utf8");
    const telefono = [
      "src/app/telefono/page.tsx",
      "src/app/telefono/topes/page.tsx",
      "src/app/telefono/facturacion/page.tsx",
      "src/server/telefono/servicio.ts",
      "src/server/telefono/repositorio.ts",
    ].map((archivo) => readFileSync(new URL(archivo, RAIZ), "utf8")).join("\n");
    assert.match(consola, /leerResumenInicio/);
    assert.doesNotMatch(consola, /leerCajones|leerPolitica|leerTarifa|postings/i);
    // La portada solo llega al libro por el resumen: ni política, ni tarifas, ni credenciales.
    const portada = [
      "src/app/consola/page.tsx",
      "src/components/inicio/resumen.tsx",
      "src/components/inicio/graficas.tsx",
      "src/server/inicio/resumen-servicio.ts",
      "src/server/inicio/resumen-repositorio.ts",
    ].map((archivo) => readFileSync(new URL(archivo, RAIZ), "utf8")).join("\n");
    assert.doesNotMatch(portada, /leerCajones|leerPolitica|leerTarifa|password_hash|policy_categories|platform_pricing|subscriptions|tope_centavos/i);
    const tablas = new Set([...SQL_RESUMEN.matchAll(/\b(?:from|join)\s+([a-z_]+)/gi)].map((coincidencia) => coincidencia[1]));
    assert.deepEqual([...tablas].sort(), ["categorias", "drawers", "limites", "mensuales", "postings", "recientes"]);
    // Pendientes no lee tesorería: ni el resumen de Inicio, ni cajones, ni el libro, ni las vistas
    // del flujo. Del flujo solo pide la alerta de faltante (leerFaltanteParaPendientes envuelve a leerFaltante),
    // y leerFaltante la niega sin cliente.flujo.ver.
    assert.doesNotMatch(pendientes, /leerResumenInicio|leerCajones|postings|leerFlujoInicio|leerVistaSaldo|proyeccionCon/i);
    assert.deepEqual(
      [...pendientes.matchAll(/import \{([^}]*)\} from "@\/server\/flujo\/[^"]+"/g)].map((coincidencia) => coincidencia[0]),
      ['import { leerFaltanteParaPendientes, type FaltanteDePendientes } from "@/server/flujo/servicio"'],
    );
    const servicioFlujo = readFileSync(new URL("src/server/flujo/servicio.ts", RAIZ), "utf8");
    assert.match(servicioFlujo, /export async function leerFaltante\([\s\S]*?\): Promise<FaltantePendientes \| null> \{\s*if \(!puede\(ctx, "cliente\.flujo\.ver"\)\) return null;/);
    assert.match(consola, /sin_permiso\"\) notFound/);
    assert.doesNotMatch(telefono, /leerPolitica|postings|drawers|password_hash/i);
    const visibles = [
      "src/components/telefono/inicio.tsx",
      "src/components/telefono/topes.tsx",
      "src/components/telefono/facturacion.tsx",
      "src/server/telefono/datos.ts",
    ].map((archivo) => readFileSync(new URL(archivo, RAIZ), "utf8")).join("\n");
    assert.doesNotMatch(visibles, /cfdi|timbre/i);
  });

  it("mantiene puntos de ajuste responsive para el teléfono y las tarjetas", () => {
    const telefono = readFileSync(new URL("src/estilo/telefono.css", RAIZ), "utf8");
    const componentes = readFileSync(new URL("src/estilo/componentes.css", RAIZ), "utf8");
    assert.match(telefono, /@media \(max-width: 560px\)/);
    assert.match(telefono, /width: min\(240px, 100%\)/);
    assert.match(componentes, /@container \(max-width: 560px\)/);
  });
});
