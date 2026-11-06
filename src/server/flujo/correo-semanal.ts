import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import { formatoPesos } from "../../dominio/centavos";
import { fechaConAnio, fechaCorta, lunesDe, primeroDelMes, ultimoDelMes } from "../../dominio/flujo/fechas";
import { calcularPresupuestos, ETIQUETA_ESTADO_PRESUPUESTO } from "../../dominio/flujo/presupuestos";
import { proyectar, textoAlcance, type Proyeccion } from "../../dominio/flujo/proyeccion";
import { hoyEnMexico } from "../../dominio/personas";
import { aplicarSentencia, comoTarea, conContexto, type Consulta, type ContextoDeBase } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { enEmpresa } from "../../nucleo/rutas";
import { auditar as auditarPorDefecto, type Actor, type Auditar } from "../bitacora/auditar";
import { enviadorDesdeEntorno, leerUrlPublica } from "../correo";
import { plantillaResumenSemanal } from "../correo/plantillas/resumen-semanal";
import type { Enviador } from "../correo/tipos";
import { booleano, lista, texto, textoONulo, unaFila } from "./lectura";
import { leerFuentesPresupuesto, leerTotalesCobro } from "./repositorio";
import { proyeccionCon } from "./servicio";

/**
 * El correo de los lunes. La tarea no tiene sesión: como plataforma_tarea pide a
 * la base solo los ids de las empresas con destinatarios
 * (empresas_con_correo_semanal, la única puerta sin empresa, que ningún otro rol
 * puede ejecutar) y después trabaja empresa por empresa, cada una en su propia
 * transacción con su contexto y RLS normal. Un fallo de una empresa se registra
 * y no detiene a las demás. Quien llama ya validó CRON_SECRET.
 *
 * Trabaja tres empresas a la vez (el tope del pool de conexiones), espacia los
 * envíos para no pasar el límite del proveedor y deja de empezar empresas
 * nuevas al agotar su tiempo; las que faltan quedan como
 * pendientes, se registran y las toma la siguiente corrida del cron. Cada
 * persona que ya recibió el correo de la semana queda registrada: un reintento,
 * aunque pasen más de 24 horas, no se lo vuelve a mandar.
 */

export type ResultadoCorreoSemanal = {
  semana: string;
  empresas: number;
  enviados: number;
  omitidos: number;
  fallidos: number;
  /** Empresas que no se alcanzaron a empezar antes del tope de tiempo. */
  pendientes: number;
};

export type DependenciasCorreoSemanal = {
  ahora?: () => Date;
  enviador?: Enviador;
  urlPublica?: string;
  auditar?: Auditar;
  registrar?: (campos: Readonly<Record<string, string | number>>) => void;
  /** Milisegundos transcurridos desde que empezó la tarea (reloj de prueba). */
  transcurrido?: () => number;
  /** Después de este tiempo no se empieza otra empresa. */
  presupuestoMs?: number;
  /** Separación mínima entre dos envíos de la corrida. */
  ritmoMs?: number;
};

type Paso = {
  hoy: string;
  semana: string;
  enviador: Enviador;
  url: string;
  auditar: Auditar;
  registrar: NonNullable<DependenciasCorreoSemanal["registrar"]>;
  turno: () => Promise<void>;
};

/** Un apartado «enviando» más viejo que esto es de una corrida que se cayó a medias. */
const INTERRUMPIDO = "30 minutes";
/** Igual al tope del pool (src/nucleo/db.ts, max: 3): más empresas a la vez solo esperarían conexión. */
export const CONCURRENCIA = 3;
/** La ruta tiene 300 s (maxDuration); se deja margen para cerrar la empresa en curso. */
export const PRESUPUESTO_MS = 240_000;
/**
 * Resend admite 10 peticiones por segundo por equipo, sin ráfaga, y la 11.ª del
 * mismo segundo recibe 429 (resend.com/docs/api-reference/rate-limit). La tarea
 * usa la mitad y deja el resto a los correos de la aplicación (invitaciones,
 * avisos de seguridad) que salen en ese mismo minuto.
 */
export const RITMO_MS = 200;
const CODIGO = /^[a-z][a-z0-9_]{0,63}$/;

export async function enviarCorreosSemanales(deps: DependenciasCorreoSemanal = {}): Promise<ResultadoCorreoSemanal> {
  const hoy = hoyEnMexico((deps.ahora ?? (() => new Date()))());
  const semana = lunesDe(hoy);
  // Sin proveedor ni dirección pública no se toca la base: lanza correo_no_configurado.
  const enviador = deps.enviador ?? enviadorDesdeEntorno();
  const url = deps.urlPublica ?? leerUrlPublica();
  const paso: Paso = {
    hoy,
    semana,
    enviador,
    url,
    auditar: deps.auditar ?? auditarPorDefecto,
    registrar: deps.registrar ?? registrarPorDefecto,
    turno: marcarRitmo(deps.ritmoMs ?? RITMO_MS),
  };

  const empresas = await comoTarea(async (consulta) => {
    const resultado = await aplicarSentencia(consulta, "select empresa from empresas_con_correo_semanal() as empresa order by empresa");
    return lista(resultado.rows).map((fila) => texto(fila.empresa));
  });

  const resultado: ResultadoCorreoSemanal = { semana, empresas: empresas.length, enviados: 0, omitidos: 0, fallidos: 0, pendientes: 0 };
  const inicio = Date.now();
  const transcurrido = deps.transcurrido ?? (() => Date.now() - inicio);
  const presupuesto = deps.presupuestoMs ?? PRESUPUESTO_MS;
  const cola = [...empresas];
  const trabajar = async (): Promise<void> => {
    for (let empresaId = cola.shift(); empresaId !== undefined; empresaId = cola.shift()) {
      if (transcurrido() >= presupuesto) {
        resultado.pendientes += 1 + cola.length;
        cola.length = 0;
        return;
      }
      try {
        resultado[await enviarAEmpresa(empresaId, paso)] += 1;
      } catch (error) {
        resultado.fallidos += 1;
        paso.registrar({ evento: "correo_semanal_fallido", empresa: empresaId, semana, codigo: codigoDe(error) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, empresas.length) }, trabajar));
  if (resultado.pendientes > 0) {
    // Sin ids ni datos: cuántas faltan. La siguiente corrida del cron las toma.
    paso.registrar({ evento: "correo_semanal_pendientes", semana, pendientes: resultado.pendientes, empresas: resultado.empresas });
  }
  return resultado;
}

type Apartado = { envioId: string; razonSocial: string; base: ContextoDeBase; actor: Actor };

async function enviarAEmpresa(empresaId: string, paso: Paso): Promise<"enviados" | "omitidos" | "fallidos"> {
  const apartado = await apartar(empresaId, paso);
  if (!apartado) return "omitidos";

  let destinatarios = 0;
  let codigo: string | null = null;
  try {
    const datos = await conContexto(apartado.base, (consulta) => leerResumen(consulta, empresaId, paso.hoy, paso.semana));
    destinatarios = datos.entregados.size;
    const plantilla = plantillaResumenSemanal({
      razonSocial: apartado.razonSocial,
      semana: fechaConAnio(paso.semana),
      saldoDeclarado: datos.proyeccion.saldo
        ? `${formatoPesos(datos.proyeccion.saldo.centavos)} al ${fechaConAnio(datos.proyeccion.saldo.alDia)}`
        : null,
      salidas4: formatoPesos(datos.proyeccion.comprometido4),
      entradas4: formatoPesos(datos.proyeccion.entradas4),
      alcance: textoAlcance(datos.proyeccion),
      faltante: textoFaltante(datos.proyeccion),
      cobrosVencidos: datos.cobros.vencidos > 0 ? `${datos.cobros.vencidos} por ${formatoPesos(datos.cobros.vencidosCentavos)}` : null,
      presupuestos: datos.alertas.map(
        (linea) =>
          `${linea.tipo === "area" ? "Área" : "Persona"} ${linea.nombre}: ${ETIQUETA_ESTADO_PRESUPUESTO[linea.estado].toLowerCase()} (${formatoPesos(linea.gastoCentavos)} de ${formatoPesos(linea.presupuestoCentavos ?? 0)}).`,
      ),
      enlace: `${paso.url}${enEmpresa(empresaId, "/consola")}`,
    });
    for (const persona of datos.destinatarios) {
      // Ya lo recibió esta semana (en esta corrida o en una anterior): no se le vuelve a mandar.
      if (datos.entregados.has(persona.id)) continue;
      try {
        await paso.turno();
        await paso.enviador({
          para: persona.correo,
          ...plantilla,
          // Segunda defensa: el proveedor descarta un repetido dentro de sus 24 horas.
          idempotencia: `correo-semanal/${empresaId}/${paso.semana}/${persona.id}`,
          etiqueta: "correo_semanal",
        });
      } catch (error) {
        codigo ??= codigoDe(error);
        paso.registrar({ evento: "correo_semanal_destinatario_fallido", empresa: empresaId, semana: paso.semana, usuario: persona.id, codigo: codigoDe(error) });
        continue;
      }
      try {
        await conContexto(apartado.base, (consulta) => registrarEntrega(consulta, apartado, paso, persona.id));
        destinatarios += 1;
      } catch (error) {
        codigo ??= codigoDe(error);
        paso.registrar({ evento: "correo_semanal_entrega_sin_registro", empresa: empresaId, semana: paso.semana, usuario: persona.id, codigo: codigoDe(error) });
      }
    }
  } catch (error) {
    codigo ??= codigoDe(error);
  }

  const estado = codigo ? "fallido" : "enviado";
  await conContexto(apartado.base, (consulta) => cerrar(consulta, apartado, paso.auditar, estado, destinatarios, codigo));
  if (codigo) paso.registrar({ evento: "correo_semanal_fallido", empresa: empresaId, semana: paso.semana, codigo });
  return codigo ? "fallidos" : "enviados";
}

/**
 * Aparta la semana de la empresa: uno por (empresa, semana). Si ya salió, no
 * hace nada; si otra corrida lo trae en curso, tampoco. Un intento fallido o
 * interrumpido se vuelve a abrir.
 */
async function apartar(empresaId: string, paso: Paso): Promise<Apartado | null> {
  return conContexto({ rol: "plataforma_cliente", companyId: empresaId }, async (consulta) => {
    const empresa = unaFila(await aplicarSentencia(consulta, "select razon_social, operator_id from companies where id = $1", [empresaId]));
    const operadorId = textoONulo(empresa.operator_id);
    if (!operadorId) throw new ErrorDeDominio("auditoria_no_disponible");
    const base: ContextoDeBase = { rol: "plataforma_cliente", companyId: empresaId, operadorId };
    const actor: Actor = {
      operadorId,
      companyId: empresaId,
      actorTipo: "sistema",
      actorId: null,
      superficie: "cliente",
      peticionId: null,
      origen: "tarea",
    };

    const nuevo = randomUUID();
    const insertado = await aplicarSentencia(
      consulta,
      `insert into weekly_digest_sends (id, company_id, semana, estado)
       values ($1, $2, $3, 'enviando')
       on conflict (company_id, semana) do nothing
       returning id`,
      [nuevo, empresaId, paso.semana],
    );
    const razonSocial = texto(empresa.razon_social);
    if (insertado.rows.length === 1) return { envioId: nuevo, razonSocial, base, actor };

    const previo = unaFila(
      await aplicarSentencia(
        consulta,
        `select id, estado, clock_timestamp() - intentado_en > $3::interval as interrumpido
           from weekly_digest_sends
          where company_id = $1 and semana = $2
          for update`,
        [empresaId, paso.semana, INTERRUMPIDO],
      ),
    );
    const envioId = texto(previo.id);
    const estado = texto(previo.estado);
    if (estado === "enviado") return null;
    const apartado = { envioId, razonSocial, base, actor };
    if (estado === "enviando") {
      if (!booleano(previo.interrumpido)) return null;
      await cerrar(consulta, apartado, paso.auditar, "fallido", 0, "interrumpido");
    }
    await aplicarSentencia(
      consulta,
      `update weekly_digest_sends
          set estado = 'enviando', destinatarios = 0, codigo = null, intentado_en = clock_timestamp(), terminado_en = null
        where id = $1 and estado = 'fallido'`,
      [envioId],
    );
    return apartado;
  });
}

async function cerrar(
  consulta: Consulta,
  apartado: Apartado,
  auditar: Auditar,
  estado: "enviado" | "fallido",
  destinatarios: number,
  codigo: string | null,
): Promise<void> {
  const resultado = await aplicarSentencia(
    consulta,
    `update weekly_digest_sends
        set estado = $2, destinatarios = $3, codigo = $4, terminado_en = clock_timestamp()
      where id = $1 and estado = 'enviando'`,
    [apartado.envioId, estado, destinatarios, codigo],
  );
  if (resultado.rowCount !== 1) throw new ErrorDeDominio("envio_cerrado");
  await auditar(consulta, apartado.actor, {
    accion: "correo_semanal",
    identificador: apartado.envioId,
    cambio: { estado, destinatarios, codigo },
  });
}

/** Deja constancia de que la persona ya recibió el correo de la semana, con su evento. */
async function registrarEntrega(consulta: Consulta, apartado: Apartado, paso: Paso, usuarioId: string): Promise<void> {
  const id = randomUUID();
  const insertado = await aplicarSentencia(
    consulta,
    `insert into weekly_digest_deliveries (id, company_id, semana, user_id, send_id)
     values ($1, $2, $3, $4, $5)
     on conflict (company_id, semana, user_id) do nothing
     returning id`,
    [id, apartado.base.companyId, paso.semana, usuarioId, apartado.envioId],
  );
  if (insertado.rows.length === 0) return;
  await paso.auditar(consulta, apartado.actor, { accion: "correo_semanal_entregado", identificador: id });
}

type Resumen = {
  proyeccion: Proyeccion;
  cobros: { vencidos: number; vencidosCentavos: number };
  alertas: ReturnType<typeof calcularPresupuestos>["alertas"];
  destinatarios: { id: string; correo: string }[];
  /** Quienes ya lo recibieron esta semana. */
  entregados: Set<string>;
};

/**
 * Todo con el contexto de la empresa: RLS solo deja ver sus filas. El correo va
 * a varias personas y no todas pueden ver el detalle de la nómina: la
 * proyección sale sin desglosar el pago de una sola persona.
 */
async function leerResumen(consulta: Consulta, empresaId: string, hoy: string, semana: string): Promise<Resumen> {
  const { fuentes } = await proyeccionCon(consulta, empresaId, hoy);
  const presupuestos = calcularPresupuestos(
    await leerFuentesPresupuesto(consulta, empresaId, hoy, primeroDelMes(hoy), ultimoDelMes(hoy)),
  );
  const entregas = await aplicarSentencia(
    consulta,
    "select user_id from weekly_digest_deliveries where company_id = $1 and semana = $2",
    [empresaId, semana],
  );
  return {
    proyeccion: proyectar(fuentes, null, { detalleNomina: false }),
    cobros: await leerTotalesCobro(consulta, empresaId, hoy),
    alertas: presupuestos.alertas,
    destinatarios: await leerDestinatarios(consulta, empresaId, hoy),
    entregados: new Set(lista(entregas.rows).map((fila) => texto(fila.user_id))),
  };
}

/**
 * Administración y finanzas lo reciben salvo que lo apaguen; contaduría, solo si
 * lo enciende. Quien está de baja o con la membresía inactiva, no.
 */
export async function leerDestinatarios(consulta: Consulta, empresaId: string, hoy: string): Promise<{ id: string; correo: string }[]> {
  const resultado = await aplicarSentencia(
    consulta,
    `select distinct u.id, u.correo
       from memberships m
       join users u on u.id = m.user_id
       join membership_roles r on r.company_id = m.company_id and r.user_id = m.user_id
       left join employees e on e.company_id = m.company_id and e.user_id = m.user_id
       left join weekly_digest_preferences p on p.company_id = m.company_id and p.user_id = m.user_id
      where m.company_id = $1
        and m.estado = 'activa'
        and r.rol in ('administrador', 'finanzas', 'contador')
        and (e.id is null or e.baja_en is null or e.baja_en > $2::date)
        and coalesce(p.activo, r.rol in ('administrador', 'finanzas'))
      order by u.id`,
    [empresaId, hoy],
  );
  return lista(resultado.rows).map((fila) => ({ id: texto(fila.id), correo: texto(fila.correo) }));
}

function textoFaltante(p: Proyeccion): string | null {
  const f = p.faltante;
  if (!f) return null;
  const semana = `la semana del ${fechaCorta(f.inicio)} al ${fechaCorta(f.fin)}`;
  const cierre =
    f.motivo === "negativo"
      ? `el saldo proyectado queda en ${formatoPesos(f.saldoFinal)} ${semana}.`
      : `el saldo proyectado baja a ${formatoPesos(f.saldoFinal)} ${semana}, debajo de tu colchón de ${formatoPesos(p.colchonCentavos)}.`;
  const causas = f.causas.length > 0 ? ` Lo provoca: ${f.causas.map((m) => `${m.concepto} (${formatoPesos(m.centavos)})`).join(", ")}.` : "";
  return `${cierre}${causas}`;
}

/**
 * Turnos de envío separados al menos `intervaloMs`, compartidos por todas las
 * empresas en curso: cada quien aparta el siguiente hueco y espera a que llegue.
 */
export function marcarRitmo(
  intervaloMs: number,
  reloj: () => number = Date.now,
  dormir: (ms: number) => Promise<void> = (ms) => new Promise((listo) => setTimeout(listo, ms)),
): () => Promise<void> {
  let siguiente = 0;
  return async () => {
    const ahora = reloj();
    const turno = Math.max(ahora, siguiente);
    siguiente = turno + intervaloMs;
    if (turno > ahora) await dormir(turno - ahora);
  };
}

function codigoDe(error: unknown): string {
  if (error instanceof ErrorDeDominio && CODIGO.test(error.codigo)) return error.codigo;
  return "desconocido";
}

/** Solo ids internos y el código: nunca correos, nombres ni montos. */
function registrarPorDefecto(campos: Readonly<Record<string, string | number>>): void {
  console.error(JSON.stringify({ nivel: "error", origen: "flujo.correo_semanal", ...campos }));
}

/** El encabezado de la tarea contra CRON_SECRET, en tiempo constante. Un secreto vacío nunca abre. */
export function autorizada(encabezado: string | null, secreto: string | undefined): boolean {
  if (!secreto || secreto.trim() === "" || !encabezado) return false;
  const esperado = createHash("sha256").update(`Bearer ${secreto}`).digest();
  const recibido = createHash("sha256").update(encabezado).digest();
  return timingSafeEqual(esperado, recibido);
}
