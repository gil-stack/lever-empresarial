import { NextResponse, type NextRequest } from "next/server";

import { NOMBRE_COOKIE_ENTRADA, NOMBRE_COOKIE_PORTAL } from "./server/autenticacion/cookie";
import { CABECERA_EMPRESA, CABECERA_PETICION, RUTA_SEGUNDO_FACTOR, rutaDe, separarEmpresa } from "./nucleo/rutas";
import { NOMBRE_COOKIE_ENTRADA_OPERACION, NOMBRE_COOKIE_PORTAL_OPERACION } from "./server/operacion/acceso";
import { NOMBRE_COOKIE } from "./server/session/cookie";

/**
 * Guardia central de rutas. Aquí se decide lo que no necesita la base: que
 * la ruta exista, que traiga la sesión que pide y de qué empresa habla.
 *
 * Ningún portal abre sin la cookie de sesión completa. Esa cookie solo existe
 * después de una passkey, un código TOTP o un código de respaldo. La cookie
 * `entrada` (la contraseña ya coincidió) solo abre la pantalla del segundo
 * factor. El servidor vuelve a exigir el factor en la base.
 */
export function proxy(request: NextRequest) {
  const { empresa, resto } = separarEmpresa(request.nextUrl.pathname);
  const ruta = rutaDe(resto);
  if (!ruta || (empresa && !ruta.conEmpresa)) {
    return NextResponse.rewrite(new URL("/_no-existe", request.url), { status: 404 });
  }

  const cabeceras = new Headers(request.headers);
  cabeceras.delete(CABECERA_EMPRESA);
  cabeceras.set(CABECERA_PETICION, crypto.randomUUID());
  if (empresa) cabeceras.set(CABECERA_EMPRESA, empresa);

  const completa = Boolean(request.cookies.get(NOMBRE_COOKIE)?.value);
  const operacion = resto === "/operacion" || resto.startsWith("/operacion/");
  // Cada superficie lee solo sus cookies de entrada: la del cliente no abre el
  // segundo factor de Operación, ni la de Operación el del cliente.
  const [cookieEntrada, cookiePortal] = operacion
    ? [NOMBRE_COOKIE_ENTRADA_OPERACION, NOMBRE_COOKIE_PORTAL_OPERACION]
    : [NOMBRE_COOKIE_ENTRADA, NOMBRE_COOKIE_PORTAL];
  const factor =
    Boolean(request.cookies.get(cookieEntrada)?.value) || Boolean(request.cookies.get(cookiePortal)?.value);
  const superficie = operacion ? "/operacion" : resto.startsWith("/telefono") ? "/telefono" : "/consola";
  const siguiente = `siguiente=${encodeURIComponent(superficie)}`;
  const entrada = operacion ? "/operacion/entrar" : "/entrar";
  const continuacion = operacion ? "/operacion/continuar" : RUTA_SEGUNDO_FACTOR;
  const destinoAutenticado = operacion ? "/operacion" : "/entrar/destino";
  if (ruta.acceso.tipo === "segundo_factor" && !factor) {
    return desviar(request, completa ? `${destinoAutenticado}?${siguiente}` : `${entrada}?${siguiente}`);
  }
  if ((ruta.acceso.tipo === "sesion" || ruta.acceso.tipo === "capacidad") && !completa) {
    return desviar(request, factor ? `${continuacion}?${siguiente}` : `${entrada}?${siguiente}`);
  }

  if (empresa) {
    const destino = request.nextUrl.clone();
    destino.pathname = resto;
    return NextResponse.rewrite(destino, { request: { headers: cabeceras } });
  }
  return NextResponse.next({ request: { headers: cabeceras } });
}

function desviar(request: NextRequest, destino: string): NextResponse {
  if (request.method === "GET" || request.method === "HEAD") {
    return NextResponse.redirect(new URL(destino, request.url));
  }
  return new NextResponse(null, { status: 401 });
}

// Los archivos de public/ van por nombre exacto (sin comodín de extensiones: una ruta de la app con punto
// debe seguir pasando por aquí). Sin esto el proxy reescribía /lever-email.png a 404 y los correos salían sin logo.
// tests/operacion/publicos.test.ts falla si un archivo de public/ no queda fuera.
export const config = {
  matcher: ["/((?!_next|__next|favicon\\.ico$|icon\\.svg$|lever-email\\.png$).*)"],
};
