"use client";

import { useEffect } from "react";

/**
 * El mensaje del error junto al campo (lo arma `MensajeDelCampo`). Va entre la etiqueta y el control. Sin JavaScript es
 * el destino del fragmento de la respuesta (`permalinkDelRechazo`): el navegador lo alinea bajo las barras con su
 * `scroll-margin-top` y el primer Tab entra al campo. Con JavaScript el formulario le da el foco al campo y Next sube la
 * página al terminar de navegar: si el mensaje queda bajo las barras de arriba o el campo fuera de la ventana, se centra
 * el mensaje.
 */
export function MensajeJuntoAlCampo({ id, texto }: { id: string; texto: string }) {
  // Con JavaScript, al aparecer el mensaje el foco va al campo que describe (sin autofocus: las páginas que marcan el
  // campo con el aviso de la dirección no tienen otro que lo haga). Una sola vez por mensaje.
  useEffect(() => {
    if (document.activeElement && (document.activeElement.getAttribute("aria-describedby") ?? "").split(" ").includes(id)) return;
    const control = document.querySelector<HTMLElement>(`[aria-describedby~="${CSS.escape(id)}"]`);
    (control instanceof HTMLFieldSetElement ? control.querySelector<HTMLElement>("input, select, textarea") : control)?.focus({ preventScroll: true });
  }, [id]);
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
