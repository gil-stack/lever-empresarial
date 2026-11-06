/**
 * En producción toda cookie de acceso lleva el prefijo `__Host-`: el navegador
 * solo la acepta con Secure, Path=/ y sin Domain, así que un subdominio no la
 * puede fijar ni leer. En desarrollo (`next dev` sobre http://localhost) el
 * nombre queda sin prefijo para no depender de cómo trate cada navegador el
 * prefijo fuera de https. `next build` y `next start` corren en producción.
 */
export function nombreDeCookie(base: string, entorno: string | undefined = process.env.NODE_ENV): string {
  return entorno === "production" ? `__Host-${base}` : base;
}
