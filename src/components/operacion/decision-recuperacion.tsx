"use client";

import { useRef, useState, type FormEvent } from "react";

import type { AccionConAviso } from "@/app/operacion/rechazo";
import { BotonEnviar } from "@/components/sistema";

import { useFormularioConAviso } from "./formulario-con-aviso";

const METODOS = ["videollamada", "presencial"];

/**
 * Aprobar o rechazar una recuperación. Nada se decide sin elegirlo:
 * - el método de verificación arranca vacío y aprobar lo exige (el servidor también);
 * - la nota es un área de texto, así que Enter escribe una línea y no envía;
 * - rechazar no necesita método (`formNoValidate`); el servidor le exige la nota.
 *
 * Cada tarjeta lleva su formulario con la clave de la solicitud: si el servidor lo rechaza, el aviso vuelve a esa
 * tarjeta con el método y la nota como se escribieron, el campo marcado y con el foco.
 */
export function DecisionRecuperacion({ id, accion }: { id: string; accion: AccionConAviso }) {
  const { forma, enviar, vuelta, valor, ligado, mensaje, resumen } = useFormularioConAviso(accion, `aviso-recuperacion-${id}`);
  const metodo = useRef<HTMLSelectElement>(null);
  const [sinMetodo, setSinMetodo] = useState(false);
  const idError = `verificacion-${id}-error`;

  function alFaltarMetodo(evento: FormEvent<HTMLSelectElement>) {
    // El mensaje va junto al campo en vez de la burbuja del navegador.
    evento.preventDefault();
    setSinMetodo(true);
    metodo.current?.focus();
    // El atajo «A» de la Bandeja devuelve el foco a la fila en el siguiente cuadro: se regresa al método después.
    requestAnimationFrame(() => requestAnimationFrame(() => metodo.current?.focus()));
  }

  return (
    <form key={vuelta} ref={forma} action={enviar} className="operacion-decision-forma">
      <input type="hidden" name="id" value={id} />
      {resumen}
      <div className="campo">
        <label htmlFor={`verificacion-${id}`}>Cómo verificaste la identidad</label>
        {sinMetodo ? (
          <p id={idError} className="error-campo error-antes-del-control">
            Elige cómo verificaste la identidad para aprobar.
          </p>
        ) : (
          mensaje("verificacion")
        )}
        <select
          ref={metodo}
          id={`verificacion-${id}`}
          name="verificacion"
          defaultValue={METODOS.includes(valor("verificacion")) ? valor("verificacion") : ""}
          required
          onInvalid={alFaltarMetodo}
          onChange={() => setSinMetodo(false)}
          {...(sinMetodo ? { "aria-invalid": true, "aria-describedby": idError } : ligado("verificacion"))}
        >
          <option value="" disabled>
            Elige cómo verificaste
          </option>
          <option value="videollamada">Videollamada</option>
          <option value="presencial">En persona</option>
        </select>
      </div>
      <div className="campo">
        <label htmlFor={`nota-${id}`}>Nota (obligatoria para rechazar)</label>
        {/* El servidor rechaza la nota como «motivo» (corto o vacío). */}
        {mensaje("motivo")}
        <textarea id={`nota-${id}`} name="nota" maxLength={500} rows={2} defaultValue={valor("nota")} {...ligado("motivo")} />
      </div>
      <div className="operacion-decision-botones">
        <BotonEnviar className="boton-texto" name="decision" value="rechazar" data-atajo="rechazar" formNoValidate>
          Rechazar
        </BotonEnviar>
        <BotonEnviar name="decision" value="aprobar" data-atajo="aprobar">
          Aprobar
        </BotonEnviar>
      </div>
    </form>
  );
}
