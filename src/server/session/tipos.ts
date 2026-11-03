export const ROLES = [
  "administrador",
  "solicitante",
  "liberador",
  "tarjetahabiente",
  "contador",
] as const;

export type Rol = (typeof ROLES)[number];

export type UsuarioPublico = {
  id: string;
  nombre: string;
  correo: string;
};

export type Sesion = {
  id: string;
  venceEn: Date;
  usuario: UsuarioPublico;
  companyId: string | null;
  rol: Rol | null;
};

export type SesionAbierta = {
  sesion: Sesion;
  setCookie: string;
};

export type AltaCuenta = {
  nombre: string;
  correo: string;
  contrasena: string;
};
