import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  REGIMENES,
  USOS_CFDI,
  conNombre,
  etiquetaAccion,
  etiquetaCategoria,
  motivoDeEntrega,
} from "../../src/components/operacion/formato.ts";

describe("textos de Operación", () => {
  it("nombra el régimen y el uso CFDI que ofrece el alta, y deja intacta una clave desconocida", () => {
    assert.equal(conNombre(REGIMENES, "601"), "601 · General de ley");
    assert.equal(conNombre(USOS_CFDI, "G03"), "G03 · Gastos en general");
    assert.equal(conNombre(REGIMENES, "999"), "999");
  });

  it("explica por qué no salió un correo sin enseñar códigos que no conoce", () => {
    assert.equal(motivoDeEntrega("correo_no_disponible"), "El proveedor de correo no respondió.");
    assert.equal(motivoDeEntrega("correo_deshabilitado"), "El correo está apagado en este entorno.");
    assert.equal(motivoDeEntrega("codigo_nuevo"), null);
    assert.equal(motivoDeEntrega(null), null);
  });

  it("pone acentos a la categoría de una alerta", () => {
    assert.equal(etiquetaCategoria("comision"), "Comisión");
    assert.equal(etiquetaCategoria("activacion"), "Activación");
    assert.equal(etiquetaCategoria("otra"), "otra");
  });

  it("traduce las acciones conocidas de la bitácora y deja el código en las demás", () => {
    assert.equal(etiquetaAccion("entrada_completa"), "Entró");
    assert.equal(etiquetaAccion("comision_aprobada"), "Autorizó una comisión");
    assert.equal(etiquetaAccion("alta_proveedor"), null);
  });
});
