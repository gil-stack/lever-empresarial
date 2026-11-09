"use client";

import { useEffect } from "react";

/**
 * El mensaje del error junto al campo (lo arma `MensajeDelCampo`). Sin JavaScript, el autofocus lleva la página al
 * campo. Con JavaScript, Next sube la página al terminar de navegar, después del autofocus: el campo queda con el foco
 * fuera de la pantalla. Si el campo que este mensaje describe tiene el foco y no se ve junto con su mensaje, se centra.
 */
export function MensajeJuntoAlCampo({ id, texto }: { id: string; texto: string }) {
  useEffect(() => {
    const mensaje = document.getElementById(id);
    const campo = document.activeElement;
    if (!mensaje || !(campo instanceof HTMLElement) || !(campo.getAttribute("aria-describedby") ?? "").split(" ").includes(id)) return;
    if (campo.getBoundingClientRect().top < 0 || mensaje.getBoundingClientRect().bottom > window.innerHeight) campo.scrollIntoView({ block: "center" });
  });
  return (
    <p id={id} className="error-campo">
      {texto}
    </p>
  );
}
