import { conTransaccion, consultar } from "../session/db";
import { ErrorDeDominio } from "../session/error-de-dominio";
import { ROLES } from "../session/tipos";
import { SQL } from "./contrato.ts";
import { loteNoGuardable } from "./decidir.ts";
import type { FilaDeLote, LoteDePrueba, Membresia, RepositorioRoles, SolicitudDeLote } from "./tipos.ts";

type FilaMembresia = {
  user_id: unknown;
  company_id: unknown;
  rol: unknown;
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
    async usuarioExiste(userId) {
      const resultado = await consultar(SQL.usuarioExiste, [userId]);
      return resultado.rows.length > 0;
    },
    async membresiaDe(userId) {
      const resultado = await consultar(SQL.membresiaDe, [userId]);
      const fila = resultado.rows[0] as FilaMembresia | undefined;
      return fila ? mapearMembresia(fila) : null;
    },
    async membresiasDeLaEmpresa(companyId) {
      const resultado = await consultar(SQL.membresiasDeLaEmpresa, [companyId]);
      return resultado.rows.map((fila) => mapearMembresia(fila as FilaMembresia));
    },
    async insertarMembresia(membresia) {
      await conTransaccion(async (consulta) => {
        const usuario = await consulta.query(SQL.bloquearUsuario, [membresia.userId]);
        if (usuario.rows.length === 0) throw new ErrorDeDominio("usuario_ausente");
        const previa = await consulta.query(SQL.membresiaDe, [membresia.userId]);
        const fila = previa.rows[0] as FilaMembresia | undefined;
        if (fila) {
          const empresa = typeof fila.company_id === "string" ? fila.company_id : "";
          throw new ErrorDeDominio(empresa === membresia.companyId ? "membresia_existente" : "segunda_razon_social");
        }
        await consulta.query(SQL.insertarMembresia, [membresia.userId, membresia.companyId, membresia.rol]);
      });
    },
    async actualizarRol(membresia) {
      await conTransaccion(async (consulta) => {
        const usuario = await consulta.query(SQL.bloquearUsuario, [membresia.userId]);
        if (usuario.rows.length === 0) throw new ErrorDeDominio("usuario_ausente");
        const actualizado = await consulta.query(SQL.actualizarRol, [
          membresia.rol,
          membresia.userId,
          membresia.companyId,
        ]);
        if (actualizado.rowCount === 0) throw new ErrorDeDominio("sin_membresia");
      });
    },
    async insertarSolicitud(solicitud) {
      const codigo = loteNoGuardable(solicitud);
      if (codigo) throw new ErrorDeDominio(codigo);
      await conTransaccion(async (consulta) => {
        await consulta.query(SQL.insertarSolicitud, [
          solicitud.id,
          solicitud.companyId,
          solicitud.solicitanteId,
          solicitud.solicitadoEn,
        ]);
      });
    },
    async leerLote(id) {
      const resultado = await consultar(SQL.leerLote, [id]);
      const fila = resultado.rows[0] as FilaLote | undefined;
      return fila ? mapearLote(fila) : null;
    },
    async cerrarLiberacion(lote) {
      const codigo = loteNoGuardable(lote);
      if (codigo) throw new ErrorDeDominio(codigo);
      await conTransaccion(async (consulta) => {
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
  if (typeof fila.user_id !== "string" || typeof fila.company_id !== "string" || typeof fila.rol !== "string") {
    throw new ErrorDeDominio("base_no_disponible");
  }
  const rol = ROLES.find((conocido) => conocido === fila.rol);
  if (!rol) throw new ErrorDeDominio("base_no_disponible");
  return { userId: fila.user_id, companyId: fila.company_id, rol, deBaja: fila.de_baja === true };
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
