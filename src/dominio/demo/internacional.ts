import { congelar, type CifraDemo, type EstadoDemo } from "./tipos";

export type BeneficiarioDemo = { readonly corto: string; readonly nombre: string; readonly pais: string; readonly moneda: string; readonly via: string };
export type PagoEnviadoDemo = { readonly fecha: string; readonly proveedor: string; readonly detalle: string; readonly monto: string; readonly pesosCentavos: number; readonly tipoCambio: string; readonly estado: EstadoDemo; readonly comprobante: string };
export type ContabilidadDemo = { readonly titulo: string; readonly detalle: string };

export type InternacionalDemo = {
  readonly cifras: readonly CifraDemo[];
  readonly beneficiarios: readonly BeneficiarioDemo[];
  readonly elegido: number;
  readonly monto: string;
  readonly montoNota: string;
  readonly tipoCambio: string;
  readonly comision: string;
  readonly comisionVia: string;
  readonly saleCentavos: number;
  readonly factura: string;
  readonly facturaDetalle: string;
  readonly enviar: string;
  readonly contabilidad: readonly ContabilidadDemo[];
  readonly enviados: readonly PagoEnviadoDemo[];
  readonly nota: string;
};

export const INTERNACIONAL_DEMO: InternacionalDemo = congelar({
  cifras: [
    { rotulo: "Enviado en octubre", valor: "$357,306", nota: "2 pagos a proveedores del extranjero" },
    { rotulo: "En camino", valor: "1", nota: "Te avisamos cuando se acrediten", tono: "aviso" },
    { rotulo: "Dólar hoy", valor: "$18.42", nota: "FIX del DOF $18.39 · euro $19.96" },
    { rotulo: "Proveedores en el extranjero", valor: "4", nota: "Estados Unidos, China, España y Canadá" },
  ],
  beneficiarios: [
    { corto: "Pacific Packaging", nombre: "Pacific Packaging Supply Inc.", pais: "Estados Unidos", moneda: "USD", via: "ACH" },
    { corto: "Shenzhen Hengtai", nombre: "Shenzhen Hengtai Pallet Co., Ltd.", pais: "China", moneda: "USD", via: "SWIFT" },
    { corto: "Logística Ibérica", nombre: "Logística Ibérica, S.L.", pais: "España", moneda: "EUR", via: "SEPA" },
    { corto: "Northern Fleet", nombre: "Northern Fleet Parts Ltd.", pais: "Canadá", moneda: "CAD", via: "SWIFT" },
  ],
  elegido: 0,
  monto: "12500.00",
  montoNota: "Monto en USD para Pacific Packaging Supply Inc.",
  tipoCambio: "1 USD = $18.42",
  comision: "$95.00",
  comisionVia: "Comisión · ACH",
  saleCentavos: 23034500,
  factura: "Factura INV-88412",
  facturaDetalle: "Bank of America · ABA 026009593 · ••4471. Llega el mismo día hábil. La factura se liga sola al pago y a la póliza.",
  enviar: "Enviar USD 12,500.00",
  contabilidad: [
    { titulo: "Tipo de cambio del DOF", detalle: "Cada pago se registra al tipo de cambio FIX que publica Banxico en el DOF." },
    { titulo: "Diferencia cambiaria", detalle: "Lo que cambia entre el día de la factura y el del pago se calcula y va a la póliza." },
    { titulo: "Proveedor extranjero en la DIOT", detalle: "La factura del extranjero se guarda como comprobante y el proveedor entra a la DIOT con su número fiscal." },
    { titulo: "Importaciones", detalle: "Si pagas mercancía, liga el pedimento y el IVA de importación queda acreditable." },
  ],
  enviados: [
    { fecha: "17 oct", proveedor: "Shenzhen Hengtai Pallet Co., Ltd.", detalle: "China · SWIFT · factura HT-2026-1043", monto: "USD 15,200.00", pesosCentavos: 28164200, tipoCambio: "TC 18.51 + comisión", estado: { texto: "Acreditado", tono: "acento" }, comprobante: "MT103" },
    { fecha: "21 oct", proveedor: "Logística Ibérica, S.L.", detalle: "España · SEPA · factura F-2026/0388", monto: "EUR 3,800.00", pesosCentavos: 7566400, tipoCambio: "TC 19.88 + comisión", estado: { texto: "En camino", tono: "aviso" }, comprobante: "Comprobante" },
  ],
  nota: "Los pagos internacionales los opera tu SOFIPO a través de su banco corresponsal. Tipos de cambio y comisiones ilustrativos; el tipo de cambio se fija al confirmar el pago.",
});
