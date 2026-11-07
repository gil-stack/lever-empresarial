// Guarda de los preloads de los recorridos (blob-local y correo-local). Cada uno
// la llama al cargarse, antes de mirar su propia variable: si alguien copia su
// NODE_OPTIONS fuera de una prueba, el proceso truena con este error en lugar de
// arrancar con un desvío de Blob o un correo falso.

function apuntaALocal(url) {
  try {
    const { hostname } = new URL(url);
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
}

/** Lanza un error si el proceso no es el servidor de una prueba local. */
export function exigirEntornoDePrueba(preload, entorno = process.env) {
  const motivos = [];
  if (entorno.VERCEL_ENV !== undefined) motivos.push("VERCEL_ENV está definido");
  if (entorno.NODE_ENV === "production" && entorno.E2E_SERVER_ACTIONS !== "1") {
    motivos.push("NODE_ENV=production sin E2E_SERVER_ACTIONS=1");
  }
  if (!apuntaALocal(entorno.DATABASE_URL)) motivos.push("DATABASE_URL no apunta a 127.0.0.1 ni a localhost");
  if (motivos.length > 0) throw new Error(`${preload} se niega a cargar: ${motivos.join("; ")}.`);
}
