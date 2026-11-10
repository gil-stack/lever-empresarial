import { randomUUID } from "node:crypto";

import { formatoPesos } from "../../dominio/centavos";
import { fechaConAnio, lunesDe } from "../../dominio/flujo/fechas";
import { proyectar } from "../../dominio/flujo/proyeccion";
import {
  calcularRunway,
  formatoMeses,
  runwayBajo,
  semanasDe,
  textoRunway,
  transicion,
  type EstadoAlertas,
} from "../../dominio/flujo/runway";
import { hoyEnMexico } from "../../dominio/personas";
import { aplicarSentencia, bloquearEmpresa, comoTarea, conContexto, type Consulta, type ContextoDeBase } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { enEmpresa } from "../../nucleo/rutas";
import { auditar as auditarPorDefecto, type Actor, type Auditar } from "../bitacora/auditar";
import { actorDeSistema, baseDeSistema } from "../cobranza/comun";
import { enviadorDesdeEntorno, leerUrlPublica } from "../correo";
import { ErrorDeCorreo } from "../correo/errores";
import { plantillaAlertaCaja } from "../correo/plantillas/alerta-caja";
import type { Enviador } from "../correo/tipos";
import { CONCURRENCIA, leerDestinatarios, marcarRitmo, RITMO_MS, textoFaltante } from "./correo-semanal";
import { booleano, entero, lista, registro, texto } from "./lectura";
import { leerEstadoAlertas, leerMesesMinimos, leerRunwayCon } from "./runway";

/**
 * La tarea de las alertas de caja (vercel.json, cada 15 minutos de 7:00 a 21:45
 * en el centro de México). Como plataforma_tarea pide solo los ids de las
 * empresas activas con saldo declarado; después, empresa por empresa, con su
 * contexto y RLS normal y bajo el candado de la empresa:
 *
 * 1. toma la foto de la semana si falta (una por semana, no se reescribe);
 * 2. evalúa las dos alertas sin entradas estimadas: el colchón con la
 *    proyección de 13 semanas y el mínimo de meses con el runway conservador;
 * 3. si una pasó de apagada a encendida, crea un aviso (un solo correo aunque
 *    crucen las dos); si sigue encendida no hace nada; si se apaga, deja listo
 *    el siguiente cruce. Sin cambios no escribe nada;
 * 4. manda los avisos apartados y reintenta los fallidos mientras la condición
 *    siga encendida. En una empresa de demostración el aviso queda simulado.
 *
 * Dos corridas a la vez (Vercel puede repetir una) se ordenan con el candado:
 * la segunda ya ve el estado nuevo y no encuentra nada que apartar. Quien llama
 * ya validó CRON_SECRET.
 */

export type ResultadoAlertas = {
  empresas: number;
  evaluadas: number;
  fotos: number;
  avisos: number;
  correos: { enviados: number; simulados: number; fallidos: number; sin_destinatarios: number; descartados: number };
  fallidas: number;
  pendientes: number;
};

export type DependenciasAlertas = {
  ahora?: () => Date;
  enviador?: () => Enviador;
  urlPublica?: () => string;
  auditar?: Auditar;
  registrar?: (campos: Readonly<Record<string, string | number>>) => void;
  transcurrido?: () => number;
  presupuestoMs?: number;
  ritmoMs?: number;
};

/** La ruta tiene 300 s; se deja margen para cerrar la empresa en curso. */
export const PRESUPUESTO_MS = 240_000;
/** Un apartado «enviando» más viejo que esto es de una corrida que se cayó a medias. */
const INTERRUMPIDO = "30 minutes";
/** Intentos de correo por aviso; después queda descartado. */
const INTENTOS = 5;
const CODIGO = /^[a-z][a-z0-9_]{0,63}$/;

type Paso = {
  hoy: string;
  semana: string;
  auditar: Auditar;
  registrar: NonNullable<DependenciasAlertas["registrar"]>;
  enviador: () => Enviador;
  urlPublica: () => string;
  turno: () => Promise<void>;
};

type Empresa = { id: string; operadorId: string; demostracion: boolean };

export async function correrAlertasDeCaja(deps: DependenciasAlertas = {}): Promise<ResultadoAlertas> {
  const hoy = hoyEnMexico((deps.ahora ?? (() => new Date()))());
  const paso: Paso = {
    hoy,
    semana: lunesDe(hoy),
    auditar: deps.auditar ?? auditarPorDefecto,
    registrar: deps.registrar ?? registrarPorDefecto,
    enviador: deps.enviador ?? (() => enviadorDesdeEntorno()),
    urlPublica: deps.urlPublica ?? (() => leerUrlPublica()),
    turno: marcarRitmo(deps.ritmoMs ?? RITMO_MS),
  };
  const empresas: Empresa[] = await comoTarea(async (consulta) =>
    lista((await aplicarSentencia(consulta, "select company_id, operator_id, demostracion from empresas_para_alertas_de_caja()")).rows).map((f) => ({
      id: texto(f.company_id),
      operadorId: texto(f.operator_id),
      demostracion: booleano(f.demostracion),
    })),
  );
  const resultado: ResultadoAlertas = {
    empresas: empresas.length,
    evaluadas: 0,
    fotos: 0,
    avisos: 0,
    correos: { enviados: 0, simulados: 0, fallidos: 0, sin_destinatarios: 0, descartados: 0 },
    fallidas: 0,
    pendientes: 0,
  };
  const inicio = Date.now();
  const transcurrido = deps.transcurrido ?? (() => Date.now() - inicio);
  const presupuesto = deps.presupuestoMs ?? PRESUPUESTO_MS;
  const cola = [...empresas];
  const trabajar = async (): Promise<void> => {
    for (let empresa = cola.shift(); empresa !== undefined; empresa = cola.shift()) {
      if (transcurrido() >= presupuesto) {
        resultado.pendientes += 1 + cola.length;
        cola.length = 0;
        return;
      }
      try {
        await atenderEmpresa(empresa, paso, resultado);
      } catch (error) {
        resultado.fallidas += 1;
        paso.registrar({ evento: "alertas_caja_empresa_fallida", empresa: empresa.id, codigo: codigoDe(error) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, empresas.length) }, trabajar));
  // Solo cuentas: nunca ids de personas, correos, nombres ni montos.
  paso.registrar({
    evento: "alertas_caja_corrida",
    empresas: resultado.empresas,
    evaluadas: resultado.evaluadas,
    fotos: resultado.fotos,
    avisos: resultado.avisos,
    enviados: resultado.correos.enviados,
    fallidos: resultado.correos.fallidos,
    fallidas: resultado.fallidas,
    pendientes: resultado.pendientes,
    ms: transcurrido(),
  });
  return resultado;
}

/** Lo que el correo dice, calculado en la misma transacción que la evaluación. */
type Contenido = { colchon: string | null; runway: string | null; conservador: string; esperado: string; saldo: string; minimo: string; razonSocial: string };

type PorMandar = { alertaId: string; colchon: boolean; runway: boolean };

async function atenderEmpresa(empresa: Empresa, paso: Paso, resultado: ResultadoAlertas): Promise<void> {
  const base = baseDeSistema(empresa.id, empresa.operadorId);
  const actor = actorDeSistema(empresa.id, empresa.operadorId, "tarea");
  const evaluada = await conContexto(base, (consulta) => evaluar(consulta, empresa, actor, paso));
  resultado.evaluadas += 1;
  resultado.fotos += evaluada.foto ? 1 : 0;
  resultado.avisos += evaluada.nuevo ? 1 : 0;
  resultado.correos.simulados += evaluada.simulado ? 1 : 0;
  resultado.correos.descartados += evaluada.descartados;
  for (const aviso of evaluada.porMandar) {
    const estado = await mandarAviso(base, actor, empresa.id, aviso, evaluada.contenido, paso);
    if (estado === "enviado") resultado.correos.enviados += 1;
    else if (estado === "fallido") resultado.correos.fallidos += 1;
    else resultado.correos.sin_destinatarios += 1;
  }
}

/** Foto, transición y avisos de una empresa, en una transacción bajo su candado. */
async function evaluar(
  consulta: Consulta,
  empresa: Empresa,
  actor: Actor,
  paso: Paso,
): Promise<{ foto: boolean; nuevo: boolean; simulado: boolean; descartados: number; porMandar: PorMandar[]; contenido: Contenido }> {
  await bloquearEmpresa(consulta, empresa.id);
  const { fuentes, planes } = await leerRunwayCon(consulta, empresa.id, paso.hoy);
  // El correo va a varias personas: sin detalle de nómina para nadie, como el de los lunes.
  const opciones = { detalleNomina: false };
  const runway = calcularRunway(fuentes, planes, opciones);
  const proyeccion = proyectar(fuentes, null, opciones);
  const { meses } = await leerMesesMinimos(consulta, empresa.id);
  const razon = unaFila(await aplicarSentencia(consulta, "select razon_social from companies where id = $1", [empresa.id]));

  // 1. Foto de la semana.
  let foto = false;
  const conservador = semanasDe(runway.conservador, runway.horizonte);
  const esperado = semanasDe(runway.esperado, runway.horizonte);
  if (fuentes.saldo && conservador !== null && esperado !== null) {
    const id = randomUUID();
    const insertada = await aplicarSentencia(
      consulta,
      `insert into cash_runway_snapshots
         (id, company_id, semana, semanas_conservador, semanas_esperado, horizonte_semanas, saldo_centavos, saldo_al_dia, colchon_centavos, meses_minimos)
       values ($1, $2, $3::date, $4, $5, $6, $7, $8::date, $9, $10)
       on conflict (company_id, semana) do nothing
       returning id`,
      [id, empresa.id, paso.semana, conservador, esperado, runway.horizonte.semanas, fuentes.saldo.centavos, fuentes.saldo.alDia, fuentes.colchonCentavos, meses],
    );
    if (insertada.rows.length === 1) {
      foto = true;
      await paso.auditar(consulta, actor, {
        accion: "foto_runway",
        identificador: id,
        cambio: { semana: paso.semana, semanas_conservador: conservador, semanas_esperado: esperado },
      });
    }
  }

  // 2. Transición. Sin saldo no hay alertas: las dos quedan apagadas.
  const ahora: EstadoAlertas = {
    bajoColchon: fuentes.saldo !== null && proyeccion.faltante !== null,
    runwayBajo: runwayBajo(runway.conservador, meses),
  };
  const antes = await leerEstadoAlertas(consulta, empresa.id);
  const { cambia, avisar } = transicion(antes, ahora);
  if (cambia) {
    await paso.auditar(consulta, actor, {
      accion: "estado_alerta_caja",
      identificador: empresa.id,
      cambio: {
        bajo_colchon_anterior: antes?.bajoColchon ?? false,
        bajo_colchon: ahora.bajoColchon,
        runway_bajo_anterior: antes?.runwayBajo ?? false,
        runway_bajo: ahora.runwayBajo,
      },
    });
    await aplicarSentencia(
      consulta,
      `insert into cash_alert_states (company_id, bajo_colchon, runway_bajo)
       values ($1, $2, $3)
       on conflict (company_id) do update
         set bajo_colchon = excluded.bajo_colchon, runway_bajo = excluded.runway_bajo, actualizado_en = now()`,
      [empresa.id, ahora.bajoColchon, ahora.runwayBajo],
    );
  }

  // 3. Aviso nuevo por el cruce.
  const porMandar: PorMandar[] = [];
  let nuevo = false;
  let simulado = false;
  if (avisar) {
    const id = randomUUID();
    const faltante = avisar.colchon ? proyeccion.faltante : null;
    const estado = empresa.demostracion ? "simulado" : "enviando";
    await aplicarSentencia(
      consulta,
      `insert into cash_alerts
         (id, company_id, colchon, runway, faltante_inicio, faltante_saldo_centavos, faltante_motivo, colchon_centavos,
          runway_semanas, horizonte_semanas, meses_minimos, estado, terminado_en)
       values ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10, $11, $12, case when $12 = 'enviando' then null else clock_timestamp() end)`,
      [
        id,
        empresa.id,
        avisar.colchon,
        avisar.runway,
        faltante?.inicio ?? null,
        faltante?.saldoFinal ?? null,
        faltante?.motivo ?? null,
        fuentes.colchonCentavos,
        avisar.runway ? conservador : null,
        runway.horizonte.semanas,
        meses,
        estado,
      ],
    );
    nuevo = true;
    if (empresa.demostracion) {
      // Una empresa de demostración tiene cifras de ejemplo: el correo no sale.
      simulado = true;
      await paso.auditar(consulta, actor, {
        accion: "alerta_caja",
        identificador: id,
        cambio: { estado, destinatarios: 0, codigo: null, colchon: avisar.colchon, runway: avisar.runway },
      });
    } else {
      porMandar.push({ alertaId: id, colchon: avisar.colchon, runway: avisar.runway });
    }
  }

  // 4. Reintentos: un fallido (o un apartado que se quedó a medias) vuelve a salir
  //    mientras su condición siga encendida; si ya se apagó, queda descartado.
  let descartados = 0;
  const previos = await aplicarSentencia(
    consulta,
    `select id, colchon, runway, estado, intentos, codigo,
            estado = 'enviando' and clock_timestamp() - intentado_en > $2::interval as interrumpido
       from cash_alerts
      where company_id = $1 and estado in ('fallido', 'enviando')
      order by detectado_en, id
      for update`,
    [empresa.id, INTERRUMPIDO],
  );
  for (const fila of lista(previos.rows)) {
    const id = texto(fila.id);
    if (porMandar.some((p) => p.alertaId === id)) continue;
    let estado = texto(fila.estado);
    if (estado === "enviando") {
      // En curso en otra corrida: no se toca. Interrumpido: se cierra como fallido y sigue la regla de abajo.
      if (!booleano(fila.interrumpido)) continue;
      await cerrar(consulta, actor, paso.auditar, id, "fallido", 0, "interrumpido", booleano(fila.colchon), booleano(fila.runway));
      estado = "fallido";
    }
    const colchon = booleano(fila.colchon);
    const runwayAviso = booleano(fila.runway);
    const sigue = (colchon && ahora.bajoColchon) || (runwayAviso && ahora.runwayBajo);
    if (!sigue || entero(fila.intentos) >= INTENTOS) {
      await aplicarSentencia(consulta, "update cash_alerts set estado = 'descartado', terminado_en = clock_timestamp() where id = $1 and estado = 'fallido'", [id]);
      await paso.auditar(consulta, actor, {
        accion: "alerta_caja",
        identificador: id,
        cambio: { estado: "descartado", destinatarios: 0, codigo: sigue ? "sin_intentos" : "condicion_resuelta", colchon, runway: runwayAviso },
      });
      descartados += 1;
      continue;
    }
    await aplicarSentencia(
      consulta,
      `update cash_alerts set estado = 'enviando', intentos = intentos + 1, codigo = null, intentado_en = clock_timestamp(), terminado_en = null
        where id = $1 and estado = 'fallido'`,
      [id],
    );
    porMandar.push({ alertaId: id, colchon: colchon && ahora.bajoColchon, runway: runwayAviso && ahora.runwayBajo });
  }

  const contenido: Contenido = {
    razonSocial: texto(razon.razon_social),
    colchon: ahora.bajoColchon ? textoFaltante(proyeccion) : null,
    runway: ahora.runwayBajo ? textoRunway(runway.conservador) : null,
    conservador: textoRunway(runway.conservador),
    esperado: textoRunway(runway.esperado),
    saldo: fuentes.saldo ? `${formatoPesos(fuentes.saldo.centavos)} al ${fechaConAnio(fuentes.saldo.alDia)}` : "Sin declarar",
    minimo: formatoMeses(meses).replace(".0 ", " "),
  };
  return { foto, nuevo, simulado, descartados, porMandar, contenido };
}

async function cerrar(
  consulta: Consulta,
  actor: Actor,
  auditar: Auditar,
  id: string,
  estado: "enviado" | "fallido" | "sin_destinatarios",
  destinatarios: number,
  codigo: string | null,
  colchon: boolean,
  runway: boolean,
): Promise<void> {
  const resultado = await aplicarSentencia(
    consulta,
    `update cash_alerts set estado = $2, destinatarios = $3, codigo = $4, terminado_en = clock_timestamp()
      where id = $1 and estado = 'enviando'`,
    [id, estado, destinatarios, codigo],
  );
  if (resultado.rowCount !== 1) throw new ErrorDeDominio("envio_cerrado");
  await auditar(consulta, actor, { accion: "alerta_caja", identificador: id, cambio: { estado, destinatarios, codigo, colchon, runway } });
}

/**
 * Manda un aviso apartado a los destinatarios del correo de los lunes que
 * todavía no lo tienen. Cada entrega queda registrada; la llave del proveedor
 * es la segunda defensa. Termina cerrando el aviso.
 */
async function mandarAviso(
  base: ContextoDeBase,
  actor: Actor,
  empresaId: string,
  aviso: PorMandar,
  contenido: Contenido,
  paso: Paso,
): Promise<"enviado" | "fallido" | "sin_destinatarios"> {
  let codigo: string | null = null;
  let entregados = 0;
  let destinatarios = 0;
  try {
    const { personas, ya } = await conContexto(base, async (consulta) => ({
      personas: await leerDestinatarios(consulta, empresaId, paso.hoy),
      ya: new Set(
        lista((await aplicarSentencia(consulta, "select user_id from cash_alert_deliveries where company_id = $1 and alert_id = $2", [empresaId, aviso.alertaId])).rows).map(
          (f) => texto(f.user_id),
        ),
      ),
    }));
    destinatarios = personas.length;
    entregados = ya.size;
    if (personas.length > 0) {
      const enviador = paso.enviador();
      const plantilla = plantillaAlertaCaja({
        razonSocial: contenido.razonSocial,
        colchon: aviso.colchon ? contenido.colchon : null,
        runway: aviso.runway ? contenido.runway : null,
        conservador: contenido.conservador,
        minimo: contenido.minimo,
        saldoDeclarado: contenido.saldo,
        esperado: contenido.esperado,
        enlace: `${paso.urlPublica()}${enEmpresa(empresaId, "/consola/flujo")}`,
      });
      for (const persona of personas) {
        if (ya.has(persona.id)) continue;
        try {
          await paso.turno();
          await enviador({ para: persona.correo, ...plantilla, idempotencia: `alerta-caja/${aviso.alertaId}/${persona.id}`, etiqueta: "alerta_caja" });
        } catch (error) {
          // La llave ya se usó con otro contenido: ese correo ya salió y solo faltó registrarlo.
          if (!(error instanceof ErrorDeCorreo && error.codigo === "correo_ya_enviado")) {
            codigo ??= codigoDe(error);
            paso.registrar({ evento: "alerta_caja_destinatario_fallido", empresa: empresaId, aviso: aviso.alertaId, usuario: persona.id, codigo: codigoDe(error) });
            continue;
          }
        }
        try {
          await conContexto(base, (consulta) => registrarEntrega(consulta, actor, paso.auditar, empresaId, aviso.alertaId, persona.id));
          entregados += 1;
        } catch (error) {
          codigo ??= codigoDe(error);
          paso.registrar({ evento: "alerta_caja_entrega_sin_registro", empresa: empresaId, aviso: aviso.alertaId, usuario: persona.id, codigo: codigoDe(error) });
        }
      }
    }
  } catch (error) {
    codigo ??= codigoDe(error);
  }
  const estado = codigo ? "fallido" : destinatarios === 0 ? "sin_destinatarios" : "enviado";
  await conContexto(base, (consulta) => cerrar(consulta, actor, paso.auditar, aviso.alertaId, estado, entregados, codigo, aviso.colchon, aviso.runway));
  if (codigo) paso.registrar({ evento: "alerta_caja_fallida", empresa: empresaId, aviso: aviso.alertaId, codigo });
  return estado;
}

async function registrarEntrega(consulta: Consulta, actor: Actor, auditar: Auditar, empresaId: string, alertaId: string, usuarioId: string): Promise<void> {
  const id = randomUUID();
  const insertado = await aplicarSentencia(
    consulta,
    `insert into cash_alert_deliveries (id, company_id, alert_id, user_id)
     values ($1, $2, $3, $4)
     on conflict (alert_id, user_id) do nothing
     returning id`,
    [id, empresaId, alertaId, usuarioId],
  );
  if (insertado.rows.length === 0) return;
  await auditar(consulta, actor, { accion: "alerta_caja_entregada", identificador: id });
}

function unaFila(resultado: { rows: unknown[] }): Record<string, unknown> {
  if (resultado.rows.length !== 1) throw new ErrorDeDominio("base_no_disponible");
  return registro(resultado.rows[0]);
}

function codigoDe(error: unknown): string {
  if (error instanceof ErrorDeDominio && CODIGO.test(error.codigo)) return error.codigo;
  if (error instanceof ErrorDeCorreo && CODIGO.test(error.codigo)) return error.codigo;
  return "desconocido";
}

/** Solo ids internos, cuentas y el código: nunca correos, nombres ni montos. */
function registrarPorDefecto(campos: Readonly<Record<string, string | number>>): void {
  // El resumen de cada corrida es informativo; lo demás es un fallo.
  const nivel = campos.evento === "alertas_caja_corrida" ? "info" : "error";
  (nivel === "info" ? console.info : console.error)(JSON.stringify({ nivel, origen: "flujo.alertas_caja", ...campos }));
}
