import { etiquetaPeriodo, esPeriodicidad } from "../../dominio/cobranza/periodos";
import { hoyEnMexico } from "../../dominio/personas";
import { aplicarSentencia, conContexto } from "../../nucleo/db";
import { auditar as auditarPorDefecto } from "../bitacora/auditar";
import { leerUrlPublica } from "../correo/configuracion";
import { plantillaAvisoSinRecordatorios } from "../correo/plantillas/cobro";
import { booleano, centavos, registro, texto, textoONulo } from "../flujo/lectura";
import { actorDeSistema, baseDeSistema, hashDeToken } from "./comun";
import { bancoDeClabe, fechaDe } from "./repositorio";
import { avisarAlEquipo, type DependenciasCobranza } from "./servicio";

/**
 * La página pública del pagador: llega con el enlace de su correo (un token de
 * 32 bytes; la base guarda solo su SHA-256). Muestra lo mismo que el correo y
 * deja pedir no recibir recordatorios. No abre nada más de la empresa.
 */

export type VistaPagador =
  | { estado: "vencido"; razonSocial: string; contacto: string | null }
  | {
      estado: "pendiente" | "pagado" | "cancelado";
      razonSocial: string;
      cliente: string;
      concepto: string;
      periodo: string;
      montoCentavos: number;
      saldoCentavos: number;
      vencimiento: string;
      pagadoEl: string | null;
      referencia: string;
      clabe: string;
      banco: string | null;
      beneficiario: string;
      contacto: string | null;
      recordatorios: boolean;
      demostracion: boolean;
    };

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

async function leerEnlace(token: unknown): Promise<Record<string, unknown> | null> {
  if (typeof token !== "string" || !TOKEN.test(token)) return null;
  return conContexto({ rol: "plataforma_cliente" }, async (consulta) => {
    const r = await aplicarSentencia(consulta, "select * from cobranza_por_enlace($1)", [hashDeToken(token)]);
    return r.rows[0] ? registro(r.rows[0]) : null;
  });
}

export async function leerPaginaDelPagador(token: unknown, deps?: Pick<DependenciasCobranza, "ahora">): Promise<VistaPagador | null> {
  const f = await leerEnlace(token);
  if (!f) return null;
  const hoy = hoyEnMexico((deps?.ahora ?? (() => new Date()))());
  const contacto = textoONulo(f.correo_contacto);
  if (fechaDe(f.enlace_vence) < hoy) return { estado: "vencido", razonSocial: texto(f.razon_social), contacto };
  const monto = centavos(f.monto_centavos);
  const vencimiento = fechaDe(f.vencimiento);
  const clabe = texto(f.clabe);
  return {
    estado: f.estado === "pagado" ? "pagado" : f.estado === "emitido" ? "pendiente" : "cancelado",
    razonSocial: texto(f.razon_social),
    cliente: texto(f.cliente),
    concepto: texto(f.concepto),
    periodo: etiquetaPeriodo(vencimiento, esPeriodicidad(f.periodicidad) ? f.periodicidad : null),
    montoCentavos: monto,
    saldoCentavos: monto - centavos(f.pagado_centavos),
    vencimiento,
    pagadoEl: f.pagado_el ? fechaDe(f.pagado_el) : null,
    referencia: texto(f.referencia),
    clabe,
    banco: bancoDeClabe(clabe),
    beneficiario: texto(f.beneficiario),
    contacto,
    recordatorios: booleano(f.recordatorios),
    demostracion: booleano(f.demostracion),
  };
}

/**
 * El pagador pide no recibir recordatorios. Lo hace el sistema a nombre del
 * pagador (sin persona de Lever), queda en la bitácora y se avisa a la empresa.
 * El cobro de cada periodo le sigue llegando. Pedirlo dos veces no hace nada.
 */
export async function pedirSinRecordatorios(token: unknown, deps?: DependenciasCobranza): Promise<boolean> {
  const f = await leerEnlace(token);
  if (!f) return false;
  const hoy = hoyEnMexico((deps?.ahora ?? (() => new Date()))());
  if (fechaDe(f.enlace_vence) < hoy) return false;
  const empresaId = texto(f.company_id);
  const operadorId = texto(f.operator_id);
  const clienteId = texto(f.customer_id);
  const actor = actorDeSistema(empresaId, operadorId, "pagador");
  const cambio = await conContexto(baseDeSistema(empresaId, operadorId), async (consulta) => {
    const r = await aplicarSentencia(
      consulta,
      `update collection_customers set recordatorios = false, recordatorios_por = 'pagador', recordatorios_cambio_en = now()
        where company_id = $1 and id = $2 and estado = 'activo' and recordatorios`,
      [empresaId, clienteId],
    );
    if (r.rowCount !== 1) return false;
    await (deps?.auditar ?? auditarPorDefecto)(consulta, actor, {
      accion: "recordatorios_cliente_cobranza",
      identificador: clienteId,
      cambio: { activos: false, por: "pagador" },
    });
    return true;
  });
  if (cambio && !booleano(f.demostracion)) {
    const url = (deps?.urlPublica ?? (() => leerUrlPublica()))();
    await avisarAlEquipo(
      { empresa: { id: empresaId, operadorId, demostracion: false } },
      deps,
      plantillaAvisoSinRecordatorios({ razonSocial: texto(f.razon_social), cliente: texto(f.cliente), enlace: `${url}/c/${empresaId}/consola/cobros/clientes/${clienteId}` }),
      `cobranza-sin-recordatorios/${clienteId}`,
    );
  }
  return true;
}
