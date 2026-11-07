import { startTransition, useState, type FormEvent } from "react";

/**
 * Con `<form action>`, React vacía los campos no controlados al terminar la
 * acción aunque ésta devuelva un error: un importe corregido regresaría en
 * silencio al original y los archivos elegidos se perderían. Este envío pasa
 * por la misma acción, con el botón que la disparó, sin ese reinicio.
 */
export function enviarSinReiniciar(accion: (datos: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const boton = (event.nativeEvent as SubmitEvent).submitter;
    const datos = new FormData(event.currentTarget, boton);
    startTransition(() => accion(datos));
  };
}

/**
 * Para un formulario con dos botones que envía con `enviarSinReiniciar`:
 * `useFormStatus` no trae los datos del envío, así que el formulario recuerda
 * qué botón se oprimió. Solo ese recibe el pendiente y dice «Enviando…»; el
 * otro únicamente se desactiva.
 */
export function useEnvioConBoton(accion: (datos: FormData) => void) {
  const [oprimido, setOprimido] = useState<string | null>(null);
  const enviar = (event: FormEvent<HTMLFormElement>) => {
    const boton = (event.nativeEvent as SubmitEvent).submitter;
    setOprimido(boton instanceof HTMLButtonElement ? boton.value : null);
    enviarSinReiniciar(accion)(event);
  };
  return { enviar, oprimido };
}
