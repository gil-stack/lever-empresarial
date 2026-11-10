import { congelar } from "./tipos";

export type GrupoDeIntegracionesDemo = { readonly titulo: string; readonly detalle: string; readonly premium: boolean; readonly sistemas: readonly string[] };

export type IntegracionesDemo = {
  readonly grupos: readonly GrupoDeIntegracionesDemo[];
  readonly whatsapp: { readonly titulo: string; readonly detalle: string; readonly estado: string; readonly nota: string };
};

export const INTEGRACIONES_DEMO: IntegracionesDemo = congelar({
  grupos: [
    { titulo: "Contabilidad", detalle: "La póliza de cada gasto, con su CFDI, llega sola a tu sistema contable", premium: true, sistemas: ["CONTPAQi", "Aspel COI", "SAP Business One", "Odoo", "Microsip", "QuickBooks"] },
    { titulo: "Recursos humanos", detalle: "Altas y bajas automáticas: quien entra recibe su tarjeta; quien sale, se le cancela", premium: false, sistemas: ["BUK", "Runa", "Worky", "Factorial"] },
  ],
  whatsapp: {
    titulo: "WhatsApp",
    detalle: "Aprobaciones, avisos y tickets por chat",
    estado: "WhatsApp Business conectado",
    nota: "Finanzas aprueba con 1 o 2; los empleados mandan tickets y consultan su saldo",
  },
});
