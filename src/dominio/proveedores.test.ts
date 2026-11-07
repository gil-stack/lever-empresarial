import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { decodificarListado, leerListado69b } from "./lista-69b.ts";
import {
  decidirPago,
  erroresDeAltaProveedor,
  horaDeLectura,
  mensajeDeAlta,
  releerFichas,
  relatoDePago,
  rfcDeProveedor,
} from "./proveedores.ts";
import { horaEnMexico } from "./reloj.ts";

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
    assert.equal(relatoDePago(enLista).frase, "El proveedor puede existir. El pago no.");
    assert.equal(relatoDePago(sinArchivo).frase, relatoDePago(enLista).frase);
    assert.equal(relatoDePago(fuera).frase, "No aparece en la lista 69-B.");
    assert.equal(relatoDePago(fuera).tono, "neutro");
    assert.match(relatoDePago(enLista).detalle, /Sentencia Favorable/);
    assert.match(relatoDePago(enLista).detalle, /30 de septiembre de 2026/);
    assert.match(mensajeDeAlta(enLista), /El pago no/);
    assert.match(mensajeDeAlta(sinArchivo), /El pago no/);
    assert.match(mensajeDeAlta(fuera), /No aparece en la lista 69-B/);
  });

  it("manda el RFC: un nombre no crea al proveedor", () => {
    assert.equal(rfcDeProveedor("Amazon"), null);
    assert.equal(rfcDeProveedor("AMZN"), null);
    assert.equal(rfcDeProveedor("Amazon México"), null);
    assert.equal(rfcDeProveedor("eku 900317 3c9"), "EKU9003173C9");
    const fuente = readFileSync(new URL("./proveedores.ts", import.meta.url), "utf8");
    assert.equal(fuente.includes("puedeVerProveedores"), false);
    assert.equal(fuente.includes("puedeDarDeAltaProveedor"), false);

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

describe("relectura del 69-B", () => {
  it("si el RFC entra después, la ficha deja de estar fuera y el pago sigue apagado", () => {
    const copia = {
      id: "44444444-4444-4444-8444-444444444444",
      fechaArchivo: "2026-10-31",
      filas: [
        { rfc: "EKU9003173C9", situacion: "Definitivo" },
        { rfc: "EKU9003173C9", situacion: "Presunto" },
      ],
    };
    const [entro, limpio, sinArchivo] = releerFichas(
      [
        {
          rfc: "EKU9003173C9",
          snapshotId: "33333333-3333-4333-8333-333333333333",
          situacion: null,
          fechaArchivo: "2026-09-30",
          botonPago: true,
        },
        {
          rfc: "AAA080808HL8",
          snapshotId: "33333333-3333-4333-8333-333333333333",
          situacion: null,
          fechaArchivo: "2026-09-30",
          botonPago: true,
        },
        {
          rfc: "CABL840215RF4",
          snapshotId: null,
          situacion: null,
          fechaArchivo: null,
          botonPago: false,
        },
      ],
      copia,
    );
    assert.equal(entro?.botonPago, false);
    assert.equal(entro?.situacion, "Definitivo · Presunto");
    assert.equal(entro?.fechaArchivo, "2026-10-31");
    assert.equal(relatoDePago({ botonPago: false, motivo: "en_lista", situacion: entro?.situacion ?? null, fechaArchivo: entro?.fechaArchivo ?? null }).insignia, "En la lista 69-B");
    assert.equal(limpio?.botonPago, true);
    assert.equal(limpio?.situacion, null);
    assert.equal(limpio?.snapshotId, copia.id);
    assert.equal(sinArchivo?.botonPago, false);
    assert.equal(sinArchivo?.snapshotId, null);
    assert.equal(sinArchivo?.fechaArchivo, null);
  });

  it("escribe la hora igual que la lista", () => {
    const instante = new Date("2026-11-03T21:09:00.000Z");
    assert.equal(horaDeLectura(instante.toISOString()), horaEnMexico(instante));
    assert.match(horaEnMexico(instante), /3 de noviembre de 2026 a las \d{2}:09, hora del centro de México/);
  });
});

describe("la pantalla no mezcla la consola con el teléfono", () => {
  it("el alta entra en la consola y el teléfono no lleva esa sección", () => {
    const marco = readFileSync(new URL("../components/cromo/marco.tsx", import.meta.url), "utf8");
    const telefono = marco.slice(marco.indexOf("export async function MarcoTelefono"));
    const paginaTelefono = readFileSync(new URL("../app/telefono/page.tsx", import.meta.url), "utf8");
    const pagina = readFileSync(new URL("../app/consola/proveedores/page.tsx", import.meta.url), "utf8");
    const forma = readFileSync(new URL("../components/proveedores/formulario.tsx", import.meta.url), "utf8");

    assert.match(telefono, /marco-telefono/);
    assert.doesNotMatch(telefono, /seccionesDe/);
    assert.doesNotMatch(telefono, /\/consola\/proveedores/);
    assert.match(paginaTelefono, /MarcoTelefono/);
    assert.doesNotMatch(paginaTelefono, /proveedores/);
    assert.doesNotMatch(paginaTelefono, /69/);
    assert.match(pagina, /<Marco/);
    assert.doesNotMatch(pagina, /MarcoTelefono/);
    assert.match(pagina, /className="pagina pagina-proveedores"/);
    assert.match(forma, /Dar de alta/);
    // La puerta del alta ya recorre estos archivos. Aquí no se escribe el
    // nombre del connection string: no es un secreto y no hace falta esconderlo.
    assert.doesNotMatch(forma, /SPEI|Pagar ahora|BLOB_READ_WRITE_TOKEN/);
  });
});
