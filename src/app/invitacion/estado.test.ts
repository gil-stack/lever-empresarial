import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { rechazoDeInvitacion } from "./estado.ts";

describe("rechazo al aceptar una invitación", () => {
  it("con la empresa suspendida, el aviso dice el motivo real y no marca las contraseñas", () => {
    assert.deepEqual(rechazoDeInvitacion("empresa_suspendida"), {
      tipo: "invalido",
      titulo: "La empresa está suspendida",
      mensaje: "Por ahora no admite cuentas nuevas. Comunícate con Lever.",
      deLaContrasena: false,
    });
  });

  it("solo lo escrito en la contraseña marca los campos", () => {
    for (const codigo of ["contrasena_invalida", "contrasenas_distintas", "credenciales_invalidas"]) {
      assert.equal(rechazoDeInvitacion(codigo).tipo === "invalido" && rechazoDeInvitacion(codigo).deLaContrasena, true, codigo);
    }
    for (const codigo of ["invitacion_vencida", "invitacion_usada", "invitacion_cerrada", "empresa_suspendida", "base_no_disponible"]) {
      assert.equal(rechazoDeInvitacion(codigo).tipo === "invalido" && rechazoDeInvitacion(codigo).deLaContrasena, false, codigo);
    }
  });

  it("un código desconocido no se muestra y no culpa al campo", () => {
    assert.deepEqual(rechazoDeInvitacion("algo_raro"), {
      tipo: "invalido", titulo: "No se aceptó", mensaje: "No se pudo aceptar. Vuelve a intentar.", deLaContrasena: false,
    });
  });
});
