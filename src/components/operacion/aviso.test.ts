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
    assert.deepEqual(errorDelCampo("motivo_invalido", "motivo"), { "aria-invalid": true, "aria-describedby": "aviso-operacion" });
    assert.deepEqual(errorDelCampo("motivo_invalido", "verificacion"), {});
    assert.deepEqual(errorDelCampo("verificacion_invalida", "verificacion"), { "aria-invalid": true, "aria-describedby": "aviso-operacion" });
    assert.deepEqual(errorDelCampo("verificacion_invalida", "motivo"), {});
  });
});
