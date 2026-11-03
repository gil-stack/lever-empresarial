"use client";

import { useActionState } from "react";

import { enviarAceptacion } from "@/app/precios/acciones";
import { FORMULARIO_INICIAL } from "@/app/precios/estado";

export function FormularioAceptar() {
  const [estado, accion, pendiente] = useActionState(enviarAceptacion, FORMULARIO_INICIAL);
  const invalido = estado.tipo === "invalido";

  return (
    <form className="alta-formulario aceptar" action={accion} noValidate>
      {invalido ? (
        <div className="alerta" role="alert">
          <p className="alerta-titulo">No se registró</p>
          <p>{estado.mensaje}</p>
        </div>
      ) : null}
      <div className="campo-confirmacion">
        <label className="confirmacion">
          <input
            type="checkbox"
            name="clienteAcepto"
            value="si"
            aria-invalid={invalido ? true : undefined}
            required
          />
          <span>El cliente aceptó el monto publicado.</span>
        </label>
      </div>
      <div className="acciones">
        <button type="submit" className="boton" disabled={pendiente}>
          {pendiente ? "Registrando…" : "Registrar como aceptada"}
        </button>
      </div>
    </form>
  );
}
