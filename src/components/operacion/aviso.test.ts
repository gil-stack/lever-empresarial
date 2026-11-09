import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";

import { AvisoOperacion, errorDelCampo, tonoDelAviso } from "./aviso.tsx";

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
    assert.deepEqual(errorDelCampo("motivo_invalido", "motivo"), { "aria-invalid": true, "aria-describedby": "aviso-operacion", autoFocus: true });
    assert.deepEqual(errorDelCampo("motivo_invalido", "verificacion"), {});
    assert.deepEqual(errorDelCampo("verificacion_invalida", "verificacion"), { "aria-invalid": true, "aria-describedby": "aviso-operacion", autoFocus: true });
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
      assert.deepEqual(errorDelCampo(codigo, campo, "aviso-representante"), { "aria-invalid": true, "aria-describedby": "aviso-representante", autoFocus: true }, codigo);
      assert.deepEqual(errorDelCampo(codigo, "rfc"), {}, codigo);
    }
  });
});
