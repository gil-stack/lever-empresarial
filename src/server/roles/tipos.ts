import type { RolCliente } from "../../nucleo/capacidades.ts";
import type { ContextoConEmpresa } from "../../nucleo/contexto.ts";
import type { Actor } from "../bitacora/auditar.ts";

/** Membresía activa con sus roles. Las invitadas no firman ni administran. */
export type Membresia = {
  userId: string;
  companyId: string;
  roles: RolCliente[];
  deBaja?: boolean;
};

/** Primer acto: quien solicita deja la fila abierta. No hay liberador todavía. */
export type SolicitudDeLote = {
  id: string;
  companyId: string;
  solicitanteId: string;
  solicitadoEn: Date;
  liberadorId: null;
  liberadoEn: null;
  esPrueba: true;
};

/** Segundo acto: otra persona libera. Sigue sin monto y sin envío. */
export type LoteDePrueba = {
  id: string;
  companyId: string;
  solicitanteId: string;
  solicitadoEn: Date;
  liberadorId: string;
  liberadoEn: Date;
  esPrueba: true;
};

export type FilaDeLote = SolicitudDeLote | LoteDePrueba;

export type CambioDeRol = { userId: string; rol: RolCliente; actor: Actor };

export type RepositorioRoles = {
  membresiaDe: (ctx: ContextoConEmpresa, userId: string) => Promise<Membresia | null>;
  membresiasDeLaEmpresa: (ctx: ContextoConEmpresa) => Promise<Membresia[]>;
  /** Agrega o quita un rol con su evento, en la misma transacción. */
  agregarRol: (ctx: ContextoConEmpresa, cambio: CambioDeRol) => Promise<void>;
  quitarRol: (ctx: ContextoConEmpresa, cambio: CambioDeRol) => Promise<void>;
  insertarSolicitud: (ctx: ContextoConEmpresa, solicitud: SolicitudDeLote) => Promise<void>;
  leerLote: (ctx: ContextoConEmpresa, id: string) => Promise<FilaDeLote | null>;
  cerrarLiberacion: (ctx: ContextoConEmpresa, lote: LoteDePrueba) => Promise<void>;
};
