import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ESTA_PANTALLA_ENVIA_DINERO,
  TOPE_FILAS_69B,
  decodificarListado,
  decidirPago69b,
  elProveedorPuedeExistir,
  fraseDePago69b,
  fraseFechaArchivo,
  leerArchivo69b,
  leerPagina69b,
  puedeGuardarLista69b,
  puedeVerLista69b,
  urlPublica,
} from "./lista-69b.ts";

const PAGINA = `
  <p>Artículo 69-B del Código Fiscal de la Federación</p>
  <strong>Información actualizada al 30 de septiembre de 2026.</strong>
  <ul>
    <li><a href="https://archivos.example/Definitivos.csv">Definitivos</a></li>
    <li><a href="https://archivos.example/Listado_completo_69-B.csv">Listado completo</a></li>
  </ul>
  <p>Artículo 69-B Bis del Código Fiscal de la Federación</p>
  <strong>Información actualizada al 9 de octubre de 2026.</strong>
  <a href="https://archivos.example/bis.csv">Listado completo</a>
`;

const CSV = [
  '"Información actualizada al 30 de septiembre de 2026; texto de ejemplo",,,',
  "Listado completo de contribuyentes (Artículo 69-B del CFF)",
  "No,RFC,Nombre del Contribuyente,Situación del contribuyente",
  '1,PAL7202161U0,"NOMBRE, CON COMA",Definitivo',
  "2,PAL7202161U0,OTRO NOMBRE,Definitivo",
  "3,CABL840215RF4,PERSONA,Presunto",
  "4,CABL840215RF4,PERSONA,Sentencia Favorable",
].join("\n");

describe("la página citada", () => {
  it("toma el listado completo del 69-B y no el del 69-B Bis", () => {
    const pagina = leerPagina69b(PAGINA);
    assert.equal(pagina.ok, true);
    if (!pagina.ok) return;
    assert.equal(pagina.fechaArchivo, "2026-09-30");
    assert.equal(pagina.urlListado, "https://archivos.example/Listado_completo_69-B.csv");
  });

  it("rechaza un enlace que no es https público", () => {
    const http = PAGINA.replace(
      "https://archivos.example/Listado_completo_69-B.csv",
      "http://archivos.example/Listado_completo_69-B.csv",
    );
    assert.deepEqual(leerPagina69b(http), { ok: false, codigo: "url_no_publica" });
    assert.equal(urlPublica("https://127.0.0.1/lista.csv", "https://www.sat.gob.mx/"), null);
    assert.equal(urlPublica("https://localhost/lista.csv", "https://www.sat.gob.mx/"), null);
  });

  it("no inventa el enlace si la sección no lo publica", () => {
    assert.equal(leerPagina69b("<p>Artículo 69 del CFF</p>").ok, false);
  });
});

describe("el archivo", () => {
  it("guarda la fecha del archivo y una fila por RFC y situación", () => {
    const archivo = leerArchivo69b(CSV);
    assert.equal(archivo.ok, true);
    if (!archivo.ok) return;
    assert.equal(archivo.fechaArchivo, "2026-09-30");
    assert.deepEqual(archivo.filas, [
      { rfc: "PAL7202161U0", situacion: "Definitivo" },
      { rfc: "CABL840215RF4", situacion: "Presunto" },
      { rfc: "CABL840215RF4", situacion: "Sentencia Favorable" },
    ]);
    assert.equal(fraseFechaArchivo(archivo.fechaArchivo), "30 de septiembre de 2026");
  });

  it("lee el archivo en windows-1252, que es como lo publica el SAT", () => {
    const texto = "Información actualizada al 2 de marzo de 2026\nNo,RFC,Situación del contribuyente\n1,PAL7202161U0,Presunto\n";
    const bytes = new Uint8Array(texto.length);
    for (let i = 0; i < texto.length; i += 1) bytes[i] = texto.charCodeAt(i);
    const leido = leerArchivo69b(decodificarListado(bytes));
    assert.equal(leido.ok, true);
    if (!leido.ok) return;
    assert.equal(leido.fechaArchivo, "2026-03-02");
    assert.equal(leido.filas[0]?.situacion, "Presunto");
  });

  it("no guarda una fecha imposible ni un archivo vacío", () => {
    const imposible = CSV.replace("30 de septiembre de 2026", "31 de septiembre de 2026");
    assert.equal(leerArchivo69b(imposible).ok, false);
    const vacio = "Información actualizada al 1 de enero de 2026\nNo,RFC,Situación del contribuyente\n";
    assert.deepEqual(leerArchivo69b(vacio), { ok: false, codigo: "listado_vacio" });
  });

  it("falla cerrado si una fila no trae situación, sin devolver las anteriores", () => {
    const roto = `${CSV}\n5,EKU9003173C9,SIN SITUACION,`;
    const leido = leerArchivo69b(roto);
    assert.equal(leido.ok, false);
    if (leido.ok) return;
    assert.equal(leido.codigo, "fila_incompleta");
    assert.equal("filas" in leido, false);
  });
});

describe("el pago", () => {
  it("no existe sin archivo, ni cuando el RFC está en la copia", () => {
    assert.equal(ESTA_PANTALLA_ENVIA_DINERO, false);
    assert.equal(elProveedorPuedeExistir(), true);
    const sinArchivo = decidirPago69b({ hayArchivo: false, situaciones: [] });
    assert.equal(sinArchivo.listaPermitePago, false);
    assert.equal(sinArchivo.motivo, "sin_archivo");
    assert.equal(fraseDePago69b(sinArchivo), "El proveedor puede existir. El pago no.");

    const publicado = decidirPago69b({ hayArchivo: true, situaciones: ["Definitivo", "Sentencia Favorable"] });
    assert.equal(publicado.listaPermitePago, false);
    assert.equal(publicado.motivo, "en_el_listado");
    assert.deepEqual(publicado.situaciones, ["Definitivo", "Sentencia Favorable"]);
    assert.equal(fraseDePago69b(publicado), fraseDePago69b(sinArchivo));
    assert.equal(elProveedorPuedeExistir(), true);
  });

  it("la lista no bloquea a quien no aparece, y esta pantalla tampoco envía", () => {
    const fuera = decidirPago69b({ hayArchivo: true, situaciones: [] });
    assert.equal(fuera.listaPermitePago, true);
    assert.equal(fuera.motivo, "fuera_del_listado");
    assert.equal(ESTA_PANTALLA_ENVIA_DINERO, false);
    assert.match(fraseDePago69b(fuera), /no envía dinero/);
  });

  it("el tarjetahabiente no consulta ni guarda; el administrador sí guarda", () => {
    assert.equal(puedeVerLista69b("tarjetahabiente"), false);
    assert.equal(puedeVerLista69b("administrador"), true);
    assert.equal(puedeVerLista69b("contador"), true);
    assert.equal(puedeGuardarLista69b("contador", false), false);
    assert.equal(puedeGuardarLista69b("solicitante", false), false);
    assert.equal(puedeGuardarLista69b("administrador", false), true);
    assert.equal(puedeGuardarLista69b("tarjetahabiente", true), true);
  });

  it("el tope de filas es un límite de la carga, no una cifra del SAT", () => {
    assert.equal(TOPE_FILAS_69B > 15_000, true);
  });
});
