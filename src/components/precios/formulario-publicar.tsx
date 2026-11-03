"use client";

import { useActionState } from "react";

import { enviarPublicacion } from "@/app/precios/acciones";
import { FORMULARIO_INICIAL } from "@/app/precios/estado";

export function FormularioPublicar() {
  const [estado, accion, pendiente] = useActionState(enviarPublicacion, FORMULARIO_INICIAL);
  const invalido = estado.tipo === "invalido";

  return (
    <section className="publicar" aria-labelledby="publicar-titulo">
      <p className="formulario-kicker">Operador</p>
      <h2 id="publicar-titulo">Publicar el monto</h2>
      <p className="lede">Una vez, en pesos. La página y la consola quedan con la misma cifra.</p>
      <form className="alta-formulario" action={accion} noValidate>
        {invalido ? (
          <div className="alerta" role="alert">
            <p className="alerta-titulo">No se publicó</p>
            <p>{estado.mensaje}</p>
          </div>
        ) : null}
        <div className="campo">
          <label htmlFor="monto">Suscripción mensual, en pesos</label>
          <input
            id="monto"
            name="monto"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            maxLength={20}
            aria-invalid={invalido ? true : undefined}
            aria-describedby="monto-pista"
            required
          />
          <p className="pista" id="monto-pista">
            Con punto decimal y hasta dos centavos. Sin un monto de ejemplo: el campo sigue vacío hasta que lo
            publiques.
          </p>
        </div>
        <div className="acciones">
          <button type="submit" className="boton" disabled={pendiente}>
            {pendiente ? "Publicando…" : "Publicar el monto"}
          </button>
        </div>
      </form>
    </section>
  );
}
