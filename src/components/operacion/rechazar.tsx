"use client";

import { useId, useState } from "react";

import { BotonEnviar, Dialogo } from "@/components/sistema";

/**
 * «Rechazar» abre un diálogo que pide el motivo: rechazar no se deshace y el motivo
 * queda en la bitácora. El formulario manda `decision=rechazar` a la misma acción que aprobar.
 */
export function RechazarConMotivo({
  id,
  accion,
  que,
}: {
  id: string;
  accion: (formData: FormData) => Promise<void>;
  /** «la activación de Empresa SA» */
  que: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const campo = useId();
  return (
    <>
      <button type="button" className="boton-texto" data-atajo="rechazar" onClick={() => setAbierto(true)}>
        Rechazar
      </button>
      <Dialogo
        abierto={abierto}
        alCerrar={() => setAbierto(false)}
        titulo="Rechazar"
        explicacion={`Vas a rechazar ${que}. El motivo queda en la bitácora y no se puede editar.`}
        pie={null}
      >
        <form action={accion} className="operacion-dialogo-forma">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="decision" value="rechazar" />
          <div className="campo">
            <label htmlFor={campo}>Motivo</label>
            <textarea id={campo} name="motivo" maxLength={500} required />
          </div>
          <div className="dialogo-pie">
            <button type="button" className="boton-texto" onClick={() => setAbierto(false)}>
              Cancelar
            </button>
            <BotonEnviar>Rechazar</BotonEnviar>
          </div>
        </form>
      </Dialogo>
    </>
  );
}
