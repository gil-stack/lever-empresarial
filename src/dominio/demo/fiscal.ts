import { congelar, type CifraDemo } from "./tipos";

export type AlertaFiscalDemo = { readonly titulo: string; readonly detalle: string; readonly grave: boolean; readonly enlace: string };
export type RenglonDiotDemo = { readonly proveedor: string; readonly rfc: string; readonly sinIvaCentavos: number; readonly ivaCentavos: number };

export type FiscalDemo = {
  readonly cifras: readonly CifraDemo[];
  readonly alertas: readonly AlertaFiscalDemo[];
  readonly diot: readonly RenglonDiotDemo[];
};

export const FISCAL_DEMO: FiscalDemo = congelar({
  cifras: [
    { rotulo: "IVA acreditable", valor: "$13,381", nota: "De compras con factura en octubre" },
    { rotulo: "IVA sin factura", valor: "$194", nota: "Se recupera si llega la factura", tono: "aviso" },
    { rotulo: "Alertas fiscales", valor: "3", nota: "Para revisar antes del cierre" },
    { rotulo: "DIOT de octubre", valor: "21", nota: "Proveedores con IVA pagado" },
  ],
  alertas: [
    { titulo: "Proveedor en la lista 69-B", grave: true, enlace: "Ir a Proveedores", detalle: "Servicios Integrales Delta, S.A. de C.V. (SID170830PL1). Su factura por $58,000.00 podría no ser deducible. Antes de pagar, confirma que el servicio existió." },
    { titulo: "2 gastos solo con ticket", grave: false, enlace: "Ver el gasto", detalle: "Sanborns $684.00 · Sanborns $725.00. Sin factura el IVA no se acredita; Lever puede pedirla al comercio." },
    { titulo: "Uso del CFDI equivocado", grave: false, enlace: "Ver el gasto", detalle: "La factura de Amazon México del 8 oct viene con uso «S01 Sin efectos fiscales». Pide que la reemitan con «G03 Gastos en general»." },
  ],
  diot: [
    { proveedor: "Llantas y Servicios Bajío, S.A. de C.V.", rfc: "LSB120415HG7", sinIvaCentavos: 3560000, ivaCentavos: 569600 },
    { proveedor: "Home Depot México, S. de R.L. de C.V.", rfc: "HOM070621KF2", sinIvaCentavos: 1934905, ivaCentavos: 309585 },
    { proveedor: "Office Depot de México, S.A. de C.V.", rfc: "OFF011228UM5", sinIvaCentavos: 853750, ivaCentavos: 136600 },
    { proveedor: "Estación de Servicio 4512, S.A. de C.V.", rfc: "EST060513RK4", sinIvaCentavos: 786207, ivaCentavos: 125793 },
    { proveedor: "Aerovías de México, S.A. de C.V.", rfc: "AER051011MT0", sinIvaCentavos: 762069, ivaCentavos: 121931 },
    { proveedor: "Costco de México, S.A. de C.V.", rfc: "COS061111BT1", sinIvaCentavos: 753138, ivaCentavos: 120502 },
    { proveedor: "Servicios Comerciales Amazon México, S. de R.L. de C.V.", rfc: "SER040901PU8", sinIvaCentavos: 752172, ivaCentavos: 120348 },
    { proveedor: "Estación de Servicio 0871, S.A. de C.V.", rfc: "EST960104KC3", sinIvaCentavos: 713793, ivaCentavos: 114207 },
    { proveedor: "Distribuidora Liverpool, S.A. de C.V.", rfc: "DIS920919NC5", sinIvaCentavos: 507759, ivaCentavos: 81241 },
    { proveedor: "Hotel Safi Royal Valle, S.A. de C.V.", rfc: "HOT110419YE6", sinIvaCentavos: 337931, ivaCentavos: 54069 },
  ],
});
