// Precarga de diagnóstico para `next start` (solo evidencia local, nunca en producción):
//   NODE_OPTIONS="--import ./scripts/evidencia/medir-fetch-interno.mjs" next start
// Escribe en la salida de error cuánto tarda cada fetch que hace el propio servidor. Sirve
// para separar, en /operacion/entrar, el tiempo de la acción del fetch interno con que Next
// arma la página a la que redirige la acción. Solo registra método, ruta, estado y
// milisegundos: nada de cabeceras, galletas ni cuerpos.
const original = globalThis.fetch;
globalThis.fetch = async function (entrada, opciones) {
  const url = new URL(typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url);
  const inicio = performance.now();
  const respuesta = await original.call(this, entrada, opciones);
  console.error(`[fetch-interno] ${url.pathname} ${respuesta.status} ${Math.round(performance.now() - inicio)} ms`);
  return respuesta;
};
