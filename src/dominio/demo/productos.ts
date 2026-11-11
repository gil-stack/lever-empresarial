/**
 * Los módulos que hoy son demostración y la línea de producto que ve una
 * empresa real en su lugar («Disponible pronto»). Aquí no hay ni una cifra ni
 * un nombre de ejemplo: este archivo es lo único de la demostración que llega
 * a una empresa real.
 */
export const MODULOS_DEMO = [
  "conciliacion",
  "gastos",
  "tarjetas",
  "movimientos",
  "fiscal",
  "cuenta",
  "internacional",
  "credito",
  "inversion",
  "viajes",
  "gasolina",
  "ahorro",
  "integraciones",
] as const;

export type ModuloDemo = (typeof MODULOS_DEMO)[number];

export type ProductoDemo = { readonly titulo: string; readonly producto: string };

export const PRODUCTOS: Readonly<Record<ModuloDemo, ProductoDemo>> = Object.freeze({
  conciliacion: { titulo: "Conciliación", producto: "Cada movimiento de la cuenta empatado con su factura y su póliza." },
  gastos: { titulo: "Gastos", producto: "Lo que gasta cada área y cada persona, al día y contra el mes anterior." },
  tarjetas: { titulo: "Tarjetas", producto: "Tarjetas precargadas para tu equipo, con límite por persona y por área." },
  movimientos: { titulo: "Movimientos", producto: "Cada compra con su comprobante, su lugar y su IVA en una sola lista." },
  fiscal: { titulo: "IVA y DIOT", producto: "El IVA acreditable, las alertas fiscales y la DIOT armados con tus facturas." },
  cuenta: { titulo: "Cuenta", producto: "La cuenta de la empresa con su CLABE para recibir y enviar por SPEI." },
  internacional: { titulo: "Pagos internacionales", producto: "Pagos a proveedores del extranjero con el tipo de cambio fijado al confirmar." },
  credito: { titulo: "Crédito", producto: "Una línea de crédito revolvente para la empresa." },
  inversion: { titulo: "Inversión", producto: "Inversiones a plazo fijo para el dinero que hoy no usas." },
  viajes: { titulo: "Viajes y proyectos", producto: "Presupuesto y tope por día para viajes, eventos y proyectos." },
  gasolina: { titulo: "Gasolina", producto: "Tarjetas de gasolina ligadas a cada vehículo, con reglas al cargar." },
  ahorro: { titulo: "Ahorro", producto: "Suscripciones y gastos que se pueden recortar, encontrados en tus compras." },
  integraciones: { titulo: "Integraciones", producto: "Tu sistema contable, el de recursos humanos y WhatsApp conectados a Lever." },
});
