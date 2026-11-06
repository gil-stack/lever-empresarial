"use client";

import { useActionState } from "react";

import { guardarCopia69b } from "@/app/consola/lista-69b/acciones";
import { FORMULARIO_INICIAL } from "@/app/consola/lista-69b/estado";
import { Aviso, BotonEnviar } from "@/components/sistema";

export function FormularioCargar() {
  const [estado, accion, pendiente] = useActionState(guardarCopia69b, FORMULARIO_INICIAL);

  return (
    <form action={accion} aria-busy={pendiente}>
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
      <p className="pista">La copia anterior se conserva; las consultas usan la más reciente.</p>
      <div className="acciones">
        <BotonEnviar pendiente={pendiente} enviando="Descargando…">Guardar el listado</BotonEnviar>
      </div>
    </form>
  );
}
