"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import type { AccionConAviso, EstadoDelFormulario } from "@/app/operacion/rechazo";

import { AvisoOperacion, errorDelCampo, MensajeDelCampo, permalinkDelRechazo } from "./aviso";

const SIN_AVISO: EstadoDelFormulario = { aviso: null, valores: {}, vuelta: 0 };
/** Lo emite un formulario rechazado: el resumen de arriba de la página (el aviso del envío anterior) ya no aplica. */
const RECHAZO = "operacion:rechazo";

/**
 * El aviso vigente de un formulario con `useActionState`. La página marca un solo campo a la vez: al enviarse otro
 * formulario de la página, el aviso de este se descarta y lo capturado se queda. Cada rechazo nuevo le avisa a la
 * página para que oculte el resumen de arriba (`ResumenDelEnvio`).
 */
export function useAvisoVigente(estado: { aviso: string | null; vuelta: number }, forma: RefObject<HTMLFormElement | null>): string | null {
  const [descartado, setDescartado] = useState(0);
  useEffect(() => {
    if (!estado.vuelta) return;
    document.dispatchEvent(new Event(RECHAZO));
    const otroEnvio = (evento: Event) => {
      if (evento.target !== forma.current) setDescartado(estado.vuelta);
    };
    document.addEventListener("submit", otroEnvio, true);
    return () => document.removeEventListener("submit", otroEnvio, true);
  }, [estado.vuelta, forma]);
  return estado.vuelta > 0 && descartado === estado.vuelta ? null : estado.aviso;
}

/**
 * Un formulario de Operación que, si el servidor lo rechaza, vuelve sin recargar con lo capturado, su aviso arriba
 * del formulario, el campo marcado con su mensaje junto a él y el foco en ese campo. Lo que queda hecho redirige con
 * su aviso, como antes. El formulario lleva `key={vuelta}`, `ref={forma}` y `action={enviar}`.
 */
export function useFormularioConAviso(accion: AccionConAviso, idAviso: string) {
  const [estado, enviar] = useActionState(accion, SIN_AVISO, permalinkDelRechazo(idAviso));
  const forma = useRef<HTMLFormElement>(null);
  const aviso = useAvisoVigente(estado, forma);
  useEffect(() => {
    if (estado.vuelta) forma.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [estado.vuelta]);
  return {
    forma,
    enviar,
    vuelta: estado.vuelta,
    aviso,
    /** Lo capturado en el último rechazo; si no hubo, lo que había. */
    valor: (campo: string, porOmision = "") => estado.valores[campo] ?? porOmision,
    ligado: (campo: string) => errorDelCampo(aviso, campo, idAviso),
    mensaje: (campo: string) => <MensajeDelCampo codigo={aviso} campo={campo} idAviso={idAviso} />,
    resumen: <AvisoOperacion codigo={aviso} id={idAviso} detalle={estado.detalle} />,
  };
}

/**
 * El aviso de un rechazo cuyo formulario ya no se pinta (otra persona cambió el registro): lo pinta la página que
 * responde al envío, arriba (`PaginaOperacion`). Si el formulario sí se pinta con su aviso, el CSS lo oculta
 * (`.aviso-sin-formulario`, también sin JavaScript). Al enviarse otro formulario se descarta, como el de un formulario.
 */
export function AvisoSinFormulario({ children }: { children: ReactNode }) {
  const [vigente, setVigente] = useState(true);
  useEffect(() => {
    const descartar = () => setVigente(false);
    document.addEventListener("submit", descartar, true);
    return () => document.removeEventListener("submit", descartar, true);
  }, []);
  return vigente ? <div className="aviso-sin-formulario">{children}</div> : null;
}

/**
 * El aviso de la dirección (lo que dejó el último envío que se aplicó) arriba de la página. Si después un formulario
 * de la página se rechaza sin recargar, su aviso va en ese formulario y este resumen ya no aplica: se oculta.
 */
export function ResumenDelEnvio({ children }: { children: ReactNode }) {
  const [vigente, setVigente] = useState(true);
  useEffect(() => {
    const ocultar = () => setVigente(false);
    document.addEventListener(RECHAZO, ocultar);
    return () => document.removeEventListener(RECHAZO, ocultar);
  }, []);
  return vigente ? children : null;
}
