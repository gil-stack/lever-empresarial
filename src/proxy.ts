import { NextResponse, type NextRequest } from "next/server";

import { CABECERA_EMPRESA, CABECERA_PETICION, RUTA_SEGUNDO_FACTOR, rutaDe, separarEmpresa } from "./nucleo/rutas";
import { NOMBRE_COOKIE, NOMBRE_COOKIE_PARCIAL } from "./server/session/cookie";

/**
 * Guardia central de rutas. Aquí se decide lo que no necesita la base: que
 * la ruta exista, que traiga la sesión que pide y de qué empresa habla.
 *
 * Ningún portal abre sin la cookie de sesión completa, que solo existe
 * después de verificar el segundo factor. La cookie parcial (contraseña sola)
 * solo abre la pantalla del segundo factor. El servidor vuelve a exigir la
 * marca en la base y las capacidades con el mismo registro de rutas.
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
  const parcial = Boolean(request.cookies.get(NOMBRE_COOKIE_PARCIAL)?.value);
  if (ruta.acceso.tipo === "segundo_factor" && !parcial) return desviar(request, completa ? "/consola" : "/entrar");
  if ((ruta.acceso.tipo === "sesion" || ruta.acceso.tipo === "capacidad") && !completa) {
    return desviar(request, parcial ? RUTA_SEGUNDO_FACTOR : "/entrar");
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

export const config = {
  matcher: ["/((?!_next|__next|favicon.ico|icon.svg).*)"],
};
