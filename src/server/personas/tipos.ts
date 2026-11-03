import type { Consulta } from "../session/db";
import type { Rol } from "../session/tipos";

export type CentroVista = {
  id: string;
  nombre: string;
};

export type PersonaVista = {
  id: string;
  nombre: string;
  altaEn: string;
  bajaEn: string | null;
  clabe: string;
  jefeId: string | null;
  jefeNombre: string | null;
  centroId: string;
  centroNombre: string;
  rol: Rol | null;
  correo: string | null;
};

export type LecturaMaestro = {
  rol: Rol;
  centros: CentroVista[];
  personas: PersonaVista[];
  autorizados: string[];
};

export type HechosLiberacion = {
  rol: Rol;
  actorDeBaja: boolean;
  autorizados: number;
};

export type UsuarioDeCorreo = {
  id: string;
  companyId: string | null;
  tieneEmpleado: boolean;
};

export type PersonaBloqueada = {
  id: string;
  altaEn: string;
  bajaEn: string | null;
  userId: string | null;
  rol: Rol | null;
};

export type EmpleadoNuevo = {
  id: string;
  nombre: string;
  altaEn: string;
  bajaEn: string | null;
  clabe: string;
  jefeId: string | null;
  centroId: string;
  userId: string | null;
};

export type ContextoMaestro = {
  companyId: string;
  rol: Rol;
  consulta: Consulta;
  centroPorId: (id: string) => Promise<CentroVista | null>;
  centroOcupado: (nombre: string) => Promise<boolean>;
  jefePorId: (id: string) => Promise<PersonaBloqueada | null>;
  bloquearPersona: (id: string) => Promise<PersonaBloqueada | null>;
  usuarioPorCorreo: (correo: string) => Promise<UsuarioDeCorreo | null>;
  insertarCentro: (centro: CentroVista) => Promise<void>;
  insertarUsuario: (usuario: {
    id: string;
    nombre: string;
    correo: string;
    passwordHash: string;
  }) => Promise<void>;
  insertarMembresia: (userId: string, rol: Rol) => Promise<void>;
  insertarEmpleado: (empleado: EmpleadoNuevo) => Promise<void>;
  escribirBaja: (id: string, bajaEn: string) => Promise<void>;
  rolDeUsuario: (userId: string) => Promise<Rol | null>;
  quitarLiberador: (userId: string) => Promise<void>;
};

export type RepositorioPersonas = {
  conEmpresa: <T>(userId: string, fn: (ctx: ContextoMaestro) => Promise<T>) => Promise<T>;
  puerta: (userId: string) => Promise<{ rol: Rol } | null>;
  leer: (userId: string, hoy: string) => Promise<LecturaMaestro | null>;
  resumen: (userId: string, hoy: string) => Promise<{ nombres: string[] } | null>;
  hechosLiberacion: (userId: string, hoy: string) => Promise<HechosLiberacion | null>;
};
