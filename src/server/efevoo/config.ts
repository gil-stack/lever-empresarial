/**
 * Configuración de Efevoo por entorno: EFEVOO_URL, EFEVOO_API_USER,
 * EFEVOO_API_KEY y EFEVOO_AMBIENTE (`sandbox` o `produccion`). Sin las cuatro,
 * la integración queda apagada y Tarjetas funciona como antes. Producción
 * (VERCEL_ENV=production) solo con `produccion`; preview y local solo con
 * `sandbox`. El host del sandbox es test-intgapi.efevoopay.com (la variable de
 * la colección, test-test-…, no resuelve). En sandbox también se acepta un
 * http://127.0.0.1 o http://localhost: el Efevoo falso de las pruebas.
 *
 * Excepción temporal (decisión del dueño, 23/11/2026, mientras llegan las llaves
 * reales): producción acepta `sandbox` solo si además EFEVOO_SANDBOX_EN_PRODUCCION
 * vale exactamente `si`. Sin esa variable, la regla de siempre.
 */

export type AmbienteEfevoo = "sandbox" | "produccion";
export type ConfigEfevoo = { url: string; usuario: string; llave: string; ambiente: AmbienteEfevoo };

export type MotivoApagado =
  | "sin_configuracion"
  | "ambiente_no_valido"
  | "url_no_valida"
  | "credenciales_no_validas"
  | "sandbox_en_produccion"
  | "produccion_fuera_de_produccion";

const RUTA = "/v1/apiservice";
// Los valores de ejemplo de la colección de Postman de Efevoo. No son de nadie.
const DE_EJEMPLO = new Set(["Efevoo Pay", "User Key"]);

export function leerConfigEfevoo(
  env: Readonly<Record<string, string | undefined>> = process.env,
): { config: ConfigEfevoo } | { config: null; motivo: MotivoApagado } {
  const crudaUrl = env.EFEVOO_URL?.trim() ?? "";
  const usuario = env.EFEVOO_API_USER?.trim() ?? "";
  const llave = env.EFEVOO_API_KEY?.trim() ?? "";
  const ambiente = env.EFEVOO_AMBIENTE?.trim() ?? "";
  if (!crudaUrl || !usuario || !llave || !ambiente) return { config: null, motivo: "sin_configuracion" };
  if (ambiente !== "sandbox" && ambiente !== "produccion") return { config: null, motivo: "ambiente_no_valido" };
  if (DE_EJEMPLO.has(usuario) || DE_EJEMPLO.has(llave) || /\s/.test(usuario) || /\s/.test(llave) || llave.length < 8) {
    return { config: null, motivo: "credenciales_no_validas" };
  }
  let url: URL;
  try {
    url = new URL(crudaUrl);
  } catch {
    return { config: null, motivo: "url_no_valida" };
  }
  const local = url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (!(url.protocol === "https:" || (local && ambiente === "sandbox")) || url.username || url.password || url.search || url.hash) {
    return { config: null, motivo: "url_no_valida" };
  }
  const produccion = env.VERCEL_ENV === "production";
  if (produccion && ambiente === "sandbox" && env.EFEVOO_SANDBOX_EN_PRODUCCION?.trim() !== "si") return { config: null, motivo: "sandbox_en_produccion" };
  if (!produccion && ambiente === "produccion") return { config: null, motivo: "produccion_fuera_de_produccion" };
  const base = url.pathname.replace(/\/+$/, "");
  return { config: { url: `${url.origin}${base.endsWith(RUTA) ? base : `${base}${RUTA}`}`, usuario, llave, ambiente } };
}

let avisoDeApagado = false;

/** La configuración vigente, o nulo: Tarjetas sigue como antes. Avisa una vez si está mal puesta (sin la llave). */
export function configEfevoo(env: Readonly<Record<string, string | undefined>> = process.env): ConfigEfevoo | null {
  const leida = leerConfigEfevoo(env);
  if (leida.config) return leida.config;
  if (leida.motivo !== "sin_configuracion" && !avisoDeApagado) {
    avisoDeApagado = true;
    console.error(JSON.stringify({ nivel: "error", origen: "efevoo", evento: "efevoo_apagado", motivo: leida.motivo }));
  }
  return null;
}
