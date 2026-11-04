"use client";

import { useActionState } from "react";

import { guardarCopia69b } from "@/app/consola/lista-69b/acciones";
import { FORMULARIO_INICIAL } from "@/app/consola/lista-69b/estado";
import { Aviso } from "@/components/sistema";

export function FormularioCargar() {
  const [estado, accion, pendiente] = useActionState(guardarCopia69b, FORMULARIO_INICIAL);

  return (
    <form action={accion}>
      {estado.tipo === "guardado" ? (
        <Aviso tono="asentado" titulo="Quedó la copia">
          <p>{estado.mensaje}</p>
        </Aviso>
      ) : null}
      {estado.tipo === "invalido" ? (
        <Aviso tono="revisar" titulo="No se guardó">
          <p>{estado.mensaje}</p>
        </Aviso>
      ) : null}
      <p className="pista">
        El servidor descarga el listado y deja la copia anterior. La consulta usa la más reciente.
      </p>
      <div className="acciones">
        <button type="submit" className="boton" disabled={pendiente}>
          {pendiente ? "Guardando…" : "Guardar el listado"}
        </button>
      </div>
    </form>
  );
}
