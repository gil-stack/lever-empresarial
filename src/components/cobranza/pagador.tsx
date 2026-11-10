"use client";

import { useActionState, useState } from "react";

import { enviarSinRecordatorios, type EstadoSinRecordatorios } from "@/app/pagar/[token]/acciones";
import { BotonEnviar } from "@/components/sistema/boton-enviar";

export function CopiarTexto({ valor, etiqueta }: { valor: string; etiqueta: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      className="boton-texto boton-chico"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(valor);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 2000);
        } catch {
          setCopiado(false);
        }
      }}
    >
      <span aria-live="polite">{copiado ? "Copiado" : etiqueta}</span>
    </button>
  );
}

const INICIAL: EstadoSinRecordatorios = { tipo: "inicial" };

export function SinRecordatorios({ token, razonSocial }: { token: string; razonSocial: string }) {
  const [estado, accion, pendiente] = useActionState(enviarSinRecordatorios, INICIAL);
  if (estado.tipo === "hecho") {
    return (
      <p className="arco-nota" role="status" data-sin-recordatorios="hecho">
        Listo: ya no te mandaremos recordatorios. Avisamos a {razonSocial}. El cobro de cada periodo te sigue llegando.
      </p>
    );
  }
  return (
    <form action={accion} aria-busy={pendiente} data-formulario="sin-recordatorios" className="pagador-sin-recordatorios">
      <input type="hidden" name="token" value={token} />
      {estado.tipo === "rechazado" ? <p className="error-campo" role="alert">{estado.mensaje}</p> : null}
      <BotonEnviar className="boton-texto boton-chico" pendiente={pendiente} enviando="Guardando…">No quiero recibir recordatorios</BotonEnviar>
      <p className="pista">El cobro de cada periodo te sigue llegando; solo dejan de llegar los avisos antes y después del vencimiento.</p>
    </form>
  );
}
