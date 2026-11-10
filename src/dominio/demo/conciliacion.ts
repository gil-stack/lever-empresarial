import { congelar, type AccionDemo, type CifraDemo, type EstadoDemo } from "./tipos";

export type ExcepcionDemo = { readonly titulo: string; readonly detalle: string; readonly grave: boolean; readonly acciones: readonly AccionDemo[] };
export type FuenteDemo = { readonly titulo: string; readonly detalle: string; readonly estado: EstadoDemo; readonly alerta?: string };
export type ConciliadoDemo = {
  readonly fecha: string;
  readonly movimiento: string;
  readonly origen: string;
  readonly centavos: number;
  readonly empate: string;
  readonly porque: string;
  readonly poliza: string;
};

export type ConciliacionDemo = {
  readonly cifras: readonly CifraDemo[];
  readonly porRevisar: readonly ExcepcionDemo[];
  readonly fuentes: readonly FuenteDemo[];
  readonly recientes: readonly ConciliadoDemo[];
  readonly nota: string;
};

const aMano: AccionDemo = { etiqueta: "A mano", tipo: "fantasma" };

export const CONCILIACION_DEMO: ConciliacionDemo = congelar({
  cifras: [
    { rotulo: "Conciliado automático", valor: "99.5%", nota: "1,277 de 1,283 movimientos de octubre", avance: 0.995 },
    { rotulo: "Por revisar", valor: "6", nota: "Solo lo que no cuadra", tono: "aviso" },
    { rotulo: "Pólizas generadas", valor: "1,277", nota: "Con UUID e IVA separado, listas para tu sistema contable" },
    { rotulo: "Cierre de octubre", valor: "En curso", nota: "6 excepciones antes de cerrar" },
  ],
  porRevisar: [
    { titulo: "CFDI cancelado por el emisor", grave: true, detalle: "Fiesta Inn Querétaro · $4,215.00 · BBVA ••7302 del 16 oct. El hotel canceló la factura FQ-55102 después del pago.", acciones: [aMano, { etiqueta: "Pedir la factura de nuevo", tipo: "secundaria" }] },
    { titulo: "Posible pago duplicado", grave: false, detalle: "Empaques y Tarimas del Norte · dos SPEI de $34,880.00 con la misma factura F-1187, el 9 y el 10 oct.", acciones: [aMano, { etiqueta: "Marcar el segundo como anticipo", tipo: "secundaria" }] },
    { titulo: "Depósito sin factura de ingreso", grave: false, detalle: "Depósito SPEI · Santander · $200,000.00 del 14 oct. No encontramos un CFDI emitido por ese monto.", acciones: [aMano, { etiqueta: "Ligar a F-A-0331 · Grupo Comercial Delta", tipo: "secundaria" }] },
    { titulo: "Falta el complemento de pago", grave: false, detalle: "Mantenimiento Industrial Lerma · factura PPD por $41,760.00 pagada el 30 sep. Aún no emite el REP.", acciones: [aMano, { etiqueta: "Pedir el complemento", tipo: "secundaria" }] },
    { titulo: "Proveedor en la lista 69-B", grave: true, detalle: "Servicios Integrales Delta, S.A. de C.V. (SID170830PL1) · factura por $58,000.00. Podría no ser deducible.", acciones: [{ etiqueta: "Ir a Proveedores", tipo: "secundaria" }] },
    { titulo: "2 gastos con tarjeta sin CFDI", grave: false, detalle: "$1,409.00 en total. Ya le pedimos la factura a cada persona en su app; el IVA se recupera en cuanto llegue.", acciones: [{ etiqueta: "Ver en Gastos", tipo: "secundaria" }] },
  ],
  fuentes: [
    { titulo: "Cuenta Lever", detalle: "CLABE ••6789 · en tiempo real", estado: { texto: "Nativa", tono: "acento" } },
    { titulo: "Tarjetas Lever", detalle: "en tiempo real", estado: { texto: "Nativa", tono: "acento" } },
    { titulo: "BBVA ••7302", detalle: "Solo lectura vía agregador · hoy, 07:00", estado: { texto: "Conexión directa", tono: "tenue" } },
    { titulo: "Santander ••0932", detalle: "Octubre · PDF subido el 1 nov", estado: { texto: "Estado de cuenta", tono: "azul" }, alerta: "Subir el de noviembre" },
    { titulo: "Correo de facturas Lever", detalle: "facturas.altamar@lever.mx · 64 XML nuevos", estado: { texto: "Nativa", tono: "acento" } },
    { titulo: "Validación del SAT", detalle: "Cada CFDI, vigente o cancelado · hoy, 07:00", estado: { texto: "Sin e.firma", tono: "tenue" } },
  ],
  recientes: [
    { fecha: "17 oct", movimiento: "Pago internacional · Shenzhen Hengtai", origen: "Cuenta Lever · SWIFT", centavos: 28164200, empate: "Factura extranjera HT-2026-1043", porque: "TC FIX del DOF · diferencia cambiaria", poliza: "Eg-0530" },
    { fecha: "21 oct", movimiento: "Pago internacional · Logística Ibérica", origen: "Cuenta Lever · SEPA", centavos: 7566400, empate: "Factura extranjera F-2026/0388", porque: "TC FIX del DOF · diferencia cambiaria", poliza: "Eg-0531" },
    { fecha: "15 oct", movimiento: "Nómina · 1a quincena de octubre", origen: "Cuenta Lever · 10 SPEI", centavos: 17188000, empate: "10 recibos de nómina (CFDI)", porque: "Recibo por persona · RFC y monto", poliza: "Eg-0600" },
    { fecha: "30 sep", movimiento: "Nómina · 2a quincena de septiembre", origen: "Cuenta Lever · 10 SPEI", centavos: 17094000, empate: "10 recibos de nómina (CFDI)", porque: "Recibo por persona · RFC y monto", poliza: "Eg-0601" },
    { fecha: "22 oct", movimiento: "Pemex · Gasolinera 4512", origen: "Combustible ••8833", centavos: 185000, empate: "Correo Lever", porque: "RFC, monto y fecha · vigente en el SAT", poliza: "Eg-0412" },
    { fecha: "21 oct", movimiento: "Uber", origen: "Viáticos ••2291", centavos: 31250, empate: "Reenviada", porque: "Monto y referencia · vigente en el SAT", poliza: "Eg-0413" },
    { fecha: "21 oct", movimiento: "Amazon México", origen: "Compras ••5170", centavos: 251020, empate: "Reenviada", porque: "Monto y referencia · vigente en el SAT", poliza: "Eg-0414" },
    { fecha: "20 oct", movimiento: "AutoZone", origen: "Combustible ••8833", centavos: 59200, empate: "Factura al pagar", porque: "Folio de la terminal", poliza: "Eg-0415" },
    { fecha: "20 oct", movimiento: "Office Depot", origen: "Compras ••5170", centavos: 642080, empate: "Factura al pagar", porque: "Folio de la terminal", poliza: "Eg-0416" },
    { fecha: "20 oct", movimiento: "Amazon Web Services", origen: "Virtual · AWS ••1182", centavos: 81240, empate: "Reenviada", porque: "Monto y referencia · vigente en el SAT", poliza: "Eg-0417" },
  ],
  nota: "Lever liga cada movimiento de tus bancos, de la cuenta y de las tarjetas con su CFDI por RFC, monto, fecha, método de pago y referencia SPEI. Cada empate guarda su porqué y se convierte en póliza con su UUID, centro de costos e IVA separado. Cada CFDI se valida en el SAT al llegar y otra vez a los 30 y 72 días y antes del cierre; si lo cancelan, el gasto vuelve a pendiente.",
});
