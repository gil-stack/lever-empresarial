"use client";

import { useState, type InputHTMLAttributes } from "react";

export function CampoContrasena(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);
  const etiqueta = visible ? "Ocultar contraseña" : "Mostrar contraseña";

  return (
    <div className="campo-contrasena">
      <input {...props} type={visible ? "text" : "password"} />
      <button
        type="button"
        className="campo-contrasena-boton"
        aria-label={etiqueta}
        aria-controls={props.id}
        aria-pressed={visible}
        title={etiqueta}
        onClick={() => setVisible((actual) => !actual)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" />
          <circle cx="12" cy="12" r="2.7" />
          {visible ? <path d="m4 4 16 16" /> : null}
        </svg>
      </button>
    </div>
  );
}
