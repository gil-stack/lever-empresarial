"use client";

import { useActionState, useEffect, useId, useState } from "react";

import { rechazarConMotivoAccion, type EstadoDelRechazo } from "@/app/operacion/acciones";
import { BotonEnviar, Dialogo } from "@/components/sistema";

import { AvisoOperacion, errorDelCampo } from "./aviso";

const SIN_AVISO: EstadoDelRechazo = { aviso: null, motivo: "", vuelta: 0 };

/**
 * «Rechazar» abre un diálogo que pide el motivo: rechazar no se deshace y el motivo queda en la
 * bitácora. Si el servidor no acepta el motivo, el diálogo sigue abierto con lo escrito, el aviso
 * ligado al campo y el foco en él (la clave `vuelta` vuelve a montar el campo con ese texto).
 */
export function RechazarConMotivo({
  id,
  tipo,
  que,
}: {
  id: string;
  tipo: "activacion" | "comision" | "suspension";
  /** «la activación de Empresa SA» */
  que: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [estado, accion] = useActionState(rechazarConMotivoAccion, SIN_AVISO);
  const campo = useId();
  const aviso = `${campo}-aviso`;
  useEffect(() => {
    if (estado.vuelta) document.getElementById(campo)?.focus();
  }, [estado.vuelta, campo]);
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
          <input type="hidden" name="tipo" value={tipo} />
          <AvisoOperacion codigo={estado.aviso} id={aviso} />
          <div className="campo">
            <label htmlFor={campo}>Motivo (de 10 a 500 caracteres)</label>
            <textarea
              key={estado.vuelta}
              id={campo}
              name="motivo"
              minLength={10}
              maxLength={500}
              required
              defaultValue={estado.motivo}
              {...errorDelCampo(estado.aviso, "motivo", aviso)}
            />
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
