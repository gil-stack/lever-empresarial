import { createHash, randomUUID } from "node:crypto";

import { fechaDeCalendario, hoyEnMexico, textoOperativo, uuidValido } from "../../dominio/operacion";
import { CARGOS_COMITE, nombreParaSiti, type CargoComite, PROPUESTA, type Propuesta } from "../../dominio/pld/etiquetas";
import { pdfDeTexto, type RenglonPdf } from "../../dominio/pld/pdf";
import { semestreDe } from "../../dominio/pld/plazos";
import type { ContextoDePersonal } from "../../nucleo/contexto";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { exigirAutenticacionReciente } from "../autenticacion/reautenticacion";
import { motivoEscrito, unaVezPorFormulario } from "../operacion/formulario";
import { exigirEnOperacion } from "../operacion/permisos";
import { leerPrivado, type AlmacenConstancia } from "../proveedores/constancia";
import type { Sesion as SesionConFactor } from "../session/tipos";
import { auditarPld } from "./auditar";
import { conPld, dia, diaOpcional, fecha, rechazarInvisible } from "./base";
import { archivoDelFormulario } from "./casos";

export type ModoDictamen = { modo: "comite" | "oficial"; oficialId: string | null; oficial: string | null };

export async function leerModoDictamen(ctx: ContextoDePersonal): Promise<ModoDictamen> {
  exigirEnOperacion(ctx, "plataforma.pld.ver");
  return conPld(ctx, null, async (consulta) => {
    const fila = (await consulta.query(
      `select m.modo, m.oficial_user_id, u.nombre from pld_modo_vigente($1) m left join users u on u.id = m.oficial_user_id`,
      [ctx.personal.operadorId],
    )).rows[0] as Record<string, unknown> | undefined;
    return {
      modo: fila?.modo === "oficial" ? "oficial" : "comite",
      oficialId: typeof fila?.oficial_user_id === "string" ? fila.oficial_user_id : null,
      oficial: typeof fila?.nombre === "string" ? fila.nombre : null,
    };
  });
}

/** El personal con rol de Cumplimiento: quién puede ser el Oficial en modo «Oficial de Cumplimiento». */
export async function personalDeCumplimiento(ctx: ContextoDePersonal): Promise<Array<{ id: string; nombre: string }>> {
  exigirEnOperacion(ctx, "plataforma.pld.ver");
  return conPld(ctx, null, async (consulta) => {
    const filas = await consulta.query(
      `select distinct u.id, u.nombre from platform_staff s join platform_staff_roles r on r.operator_id = s.operator_id and r.user_id = s.user_id
       join users u on u.id = s.user_id where s.operator_id = $1 and s.estado = 'activo' and r.rol = 'cumplimiento' order by u.nombre`,
      [ctx.personal.operadorId],
    );
    return (filas.rows as Array<Record<string, unknown>>).map((fila) => ({ id: String(fila.id), nombre: String(fila.nombre) }));
  });
}

/**
 * 47ª, último párrafo: con menos de 25 personas no hay Comité obligatorio y
 * dictamina el Oficial. Cambiar el modo deja bitácora con su motivo.
 */
export async function cambiarModoDictamen(
  ctx: ContextoDePersonal,
  sesion: Pick<SesionConFactor, "segundoFactor" | "superficie">,
  entrada: { formId: unknown; modo: unknown; oficialId: unknown; motivo: unknown },
  deps: { ahora?: () => Date } = {},
): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.pld.comite");
  // Cambiar quién dictamina es una decisión: segundo factor de los últimos 30 minutos.
  exigirAutenticacionReciente(sesion);
  if (!uuidValido(entrada.formId)) throw new ErrorDeDominio("formulario_invalido");
  if (entrada.modo !== "comite" && entrada.modo !== "oficial") throw new ErrorDeDominio("dato_invalido_modo");
  const oficial = entrada.modo === "oficial" ? entrada.oficialId : null;
  if (entrada.modo === "oficial" && !uuidValido(oficial)) throw new ErrorDeDominio("dato_invalido_oficialId");
  const motivo = motivoEscrito(entrada.motivo, 500);
  const ahora = deps.ahora?.() ?? new Date();
  await unaVezPorFormulario(() => conPld(ctx, null, async (consulta) => {
    if ((await consulta.query("select 1 from pld_modo_dictamen where id = $1", [entrada.formId])).rows.length > 0) return;
    await consulta.query(
      "insert into pld_modo_dictamen (id, operator_id, modo, oficial_user_id, motivo, registrado_por) values ($1, $2, $3, $4, $5, $6)",
      [entrada.formId, ctx.personal.operadorId, entrada.modo, oficial, motivo, ctx.persona.id],
    );
    await auditarPld(consulta, ctx, {
      companyId: null, accion: "pld_modo_dictamen_cambiado", identificador: entrada.formId as string, motivo, ocurridoEn: ahora,
      cambio: { modo: entrada.modo as string },
    });
  }), "formulario_invalido");
}

export type Integrante = {
  id: string;
  area: string;
  cargo: CargoComite;
  titularidad: "TITULAR" | "SUPLENTE";
  suplenteDe: string | null;
  nombres: string;
  primerApellido: string;
  segundoApellido: string;
  rfc: string;
  curp: string;
  cargoEntidad: string;
  esOficial: boolean;
  designadoEl: string;
  certificado: string | null;
  vigente: boolean;
  sustituidoEl: string | null;
};

export type ComunicacionPendiente = {
  tipo: "designacion" | "baja";
  integranteId: string;
  nombre: string;
  desde: string;
  vence: string;
};

export type Comite = {
  integrantes: Integrante[];
  auditor: { id: string; nombre: string; cargoEntidad: string; designadoEl: string } | null;
  pendientes: ComunicacionPendiente[];
  comunicaciones: Array<{ id: string; folio: string; recibidoEn: Date; integrantes: number; bajas: number }>;
  sesiones: Sesion[];
  /** Suplentes que pasan de dos sesiones en el semestre o asisten a dos seguidas (47ª). */
  avisosSuplentes: Array<{ integranteId: string; nombre: string; sesiones: number; seguidas: boolean }>;
  sesionDelMes: boolean;
};

export type Sesion = {
  id: string;
  celebradaEl: string;
  presentes: string[];
  miembros: number;
  representados: number;
  quorum: boolean;
  presidenteId: string | null;
  auditorPresente: boolean;
  acta: { id: string; nombre: string; sha256: string } | null;
};

function nombreCompleto(fila: { nombres: string; primerApellido: string; segundoApellido: string }): string {
  return [fila.nombres, fila.primerApellido, fila.segundoApellido === "XXXX" ? "" : fila.segundoApellido].filter(Boolean).join(" ");
}

export function nombreDeIntegrante(integrante: Pick<Integrante, "nombres" | "primerApellido" | "segundoApellido">): string {
  return nombreCompleto(integrante);
}

/** Integración, pendientes de la 49ª (15 días hábiles desde la designación o el cambio), sesiones y avisos. */
export async function leerComite(ctx: ContextoDePersonal, opciones: { ahora?: Date } = {}): Promise<Comite> {
  exigirEnOperacion(ctx, "plataforma.pld.ver");
  const hoy = hoyEnMexico(opciones.ahora ?? new Date());
  return conPld(ctx, null, async (consulta) => {
    const integrantes = ((await consulta.query(
      `select i.*, i.designado_el::text as designado, b.sustituido_el::text as sustituido
       from pld_comite_integrantes i left join pld_comite_bajas b on b.integrante_id = i.id
       where i.operator_id = $1 order by b.sustituido_el nulls first, i.titularidad desc, i.cargo, i.registrado_en`,
      [ctx.personal.operadorId],
    )).rows as Array<Record<string, unknown>>).map((fila): Integrante => ({
      id: String(fila.id),
      area: String(fila.area),
      cargo: fila.cargo as CargoComite,
      titularidad: fila.titularidad === "SUPLENTE" ? "SUPLENTE" : "TITULAR",
      suplenteDe: typeof fila.suplente_de === "string" ? fila.suplente_de : null,
      nombres: String(fila.nombres),
      primerApellido: String(fila.primer_apellido),
      segundoApellido: String(fila.segundo_apellido),
      rfc: String(fila.rfc),
      curp: String(fila.curp),
      cargoEntidad: String(fila.cargo_entidad),
      esOficial: fila.es_oficial === true,
      designadoEl: dia(fila.designado),
      certificado: typeof fila.certificado === "string" ? fila.certificado : null,
      vigente: fila.sustituido === null,
      sustituidoEl: diaOpcional(fila.sustituido),
    }));
    const auditor = (await consulta.query(
      "select id, nombre, cargo_entidad, designado_el::text as designado from pld_comite_auditores where operator_id = $1 order by registrado_en desc, id desc limit 1",
      [ctx.personal.operadorId],
    )).rows[0] as Record<string, unknown> | undefined;
    const comunicaciones = (await consulta.query(
      "select id, folio, recibido_en, integrantes, bajas from pld_comite_comunicaciones where operator_id = $1 order by recibido_en desc",
      [ctx.personal.operadorId],
    )).rows as Array<{ id: string; folio: string; recibido_en: unknown; integrantes: string[]; bajas: string[] }>;
    const comunicadas = new Set(comunicaciones.flatMap((c) => c.integrantes.map((id) => `designacion:${id}`).concat(c.bajas.map((id) => `baja:${id}`))));
    const pendientesBase = integrantes.flatMap((integrante) => {
      const salida: Array<{ tipo: "designacion" | "baja"; integrante: Integrante; desde: string }> = [];
      if (!comunicadas.has(`designacion:${integrante.id}`)) salida.push({ tipo: "designacion", integrante, desde: integrante.designadoEl });
      if (integrante.sustituidoEl && !comunicadas.has(`baja:${integrante.id}`)) salida.push({ tipo: "baja", integrante, desde: integrante.sustituidoEl });
      return salida;
    });
    const vencimientos = pendientesBase.length
      ? ((await consulta.query("select d::text as desde, pld_sumar_dias_habiles(d, 15)::text as vence from unnest($1::date[]) as d", [
          pendientesBase.map((p) => p.desde),
        ])).rows as Array<{ desde: string; vence: string }>)
      : [];
    const vencePorDia = new Map(vencimientos.map((v) => [v.desde, v.vence]));
    const sesiones = ((await consulta.query(
      `select s.id, s.celebrada_el::text as celebrada, s.presentes, s.miembros, s.representados, s.quorum, s.presidente_id, s.auditor_id,
              a.id as acta_id, a.nombre_archivo, a.sha256
       from pld_sesiones s left join pld_actas a on a.sesion_id = s.id
       where s.operator_id = $1 order by s.celebrada_el desc, s.registrado_en desc`,
      [ctx.personal.operadorId],
    )).rows as Array<Record<string, unknown>>).map((fila): Sesion => ({
      id: String(fila.id),
      celebradaEl: dia(fila.celebrada),
      presentes: (fila.presentes as string[]) ?? [],
      miembros: Number(fila.miembros),
      representados: Number(fila.representados),
      quorum: fila.quorum === true,
      presidenteId: typeof fila.presidente_id === "string" ? fila.presidente_id : null,
      auditorPresente: typeof fila.auditor_id === "string",
      acta: typeof fila.acta_id === "string" ? { id: fila.acta_id, nombre: String(fila.nombre_archivo), sha256: String(fila.sha256) } : null,
    }));
    // 47ª: el suplente representa a su titular a lo más en dos sesiones no continuas por semestre.
    const semestre = semestreDe(hoy);
    const delSemestre = sesiones.filter((s) => s.celebradaEl >= semestre.inicio && s.celebradaEl <= semestre.fin).reverse();
    const avisosSuplentes = integrantes
      .filter((i) => i.titularidad === "SUPLENTE")
      .map((suplente) => {
        const asistencias = delSemestre.map((s) => s.presentes.includes(suplente.id) && !s.presentes.includes(suplente.suplenteDe ?? ""));
        const sesionesSuplente = asistencias.filter(Boolean).length;
        const seguidas = asistencias.some((asistio, indice) => asistio && indice > 0 && asistencias[indice - 1]);
        return { integranteId: suplente.id, nombre: nombreCompleto(suplente), sesiones: sesionesSuplente, seguidas };
      })
      .filter((aviso) => aviso.sesiones > 2 || aviso.seguidas);
    const mes = hoy.slice(0, 7);
    return {
      integrantes,
      auditor: auditor
        ? { id: String(auditor.id), nombre: String(auditor.nombre), cargoEntidad: String(auditor.cargo_entidad), designadoEl: dia(auditor.designado) }
        : null,
      pendientes: pendientesBase.map((p) => ({
        tipo: p.tipo, integranteId: p.integrante.id, nombre: nombreCompleto(p.integrante), desde: p.desde, vence: vencePorDia.get(p.desde) ?? p.desde,
      })),
      comunicaciones: comunicaciones.map((c) => ({
        id: c.id, folio: c.folio, recibidoEn: fecha(c.recibido_en), integrantes: c.integrantes.length, bajas: c.bajas.length,
      })),
      sesiones,
      avisosSuplentes,
      sesionDelMes: sesiones.some((s) => s.quorum && s.celebradaEl.slice(0, 7) === mes),
    };
  });
}

export type EntradaIntegrante = {
  id: unknown;
  area: unknown;
  cargo: unknown;
  titularidad: unknown;
  suplenteDe: unknown;
  nombres: unknown;
  primerApellido: unknown;
  segundoApellido: unknown;
  rfc: unknown;
  curp: unknown;
  cargoEntidad: unknown;
  esOficial: unknown;
  designadoEl: unknown;
  certificado: unknown;
};

function leerIntegrante(entrada: EntradaIntegrante, hoy: string) {
  if (!uuidValido(entrada.id)) throw new ErrorDeDominio("formulario_invalido");
  const texto = (valor: unknown, maximo: number, campo: string) => {
    // Área y cargo van tal cual en el aviso de la 49ª: con un control se rechazan, no se vuelven espacio.
    rechazarInvisible(valor, campo);
    const limpio = textoOperativo(valor, maximo);
    if (!limpio) throw new ErrorDeDominio(`dato_invalido_${campo}`);
    return limpio.toLocaleUpperCase("es-MX");
  };
  const nombre = (valor: unknown, campo: string, vacio?: string) => {
    // Una identidad: con un control se rechaza; nombreParaSiti lo volvería un espacio.
    rechazarInvisible(valor, campo);
    const limpio = typeof valor === "string" ? nombreParaSiti(valor) : "";
    if (!limpio && vacio) return vacio;
    if (!limpio || limpio.length > 80) throw new ErrorDeDominio(`dato_invalido_${campo}`);
    return limpio;
  };
  if (!(CARGOS_COMITE as readonly unknown[]).includes(entrada.cargo)) throw new ErrorDeDominio("dato_invalido_cargo");
  if (entrada.titularidad !== "TITULAR" && entrada.titularidad !== "SUPLENTE") throw new ErrorDeDominio("dato_invalido_titularidad");
  const suplenteDe = entrada.titularidad === "SUPLENTE" ? entrada.suplenteDe : null;
  if (entrada.titularidad === "SUPLENTE" && !uuidValido(suplenteDe)) throw new ErrorDeDominio("dato_invalido_suplenteDe");
  const rfc = typeof entrada.rfc === "string" ? entrada.rfc.trim().toUpperCase() : "";
  if (!/^[A-Z&Ñ]{4}[0-9]{6}[A-Z0-9]{3}$/.test(rfc)) throw new ErrorDeDominio("dato_invalido_rfc");
  const curp = typeof entrada.curp === "string" ? entrada.curp.trim().toUpperCase() : "";
  if (!/^[A-Z]{4}[0-9]{6}[HM][A-Z]{5}[A-Z0-9][0-9]$/.test(curp)) throw new ErrorDeDominio("dato_invalido_curp");
  const designado = typeof entrada.designadoEl === "string" ? entrada.designadoEl : "";
  if (!fechaDeCalendario(designado) || designado > hoy) throw new ErrorDeDominio("dato_invalido_designadoEl");
  const certificado = typeof entrada.certificado === "string" && entrada.certificado.trim() ? entrada.certificado.trim().toUpperCase() : null;
  if (certificado !== null && !/^[A-Z0-9/-]{1,22}$/.test(certificado)) throw new ErrorDeDominio("dato_invalido_certificado");
  return {
    id: entrada.id,
    area: texto(entrada.area, 120, "area"),
    cargo: entrada.cargo as CargoComite,
    titularidad: entrada.titularidad,
    suplenteDe: suplenteDe as string | null,
    nombres: nombre(entrada.nombres, "nombres"),
    primerApellido: nombre(entrada.primerApellido, "primerApellido"),
    // Apéndice A, campo 6: sin segundo apellido se capturan cuatro equis.
    segundoApellido: nombre(entrada.segundoApellido, "segundoApellido", "XXXX"),
    rfc,
    curp,
    cargoEntidad: texto(entrada.cargoEntidad, 120, "cargoEntidad"),
    esOficial: entrada.esOficial === true || entrada.esOficial === "si",
    designadoEl: designado,
    certificado,
  };
}

/**
 * Alta de uno o más integrantes en una sola transacción (la integración inicial
 * va completa) y, si se pide, la baja de quien sustituyen. La base revisa al
 * cerrar la transacción que la integración vigente cumpla la 47ª y el instructivo.
 */
export async function registrarIntegrantes(
  ctx: ContextoDePersonal,
  entrada: { integrantes: EntradaIntegrante[]; sustituye?: { integranteId: unknown; sustituidoEl: unknown; motivo: unknown } | null },
  deps: { ahora?: () => Date } = {},
): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.pld.comite");
  const ahora = deps.ahora?.() ?? new Date();
  const hoy = hoyEnMexico(ahora);
  if (entrada.integrantes.length === 0 && !entrada.sustituye) throw new ErrorDeDominio("dato_invalido_integrantes");
  const nuevos = entrada.integrantes.map((integrante) => leerIntegrante(integrante, hoy));
  let baja: { integranteId: string; sustituidoEl: string; motivo: string } | null = null;
  if (entrada.sustituye) {
    if (!uuidValido(entrada.sustituye.integranteId)) throw new ErrorDeDominio("comite_integrante_no_existe");
    const sustituidoEl = typeof entrada.sustituye.sustituidoEl === "string" ? entrada.sustituye.sustituidoEl : "";
    if (!fechaDeCalendario(sustituidoEl) || sustituidoEl > hoy) throw new ErrorDeDominio("dato_invalido_sustituidoEl");
    baja = { integranteId: entrada.sustituye.integranteId, sustituidoEl, motivo: motivoEscrito(entrada.sustituye.motivo, 500) };
  }
  await unaVezPorFormulario(() => conPld(ctx, null, async (consulta) => {
    if (nuevos.length > 0) {
      const ya = await consulta.query("select id from pld_comite_integrantes where id = any($1::uuid[])", [nuevos.map((n) => n.id)]);
      if (ya.rows.length === nuevos.length) return;
      if (ya.rows.length > 0) throw new ErrorDeDominio("formulario_invalido");
    } else if (baja) {
      if ((await consulta.query("select 1 from pld_comite_bajas where integrante_id = $1", [baja.integranteId])).rows.length > 0) return;
    }
    if (baja) {
      await consulta.query(
        "insert into pld_comite_bajas (integrante_id, operator_id, sustituido_el, motivo, registrado_por) values ($1, $2, $3, $4, $5)",
        [baja.integranteId, ctx.personal.operadorId, baja.sustituidoEl, baja.motivo, ctx.persona.id],
      );
      await auditarPld(consulta, ctx, {
        companyId: null, accion: "pld_comite_integrante_sustituido", identificador: baja.integranteId, motivo: baja.motivo, ocurridoEn: ahora,
      });
    }
    for (const n of nuevos) {
      await consulta.query(
        `insert into pld_comite_integrantes (
           id, operator_id, area, cargo, titularidad, suplente_de, nombres, primer_apellido, segundo_apellido, rfc, curp,
           cargo_entidad, es_oficial, designado_el, certificado, registrado_por
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [n.id, ctx.personal.operadorId, n.area, n.cargo, n.titularidad, n.suplenteDe, n.nombres, n.primerApellido, n.segundoApellido,
          n.rfc, n.curp, n.cargoEntidad, n.esOficial, n.designadoEl, n.certificado, ctx.persona.id],
      );
      await auditarPld(consulta, ctx, {
        companyId: null, accion: "pld_comite_integrante_designado", identificador: n.id as string, ocurridoEn: ahora,
        cambio: { cargo: n.cargo, titularidad: n.titularidad as string, oficial: n.esOficial },
      });
    }
  }), "formulario_invalido");
}

export async function registrarAuditor(
  ctx: ContextoDePersonal,
  entrada: { formId: unknown; nombre: unknown; cargoEntidad: unknown; designadoEl: unknown },
  deps: { ahora?: () => Date } = {},
): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.pld.comite");
  if (!uuidValido(entrada.formId)) throw new ErrorDeDominio("formulario_invalido");
  const ahora = deps.ahora?.() ?? new Date();
  rechazarInvisible(entrada.nombre, "nombre");
  const nombre = textoOperativo(entrada.nombre, 200);
  if (!nombre) throw new ErrorDeDominio("dato_invalido_nombre");
  rechazarInvisible(entrada.cargoEntidad, "cargoEntidad");
  const cargo = textoOperativo(entrada.cargoEntidad, 120);
  if (!cargo) throw new ErrorDeDominio("dato_invalido_cargoEntidad");
  const designado = typeof entrada.designadoEl === "string" ? entrada.designadoEl : "";
  if (!fechaDeCalendario(designado) || designado > hoyEnMexico(ahora)) throw new ErrorDeDominio("dato_invalido_designadoEl");
  await unaVezPorFormulario(() => conPld(ctx, null, async (consulta) => {
    if ((await consulta.query("select 1 from pld_comite_auditores where id = $1", [entrada.formId])).rows.length > 0) return;
    await consulta.query(
      "insert into pld_comite_auditores (id, operator_id, nombre, cargo_entidad, designado_el, registrado_por) values ($1, $2, $3, $4, $5, $6)",
      [entrada.formId, ctx.personal.operadorId, nombre, cargo, designado, ctx.persona.id],
    );
    await auditarPld(consulta, ctx, { companyId: null, accion: "pld_comite_auditor_designado", identificador: entrada.formId as string, ocurridoEn: ahora });
  }), "formulario_invalido");
}

/** 49ª: el acuse del SITI de la comunicación de la integración y qué designaciones y bajas cubre. */
export async function registrarComunicacion(
  ctx: ContextoDePersonal,
  entrada: { formId: unknown; folio: unknown; recibidoEn: unknown; integrantes: unknown[]; bajas: unknown[] },
  deps: { ahora?: () => Date } = {},
): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.pld.comite");
  if (!uuidValido(entrada.formId)) throw new ErrorDeDominio("formulario_invalido");
  rechazarInvisible(entrada.folio, "folio");
  const folio = textoOperativo(entrada.folio, 40);
  if (!folio) throw new ErrorDeDominio("dato_invalido_folio");
  const recibido = leerFechaHora(entrada.recibidoEn);
  const integrantes = entrada.integrantes.filter(uuidValido);
  const bajas = entrada.bajas.filter(uuidValido);
  if (integrantes.length + bajas.length === 0) throw new ErrorDeDominio("dato_invalido_integrantes");
  const ahora = deps.ahora?.() ?? new Date();
  if (recibido.getTime() > ahora.getTime()) throw new ErrorDeDominio("acuse_fecha_futura");
  await unaVezPorFormulario(() => conPld(ctx, null, async (consulta) => {
    if ((await consulta.query("select 1 from pld_comite_comunicaciones where id = $1", [entrada.formId])).rows.length > 0) return;
    await consulta.query(
      `insert into pld_comite_comunicaciones (id, operator_id, folio, recibido_en, integrantes, bajas, registrado_por)
       values ($1, $2, $3, $4, $5::uuid[], $6::uuid[], $7)`,
      [entrada.formId, ctx.personal.operadorId, folio, recibido, integrantes, bajas, ctx.persona.id],
    );
    await auditarPld(consulta, ctx, {
      companyId: null, accion: "pld_comite_comunicacion_registrada", identificador: entrada.formId as string, ocurridoEn: ahora,
      cambio: { integrantes: integrantes.length, bajas: bajas.length },
    });
  }), "formulario_invalido");
}

/** «AAAA-MM-DDTHH:MM» de un campo datetime-local, en hora de la Ciudad de México (UTC−6, sin horario de verano). */
export function leerFechaHora(valor: unknown): Date {
  const texto = typeof valor === "string" ? valor.trim() : "";
  const coincide = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(texto);
  if (!coincide || !fechaDeCalendario(coincide[1]!) || Number(coincide[2]) > 23 || Number(coincide[3]) > 59) {
    throw new ErrorDeDominio("dato_invalido_recibidoEn");
  }
  return new Date(`${coincide[1]}T${coincide[2]}:${coincide[3]}:00-06:00`);
}

/**
 * Registra una sesión con sus presentes. La base calcula los miembros, los
 * representados, el quórum y quién preside: sin la mayoría queda «sin quórum».
 */
export async function registrarSesion(
  ctx: ContextoDePersonal,
  entrada: { formId: unknown; celebradaEl: unknown; presentes: unknown[]; auditorPresente: unknown },
  deps: { ahora?: () => Date } = {},
): Promise<{ quorum: boolean }> {
  exigirEnOperacion(ctx, "plataforma.pld.comite");
  if (!uuidValido(entrada.formId)) throw new ErrorDeDominio("formulario_invalido");
  const ahora = deps.ahora?.() ?? new Date();
  const celebrada = typeof entrada.celebradaEl === "string" ? entrada.celebradaEl : "";
  if (!fechaDeCalendario(celebrada) || celebrada > hoyEnMexico(ahora)) throw new ErrorDeDominio("dato_invalido_celebradaEl");
  const presentes = [...new Set(entrada.presentes.filter(uuidValido))];
  if (presentes.length === 0) throw new ErrorDeDominio("sesion_presentes_invalidos");
  return unaVezPorFormulario(() => conPld(ctx, null, async (consulta) => {
    const previo = (await consulta.query("select quorum from pld_sesiones where id = $1", [entrada.formId])).rows[0] as { quorum?: boolean } | undefined;
    if (previo) return { quorum: previo.quorum === true };
    const auditor = entrada.auditorPresente === true || entrada.auditorPresente === "si"
      ? ((await consulta.query("select id from pld_comite_auditores where operator_id = $1 order by registrado_en desc, id desc limit 1", [
          ctx.personal.operadorId,
        ])).rows[0] as { id?: string } | undefined)?.id ?? null
      : null;
    const fila = (await consulta.query(
      `insert into pld_sesiones (id, operator_id, celebrada_el, presentes, auditor_id, registrado_por)
       values ($1, $2, $3, $4::uuid[], $5, $6) returning quorum, miembros, representados`,
      [entrada.formId, ctx.personal.operadorId, celebrada, presentes, auditor, ctx.persona.id],
    )).rows[0] as { quorum: boolean; miembros: number; representados: number };
    await auditarPld(consulta, ctx, {
      companyId: null, accion: "pld_sesion_registrada", identificador: entrada.formId as string, ocurridoEn: ahora,
      cambio: { quorum: fila.quorum, miembros: Number(fila.miembros), representados: Number(fila.representados) },
    });
    return { quorum: fila.quorum };
  }), "formulario_invalido");
}

/** 48ª: el voto de un miembro presente sobre la propuesta vigente de un caso. */
export async function registrarVoto(
  ctx: ContextoDePersonal,
  entrada: { formId: unknown; sesionId: unknown; propuestaId: unknown; integranteId: unknown; voto: unknown },
  deps: { ahora?: () => Date } = {},
): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.pld.comite");
  for (const [valor, codigo] of [[entrada.formId, "formulario_invalido"], [entrada.sesionId, "sesion_no_existe"], [entrada.propuestaId, "propuesta_no_vigente"], [entrada.integranteId, "voto_de_ausente"]] as const) {
    if (!uuidValido(valor)) throw new ErrorDeDominio(codigo);
  }
  if (entrada.voto !== "a_favor" && entrada.voto !== "en_contra") throw new ErrorDeDominio("dato_invalido_voto");
  const ahora = deps.ahora?.() ?? new Date();
  await unaVezPorFormulario(() => conPld(ctx, null, async (consulta) => {
    if ((await consulta.query("select 1 from pld_votos where id = $1", [entrada.formId])).rows.length > 0) return;
    const fila = (await consulta.query(
      `insert into pld_votos (id, operator_id, sesion_id, caso_id, propuesta_id, integrante_id, voto, registrado_por)
       select $1, $2, $3, p.caso_id, $4, $5, $6, $7 from pld_propuestas p where p.id = $4
       returning company_id`,
      [entrada.formId, ctx.personal.operadorId, entrada.sesionId, entrada.propuestaId, entrada.integranteId, entrada.voto, ctx.persona.id],
    )).rows[0] as { company_id: string | null } | undefined;
    if (!fila) throw new ErrorDeDominio("propuesta_no_vigente");
    await auditarPld(consulta, ctx, {
      companyId: fila.company_id, accion: "pld_voto_registrado", identificador: entrada.formId as string, ocurridoEn: ahora,
      cambio: { voto: entrada.voto as string },
    });
  }), "formulario_invalido");
}

export type PropuestaPorVotar = {
  casoId: string;
  razonSocial: string | null;
  propuestaId: string;
  propuesta: Propuesta;
  justificacion: string;
  /** Día de registro en la Ciudad de México: una sesión anterior no la vota. */
  registradaEl: string;
};

/** Casos sin dictamen con su propuesta vigente: lo que el Comité puede votar en una sesión (48ª). */
export async function propuestasPorVotar(ctx: ContextoDePersonal): Promise<PropuestaPorVotar[]> {
  exigirEnOperacion(ctx, "plataforma.pld.ver");
  return conPld(ctx, null, async (consulta) => {
    const filas = (await consulta.query(
      `select k.id as caso_id, c.razon_social, p.id as propuesta_id, p.propuesta, p.justificacion,
              pld_fecha_mx(p.registrado_en)::text as registrada_el
       from pld_casos k
       left join companies c on c.id = k.company_id
       join lateral (select x.* from pld_propuestas x where x.caso_id = k.id order by x.registrado_en desc, x.id desc limit 1) p on true
       where k.operator_id = $1 and not exists (select 1 from pld_dictamenes d where d.caso_id = k.id)
       order by k.registrado_en`,
      [ctx.personal.operadorId],
    )).rows as Array<Record<string, unknown>>;
    return filas.map((fila) => ({
      casoId: String(fila.caso_id),
      razonSocial: typeof fila.razon_social === "string" ? fila.razon_social : null,
      propuestaId: String(fila.propuesta_id),
      propuesta: fila.propuesta as Propuesta,
      justificacion: String(fila.justificacion),
      registradaEl: dia(fila.registrada_el),
    }));
  });
}

export type Votacion = {
  sesionId: string;
  propuestaId: string;
  casoId: string;
  propuesta: Propuesta;
  votos: Array<{ integranteId: string; voto: "a_favor" | "en_contra" }>;
  resultado: "aprobada" | "rechazada" | null;
};

/** Las votaciones de una sesión, con el resultado que calcula la base (48ª). */
export async function leerVotaciones(ctx: ContextoDePersonal, sesionId: unknown): Promise<Votacion[]> {
  exigirEnOperacion(ctx, "plataforma.pld.ver");
  if (!uuidValido(sesionId)) return [];
  return conPld(ctx, null, async (consulta) => {
    const filas = (await consulta.query(
      `select v.propuesta_id, v.caso_id, p.propuesta, json_agg(json_build_object('integranteId', v.integrante_id, 'voto', v.voto)) as votos,
              pld_resultado_votacion($1, v.propuesta_id) as resultado
       from pld_votos v join pld_propuestas p on p.id = v.propuesta_id where v.sesion_id = $1
       group by v.propuesta_id, v.caso_id, p.propuesta`,
      [sesionId],
    )).rows as Array<Record<string, unknown>>;
    return filas.map((fila) => ({
      sesionId: sesionId as string,
      propuestaId: String(fila.propuesta_id),
      casoId: String(fila.caso_id),
      propuesta: fila.propuesta as Propuesta,
      votos: fila.votos as Votacion["votos"],
      resultado: fila.resultado === "aprobada" ? "aprobada" : fila.resultado === "rechazada" ? "rechazada" : null,
    }));
  });
}

/**
 * 48ª: el acta de la sesión en PDF, con lo registrado en Lever: fecha, presentes,
 * quórum, el auditor con voz y sin voto, y por caso la propuesta, los votos y el
 * resultado. La firman el presidente y el secretario fuera de Lever.
 */
export async function actaEnPdf(ctx: ContextoDePersonal, sesionId: unknown): Promise<{ bytes: Uint8Array; nombre: string }> {
  exigirEnOperacion(ctx, "plataforma.pld.ver");
  if (!uuidValido(sesionId)) throw new ErrorDeDominio("sesion_no_existe");
  const comite = await leerComite(ctx);
  const sesion = comite.sesiones.find((s) => s.id === sesionId);
  if (!sesion) throw new ErrorDeDominio("sesion_no_existe");
  const votaciones = await leerVotaciones(ctx, sesionId);
  const casos = await conPld(ctx, null, async (consulta) =>
    (await consulta.query(
      `select k.id, c.razon_social from pld_casos k left join companies c on c.id = k.company_id where k.id = any($1::uuid[])`,
      [votaciones.map((v) => v.casoId)],
    )).rows as Array<{ id: string; razon_social: string | null }>,
  );
  const porId = new Map(comite.integrantes.map((i) => [i.id, i]));
  const renglones: RenglonPdf[] = [
    { texto: "Acta de la sesión del Comité de Comunicación y Control", negrita: true },
    { texto: `Fecha de la sesión: ${sesion.celebradaEl}` },
    { texto: `Quórum: ${sesion.quorum ? "sí" : "no"} (${sesion.representados} de ${sesion.miembros} miembros presentes o representados; se requiere la mayoría, 47ª).` },
    { texto: "" },
    { texto: "Presentes", negrita: true },
    ...sesion.presentes.map((id) => {
      const integrante = porId.get(id);
      return { texto: integrante ? `${nombreCompleto(integrante)} — ${integrante.cargo} ${integrante.titularidad}${integrante.esOficial ? ", Oficial de Cumplimiento" : ""}` : id };
    }),
    { texto: sesion.auditorPresente && comite.auditor ? `Asistió el auditor ${comite.auditor.nombre}, con voz y sin voto (47ª).` : "No asistió el auditor." },
    { texto: "" },
    { texto: "Resoluciones", negrita: true },
  ];
  if (votaciones.length === 0) renglones.push({ texto: "No se votaron casos en esta sesión." });
  for (const votacion of votaciones) {
    const caso = casos.find((c) => c.id === votacion.casoId);
    renglones.push({ texto: `Caso ${votacion.casoId.slice(0, 8).toUpperCase()}${caso?.razon_social ? ` (${caso.razon_social})` : ""}`, negrita: true });
    renglones.push({ texto: `Propuesta: ${PROPUESTA[votacion.propuesta]}.` });
    for (const voto of votacion.votos) {
      const integrante = porId.get(voto.integranteId);
      renglones.push({ texto: `${integrante ? nombreCompleto(integrante) : voto.integranteId}: ${voto.voto === "a_favor" ? "a favor" : "en contra"}` });
    }
    renglones.push({
      texto: `Resultado: ${votacion.resultado === "aprobada" ? "aprobada" : votacion.resultado === "rechazada" ? "rechazada" : "sin resultado"}. Las justificaciones por caso se conservan resguardadas en Lever (48ª).`,
    });
  }
  renglones.push(
    { texto: "" },
    { texto: "Firmas (48ª: presidente y secretario, o sus suplentes)", negrita: true },
    { texto: "Presidente: ____________________________" },
    { texto: "Secretario: ____________________________" },
    { texto: "" },
    { texto: "Lever generó esta acta con lo registrado en la plataforma. No la transmite a la UIF ni a la CNBV." },
  );
  return { bytes: pdfDeTexto(renglones), nombre: `acta-comite-${sesion.celebradaEl}.pdf` };
}

/** 48ª: el acta firmada, con su SHA-256, en Blob privado. Una por sesión. */
export async function cargarActaFirmada(
  ctx: ContextoDePersonal,
  entrada: { formId: unknown; sesionId: unknown; archivo: { nombre: string; bytes: Uint8Array } | null },
  deps: { almacen: AlmacenConstancia; ahora?: () => Date },
): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.pld.comite");
  if (!uuidValido(entrada.formId)) throw new ErrorDeDominio("formulario_invalido");
  if (!uuidValido(entrada.sesionId)) throw new ErrorDeDominio("sesion_no_existe");
  const archivo = entrada.archivo;
  if (!archivo || archivo.bytes.byteLength === 0) throw new ErrorDeDominio("dato_invalido_archivo");
  if (archivo.bytes.byteLength > 4 * 1024 * 1024) throw new ErrorDeDominio("archivo_demasiado_grande");
  const pdf = archivo.bytes[0] === 0x25 && archivo.bytes[1] === 0x50 && archivo.bytes[2] === 0x44 && archivo.bytes[3] === 0x46;
  if (!pdf) throw new ErrorDeDominio("archivo_no_admitido");
  const sha256 = createHash("sha256").update(archivo.bytes).digest("hex");
  const nombre = textoOperativo(archivo.nombre.replace(/[\\/]/g, "_"), 200) ?? "acta-firmada.pdf";
  const ahora = deps.ahora?.() ?? new Date();
  const yaEsta = await conPld(ctx, null, async (consulta) => {
    if ((await consulta.query("select 1 from pld_actas where id = $1", [entrada.formId])).rows.length > 0) return true;
    if ((await consulta.query("select 1 from pld_actas where sesion_id = $1", [entrada.sesionId])).rows.length > 0) {
      throw new ErrorDeDominio("acta_ya_cargada");
    }
    if ((await consulta.query("select 1 from pld_sesiones where id = $1", [entrada.sesionId])).rows.length !== 1) {
      throw new ErrorDeDominio("sesion_no_existe");
    }
    return false;
  });
  if (yaEsta) return;
  const guardado = await deps.almacen.guardar({
    clave: `pld/${ctx.personal.operadorId}/actas/${entrada.sesionId as string}-${randomUUID().slice(0, 8)}.pdf`,
    bytes: archivo.bytes,
    tipo: "application/pdf",
  });
  await unaVezPorFormulario(() => conPld(ctx, null, async (consulta) => {
    if ((await consulta.query("select 1 from pld_actas where id = $1", [entrada.formId])).rows.length > 0) return;
    await consulta.query(
      `insert into pld_actas (id, sesion_id, operator_id, nombre_archivo, tipo_contenido, tamano_bytes, sha256, clave_blob, registrado_por)
       values ($1, $2, $3, $4, 'application/pdf', $5, $6, $7, $8)`,
      [entrada.formId, entrada.sesionId, ctx.personal.operadorId, nombre, archivo.bytes.byteLength, sha256, guardado.clave, ctx.persona.id],
    );
    await auditarPld(consulta, ctx, { companyId: null, accion: "pld_acta_cargada", identificador: entrada.formId as string, ocurridoEn: ahora });
  }), "formulario_invalido");
}

export async function descargarActa(
  ctx: ContextoDePersonal,
  actaId: unknown,
  deps: { leer?: (clave: string) => Promise<ReadableStream<Uint8Array>> } = {},
): Promise<{ bytes: Uint8Array; nombre: string; tipo: string }> {
  exigirEnOperacion(ctx, "plataforma.pld.ver");
  if (!uuidValido(actaId)) throw new ErrorDeDominio("documento_no_existe");
  const fila = await conPld(ctx, null, async (consulta) =>
    (await consulta.query("select clave_blob, nombre_archivo, tipo_contenido, sha256 from pld_acta_para_descarga($1, $2)", [actaId, ctx.peticionId]))
      .rows[0] as { clave_blob: string; nombre_archivo: string; tipo_contenido: string; sha256: string } | undefined,
  );
  if (!fila) throw new ErrorDeDominio("documento_no_existe");
  const bytes = new Uint8Array(await new Response(await (deps.leer ?? leerPrivado)(fila.clave_blob)).arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== fila.sha256) {
    console.error(JSON.stringify({ evento: "pld_acta_alterada", actaId, peticionId: ctx.peticionId }));
    throw new ErrorDeDominio("archivo_no_disponible");
  }
  return { bytes, nombre: fila.nombre_archivo, tipo: fila.tipo_contenido };
}

/**
 * Instructivo de la CNBV, Apéndice A: el contenido exacto de los 14 campos que el
 * Oficial captura en el SITI para comunicar la integración y sus cambios (49ª).
 * Separado por «|» para leerlo; el SITI lo pide campo por campo.
 */
export function contenidoParaSiti(integrantes: readonly Integrante[]): string {
  const fechaSiti = (valor: string) => `${valor.slice(8, 10)}/${valor.slice(5, 7)}/${valor.slice(0, 4)}`;
  const encabezado = [
    "AREA", "CARGO EN EL COMITE", "TITULAR O SUPLENTE", "NOMBRE(S)", "PRIMER APELLIDO", "SEGUNDO APELLIDO", "RFC", "CURP",
    "CARGO EN LA ENTIDAD", "ES EL OFICIAL DE CUMPLIMIENTO", "FECHA DE DESIGNACION", "VIGENTE", "FECHA DE SUSTITUCION", "NUMERO DE CERTIFICADO",
  ].join("|");
  const renglones = integrantes.map((i) =>
    [
      i.area, i.cargo, i.titularidad, i.nombres, i.primerApellido, i.segundoApellido, i.rfc, i.curp, i.cargoEntidad,
      i.esOficial ? "SI" : "NO", fechaSiti(i.designadoEl), i.vigente ? "SI" : "NO", i.sustituidoEl ? fechaSiti(i.sustituidoEl) : "",
      i.certificado ?? "",
    ].join("|"),
  );
  return [encabezado, ...renglones].join("\r\n") + "\r\n";
}

export { archivoDelFormulario };
