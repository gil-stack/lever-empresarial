/**
 * Contrato de lectura de la fase 1.
 *
 * La sesión identifica a la persona. La empresa se autoriza por su membresía.
 * El id que mande el navegador solo puede estrechar esa lectura: no abre
 * otra empresa. Con eso el usuario de la cuenta A no recibe el RFC ni la
 * razón social de la cuenta B, que es otra cuenta y otro libro visible.
 */

export type Sesion = {
  /** Hash que guarda `sessions`. El token en claro no entra a la consulta. */
  tokenHash: string;
};

export type Empresa = {
  id: string;
  rfc: string;
  razonSocial: string;
};

export type EventoDeAuditoria = {
  id: string;
  companyId: string | null;
  accion: string;
};

export interface LecturaDeNegocio {
  /**
   * Devuelve la empresa solo si la sesión tiene membresía en ella.
   * `companyIdPedido` viene del navegador y no autoriza por sí solo.
   */
  leerEmpresa(sesion: Sesion, companyIdPedido: string): Promise<Empresa | null>;

  /** Empresas de la membresía de la sesión. No recibe un id del navegador. */
  listarEmpresas(sesion: Sesion): Promise<Empresa[]>;

  /**
   * Auditoría de las empresas de la sesión. Si `companyIdPedido` no es de
   * esa membresía, la respuesta queda vacía. Un acto del operador, con
   * `company_id` vacío, tampoco entra.
   */
  listarAuditoria(
    sesion: Sesion,
    companyIdPedido: string | null,
  ): Promise<EventoDeAuditoria[]>;
}

/**
 * Lectura sin sesión. Existe para comprobar que la fila de B sí quedó
 * guardada: si el libro no la tuviera, una respuesta vacía no probaría
 * aislamiento.
 */
export interface LibroSinFiltro {
  leerEmpresa(id: string): Promise<Empresa | null>;
  existeEvento(id: string): Promise<boolean>;
}
