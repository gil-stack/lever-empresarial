import { rolesLeidos } from "../../nucleo/capacidades.ts";
import { baseCliente } from "../../nucleo/contexto.ts";
import { bloquearEmpresa, conContexto } from "../../nucleo/db.ts";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio.ts";
import { auditar } from "../bitacora/auditar.ts";
import { SQL } from "./contrato.ts";
import { loteNoGuardable } from "./decidir.ts";
import type { FilaDeLote, LoteDePrueba, Membresia, RepositorioRoles, SolicitudDeLote } from "./tipos.ts";

type FilaMembresia = {
  user_id: unknown;
  company_id: unknown;
  roles: unknown;
  de_baja?: unknown;
};

type FilaLote = {
  id: unknown;
  company_id: unknown;
  solicitante_user_id: unknown;
  solicitado_en: unknown;
  liberador_user_id: unknown;
  liberado_en: unknown;
};

export function repositorioPg(): RepositorioRoles {
  return {
    membresiaDe(ctx, userId) {
      return conContexto(baseCliente(ctx), async (consulta) => {
        const resultado = await consulta.query(SQL.membresiaDe, [userId, ctx.empresa.id]);
        const fila = resultado.rows[0] as FilaMembresia | undefined;
        return fila ? mapearMembresia(fila) : null;
      });
    },
    membresiasDeLaEmpresa(ctx) {
      return conContexto(baseCliente(ctx), async (consulta) => {
        const resultado = await consulta.query(SQL.membresiasDeLaEmpresa, [ctx.empresa.id]);
        return resultado.rows.map((fila) => mapearMembresia(fila as FilaMembresia));
      });
    },
    agregarRol(ctx, cambio) {
      return conContexto(baseCliente(ctx), async (consulta) => {
        await bloquearEmpresa(consulta, ctx.empresa.id);
        await auditar(consulta, cambio.actor, {
          accion: "asignar_rol",
          identificador: cambio.userId,
          cambio: { rol: cambio.rol },
        });
        const insertado = await consulta.query(SQL.agregarRol, [cambio.userId, ctx.empresa.id, cambio.rol]);
        if (insertado.rowCount !== 1) throw new ErrorDeDominio("rol_existente");
      });
    },
    quitarRol(ctx, cambio) {
      return conContexto(baseCliente(ctx), async (consulta) => {
        await bloquearEmpresa(consulta, ctx.empresa.id);
        await auditar(consulta, cambio.actor, {
          accion: "quitar_rol",
          identificador: cambio.userId,
          cambio: { rol: cambio.rol },
        });
        const quitado = await consulta.query(SQL.quitarRol, [cambio.userId, ctx.empresa.id, cambio.rol]);
        if (quitado.rowCount !== 1) throw new ErrorDeDominio("sin_membresia");
      });
    },
    insertarSolicitud(ctx, solicitud) {
      const codigo = loteNoGuardable(solicitud);
      if (codigo) throw new ErrorDeDominio(codigo);
      return conContexto(baseCliente(ctx), async (consulta) => {
        await consulta.query(SQL.insertarSolicitud, [
          solicitud.id,
          solicitud.companyId,
          solicitud.solicitanteId,
          solicitud.solicitadoEn,
        ]);
      });
    },
    leerLote(ctx, id) {
      return conContexto(baseCliente(ctx), async (consulta) => {
        const resultado = await consulta.query(SQL.leerLote, [id, ctx.empresa.id]);
        const fila = resultado.rows[0] as FilaLote | undefined;
        return fila ? mapearLote(fila) : null;
      });
    },
    cerrarLiberacion(ctx, lote) {
      const codigo = loteNoGuardable(lote);
      if (codigo) throw new ErrorDeDominio(codigo);
      return conContexto(baseCliente(ctx), async (consulta) => {
        const actualizado = await consulta.query(SQL.cerrarLiberacion, [
          lote.id,
          lote.liberadorId,
          lote.liberadoEn,
          lote.companyId,
        ]);
        if (actualizado.rowCount !== 1) throw new ErrorDeDominio("lote_ya_firmado");
      });
    },
  };
}

function mapearMembresia(fila: FilaMembresia): Membresia {
  if (typeof fila.user_id !== "string" || typeof fila.company_id !== "string" || !Array.isArray(fila.roles)) {
    throw new ErrorDeDominio("base_no_disponible");
  }
  return { userId: fila.user_id, companyId: fila.company_id, roles: rolesLeidos(fila.roles), deBaja: fila.de_baja === true };
}

function mapearLote(fila: FilaLote): FilaDeLote {
  const solicitadoEn = instante(fila.solicitado_en);
  if (
    typeof fila.id !== "string" ||
    typeof fila.company_id !== "string" ||
    typeof fila.solicitante_user_id !== "string" ||
    !solicitadoEn
  ) {
    throw new ErrorDeDominio("base_no_disponible");
  }
  if (fila.liberador_user_id == null && fila.liberado_en == null) {
    const abierta: SolicitudDeLote = {
      id: fila.id,
      companyId: fila.company_id,
      solicitanteId: fila.solicitante_user_id,
      solicitadoEn,
      liberadorId: null,
      liberadoEn: null,
      esPrueba: true,
    };
    return abierta;
  }
  const liberadoEn = instante(fila.liberado_en);
  if (typeof fila.liberador_user_id !== "string" || !liberadoEn) {
    throw new ErrorDeDominio("base_no_disponible");
  }
  const cerrada: LoteDePrueba = {
    id: fila.id,
    companyId: fila.company_id,
    solicitanteId: fila.solicitante_user_id,
    solicitadoEn,
    liberadorId: fila.liberador_user_id,
    liberadoEn,
    esPrueba: true,
  };
  return cerrada;
}

function instante(valor: unknown): Date | null {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) return valor;
  if (typeof valor === "string") {
    const fecha = new Date(valor);
    if (!Number.isNaN(fecha.getTime())) return fecha;
  }
  return null;
}
