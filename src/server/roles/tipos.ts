import type { Rol } from "../session/tipos.ts";

export type Membresia = {
  userId: string;
  companyId: string;
  rol: Rol;
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

export type RepositorioRoles = {
  usuarioExiste: (userId: string) => Promise<boolean>;
  membresiaDe: (userId: string) => Promise<Membresia | null>;
  membresiasDeLaEmpresa: (companyId: string) => Promise<Membresia[]>;
  insertarMembresia: (membresia: Membresia) => Promise<void>;
  actualizarRol: (membresia: Membresia) => Promise<void>;
  insertarSolicitud: (solicitud: SolicitudDeLote) => Promise<void>;
  leerLote: (id: string) => Promise<FilaDeLote | null>;
  cerrarLiberacion: (lote: LoteDePrueba) => Promise<void>;
};
