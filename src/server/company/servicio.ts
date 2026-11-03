import { randomUUID } from "node:crypto";

import type { Consulta } from "../session/db";
import { ErrorDeDominio } from "../session/error-de-dominio";
import type { Sesion } from "../session/tipos";
import { auditarAlta, type AuditarAlta, type EventoDeAuditoria } from "./auditar";
import { rechazoDeAlta } from "./decidir";
import { repositorioPg, type RepositorioEmpresas } from "./repositorio";
import type { AltaEmpresaEntrada, Empresa } from "./tipos";
import { validarAlta } from "./validar";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DependenciasEmpresa = {
  repositorio?: RepositorioEmpresas;
  auditar?: AuditarAlta;
};

export async function darDeAltaEmpresa(
  sesion: Sesion | null | undefined,
  entrada: AltaEmpresaEntrada,
  deps?: DependenciasEmpresa,
): Promise<Empresa> {
  const userId = exigirUsuario(sesion);
  const validada = validarAlta(entrada);
  if (!validada.ok) throw new ErrorDeDominio(validada.codigo);
  const repositorio = deps?.repositorio ?? repositorioPg();
  const auditar = deps?.auditar ?? auditarAlta;
  return repositorio.conCuenta(userId, async (cuenta) => {
    const rechazo = rechazoDeAlta({
      tieneEmpresa: await cuenta.tieneEmpresa(),
      rfcOcupado: await cuenta.rfcOcupado(validada.valor.rfc),
    });
    if (rechazo) throw new ErrorDeDominio(rechazo);
    const empresa = await cuenta.insertar({ id: randomUUID(), ...validada.valor });
    const evento: EventoDeAuditoria = {
      companyId: empresa.id,
      actorId: userId,
      accion: "alta_empresa",
      entidad: "companies",
      identificador: empresa.id,
      ocurridoEn: empresa.altaEn,
    };
    try {
      await auditar(evento, consultaDeAlta(cuenta.consulta));
    } catch (error) {
      if (error instanceof ErrorDeDominio) throw error;
      throw new ErrorDeDominio("auditoria_no_disponible");
    }
    return empresa;
  });
}

export async function leerEmpresa(
  sesion: Sesion | null | undefined,
  opciones?: DependenciasEmpresa & { companyId?: string | null },
): Promise<Empresa | null> {
  const userId = exigirUsuario(sesion);
  // El identificador que manda el navegador no autoriza la lectura.
  void opciones?.companyId;
  return (opciones?.repositorio ?? repositorioPg()).leerDeLaCuenta(userId);
}

function exigirUsuario(sesion: Sesion | null | undefined): string {
  const id = sesion?.usuario?.id;
  if (typeof id !== "string" || !UUID.test(id)) throw new ErrorDeDominio("sesion_ausente");
  return id;
}

function consultaDeAlta(consulta: Consulta): Consulta {
  return {
    async query(sql, params) {
      const verbo = (sql.trim().toLowerCase().split(/\s+/)[0] ?? "").replace(/;$/, "");
      if (verbo === "begin" || verbo === "commit" || verbo === "rollback" || verbo === "start") {
        throw new ErrorDeDominio("auditoria_no_disponible");
      }
      return consulta.query(sql, params);
    },
  };
}
