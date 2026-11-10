import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";

import { AvisoOperacion, avisoConocido, avisoDeCampo, errorDelCampo, MensajeDelCampo, tonoDelAviso } from "./aviso.tsx";

describe("aviso de Operación", () => {
  it("solo lo que quedó hecho se anuncia como asentado", () => {
    for (const codigo of ["alerta_cerrada", "alerta_creada", "decision_registrada", "invitacion_enviada", "comision_solicitada"]) {
      assert.equal(tonoDelAviso(codigo), "asentado", codigo);
    }
    for (const codigo of ["alerta_ya_cerrada", "solicitud_ya_decidida", "comision_ya_decidida", "invitacion_fallida", "motivo_invalido", "desconocido"]) {
      assert.equal(tonoDelAviso(codigo), "revisar", codigo);
    }
  });

  it("una alerta que ya estaba cerrada es un rechazo: role=alert, no status", () => {
    const html = renderToStaticMarkup(createElement(AvisoOperacion, { codigo: "alerta_ya_cerrada" }));
    assert.match(html, /role="alert"/);
    assert.doesNotMatch(html, /role="status"/);
  });

  it("cada error de Recuperaciones marca su propio campo", () => {
    assert.deepEqual(errorDelCampo("motivo_invalido", "motivo"), { "aria-invalid": true, "aria-describedby": "aviso-operacion-campo", autoFocus: true });
    assert.deepEqual(errorDelCampo("motivo_invalido", "verificacion"), {});
    assert.deepEqual(errorDelCampo("verificacion_invalida", "verificacion"), { "aria-invalid": true, "aria-describedby": "aviso-operacion-campo", autoFocus: true });
    assert.deepEqual(errorDelCampo("verificacion_invalida", "motivo"), {});
  });

  // Una identidad con un carácter invisible se ve bien en pantalla: el aviso dice qué pasó (no «el formato»), marca
  // su campo y le da el foco. Un nombre mal formado sin invisibles conserva el aviso de formato.
  it("el carácter invisible tiene su propio aviso por campo; el formato conserva el suyo", () => {
    const texto = (codigo: string) => renderToStaticMarkup(createElement(AvisoOperacion, { codigo }));
    assert.match(texto("invisible_nombre"), /El nombre trae un carácter invisible, algo común al copiar y pegar\. Escríbelo de nuevo a mano\./);
    assert.match(texto("invisible_razonSocial"), /La razón social trae un carácter invisible, algo común al copiar y pegar\. Escríbela de nuevo a mano\./);
    assert.match(texto("invisible_folio"), /El folio trae un carácter invisible, algo común al copiar y pegar\. Escríbelo de nuevo a mano\./);
    assert.match(texto("razon_social_control"), /La razón social trae un carácter invisible/);
    // serv-nuevo-6b: cada fecha del reporte dice cuál revisar.
    assert.match(texto("dato_invalido_presentadoEl"), /Revisa la fecha de presentación del reporte/);
    assert.match(texto("dato_invalido_avisoClienteEl"), /Revisa la fecha del aviso al cliente/);
    assert.match(texto("dato_invalido_nombre"), /Revisa el campo marcado: el dato no tiene el formato esperado\./);
    assert.doesNotMatch(texto("dato_invalido_nombre"), /invisible/);
    for (const [codigo, campo] of [["invisible_nombre", "nombre"], ["invisible_razonSocial", "razonSocial"], ["invisible_folio", "folio"]] as const) {
      assert.deepEqual(errorDelCampo(codigo, campo, "aviso-representante"), { "aria-invalid": true, "aria-describedby": "aviso-representante-campo", autoFocus: true }, codigo);
      assert.deepEqual(errorDelCampo(codigo, "rfc"), {}, codigo);
    }
  });

  // Décima revisión: avisoDeCampo coincide con los códigos que `errorDelCampo` marca. Doceava: con él, el resumen de un
  // aviso de campo se pinta sin región viva (el foco en el campo ya lo anuncia).
  it("avisoDeCampo dice qué avisos son de un campo, los mismos que marca errorDelCampo", () => {
    for (const [codigo, campo] of [
      ["archivo_demasiado_grande", "archivo"],
      ["archivo_no_admitido", "archivo"],
      ["motivo_corto", "motivo"],
      ["dato_invalido_presentadoEl", "presentadoEl"],
      ["invisible_razonSocial", "razonSocial"],
    ] as const) {
      assert.equal(avisoDeCampo(codigo), true, codigo);
      assert.equal(errorDelCampo(codigo, campo).autoFocus, true, codigo);
    }
    for (const codigo of ["expediente_datos_incompletos", "expediente_ausente", "expediente_documento_cargado", "toString", "constructor", ""]) {
      assert.equal(avisoDeCampo(codigo), false, codigo);
    }
  });

  // Onceava revisión: el texto del error va junto al campo y es su descripción; el aviso de arriba queda como resumen.
  it("MensajeDelCampo pinta junto al campo el mismo texto del aviso, con el id que nombra errorDelCampo; sin error, nada", () => {
    const pintar = (codigo: string | null, campo: string, idAviso?: string) =>
      renderToStaticMarkup(createElement(MensajeDelCampo, { codigo, campo, ...(idAviso ? { idAviso } : {}) }));
    for (const [codigo, campo, texto] of [
      ["archivo_no_admitido", "archivo", "Sube un PDF, PNG o JPG legible."],
      ["motivo_invalido", "motivo", "Escribe un motivo breve y claro."],
      ["dato_invalido_capital", "capital", "Revisa el campo marcado: el dato no tiene el formato esperado."],
      ["invisible_razonSocial", "razonSocial", "La razón social trae un carácter invisible, algo común al copiar y pegar. Escríbela de nuevo a mano."],
    ] as const) {
      // Doceava revisión: el mensaje va entre la etiqueta y el control (patrón GOV.UK), con su propia clase.
      assert.equal(pintar(codigo, campo), `<p id="aviso-operacion-campo" class="error-campo error-antes-del-control">${texto}</p>`, codigo);
      assert.ok(renderToStaticMarkup(createElement(AvisoOperacion, { codigo })).includes(texto), codigo);
      assert.equal(errorDelCampo(codigo, campo)["aria-describedby"], "aviso-operacion-campo", codigo);
    }
    assert.match(pintar("dato_invalido_capital", "capital", "aviso-accionista"), /^<p id="aviso-accionista-campo"/);
    // Otro campo, un aviso general o ninguno: no pinta nada (sin error, la página no cambia).
    for (const [codigo, campo] of [["dato_invalido_capital", "votos"], ["expediente_datos_incompletos", "giro"], [null, "archivo"], ["toString", "toString"]] as const) {
      assert.equal(pintar(codigo, campo), "", `${codigo} ${campo}`);
    }
  });

  // Doceava revisión (revisor del servidor): el valor y la vigencia de una comisión, su tipo y el responsable de una
  // alerta marcan su campo; antes el valor quedaba marcado sin foco ni mensaje, apuntando al resumen.
  it("los rechazos de comisiones, invitaciones y alertas son de su campo", () => {
    const texto = (codigo: string) => renderToStaticMarkup(createElement(AvisoOperacion, { codigo }));
    for (const [codigo, campo] of [
      ["comision_valor_invalido", "valor"],
      ["comision_tipo_invalido", "tipo"],
      ["vigencia_invalida", "vigenteDesde"],
      ["vigencia_solapada", "vigenteDesde"],
      ["responsable_invalido", "responsableId"],
      ["dato_invalido_nombre", "nombre"],
      ["dato_invalido_correo", "correo"],
      ["dato_invalido_titulo", "titulo"],
      ["dato_invalido_detalle", "detalle"],
    ] as const) {
      assert.equal(avisoDeCampo(codigo), true, codigo);
      assert.equal(errorDelCampo(codigo, campo).autoFocus, true, codigo);
      assert.doesNotMatch(texto(codigo), /No se pudo completar/, codigo);
    }
    // Humo-N3 del preview: el correo inválido tiene su propio mensaje, no el del formato en general.
    assert.match(texto("dato_invalido_correo"), /Escribe un correo válido, como nombre@empresa\.mx\./);
  });

  // Doceava revisión (accesibilidad): en un formulario que muestra su propio aviso, el resumen de un aviso de campo no es
  // región viva; el campo con el foco ya lo lee como su descripción. El de la página y los que no son de un campo sí.
  it("el resumen de un aviso de campo en su formulario no es región viva", () => {
    const pintar = (codigo: string, id?: string) => renderToStaticMarkup(createElement(AvisoOperacion, { codigo, ...(id ? { id } : {}) }));
    assert.doesNotMatch(pintar("motivo_corto", "aviso-suspension"), /role=/);
    assert.match(pintar("suspension_pendiente", "aviso-suspension"), /role="alert"/);
    assert.match(pintar("motivo_corto"), /role="alert"/);
    assert.match(pintar("expediente_documento_cargado"), /role="status"/);
  });
  // Doceava revisión: la cookie del rechazo y la dirección vienen de fuera; solo un código del catálogo se pinta o se nombra.
  it("avisoConocido acepta los códigos del catálogo y rechaza lo inventado; data-aviso no copia un valor de fuera", () => {
    for (const codigo of ["dictamen_ya_registrado", "motivo_corto", "dato_invalido_presentadoEl", "invisible_razonSocial"]) {
      assert.equal(avisoConocido(codigo), true, codigo);
    }
    for (const codigo of ["", "toString", "constructor", "__proto__", "codigo_inventado", "dato_invalido_", "dato_invalido_<b>x</b>", "invisible_a b"]) {
      assert.equal(avisoConocido(codigo), false, codigo);
    }
    const html = renderToStaticMarkup(createElement(AvisoOperacion, { codigo: "codigo_inventado" }));
    assert.match(html, /data-aviso="desconocido"/);
    assert.doesNotMatch(html, /inventado/);
    // Un campo fuera de la lista cerrada o algo sin forma de código no se pinta: ni texto, ni data-aviso, ni id del campo.
    for (const codigo of ["dato_invalido_<b>x</b>", 'invisible_" onfocus="x', "dato_invalido_inventado", "<script>x</script>", "a b"]) {
      assert.equal(avisoConocido(codigo), false, codigo);
      assert.equal(renderToStaticMarkup(createElement(AvisoOperacion, { codigo })), "", codigo);
    }
  });

  it("la lista cerrada de campos cubre cada dato_invalido_ e invisible_ que lanza el código, y los datos generales", () => {
    const raiz = new URL("../../", import.meta.url);
    const fuentes = (readdirSync(raiz, { recursive: true }) as string[])
      .filter((ruta) => /\.(ts|tsx)$/.test(ruta) && !/\.test\.tsx?$/.test(ruta))
      .map((ruta) => readFileSync(new URL(ruta, raiz), "utf8"));
    const lanzados = new Set(fuentes.flatMap((texto) => [...texto.matchAll(/"((?:dato_invalido|invisible)_[A-Za-z]+)"/g)].map((m) => m[1]!)));
    // El único código armado al vuelo: `dato_invalido_${clave}` con las claves de CAMPOS_DATOS.
    const expediente = readFileSync(new URL("server/operacion/expediente.ts", raiz), "utf8");
    const bloque = expediente.slice(expediente.indexOf("const CAMPOS_DATOS"), expediente.indexOf("];", expediente.indexOf("const CAMPOS_DATOS")));
    const claves = [...bloque.matchAll(/^\s*\["([A-Za-z]+)"/gm)].map((m) => `dato_invalido_${m[1]}`);
    assert.equal(claves.length, 17);
    assert.ok(lanzados.size > 20);
    for (const codigo of [...lanzados, ...claves]) assert.equal(avisoConocido(codigo), true, codigo);
  });
});
