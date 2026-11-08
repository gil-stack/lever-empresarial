import { createHash } from "node:crypto";

import { basePlataforma, type ContextoDePersonal } from "../../nucleo/contexto";
import { conContexto } from "../../nucleo/db";
import { TOPE_ARCHIVO_BYTES } from "../../dominio/archivos";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { fechaDeCalendario, hoyEnMexico, leerListaBloqueadas, textoOperativo, uuidValido } from "../../dominio/operacion";
import { exigirAutenticacionReciente } from "../autenticacion/reautenticacion";
import type { Sesion } from "../session/tipos";
import { auditarOperacion } from "./auditar";
import { exigirEnOperacion } from "./permisos";
import { motivoEscrito, unaVezPorFormulario } from "./formulario";

type SesionConFactor = Pick<Sesion, "segundoFactor" | "superficie">;

export type CargaLpb = { id: string; nombreArchivo: string; filas: number; cargadaPor: string; cargadaEn: Date; vigente: boolean; coincidencias: number };

export type CoincidenciaLpb = {
  id: string;
  companyId: string;
  razonSocial: string;
  estadoEmpresa: string;
  sujetoTipo: string;
  sujetoNombre: string;
  lista: "lpb" | "69b";
  tipo: "exacta" | "posible";
  coincidePor: "rfc" | "curp" | "nombre";
  nombreEnLista: string | null;
  estado: "pendiente" | "confirmada" | "falso_positivo" | "fuera_de_lista";
  detectadaEn: Date;
  plazoReporteHasta: Date | null;
  resueltaPor: string | null;
  resueltaEn: Date | null;
  motivoResolucion: string | null;
  reporteFolio: string | null;
  reportePresentadoEl: string | null;
  avisoClienteEl: string | null;
};

/**
 * El archivo de la lista, leído solo por quien puede cargarla: el rol se revisa antes de leer un
 * byte. Un renglón malo vuelve con su línea para corregir el archivo.
 */
export async function leerArchivoDeLista(
  ctx: ContextoDePersonal,
  archivo: unknown,
): Promise<{ ok: true; nombre: string; texto: string } | { ok: false; codigo: string; linea?: number }> {
  exigirEnOperacion(ctx, "plataforma.lpb.cargar");
  if (!(archivo instanceof File) || archivo.size === 0) return { ok: false, codigo: "lpb_vacia" };
  if (archivo.size > TOPE_ARCHIVO_BYTES) return { ok: false, codigo: "lpb_demasiado_grande" };
  const texto = await archivo.text();
  const lectura = leerListaBloqueadas(texto);
  if (!lectura.ok) return { ok: false, codigo: lectura.codigo, ...(lectura.linea !== undefined ? { linea: lectura.linea } : {}) };
  return { ok: true, nombre: archivo.name, texto };
}

/**
 * Carga una lista completa. La base coteja al confirmar la transacción a todas
 * las empresas del operador, sus expedientes y sus proveedores (73ª). Una
 * coincidencia exacta de la empresa, un representante o un propietario real
 * suspende a la empresa en ese mismo momento (75ª fr. I).
 */
export async function cargarListaBloqueadas(
  ctx: ContextoDePersonal,
  entrada: { formId: unknown; nombreArchivo: unknown; texto: string },
): Promise<{ cargaId: string; filas: number; coincidencias: number }> {
  exigirEnOperacion(ctx, "plataforma.lpb.cargar");
  if (!uuidValido(entrada.formId)) throw new ErrorDeDominio("formulario_invalido");
  const lectura = leerListaBloqueadas(entrada.texto);
  if (!lectura.ok) throw new ErrorDeDominio(lectura.codigo);
  const nombre = textoOperativo(typeof entrada.nombreArchivo === "string" ? entrada.nombreArchivo : "", 200) ?? "lista.csv";
  const sha256 = createHash("sha256").update(entrada.texto).digest("hex");
  const id = entrada.formId;
  const ahora = new Date();
  await unaVezPorFormulario(() => conContexto(basePlataforma(ctx), async (consulta) => {
    const previa = await consulta.query("select id, sha256 from lpb_cargas where id = $1 or sha256 = $2", [id, sha256]);
    const filas = previa.rows as Array<{ id: string; sha256: string }>;
    // El segundo clic del mismo formulario con el mismo archivo ya quedó; con otro archivo no se da por hecho.
    const mismoFormulario = filas.find((fila) => fila.id === id);
    if (mismoFormulario) {
      if (mismoFormulario.sha256 === sha256) return;
      throw new ErrorDeDominio("formulario_invalido");
    }
    if (filas.length > 0) throw new ErrorDeDominio("lpb_ya_cargada");
    await consulta.query(
      `insert into lpb_cargas (id, operator_id, nombre_archivo, sha256, filas, cargada_por, cargada_en)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [id, ctx.personal.operadorId, nombre, sha256, lectura.renglones.length, ctx.persona.id, ahora],
    );
    await consulta.query(
      `insert into lpb_personas (carga_id, operator_id, nombre, rfc, curp, tipo, fecha_publicacion)
       select $1, $2, r.nombre, r.rfc, r.curp, r.tipo, r.fecha::date
       from unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::text[]) as r(nombre, rfc, curp, tipo, fecha)`,
      [
        id,
        ctx.personal.operadorId,
        lectura.renglones.map((renglon) => renglon.nombre),
        lectura.renglones.map((renglon) => renglon.rfc),
        lectura.renglones.map((renglon) => renglon.curp),
        lectura.renglones.map((renglon) => renglon.tipo),
        lectura.renglones.map((renglon) => renglon.fecha),
      ],
    );
    await auditarOperacion(consulta, ctx, {
      companyId: null, accion: "lpb_cargada", identificador: id, ocurridoEn: ahora, cambio: { filas: lectura.renglones.length },
    });
  }), "formulario_invalido");
  const contadas = await conContexto(basePlataforma(ctx), (consulta) =>
    consulta.query("select count(*)::int as total from lpb_coincidencias where carga_id = $1", [id]),
  );
  return { cargaId: id, filas: lectura.renglones.length, coincidencias: Number((contadas.rows[0] as { total: number }).total) };
}

export async function listarCargas(ctx: ContextoDePersonal): Promise<CargaLpb[]> {
  exigirEnOperacion(ctx, "plataforma.cumplimiento.bandeja");
  const resultado = await conContexto(basePlataforma(ctx), (consulta) =>
    consulta.query(
      `select c.id, c.nombre_archivo, c.filas, c.cargada_en, u.nombre,
              c.id = lpb_carga_vigente(c.operator_id) as vigente,
              (select count(*)::int from lpb_coincidencias k where k.carga_id = c.id) as coincidencias
       from lpb_cargas c join users u on u.id = c.cargada_por
       order by c.cargada_en desc, c.id desc limit 20`,
      [],
    ),
  );
  return (resultado.rows as Array<Record<string, unknown>>).map((fila) => ({
    id: String(fila.id),
    nombreArchivo: String(fila.nombre_archivo),
    filas: Number(fila.filas),
    cargadaPor: String(fila.nombre),
    cargadaEn: fecha(fila.cargada_en),
    vigente: fila.vigente === true,
    coincidencias: Number(fila.coincidencias),
  }));
}

/**
 * El detalle (nombre en la lista, plazo, folio y motivos) lo ven Cumplimiento y Auditoría.
 * Quien habla con el cliente (Originación) o decide (Aprobación) solo sabe si la empresa está
 * en revisión de Cumplimiento: así no se alerta al cliente (55ª fr. I).
 */
export async function listarCoincidencias(
  ctx: ContextoDePersonal,
  filtro: { companyId?: string; soloAbiertas?: boolean } = {},
): Promise<CoincidenciaLpb[]> {
  exigirEnOperacion(ctx, "plataforma.cumplimiento.bandeja");
  if (filtro.companyId !== undefined && !uuidValido(filtro.companyId)) return [];
  const resultado = await conContexto(basePlataforma(ctx), (consulta) =>
    consulta.query(
      `select k.*, c.razon_social, c.estado as estado_empresa, p.nombre as nombre_en_lista, u.nombre as resuelta_por_nombre,
              k.reporte_presentado_el::text as presentado_texto, k.aviso_cliente_el::text as aviso_texto
       from lpb_coincidencias k
       join companies c on c.id = k.company_id
       left join lpb_personas p on p.id = k.lpb_persona_id
       left join users u on u.id = k.resuelta_por
       where ($1::uuid is null or k.company_id = $1::uuid)
         and (not $2 or k.estado = 'pendiente' or (k.estado = 'confirmada' and k.reporte_folio is null))
       order by (k.estado = 'pendiente') desc, k.detectada_en desc
       limit 300`,
      [filtro.companyId ?? null, filtro.soloAbiertas === true],
    ),
  );
  return (resultado.rows as Array<Record<string, unknown>>).map((fila) => ({
    id: String(fila.id),
    companyId: String(fila.company_id),
    razonSocial: String(fila.razon_social),
    estadoEmpresa: String(fila.estado_empresa),
    sujetoTipo: String(fila.sujeto_tipo),
    sujetoNombre: String(fila.sujeto_nombre),
    lista: fila.lista === "69b" ? "69b" : "lpb",
    tipo: fila.tipo === "exacta" ? "exacta" : "posible",
    coincidePor: fila.coincide_por === "curp" ? "curp" : fila.coincide_por === "nombre" ? "nombre" : "rfc",
    nombreEnLista: typeof fila.nombre_en_lista === "string" ? fila.nombre_en_lista : null,
    estado: String(fila.estado) as CoincidenciaLpb["estado"],
    detectadaEn: fecha(fila.detectada_en),
    plazoReporteHasta: fila.plazo_reporte_hasta ? fecha(fila.plazo_reporte_hasta) : null,
    resueltaPor: typeof fila.resuelta_por_nombre === "string" ? fila.resuelta_por_nombre : null,
    resueltaEn: fila.resuelta_en ? fecha(fila.resuelta_en) : null,
    motivoResolucion: typeof fila.motivo_resolucion === "string" ? fila.motivo_resolucion : null,
    reporteFolio: typeof fila.reporte_folio === "string" ? fila.reporte_folio : null,
    reportePresentadoEl: typeof fila.presentado_texto === "string" ? fila.presentado_texto : null,
    avisoClienteEl: typeof fila.aviso_texto === "string" ? fila.aviso_texto : null,
  }));
}

/** ¿La empresa tiene un caso abierto con la lista? Sin detalle: lo que ven Originación y Aprobación. */
export async function enRevisionDeCumplimiento(ctx: ContextoDePersonal, companyId: unknown): Promise<boolean> {
  exigirEnOperacion(ctx, "plataforma.expediente.ver");
  if (!uuidValido(companyId)) return false;
  const resultado = await conContexto(basePlataforma(ctx), (consulta) =>
    consulta.query(
      "select exists (select 1 from lpb_coincidencias where company_id = $1 and estado in ('pendiente', 'confirmada')) as abierta",
      [companyId],
    ),
  );
  return (resultado.rows[0] as { abierta?: unknown } | undefined)?.abierta === true;
}

/**
 * Cumplimiento resuelve una coincidencia, siempre con motivo. Una posible que se
 * confirma de la empresa, un representante o un propietario real suspende de
 * inmediato y abre el plazo de 24 horas del reporte (75ª).
 */
export async function resolverCoincidencia(
  ctx: ContextoDePersonal,
  sesion: SesionConFactor,
  entrada: { id: unknown; estado: unknown; motivo: unknown },
): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.lpb.resolver");
  exigirAutenticacionReciente(sesion);
  if (!uuidValido(entrada.id)) throw new ErrorDeDominio("coincidencia_ausente");
  const estado = entrada.estado;
  if (estado !== "confirmada" && estado !== "falso_positivo" && estado !== "fuera_de_lista") throw new ErrorDeDominio("dato_invalido_estado");
  const motivo = motivoEscrito(entrada.motivo, 1000);
  const ahora = new Date();
  await conContexto(basePlataforma(ctx), async (consulta) => {
    const fila = await consulta.query("select company_id, estado from lpb_coincidencias where id = $1 for update", [entrada.id]);
    const actual = fila.rows[0] as { company_id?: unknown; estado?: unknown } | undefined;
    if (!actual) throw new ErrorDeDominio("coincidencia_ausente");
    // El segundo clic encuentra la coincidencia ya resuelta igual: no hace nada más.
    if (actual.estado === estado) return;
    await consulta.query(
      `update lpb_coincidencias set estado = $2, resuelta_por = $3, resuelta_en = $4, motivo_resolucion = $5 where id = $1`,
      [entrada.id, estado, ctx.persona.id, ahora, motivo],
    );
    await auditarOperacion(consulta, ctx, {
      companyId: String(actual.company_id), accion: "lpb_coincidencia_resuelta", identificador: entrada.id as string,
      motivo, ocurridoEn: ahora, cambio: { estado },
    });
  });
}

/**
 * Anota el folio del reporte de Operación Inusual que Cumplimiento presentó por
 * su vía y la fecha del aviso por escrito al cliente. Lever no transmite reportes.
 */
export async function registrarReporte(
  ctx: ContextoDePersonal,
  entrada: { id: unknown; folio: unknown; presentadoEl: unknown; avisoClienteEl: unknown },
): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.lpb.resolver");
  if (!uuidValido(entrada.id)) throw new ErrorDeDominio("coincidencia_ausente");
  const folio = textoOperativo(entrada.folio, 80);
  if (!folio) throw new ErrorDeDominio("dato_invalido_folio");
  const hoy = hoyEnMexico(new Date());
  const presentadoEl = typeof entrada.presentadoEl === "string" && fechaDeCalendario(entrada.presentadoEl) && entrada.presentadoEl <= hoy
    ? entrada.presentadoEl
    : null;
  if (!presentadoEl) throw new ErrorDeDominio("dato_invalido_presentadoEl");
  const aviso = entrada.avisoClienteEl === "" || entrada.avisoClienteEl === null || entrada.avisoClienteEl === undefined
    ? null
    : typeof entrada.avisoClienteEl === "string" && fechaDeCalendario(entrada.avisoClienteEl) && entrada.avisoClienteEl <= hoy
      ? entrada.avisoClienteEl
      : undefined;
  if (aviso === undefined) throw new ErrorDeDominio("dato_invalido_avisoClienteEl");
  const ahora = new Date();
  await conContexto(basePlataforma(ctx), async (consulta) => {
    const fila = await consulta.query("select company_id, estado, reporte_folio from lpb_coincidencias where id = $1 for update", [entrada.id]);
    const actual = fila.rows[0] as { company_id?: unknown; estado?: unknown; reporte_folio?: unknown } | undefined;
    if (!actual) throw new ErrorDeDominio("coincidencia_ausente");
    if (actual.estado !== "confirmada") throw new ErrorDeDominio("reporte_sin_confirmar");
    if (actual.reporte_folio === folio) return;
    if (actual.reporte_folio !== null) throw new ErrorDeDominio("reporte_ya_registrado");
    await consulta.query(
      `update lpb_coincidencias set reporte_folio = $2, reporte_presentado_el = $3, aviso_cliente_el = $4,
         reporte_registrado_por = $5, reporte_registrado_en = $6 where id = $1`,
      [entrada.id, folio, presentadoEl, aviso, ctx.persona.id, ahora],
    );
    await auditarOperacion(consulta, ctx, {
      companyId: String(actual.company_id), accion: "lpb_reporte_registrado", identificador: entrada.id as string, ocurridoEn: ahora,
    });
  });
}

function fecha(valor: unknown): Date {
  const salida = valor instanceof Date ? valor : new Date(String(valor));
  if (Number.isNaN(salida.getTime())) throw new ErrorDeDominio("base_no_disponible");
  return salida;
}
