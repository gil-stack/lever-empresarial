import { correoDeHoy, type CorreoPrevio, type TipoCorreo } from "../../dominio/cobranza/recordatorios";
import { hoyEnMexico } from "../../dominio/personas";
import { aplicarSentencia, bloquearEmpresa, comoTarea, conContexto } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { auditar as auditarPorDefecto, type Auditar } from "../bitacora/auditar";
import { leerUrlPublica } from "../correo/configuracion";
import { enviadorDesdeEntorno } from "../correo/enviar";
import type { Enviador } from "../correo/tipos";
import { marcarRitmo, RITMO_MS } from "../flujo/correo-semanal";
import { booleano, entero, registro, texto } from "../flujo/lectura";
import { actorDeSistema, baseDeSistema, generarCargos } from "./comun";
import { enviarCorreoDeCargo, registrarPorDefecto, type PasoCorreo, type ResultadoCorreo } from "./correo";
import { asegurarClabeDeCliente, clienteHttpFintoc, configFintoc, type ClienteFintoc } from "./fintoc";
import { fechaDe, leerConfiguracion } from "./repositorio";

/**
 * La tarea diaria de cobranza (vercel.json, 14:00 UTC = 8:00 en el centro de
 * México). Por empresa con cobranza configurada:
 * 1. genera los cargos que tocan (la llave plan + periodo hace que correr dos
 *    veces no duplique nada);
 * 2. pide al proveedor SPEI las CLABEs propias que falten;
 * 3. manda el cobro y los recordatorios que tocan hoy (uno por cargo al día).
 * Corre como el sistema: sin persona, con la empresa en el contexto y RLS.
 */

export type DependenciasTarea = {
  ahora?: () => Date;
  auditar?: Auditar;
  enviador?: () => Enviador;
  urlPublica?: () => string;
  fintoc?: ClienteFintoc | null;
  registrar?: (campos: Readonly<Record<string, string | number>>) => void;
  presupuestoMs?: number;
  transcurrido?: () => number;
  ritmoMs?: number;
};

export type ResultadoTarea = {
  empresas: number;
  cargos: number;
  clabes: number;
  correos: Record<ResultadoCorreo, number>;
  fallidas: number;
  pendientes: number;
};

export const PRESUPUESTO_MS = 240_000;
/** Correos por empresa en una corrida; lo que falte sale en la siguiente. */
const CORREOS_POR_EMPRESA = 300;
/** CLABEs propias por empresa en una corrida. */
const CLABES_POR_EMPRESA = 25;

export async function correrCobranza(deps: DependenciasTarea = {}): Promise<ResultadoTarea> {
  const hoy = hoyEnMexico((deps.ahora ?? (() => new Date()))());
  const auditar = deps.auditar ?? auditarPorDefecto;
  const registrar = deps.registrar ?? registrarPorDefecto;
  const turno = marcarRitmo(deps.ritmoMs ?? RITMO_MS);
  const paso: PasoCorreo = {
    enviador: deps.enviador ?? (() => enviadorDesdeEntorno()),
    urlPublica: deps.urlPublica ?? (() => leerUrlPublica()),
    auditar,
    turno,
    registrar,
  };
  const fintoc = deps.fintoc !== undefined ? deps.fintoc : (() => {
    const config = configFintoc();
    return config ? clienteHttpFintoc(config) : null;
  })();
  const empresas = await comoTarea(async (consulta) =>
    (await aplicarSentencia(consulta, "select company_id, operator_id, demostracion from empresas_con_cobranza()")).rows.map(registro));
  const resultado: ResultadoTarea = {
    empresas: empresas.length,
    cargos: 0,
    clabes: 0,
    correos: { enviado: 0, simulado: 0, fallido: 0, ya_enviado: 0, tope: 0, no_aplica: 0 },
    fallidas: 0,
    pendientes: 0,
  };
  const inicio = Date.now();
  const transcurrido = deps.transcurrido ?? (() => Date.now() - inicio);
  const presupuesto = deps.presupuestoMs ?? PRESUPUESTO_MS;
  for (const [i, fila] of empresas.entries()) {
    if (transcurrido() >= presupuesto) {
      resultado.pendientes = empresas.length - i;
      registrar({ evento: "cobranza_pendientes", pendientes: resultado.pendientes, empresas: empresas.length });
      break;
    }
    const empresaId = texto(fila.company_id);
    const operadorId = texto(fila.operator_id);
    const base = baseDeSistema(empresaId, operadorId);
    const actor = actorDeSistema(empresaId, operadorId, "tarea");
    try {
      // 1. Cargos.
      const generados = await conContexto(base, async (consulta) => {
        await bloquearEmpresa(consulta, empresaId);
        const config = await leerConfiguracion(consulta, empresaId);
        if (!config) return [];
        return generarCargos(consulta, actor, auditar, empresaId, hoy, config.emitirDiasAntes);
      });
      resultado.cargos += generados.length;
      // 2. CLABEs propias que falten (nunca en una empresa de demostración).
      if (fintoc && !booleano(fila.demostracion)) {
        const sinClabe = await conContexto(base, async (consulta) =>
          (await aplicarSentencia(
            consulta,
            `select k.id from collection_customers k
              where k.company_id = $1 and k.estado = 'activo'
                and exists (select 1 from collection_provider_accounts a where a.company_id = k.company_id)
                and not exists (select 1 from collection_virtual_accounts v where v.company_id = k.company_id and v.customer_id = k.id)
              order by k.creado_en limit ${CLABES_POR_EMPRESA}`,
            [empresaId],
          )).rows.map(registro).map((f) => texto(f.id)));
        for (const clienteId of sinClabe) {
          try {
            if (await asegurarClabeDeCliente(base, actor, auditar, clienteId, fintoc)) resultado.clabes += 1;
          } catch {
            registrar({ evento: "clabe_propia_pendiente", empresa: empresaId, cliente: clienteId });
          }
        }
      }
      // 3. Correos de hoy.
      const porMandar = await conContexto(base, async (consulta) => {
        const config = await leerConfiguracion(consulta, empresaId);
        if (!config) return [];
        const cargos = await aplicarSentencia(
          consulta,
          `select c.id, c.estado, c.vencimiento, k.recordatorios,
                  coalesce((select json_agg(json_build_object('tipo', m.tipo, 'secuencia', m.secuencia, 'estado', m.estado,
                                                              'dia', to_char(timezone('America/Mexico_City', m.intentado_en), 'YYYY-MM-DD')))
                              from collection_emails m where m.company_id = c.company_id and m.charge_id = c.id), '[]'::json) as correos
             from collection_charges c
             join collection_customers k on k.id = c.customer_id and k.company_id = c.company_id
            where c.company_id = $1 and c.estado = 'emitido' and k.estado = 'activo'
            order by c.vencimiento, c.id
            limit 2000`,
          [empresaId],
        );
        const lista: { cargoId: string; tipo: TipoCorreo; secuencia: number }[] = [];
        for (const f of cargos.rows.map(registro)) {
          const correos = Array.isArray(f.correos) ? f.correos.map(registro) : [];
          // Un correo fallido de hoy se reintenta con su misma llave; los demás cuentan como enviados.
          const fallidoDeHoy = correos.find((m) => m.estado === "fallido" && m.dia === hoy && m.tipo !== "reenvio");
          if (fallidoDeHoy) {
            lista.push({ cargoId: texto(f.id), tipo: texto(fallidoDeHoy.tipo) as TipoCorreo, secuencia: entero(fallidoDeHoy.secuencia) });
            continue;
          }
          const previos: CorreoPrevio[] = correos
            .filter((m) => m.estado !== "fallido")
            .map((m) => ({ tipo: texto(m.tipo) as TipoCorreo, secuencia: entero(m.secuencia), dia: texto(m.dia) }));
          const toca = correoDeHoy({ estado: texto(f.estado), vencimiento: fechaDe(f.vencimiento), recordatorios: booleano(f.recordatorios) }, previos, config, hoy);
          if (toca) lista.push({ cargoId: texto(f.id), tipo: toca.tipo, secuencia: toca.secuencia });
          if (lista.length >= CORREOS_POR_EMPRESA) break;
        }
        return lista;
      });
      for (const correo of porMandar) {
        if (transcurrido() >= presupuesto) break;
        const r = await enviarCorreoDeCargo(base, actor, correo.cargoId, correo.tipo, correo.secuencia, hoy, paso);
        resultado.correos[r] += 1;
        if (r === "tope") break;
      }
    } catch (error) {
      resultado.fallidas += 1;
      registrar({ evento: "cobranza_empresa_fallida", empresa: empresaId, codigo: error instanceof ErrorDeDominio ? error.codigo : "desconocido" });
    }
  }
  return resultado;
}
