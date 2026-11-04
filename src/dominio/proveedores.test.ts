import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { decodificarListado, leerListado69b } from "./lista-69b.ts";
import {
  decidirPago,
  erroresDeAltaProveedor,
  mensajeDeAlta,
  puedeDarDeAltaProveedor,
  puedeVerProveedores,
  relatoDePago,
  rfcDeProveedor,
} from "./proveedores.ts";

const LISTADO = `"Información actualizada al 30 de septiembre de 2026; listado público.",
Listado completo de contribuyentes (Artículo 69-B del CFF)
No,RFC,Nombre del Contribuyente,Situación del contribuyente,Número y fecha de oficio global de presunción SAT
1,AAA080808HL8,"ASESORES EN AVALÚOS Y ACTIVOS, S.A. DE C.V.",Sentencia Favorable,500-05-2018-16632 de fecha 01 de junio de 2018
2,EKU9003173C9,ESCUELA KEMPER URGATE,Definitivo,500-05-2018-16632 de fecha 01 de junio de 2018
2,EKU9003173C9,ESCUELA KEMPER URGATE,Definitivo,repetida
`;

describe("listado 69-B", () => {
  it("lee la fecha del preámbulo y la situación publicada, sin usar la fecha del oficio", () => {
    const leido = leerListado69b(LISTADO);
    assert.equal(leido.ok, true);
    if (!leido.ok) return;
    assert.equal(leido.fechaArchivo, "2026-09-30");
    assert.deepEqual(
      leido.filas.map((fila) => `${fila.rfc}:${fila.situacion}`),
      ["AAA080808HL8:Sentencia Favorable", "EKU9003173C9:Definitivo"],
    );
  });

  it("no guarda un archivo ilegible ni uno sin fecha: eso abriría el pago", () => {
    assert.equal(leerListado69b("RFC,Situación\nAAA010101AAA,Definitivo").ok, false);
    assert.deepEqual(leerListado69b("sin columnas").ok, false);
    const sinFilas = leerListado69b(
      "Información actualizada al 30 de septiembre de 2026\nNo,RFC,Situación del contribuyente\n",
    );
    assert.equal(sinFilas.ok, false);
  });

  it("acepta el CSV en windows-1252, que es como lo publica el SAT", () => {
    const texto = decodificarListado(Buffer.from("Situación del contribuyente", "latin1"));
    assert.match(texto, /Situación/);
  });
});

describe("decisión de pago", () => {
  it("no ofrece botón si el RFC aparece o si no hay archivo", () => {
    const enLista = decidirPago({ fechaArchivo: "2026-09-30", situaciones: ["Sentencia Favorable"] });
    const sinArchivo = decidirPago({ fechaArchivo: null, situaciones: [] });
    const fuera = decidirPago({ fechaArchivo: "2026-09-30", situaciones: [] });

    assert.equal(enLista.botonPago, false);
    assert.equal(sinArchivo.botonPago, false);
    assert.equal(fuera.botonPago, true);
    assert.equal(relatoDePago(enLista).hayBoton, false);
    assert.equal(relatoDePago(sinArchivo).hayBoton, false);
    assert.equal(relatoDePago(fuera).hayBoton, false);
    assert.equal(relatoDePago(enLista).frase, "No hay botón de pago.");
    assert.match(relatoDePago(enLista).detalle, /Sentencia Favorable/);
    assert.match(relatoDePago(enLista).detalle, /30 de septiembre de 2026/);
    assert.equal(relatoDePago(sinArchivo).frase, "No hay botón de pago.");
    assert.notEqual(relatoDePago(fuera).frase, "No hay botón de pago.");
    assert.match(mensajeDeAlta(enLista), /no hay botón de pago/);
    assert.match(mensajeDeAlta(sinArchivo), /no hay botón de pago/);
  });

  it("manda el RFC: un nombre no crea al proveedor", () => {
    assert.equal(rfcDeProveedor("Amazon"), null);
    assert.equal(rfcDeProveedor("AMZN"), null);
    assert.equal(rfcDeProveedor("Amazon México"), null);
    assert.equal(rfcDeProveedor("eku 900317 3c9"), "EKU9003173C9");
    assert.equal(puedeVerProveedores("contador"), true);
    assert.equal(puedeDarDeAltaProveedor("contador"), false);
    assert.equal(puedeVerProveedores("tarjetahabiente"), false);
    assert.equal(puedeVerProveedores("solicitante"), false);
    assert.equal(puedeDarDeAltaProveedor("liberador"), true);

    const errores = erroresDeAltaProveedor({
      rfc: "Amazon",
      razonSocial: "Amazon México",
      clabe: "002180701150123453",
      archivo: null,
    });
    assert.equal(errores.some((error) => error.campo === "rfc"), true);
    assert.equal(errores.some((error) => error.campo === "clabe"), true);
    assert.equal(errores.some((error) => error.campo === "constancia"), true);
  });
});

describe("la pantalla no mezcla la consola con el teléfono", () => {
  it("el alta entra en la consola y el teléfono no lleva esa sección", () => {
    const marco = readFileSync(new URL("../components/cromo/marco.tsx", import.meta.url), "utf8");
    const telefono = marco.slice(marco.indexOf("export async function MarcoTelefono"));
    const paginaTelefono = readFileSync(new URL("../app/telefono/page.tsx", import.meta.url), "utf8");
    const pagina = readFileSync(new URL("../app/consola/proveedores/page.tsx", import.meta.url), "utf8");
    const pantalla = readFileSync(new URL("../components/proveedores/pantalla.tsx", import.meta.url), "utf8");
    const forma = readFileSync(new URL("../components/proveedores/formulario.tsx", import.meta.url), "utf8");

    assert.match(telefono, /marco-telefono/);
    assert.doesNotMatch(telefono, /seccionesDe/);
    assert.doesNotMatch(telefono, /\/consola\/proveedores/);
    assert.match(paginaTelefono, /MarcoTelefono/);
    assert.doesNotMatch(paginaTelefono, /proveedores/);
    assert.doesNotMatch(paginaTelefono, /69/);
    assert.match(pagina, /<Marco/);
    assert.doesNotMatch(pagina, /MarcoTelefono/);
    assert.match(pagina, /className="pagina"/);
    assert.equal(pantalla.includes("<button"), false);
    assert.match(forma, /Dar de alta/);
    assert.doesNotMatch(forma, /SPEI|Pagar ahora|BLOB_READ_WRITE_TOKEN|DATABASE_URL/);
    assert.match(pantalla, /clabeVisible/);
    assert.doesNotMatch(pantalla, /DATABASE_URL|BLOB_READ_WRITE_TOKEN|https?:\/\//);
    assert.doesNotMatch(pantalla, /SPEI/);
  });
});
