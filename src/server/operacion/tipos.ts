import type { EstadoCliente, TipoComision } from "../../dominio/operacion";

export type ClienteResumen = {
  id: string;
  rfc: string;
  razonSocial: string;
  estado: EstadoCliente;
  /** Cliente de prueba del alta rápida (0050): nació activo sin el alta regulada. */
  dePrueba: boolean;
  altaEn: Date;
  solicitudPendienteId: string | null;
  administrador: string | null;
  administradorCorreo: string | null;
  administradorEstado: "invitada" | "activa" | "suspendida" | null;
};

export type ClienteDetalle = ClienteResumen & {
  codigoPostal: string;
  regimen: string;
  usoCfdi: string;
  /** Quien será el primer administrador, anotado en el alta (puede no haberse anotado). */
  contactoNombre: string | null;
  contactoCorreo: string | null;
  /** Solo un cliente de prueba se archiva: cuándo. */
  archivadaEn: Date | null;
  historial: Array<{
    id: string;
    estadoAnterior: EstadoCliente | null;
    estadoNuevo: EstadoCliente;
    actor: string;
    ocurridoEn: Date;
  }>;
  entregas: Array<{ id: string; estado: string; registradaEn: Date; detalle: string | null }>;
  /** La última invitación emitida para la empresa: reenviar solo reemplaza la que la persona vio. */
  ultimaInvitacionId: string | null;
};

export type SolicitudActivacion = {
  id: string;
  companyId: string;
  razonSocial: string;
  rfc: string;
  solicitadaPor: string;
  solicitante: string;
  solicitadaEn: Date;
};

export type AlertaOperativa = {
  id: string;
  companyId: string;
  razonSocial: string;
  categoria: "activacion" | "invitacion" | "comision" | "operativa";
  titulo: string;
  detalle: string;
  responsableId: string;
  responsable: string;
  creadaEn: Date;
  estado: "abierta" | "cerrada";
  cerradaPor: string | null;
  cerradaEn: Date | null;
  motivoCierre: string | null;
};

/** Las alertas que el sistema abre solo, al registrar un prospecto o proponer una comisión. */
export type CategoriaAutomatica = "activacion" | "comision";

/** Cómo se comporta una alerta automática en este operador. Sin ajuste guardado: prendida y a quien hizo el trámite. */
export type AjusteDeAlerta = {
  categoria: CategoriaAutomatica;
  activa: boolean;
  /** Vacío: la alerta se asigna a quien hizo el trámite. */
  responsableId: string | null;
  responsable: string | null;
  actualizadoPor: string | null;
  actualizadoEn: Date | null;
};

export type Comision = {
  id: string;
  companyId: string;
  razonSocial: string;
  tipo: TipoComision;
  valor: number;
  moneda: "MXN" | null;
  vigenteDesde: string;
  vigenteHasta: string | null;
  estado: "pendiente" | "vigente" | "rechazada" | "cerrada";
  solicitadaPor: string;
  solicitante: string;
  solicitadaEn: Date;
  decididaPor: string | null;
  decididaEn: Date | null;
  motivo: string | null;
};

export type EventoBitacora = {
  id: string;
  companyId: string | null;
  razonSocial: string | null;
  actor: string;
  accion: string;
  entidad: string;
  identificador: string | null;
  motivo: string | null;
  ocurridoEn: Date;
};
