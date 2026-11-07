// Se carga en `next start` con NODE_OPTIONS=--import, solo desde tests/e2e/entorno.ts.
// Sin E2E_BLOB_LOCAL_URL no hace nada.
//
// get() de @vercel/blob lee el almacén privado con el fetch del paquete undici en
// https://<almacén>.private.blob.vercel-storage.com/<ruta>. Ese fetch y el de Node
// comparten el despachador global (Symbol.for("undici.globalDispatcher.1")).
// Aquí se envuelve ese despachador: solo las peticiones a *.blob.vercel-storage.com
// cambian de destino a GET <emulador>/almacen/<ruta>; todo lo demás sale igual.
const destino = process.env.E2E_BLOB_LOCAL_URL;

if (destino) {
  // Node crea su despachador global con la primera petición; esta lo crea para conservarlo.
  const salud = await fetch(`${destino}/salud`);
  if (!salud.ok) throw new Error("El emulador de Blob no respondió.");
  const SIMBOLO = Symbol.for("undici.globalDispatcher.1");
  const interno = globalThis[SIMBOLO];
  if (!interno) throw new Error("No se encontró el despachador global de Node.");
  const local = new URL(destino);

  globalThis[SIMBOLO] = new Proxy(interno, {
    get(objetivo, propiedad) {
      if (propiedad === "dispatch") {
        return (opciones, manejador) => {
          const origen = new URL(String(opciones.origin));
          if (origen.protocol !== "https:" || !origen.hostname.endsWith(".blob.vercel-storage.com")) {
            return objetivo.dispatch(opciones, manejador);
          }
          const encabezados =
            opciones.headers && !Array.isArray(opciones.headers) && typeof opciones.headers === "object"
              ? Object.fromEntries(Object.entries(opciones.headers).filter(([nombre]) => nombre.toLowerCase() !== "host"))
              : opciones.headers;
          return objetivo.dispatch({ ...opciones, origin: local.origin, path: `/almacen${opciones.path}`, headers: encabezados }, manejador);
        };
      }
      const valor = Reflect.get(objetivo, propiedad, objetivo);
      return typeof valor === "function" ? valor.bind(objetivo) : valor;
    },
  });
}
