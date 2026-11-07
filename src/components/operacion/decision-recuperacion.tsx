"use client";

import { useRef, useState, type FormEvent } from "react";

import { BotonEnviar } from "@/components/sistema";

type ErrorDeCampo = { "aria-invalid"?: true; "aria-describedby"?: string };

/**
 * Aprobar o rechazar una recuperación. Nada se decide sin elegirlo:
 * - el método de verificación arranca vacío y aprobar lo exige (el servidor también);
 * - la nota es un área de texto, así que Enter escribe una línea y no envía;
 * - rechazar no necesita método (`formNoValidate`); el servidor le exige la nota.
 */
export function DecisionRecuperacion({
  id,
  accion,
  errorMetodo,
  errorNota,
}: {
  id: string;
  accion: (datos: FormData) => Promise<void>;
  /** El error que el servidor devolvió para el método o la nota, ligado al aviso de la página. */
  errorMetodo: ErrorDeCampo;
  errorNota: ErrorDeCampo;
}) {
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
    <form action={accion} className="operacion-decision-forma">
      <input type="hidden" name="id" value={id} />
      <div className="campo">
        <label htmlFor={`verificacion-${id}`}>Cómo verificaste la identidad</label>
        <select
          ref={metodo}
          id={`verificacion-${id}`}
          name="verificacion"
          defaultValue=""
          required
          onInvalid={alFaltarMetodo}
          onChange={() => setSinMetodo(false)}
          {...(sinMetodo ? { "aria-invalid": true, "aria-describedby": idError } : errorMetodo)}
        >
          <option value="" disabled>
            Elige cómo verificaste
          </option>
          <option value="videollamada">Videollamada</option>
          <option value="presencial">En persona</option>
        </select>
        {sinMetodo ? (
          <p id={idError} className="error-campo">
            Elige cómo verificaste la identidad para aprobar.
          </p>
        ) : null}
      </div>
      <div className="campo">
        <label htmlFor={`nota-${id}`}>Nota (obligatoria para rechazar)</label>
        <textarea id={`nota-${id}`} name="nota" maxLength={500} rows={2} {...errorNota} />
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
