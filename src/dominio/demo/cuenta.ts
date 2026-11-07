import { congelar, type AccionDemo } from "./tipos";

export type MovimientoCuentaDemo = { readonly fecha: string; readonly hora: string; readonly concepto: string; readonly detalle: string; readonly centavos: number };

export type CuentaDemo = {
  readonly titular: string;
  readonly saldoCentavos: number;
  readonly enTarjetas: string;
  readonly acciones: readonly AccionDemo[];
  readonly clabe: string;
  readonly clabeNota: string;
  readonly movimientos: readonly MovimientoCuentaDemo[];
};

export const CUENTA_DEMO: CuentaDemo = congelar({
  titular: "Altamar Logística",
  saldoCentavos: 128456040,
  enTarjetas: "Más $320,878.20 asignados a tarjetas",
  acciones: [
    { etiqueta: "Fondear", tipo: "principal" },
    { etiqueta: "Asignar a una tarjeta", tipo: "secundaria" },
    { etiqueta: "Transferir por SPEI", tipo: "secundaria" },
    { etiqueta: "Pago internacional", tipo: "secundaria" },
    { etiqueta: "Invertir a plazo fijo", tipo: "secundaria" },
    { etiqueta: "Estados de cuenta", tipo: "secundaria" },
  ],
  // La CLABE de ejemplo del diseño: no es una cuenta que reciba dinero.
  clabe: "718 180 00012345678 9",
  clabeNota: "A nombre de Altamar Logística, S.A. de C.V. · transferencias SPEI las 24 horas",
  movimientos: [
    { fecha: "22 oct", hora: "09:03", concepto: "Asignación a Lever Silver ••6767", detalle: "Eduardo", centavos: -2500000 },
    { fecha: "21 oct", hora: "17:20", concepto: "Depósito SPEI · BBVA", detalle: "Altamar Logística", centavos: 35000000 },
    { fecha: "20 oct", hora: "10:00", concepto: "Disposición de la línea de crédito", detalle: "Otorgada por tu SOFIPO", centavos: 12000000 },
    { fecha: "18 oct", hora: "12:41", concepto: "Asignación a Compras ••5170", detalle: "Daniela Ruiz", centavos: -6000000 },
    { fecha: "15 oct", hora: "09:00", concepto: "Pago de la línea de crédito", detalle: "Mensualidad de octubre", centavos: -3845000 },
    { fecha: "14 oct", hora: "16:05", concepto: "Depósito SPEI · Santander", detalle: "Altamar Logística", centavos: 20000000 },
  ],
});
