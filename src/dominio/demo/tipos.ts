/**
 * Los datos de ejemplo de Altamar Logística, la empresa de demostración del
 * diseño de los socios (fPlat.script0.js, «Plataforma v6»). Solo se pintan en
 * empresas marcadas `demostracion`; la regla vive en src/server/demo. Los
 * montos van en centavos enteros; lo que el diseño muestra como texto (un
 * porcentaje, «En curso») va como texto.
 */

/** Una cifra clave de la fila de arriba (KPI del diseño): rótulo, valor y nota. */
export type CifraDemo = {
  readonly rotulo: string;
  readonly valor: string;
  readonly nota: string;
  /** «aviso» pinta el valor en ámbar, como el diseño hace con lo que espera revisión. */
  readonly tono?: "aviso" | "peligro";
  /** Avance de 0 a 1 para la barra fina bajo la cifra. */
  readonly avance?: number;
};

/** Un estado dicho con un punto de color, como `.badge` del diseño. */
export type EstadoDemo = { readonly texto: string; readonly tono: "acento" | "aviso" | "peligro" | "tenue" | "azul" };

/** Una acción que en el diseño mueve dinero o crea algo: en la demostración va apagada. */
/** El rango de un deslizador de monto (`input type="range"` del diseño). */
export type RangoDemo = { readonly minimoCentavos: number; readonly maximoCentavos: number; readonly pasoCentavos: number };

export type AccionDemo = { readonly etiqueta: string; readonly tipo: "principal" | "secundaria" | "fantasma" };

/** Congela un objeto y todo lo que contiene: los datos de ejemplo son de solo lectura. */
export function congelar<T>(valor: T): T {
  if (valor && typeof valor === "object" && !Object.isFrozen(valor)) {
    for (const hijo of Object.values(valor as Record<string, unknown>)) congelar(hijo);
    Object.freeze(valor);
  }
  return valor;
}
