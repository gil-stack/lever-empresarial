import { conTransaccion, consultar } from "../session/db";
import { ErrorDeDominio } from "../session/error-de-dominio";
import { ROLES } from "../session/tipos";
import { SQL } from "./contrato.ts";
import { loteNoGuardable } from "./decidir.ts";
import type { Membresia, RepositorioRoles } from "./tipos.ts";

type FilaMembresia = {
  user_id: unknown;
  company_id: unknown;
  rol: unknown;
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
    async insertarLote(lote) {
      const codigo = loteNoGuardable(lote);
      if (codigo) throw new ErrorDeDominio(codigo);
      await consultar(SQL.insertarLote, [
        lote.id,
        lote.companyId,
        lote.solicitanteId,
        lote.liberadorId,
        lote.firmadoEn,
      ]);
    },
  };
}

function mapearMembresia(fila: FilaMembresia): Membresia {
  if (typeof fila.user_id !== "string" || typeof fila.company_id !== "string" || typeof fila.rol !== "string") {
    throw new ErrorDeDominio("base_no_disponible");
  }
  const rol = ROLES.find((conocido) => conocido === fila.rol);
  if (!rol) throw new ErrorDeDominio("base_no_disponible");
  return { userId: fila.user_id, companyId: fila.company_id, rol };
}
