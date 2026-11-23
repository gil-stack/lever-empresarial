import { refresh } from "next/cache";
import { cookies } from "next/headers";

import { ErrorDeDominio } from "@/server/session";

/**
 * Lo que vuelve a un formulario de Operación cuando el servidor lo rechaza: el aviso, lo capturado y la vuelta (que
 * vuelve a montar los campos con lo capturado). Nada de esto pasa por la dirección. Sin JavaScript, React se lo
 * entrega al mismo formulario en la página que responde al envío. `detalle` es una línea más bajo el aviso.
 */
export type EstadoDelFormulario = {
  aviso: string | null;
  valores: Record<string, string>;
  vuelta: number;
  detalle?: string;
  /** La invitación emitida cuyo correo no salió: su enlace, para copiarlo (solo en la respuesta de ese envío). */
  enlace?: string;
  /** El cliente de prueba que acaba de quedar dado de alta (alta rápida): para pintar el resultado en la misma pantalla. */
  clienteDePrueba?: { id: string; razonSocial: string; correo: string; entrega: string; tarjetas: string | null };
};

/** El código del rechazo, para la página que responde a ese mismo envío (ver `rechazado` y `PaginaOperacion`). */
export const COOKIE_RECHAZO = "operacion-rechazo";

/** Una acción de Operación con su formulario: devuelve el rechazo; lo que queda hecho redirige con su aviso. */
export type AccionConAviso = (previo: EstadoDelFormulario, formData: FormData) => Promise<EstadoDelFormulario>;

/** Lo capturado en esos campos, como texto (un archivo no vuelve: el navegador no deja rellenar ese campo). */
export function capturado(formData: FormData, campos: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    campos.map((campo) => {
      const valor = formData.get(campo);
      return [campo, typeof valor === "string" ? valor : ""];
    }),
  );
}

/**
 * Un rechazo del dominio vuelve al formulario con lo capturado; cualquier otro error sigue su camino. La página se
 * vuelve a pintar con lo que hay en la base (otra persona pudo cambiar algo entre la vista y el envío), sin perder el
 * formulario ni lo escrito.
 *
 * Si con eso el formulario ya no se pinta (la empresa dejó de estar activa, el dictamen ya se registró, otra persona
 * resolvió la coincidencia), su aviso se iría con él. Por eso el código va también en una cookie que la página que
 * responde a este envío lee y pinta arriba cuando ningún formulario lo muestra (`PaginaOperacion`). Va vencida
 * (`maxAge: 0`): Next copia las cookies de la acción a ese repintado (`synchronizeMutableCookies`, también sin
 * JavaScript) y el navegador no la guarda, así que no llega a ninguna otra página. Lleva solo el código, nunca ids ni
 * datos, y la página lo valida contra el catálogo al leerlo. Depende de Next 16.4.4; la protege la e2e «si otra pestaña
 * ya registró el dictamen» (tests/e2e/operacion.spec.ts).
 */
export async function rechazado(
  previo: EstadoDelFormulario,
  error: unknown,
  formData: FormData,
  campos: readonly string[],
  aviso?: string,
): Promise<EstadoDelFormulario> {
  if (!(error instanceof ErrorDeDominio)) throw error;
  const codigo = aviso ?? error.codigo;
  (await cookies()).set(COOKIE_RECHAZO, codigo, {
    maxAge: 0,
    path: "/operacion",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });
  refresh();
  return { aviso: codigo, valores: capturado(formData, campos), vuelta: previo.vuelta + 1 };
}
