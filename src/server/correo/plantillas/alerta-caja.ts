import { fraseRunwayDelAviso, type AlcanceRunway } from "../../../dominio/flujo/runway";
import type { CorreoPlantilla } from "../tipos";
import { armarCorreo } from "./marco";

export type DatosAlertaCaja = {
  razonSocial: string;
  /** El faltante en palabras (el mismo texto del correo de los lunes), si cruzó el colchón. */
  colchon: string | null;
  /** El runway conservador, si bajó del mínimo: la frase sale completa para cada caso (r64-N1). */
  runway: AlcanceRunway | null;
  /** El runway conservador de hoy en palabras, siempre. */
  conservador: string;
  /** «3 meses». */
  minimo: string;
  saldoDeclarado: string;
  /** El runway esperado en palabras, para contexto. */
  esperado: string;
  enlace: string;
};

/**
 * El aviso de caja: sale una sola vez cuando la caja proyectada cruza el colchón
 * o el runway conservador baja del mínimo. Nada se presenta como confirmado
 * por un banco; la nómina de una sola persona no lleva monto.
 */
export function plantillaAlertaCaja(datos: DatosAlertaCaja): CorreoPlantilla {
  const motivos = [
    ...(datos.colchon ? [`Caja proyectada: ${datos.colchon}`] : []),
    ...(datos.runway ? [fraseRunwayDelAviso(datos.runway, datos.minimo)] : []),
  ];
  const asunto = datos.colchon && datos.runway
    ? `Aviso de caja: debajo del colchón y runway corto · ${datos.razonSocial}`
    : datos.colchon
      ? `Aviso de caja: la caja proyectada baja de tu colchón · ${datos.razonSocial}`
      : `Aviso de caja: runway debajo de ${datos.minimo} · ${datos.razonSocial}`;
  return armarCorreo(asunto, {
    preencabezado: `Un cambio en la caja proyectada de ${datos.razonSocial}. No se repite mientras siga igual.`,
    kicker: "Aviso de caja",
    titulo: `La caja de ${datos.razonSocial} necesita atención`,
    parrafos: [
      ...motivos,
      "Revisa qué lo provoca y qué puedes mover en Flujo de caja. Este aviso no se repite mientras la situación siga igual; si se corrige y vuelve a pasar, te avisamos otra vez.",
    ],
    datos: [
      ["Saldo declarado por tu empresa", datos.saldoDeclarado],
      ["Runway conservador (sin entradas estimadas)", datos.conservador],
      ["Runway esperado (con cobranza estimada)", datos.esperado],
      ["Tu mínimo", datos.minimo],
    ],
    boton: { texto: "Ver el flujo en Lever", url: datos.enlace },
    notas: [
      "El runway conservador cuenta tu saldo declarado, lo comprometido (nómina, pagos a proveedores, obligaciones) y lo que ya registraste por cobrar. El esperado suma los cobros que tus planes de cobranza todavía no generan. Lever no confirma el saldo con el banco.",
      "Recibes este aviso con el resumen de los lunes; puedes dejar de recibir los dos desde Flujo de caja › Saldo y alertas.",
    ],
  });
}
