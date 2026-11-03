import type { Rol } from "../session/tipos.ts";

export type Membresia = {
  userId: string;
  companyId: string;
  rol: Rol;
};

/** Un lote de nómina de prueba. No tiene monto ni estado de envío. */
export type LoteDePrueba = {
  id: string;
  companyId: string;
  solicitanteId: string;
  liberadorId: string;
  firmadoEn: Date;
  esPrueba: true;
};

export type RepositorioRoles = {
  usuarioExiste: (userId: string) => Promise<boolean>;
  membresiaDe: (userId: string) => Promise<Membresia | null>;
  membresiasDeLaEmpresa: (companyId: string) => Promise<Membresia[]>;
  insertarMembresia: (membresia: Membresia) => Promise<void>;
  actualizarRol: (membresia: Membresia) => Promise<void>;
  insertarLote: (lote: LoteDePrueba) => Promise<void>;
};
