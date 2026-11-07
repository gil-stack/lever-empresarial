"use client";

import { useState } from "react";

import { TOPE_ARCHIVO_BYTES } from "@/dominio/archivos";

/**
 * Campo de archivo que revisa el tamaño en el navegador antes de enviar: un archivo
 * que pasa del tope no sale (la plataforma lo cortaría antes de llegar a la acción).
 * El aviso queda ligado al campo y el formulario no se envía mientras siga marcado.
 */
export function CampoArchivo({
  id,
  name,
  accept,
  mensaje,
  required = false,
  ligado = {},
}: {
  id: string;
  name: string;
  accept: string;
  mensaje: string;
  required?: boolean;
  /** El error que devolvió el servidor para este campo (errorDelCampo). */
  ligado?: Record<string, unknown>;
}) {
  const [excede, setExcede] = useState(false);
  const delServidor = typeof ligado["aria-describedby"] === "string" ? ligado["aria-describedby"] : undefined;
  return (
    <>
      <input
        id={id}
        name={name}
        type="file"
        accept={accept}
        required={required}
        aria-invalid={excede || ligado["aria-invalid"] === true ? true : undefined}
        aria-describedby={excede ? `${id}-error` : delServidor}
        onChange={(evento) => {
          const archivo = evento.currentTarget.files?.[0];
          const grande = archivo !== undefined && archivo.size > TOPE_ARCHIVO_BYTES;
          evento.currentTarget.setCustomValidity(grande ? mensaje : "");
          setExcede(grande);
        }}
      />
      {excede ? (
        <p id={`${id}-error`} className="error-campo" role="alert">
          {mensaje}
        </p>
      ) : null}
    </>
  );
}
