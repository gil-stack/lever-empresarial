import type { CorreoPlantilla } from "../tipos";
import { armarCorreo } from "./marco";

export type DatosResumenSemanal = {
  razonSocial: string;
  /** Lunes de la semana del resumen, ya en palabras («9 de noviembre de 2026»). */
  semana: string;
  /** «$100,000.00 al 5 de noviembre» o null si la empresa no ha declarado saldo. */
  saldoDeclarado: string | null;
  salidas4: string;
  entradas4: string;
  alcance: string;
  /** La primera semana en problemas, ya en palabras, o null. */
  faltante: string | null;
  cobrosVencidos: string | null;
  presupuestos: readonly string[];
  enlace: string;
};

/**
 * El resumen de los lunes. Cada cifra dice de dónde sale: lo comprometido sale
 * de la plataforma; el saldo, de lo que la empresa declaró. Nada se presenta
 * como confirmado por un banco.
 */
export function plantillaResumenSemanal(datos: DatosResumenSemanal): CorreoPlantilla {
  const parrafos = [
    datos.faltante
      ? `Atención: ${datos.faltante}`
      : "Con lo comprometido y lo que esperas cobrar, ninguna de las próximas 13 semanas cae por debajo de cero ni de tu colchón.",
    ...(datos.presupuestos.length > 0 ? [`Presupuestos: ${datos.presupuestos.join(" ")}`] : []),
  ];
  return armarCorreo(`Tu flujo de la semana · ${datos.razonSocial}`, {
    preencabezado: `Lo que sale, lo que entra y hasta dónde alcanza el saldo de ${datos.razonSocial}.`,
    kicker: `Semana del ${datos.semana}`,
    // El cuerpo nombra a la empresa: quien administra varias recibe un correo por cada una.
    titulo: `Tu flujo de caja de la semana · ${datos.razonSocial}`,
    parrafos,
    datos: [
      ["Saldo declarado por tu empresa", datos.saldoDeclarado ?? "Sin declarar"],
      ["Sale en 4 semanas (comprometido)", datos.salidas4],
      ["Entra en 4 semanas (cobros esperados)", datos.entradas4],
      ["Alcance del saldo", datos.alcance],
      ...(datos.cobrosVencidos ? ([["Cobros vencidos", datos.cobrosVencidos]] as const) : []),
    ],
    boton: { texto: "Ver el flujo en Lever", url: datos.enlace },
    notas: [
      "Lo comprometido sale de la nómina, los pagos a proveedores y las obligaciones registrados en Lever. El saldo es el último que declaró tu empresa; Lever no lo confirma con el banco.",
      "Puedes dejar de recibir este resumen desde Flujo de caja › Saldo y alertas.",
    ],
  });
}
