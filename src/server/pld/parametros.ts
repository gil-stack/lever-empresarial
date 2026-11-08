import { leerCentavosEscritos } from "../../dominio/centavos";
import { uuidValido } from "../../dominio/operacion";
import type { ContextoDePersonal } from "../../nucleo/contexto";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { motivoEscrito, unaVezPorFormulario } from "../operacion/formulario";
import { exigirEnOperacion } from "../operacion/permisos";
import { auditarPld } from "./auditar";
import { conPld, fecha } from "./base";

export type ParametrosPld = {
  id: string;
  numero: number;
  atipicoK: string;
  atipicoHistorialMinimo: number;
  fraccionN: number;
  fraccionVentanaDias: number;
  fraccionUmbralCentavos: number;
  nominaPersonasPct: string;
  factorGradoAlto: string;
  fuentes: Record<string, string>;
  motivo: string;
  iniciales: boolean;
  registradoPor: string | null;
  registradoEn: Date;
};

/** Los parámetros vigentes de las reglas: los del operador o, sin ellos, los iniciales de la 0030. */
export async function leerParametros(ctx: ContextoDePersonal): Promise<ParametrosPld> {
  exigirEnOperacion(ctx, "plataforma.pld.ver");
  return conPld(ctx, null, async (consulta) => {
    const fila = (await consulta.query(
      `select p.*, u.nombre from pld_parametros p left join users u on u.id = p.registrado_por
       where p.operator_id = $1 or p.operator_id is null order by (p.operator_id is null), p.numero desc limit 1`,
      [ctx.personal.operadorId],
    )).rows[0] as Record<string, unknown> | undefined;
    if (!fila) throw new ErrorDeDominio("base_no_disponible");
    return {
      id: String(fila.id),
      numero: Number(fila.numero),
      atipicoK: String(fila.atipico_k),
      atipicoHistorialMinimo: Number(fila.atipico_historial_minimo),
      fraccionN: Number(fila.fraccion_n),
      fraccionVentanaDias: Number(fila.fraccion_ventana_dias),
      fraccionUmbralCentavos: Number(fila.fraccion_umbral_centavos),
      nominaPersonasPct: String(fila.nomina_personas_pct),
      factorGradoAlto: String(fila.factor_grado_alto),
      fuentes: (fila.fuentes ?? {}) as Record<string, string>,
      motivo: String(fila.motivo),
      iniciales: fila.operator_id === null,
      registradoPor: typeof fila.nombre === "string" ? fila.nombre : null,
      registradoEn: fecha(fila.registrado_en),
    };
  });
}

function decimal(valor: unknown, campo: string, minimo: number, maximo: number): string {
  const texto = typeof valor === "string" ? valor.trim().replace(",", ".") : "";
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(texto) || Number(texto) < minimo || Number(texto) > maximo) throw new ErrorDeDominio(`dato_invalido_${campo}`);
  return texto;
}

function entero(valor: unknown, campo: string, minimo: number, maximo: number): number {
  const texto = typeof valor === "string" ? valor.trim() : "";
  if (!/^\d{1,4}$/.test(texto) || Number(texto) < minimo || Number(texto) > maximo) throw new ErrorDeDominio(`dato_invalido_${campo}`);
  return Number(texto);
}

/** Cumplimiento cambia los parámetros con motivo y bitácora (54ª). Cada cambio es una versión nueva. */
export async function cambiarParametros(
  ctx: ContextoDePersonal,
  entrada: {
    formId: unknown; atipicoK: unknown; atipicoHistorialMinimo: unknown; fraccionN: unknown; fraccionVentanaDias: unknown;
    fraccionUmbral: unknown; nominaPersonasPct: unknown; factorGradoAlto: unknown; motivo: unknown;
  },
  deps: { ahora?: () => Date } = {},
): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.pld.analizar");
  if (!uuidValido(entrada.formId)) throw new ErrorDeDominio("formulario_invalido");
  const umbral = leerCentavosEscritos(entrada.fraccionUmbral);
  if (umbral.tipo !== "centavos" || umbral.centavos < 100) throw new ErrorDeDominio("dato_invalido_fraccionUmbral");
  const valores = {
    atipicoK: decimal(entrada.atipicoK, "atipicoK", 1, 100),
    historial: entero(entrada.atipicoHistorialMinimo, "atipicoHistorialMinimo", 1, 1000),
    n: entero(entrada.fraccionN, "fraccionN", 2, 100),
    ventana: entero(entrada.fraccionVentanaDias, "fraccionVentanaDias", 1, 90),
    pct: decimal(entrada.nominaPersonasPct, "nominaPersonasPct", 1, 1000),
    factor: decimal(entrada.factorGradoAlto, "factorGradoAlto", 0.01, 1),
  };
  const motivo = motivoEscrito(entrada.motivo, 500);
  const ahora = deps.ahora?.() ?? new Date();
  const fuente = `Cambio de Cumplimiento: ${motivo}`.slice(0, 500);
  await unaVezPorFormulario(() => conPld(ctx, null, async (consulta) => {
    if ((await consulta.query("select 1 from pld_parametros where id = $1", [entrada.formId])).rows.length > 0) return;
    await consulta.query(
      `insert into pld_parametros (
         id, operator_id, atipico_k, atipico_historial_minimo, fraccion_n, fraccion_ventana_dias, fraccion_umbral_centavos,
         nomina_personas_pct, factor_grado_alto, fuentes, motivo, registrado_por
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [entrada.formId, ctx.personal.operadorId, valores.atipicoK, valores.historial, valores.n, valores.ventana, umbral.centavos,
        valores.pct, valores.factor, JSON.stringify({ todos: fuente }), motivo, ctx.persona.id],
    );
    await auditarPld(consulta, ctx, { companyId: null, accion: "pld_parametros_cambiados", identificador: entrada.formId as string, motivo, ocurridoEn: ahora });
  }), "formulario_invalido");
}
