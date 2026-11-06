import { startTransition, type FormEvent } from "react";

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
