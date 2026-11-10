"use client";

import { useActionState, useEffect } from "react";

import { enviarMinimo } from "@/app/consola/flujo/acciones-runway";
import { enviarSinReiniciar } from "@/components/proveedores/sin-reinicio";
import { BotonEnviar } from "@/components/sistema";

import { ESTADO_MINIMO_INICIAL } from "./estado-minimo";
import { AvisoFlujo, Campo, describe } from "./formularios";

const ID = "meses-minimos";

/**
 * El mínimo de meses del aviso de runway. Con JavaScript envía sin vaciar el
 * campo; sin JavaScript el formulario va directo a la acción del servidor y la
 * página regresa con el rechazo, el campo marcado y lo que se escribió.
 */
export function FormularioMinimo({ meses }: { meses: number }) {
  const [estado, despachar, pendiente] = useActionState(enviarMinimo, ESTADO_MINIMO_INICIAL);
  const error = estado.tipo === "invalido" ? estado.errores.find((e) => e.campo === "meses")?.mensaje : undefined;
  useEffect(() => {
    if (estado.tipo === "invalido") document.getElementById(ID)?.focus();
  }, [estado]);
  return (
    <form action={despachar} onSubmit={enviarSinReiniciar(despachar)} noValidate aria-busy={pendiente} className="flujo-formulario" data-formulario="runway">
      <AvisoFlujo estado={estado} />
      <Campo id={ID} etiqueta="Avísame si el runway baja de" pista="Meses, de 1 a 12. Se compara con el runway conservador." error={error}>
        <input
          id={ID}
          name="meses"
          inputMode="numeric"
          autoComplete="off"
          defaultValue={estado.escrito ?? String(meses)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describe(ID, error, true)}
        />
      </Campo>
      <div className="acciones">
        <BotonEnviar pendiente={pendiente} className="boton-texto">Guardar el mínimo</BotonEnviar>
      </div>
    </form>
  );
}
