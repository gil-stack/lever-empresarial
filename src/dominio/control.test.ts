import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validarRfcDeAlta } from "../domain/rfc.ts";
import { validarAlta } from "../server/company/validar.ts";
import { validarPdfPrivado } from "./cfdi.ts";
import { clabeValida } from "./clabe.ts";
import { textoLimpio, validarCobroManual } from "./flujo/entradas.ts";
import { INVISIBLE } from "./control.ts";
import { leerListaBloqueadas } from "./operacion/lpb.ts";
import { documentoExtranjeroNormalizado } from "./operacion/paises.ts";
import { textoMultilinea, textoOperativo } from "./operacion/validar.ts";
import { correoOpcional, textoPago } from "./pagos-proveedores.ts";
import { erroresDeAltaProveedor } from "./proveedores.ts";
import { MENSAJE_CAMPO, normalizarCentro, normalizarNombrePersona, validarAltaPersona, validarCentro } from "./personas.ts";
import { validarRfc } from "./rfc.ts";

// bar-3: la base cuenta como `[[:cntrl:]]` también los C1 (U+0080 a U+009F), como el U+0085 o las comillas
// U+0093/U+0094 de un Windows-1252 mal decodificado. Antes los validadores solo filtraban C0 y DEL: el texto
// pasaba el servidor y el CHECK lo rechazaba con «La base no respondió». La equivalencia exacta con la base
// la prueba `alta-regulada-postgres.test.ts` contra `pg_c_utf8`.
describe("los validadores rechazan los controles C1 como la base", () => {
  const conC1 = ["Comercio\u0085al por mayor", "Calle \u0093Reforma\u0094"];

  // serv-nuevo-4 (antes serv-nuevo-1): en los textos libres cada control invisible vale un espacio, para no
  // pegar dos palabras, salvo las comillas de Windows-1252 (U+0091/U+0092 → «'», U+0093/U+0094 → «"»); después
  // se juntan los espacios y las longitudes se miden sobre lo limpio. Antes el control se borraba sin dejar nada
  // («Comercializadora\u0085Uno» quedaba «ComercializadoraUno»).
  it("los textos libres de Operación, pagos y flujo cambian el control por un espacio y miden lo limpio", () => {
    for (const [texto, limpio] of [
      ["Comercializadora\u0085Uno", "Comercializadora Uno"],
      ["Servicio\u000bde noviembre", "Servicio de noviembre"],
      ["Pérez\u0096López Hermanos", "Pérez López Hermanos"],
      ["Trabajo urgente\u0085 autorizado ya", "Trabajo urgente autorizado ya"],
      ["O\u0092Brien y asociados", "O'Brien y asociados"],
      ["Calle \u0093Reforma\u0094", 'Calle "Reforma"'],
    ]) {
      assert.equal(textoOperativo(texto, 300), limpio, texto);
      assert.equal(textoMultilinea(texto, 500), limpio, texto);
      assert.equal(textoPago(texto, 500, 10), limpio, texto);
      assert.equal(textoLimpio(texto, 254), limpio, texto);
    }
    assert.equal(textoPago("ok\u0085\u0085\u0085\u0085\u0085\u0085\u0085\u0085", 500, 10), null);
    assert.equal(textoOperativo("\u0085\u0000\u007f", 300), null);
  });

  it("los nombres de personas y áreas siguen rechazando el control", () => {
    for (const texto of conC1) {
      assert.equal(normalizarNombrePersona(texto), null, texto);
      assert.equal(normalizarCentro(texto), null, texto);
    }
  });

  it("la razón social del alta, el renglón de la Lista y el nombre de un PDF privado", () => {
    // P3: la razón social con un control da su propio aviso (antes, el genérico y sin el campo marcado).
    const alta = validarAlta({ rfc: "EKU9003173C9", razonSocial: "Escuela\u0085Kemper", codigoPostal: "06600", regimen: "601", usoCfdi: "G03" });
    assert.deepEqual(alta, { ok: false, codigo: "razon_social_control" });
    assert.deepEqual(leerListaBloqueadas("nombre,rfc,curp,tipo,fecha\nBien,,,fisica,\nJuan\u0085Pérez,,,fisica,"), { ok: false, codigo: "lpb_renglon_invalido", linea: 3 });
    const pdf = new TextEncoder().encode(`%PDF-1.4\n${"0".repeat(80)}\n%%EOF\n`);
    assert.deepEqual(validarPdfPrivado("acta\u0093.pdf", pdf), { ok: false });
  });
});

// Regla 1 (base-N23 y serv-nuevo-4): una identidad o un identificador con cualquier control se rechaza con el
// error de su campo; nunca se limpia ni se transforma. Antes, el RFC y la CLABE borraban el tabulador, el
// U+000B o el U+000C (normalizar quita los espacios) y el correo de contacto del proveedor guardaba el U+0085.
describe("las identidades y los identificadores rechazan cualquier control", () => {
  const controles = ["\u0009", "\u000b", "\u000c", "\u001f", "\u0085", "\u0096"];

  it("RFC, CLABE, correo de contacto y RFC del cobro manual", () => {
    for (const c of controles) {
      assert.equal(validarRfcDeAlta(`EKU900317${c}3C9`).ok, false, JSON.stringify(c));
      assert.notEqual(validarRfc(`EKU900317${c}3C9`), null, JSON.stringify(c));
      assert.deepEqual(clabeValida(`0021800${c}12345678906`), { ok: false, codigo: "clabe_invalida" }, JSON.stringify(c));
      assert.equal(correoOpcional(`ana${c}@lab.mx`), "invalido", JSON.stringify(c));
      const cobro = validarCobroManual({ clienteNombre: "Cliente", clienteRfc: `EKU900317${c}3C9`, concepto: "Servicio", monto: "100", fechaProbable: "2026-11-30" });
      assert.equal(cobro.ok, false, JSON.stringify(c));
      if (!cobro.ok) assert.deepEqual(cobro.errores.map((e) => e.campo), ["clienteRfc"]);
    }
    // En las orillas, los espacios (también el tabulador) se recortan como siempre.
    assert.equal(validarRfcDeAlta(" EKU9003173C9\t").ok, true);
    assert.deepEqual(clabeValida("002180012345678906"), { ok: true, clabe: "002180012345678906" });
  });

  it("el área y la persona dan su propio aviso con el campo marcado (P3)", () => {
    for (const c of controles) {
      assert.deepEqual(validarCentro({ nombre: `Ventas${c}Norte`, presupuesto: "" }), { ok: false, codigo: "centro_nombre_control" }, JSON.stringify(c));
    }
    assert.equal(MENSAJE_CAMPO.centro_nombre_control?.campo, "centroNombre");
    assert.equal(MENSAJE_CAMPO.nombre_control?.campo, "nombre");
    const persona = validarAltaPersona({ nombre: "Ana\u0085Ruiz", alta: "2026-11-01" }, "2026-11-08");
    assert.deepEqual(persona.ok ? null : [persona.codigo, persona.campo], ["nombre_control", "nombre"]);
  });
});

// serv-nuevo-5: los caracteres de formato (Cf) tampoco se ven y cambian la identidad igual que un control: el guion
// suave U+00AD, el espacio de ancho cero U+200B, la unión de palabras U+2060, el U+FEFF y la marca de dirección
// U+200E. Antes solo se rechazaban los Cc (`CONTROL`). Entre dos palabras no cambiaban el cotejo («Ana\u200bRuiz» da
// «ANA RUIZ» en `lpb_normalizar`), pero dentro de una palabra la partían: «Ro\u200bdríguez» da «DRIGUEZ RO».
// base-N26: lo mismo con los invisibles de otras categorías (Default_Ignorable_Code_Point): el relleno hangul U+3164,
// U+115F y U+FFA0, los selectores de variación U+FE0F, U+180B y U+E0100 y la vocal muda jemer U+17B4. Antes pasaban;
// «Rodr\u3164íguez» daba «IGUEZ RODR» y el socio no coincidía con la Lista.
describe("las identidades rechazan también los caracteres de formato (Cf) y los demás invisibles", () => {
  const formato = ["\u00ad", "\u200b", "\u2060", "\ufeff", "\u200e", "\u200d", "\u3164", "\ufe0f", "\u180b", "\u17b4", "\u115f", "\uffa0", "\u{e0100}"];

  it("INVISIBLE es Cc, Cf y los demás invisibles; un espacio duro, una letra con acento u otro alfabeto no lo son", () => {
    for (const c of [...formato, "\u0009", "\u0085", "\u0000", "\u009f"]) assert.equal(INVISIBLE.test(`a${c}b`), true, JSON.stringify(c));
    for (const texto of ["José Pérez Núñez", "Ana\u00a0Ruiz", "O'Brien", "Müller & Söhne", "Łukasz Żółć", "李小龍", "محمد"]) assert.equal(INVISIBLE.test(texto), false, texto);
  });

  it("razón social del alta, proveedor, persona, área, RFC, CLABE, correo y RFC del cobro", () => {
    for (const c of formato) {
      const etiqueta = JSON.stringify(c);
      assert.deepEqual(validarAlta({ rfc: "EKU9003173C9", razonSocial: `Escuela${c}Kemper`, codigoPostal: "06600", regimen: "601", usoCfdi: "G03" }), { ok: false, codigo: "razon_social_control" }, etiqueta);
      const proveedor = erroresDeAltaProveedor({ rfc: "EKU9003173C9", razonSocial: `Proveedor${c}Uno`, clabe: "002180701150123453", archivo: null });
      assert.equal(proveedor.find((error) => error.campo === "razonSocial")?.mensaje, "La razón social trae un carácter invisible, algo común al copiar y pegar. Escríbela de nuevo a mano.", etiqueta);
      assert.equal(normalizarNombrePersona(`Ana${c}Ruiz`), null, etiqueta);
      assert.deepEqual(validarCentro({ nombre: `Ventas${c}Norte`, presupuesto: "" }), { ok: false, codigo: "centro_nombre_control" }, etiqueta);
      assert.equal(validarRfcDeAlta(`EKU900317${c}3C9`).ok, false, etiqueta);
      assert.deepEqual(clabeValida(`0021800${c}12345678906`), { ok: false, codigo: "clabe_invalida" }, etiqueta);
      assert.equal(correoOpcional(`ana${c}@lab.mx`), "invalido", etiqueta);
      const cobro = validarCobroManual({ clienteNombre: "Cliente", clienteRfc: `EKU900317${c}3C9`, concepto: "Servicio", monto: "100", fechaProbable: "2026-11-30" });
      assert.equal(cobro.ok, false, etiqueta);
    }
  });

  it("un texto libre conserva el emoji compuesto con U+200D y el selector U+FE0F (no se amplía CONTROL)", () => {
    for (const motivo of ["Revisado con la familia 👨‍👩‍👧 completa", "Gracias por el apoyo ❤️ del equipo"]) {
      assert.equal(textoOperativo(motivo, 300), motivo);
      assert.equal(textoMultilinea(motivo, 500), motivo);
      assert.equal(textoPago(motivo, 500, 10), motivo);
    }
  });

  // base-N24: el renglón de la Lista juntaba los espacios antes de buscar el control, así que «EVA\tRUIZ SOL» se
  // guardaba como «EVA RUIZ SOL». Ahora el nombre crudo se revisa primero.
  it("el renglón de la Lista con un tabulador o un carácter de formato en el nombre se rechaza", () => {
    for (const nombre of ["EVA\tRUIZ SOL", "EVA\u00adRUIZ SOL", "EVA RUIZ\u200bSOL", "EVA\u000bRUIZ SOL", "EVA RODR\u3164IGUEZ", "EVA RUIZ\ufe0f SOL"]) {
      assert.deepEqual(leerListaBloqueadas(`nombre,rfc,curp,tipo,fecha\nBien,,,fisica,\n${nombre},,,fisica,`), { ok: false, codigo: "lpb_renglon_invalido", linea: 3 }, JSON.stringify(nombre));
    }
    const bien = leerListaBloqueadas("nombre,rfc,curp,tipo,fecha\n  EVA   RUIZ SOL\t,,,fisica,");
    assert.deepEqual(bien.ok ? bien.renglones.map((r) => r.nombre) : bien, ["EVA RUIZ SOL"]);
  });

  // base-N25: el documento extranjero quitaba el tabulador, el salto y el U+000B (`\s`) y guardaba otro número.
  it("el documento extranjero con un carácter invisible se rechaza; los espacios, puntos y guiones se quitan", () => {
    for (const documento of ["X123\t4567", "X123\n4567", "X123\u000b4567", "X123\u000c4567", "X123\r4567", "X123\u200b4567", "X123\u00ad4567"]) {
      assert.equal(documentoExtranjeroNormalizado(documento), null, JSON.stringify(documento));
    }
    assert.equal(documentoExtranjeroNormalizado(" x123 45.6-7 "), "X1234567");
  });
});
