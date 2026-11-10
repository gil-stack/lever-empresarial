"use client";

import { useEffect } from "react";

/**
 * El mensaje del error junto al campo (lo arma `MensajeDelCampo`). Va entre la etiqueta y el control: el navegador
 * desplaza la página hasta el campo con el foco, y así el mensaje queda a la vista aunque el campo quede a medio
 * asomar (sin JavaScript no hay más ayuda que esa). Con JavaScript, Next sube la página al terminar de navegar, después
 * del autofocus: si el campo que este mensaje describe tiene el foco y el mensaje queda bajo las barras de arriba o el
 * campo fuera de la ventana, se centra el mensaje.
 */
export function MensajeJuntoAlCampo({ id, texto }: { id: string; texto: string }) {
  useEffect(() => {
    const mensaje = document.getElementById(id);
    const campo = document.activeElement;
    if (!mensaje || !(campo instanceof HTMLElement) || !(campo.getAttribute("aria-describedby") ?? "").split(" ").includes(id)) return;
    const barras = [".barra-movil", ".barra-superior"]
      .map((selector) => document.querySelector(selector)?.getBoundingClientRect())
      .filter((caja) => caja !== undefined && caja.top <= 1 && caja.height > 0)
      .reduce((tapa, caja) => Math.max(tapa, caja!.bottom), 0);
    const cajaCampo = campo.getBoundingClientRect();
    if (mensaje.getBoundingClientRect().top < barras || cajaCampo.top + Math.min(cajaCampo.height, 40) > window.innerHeight) {
      mensaje.scrollIntoView({ block: "center" });
    }
  });
  return (
    <p id={id} className="error-campo error-antes-del-control">
      {texto}
    </p>
  );
}
