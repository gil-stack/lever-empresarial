import type { ContextoConEmpresa } from "../../nucleo/contexto";

export type InicioTelefono = {
  nombre: string;
  bajaEn: string | null;
} | null;

export type TopeTelefono = {
  id: string;
  nombre: string;
  topeCentavos: number | null;
};

export type DatosFiscalesTelefono = {
  rfc: string;
  razonSocial: string;
  codigoPostal: string;
  regimen: string;
  uso: string;
};

/** Cada método es una proyección acotada; ninguno lee la política completa ni el libro. */
export type RepositorioTelefono = {
  inicio: (ctx: ContextoConEmpresa) => Promise<InicioTelefono>;
  topes: (ctx: ContextoConEmpresa) => Promise<TopeTelefono[]>;
  facturacion: (ctx: ContextoConEmpresa) => Promise<DatosFiscalesTelefono | null>;
};
