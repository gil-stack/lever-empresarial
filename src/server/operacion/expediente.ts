import { createHash, randomUUID } from "node:crypto";

import { basePlataforma, type ContextoDePersonal } from "../../nucleo/contexto";
import { conContexto, type Consulta } from "../../nucleo/db";
import { TOPE_ARCHIVO_BYTES } from "../../dominio/archivos";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import {
  CARGOS,
  curpValida,
  documentoExtranjeroNormalizado,
  hoyEnMexico,
  nombreDePais,
  paisExtranjeroValido,
  fechaDeCalendario,
  PEPS,
  pesosACentavos,
  porcentajeAPuntosBase,
  rfcFisicaValido,
  rfcMoralValido,
  SERIE_EFIRMA,
  textoMultilinea,
  textoOperativo,
  TIPOS_DOCUMENTO,
  uuidValido,
  vigenciaDeComprobante,
  calificarRiesgo,
  revisionVencida,
  type Cargo,
  type Coincidencias,
  type EstadoCliente,
  type Grado,
  type Nivel,
  type Pep,
  type PepDeclarada,
  type TipoDocumento,
} from "../../dominio/operacion";
import { INVISIBLE } from "../../dominio/control";
import { exigirAutenticacionReciente } from "../autenticacion/reautenticacion";
import { leerPrivado, type AlmacenConstancia } from "../proveedores/constancia";
import type { Sesion } from "../session/tipos";
import { auditarOperacion } from "./auditar";
import { exigirEnOperacion, puedeEnOperacion } from "./permisos";
import { motivoEscrito, unaVezPorFormulario, type EnvolturaDeTransaccion } from "./formulario";

type SesionConFactor = Pick<Sesion, "segundoFactor" | "superficie">;

export type DatosGenerales = {
  razonSocial: string | null;
  giro: string | null;
  nacionalidad: string | null;
  rfc: string | null;
  serieEfirma: string | null;
  domicilioCalle: string | null;
  domicilioExterior: string | null;
  domicilioInterior: string | null;
  domicilioColonia: string | null;
  domicilioMunicipio: string | null;
  domicilioEntidad: string | null;
  domicilioCodigoPostal: string | null;
  domicilioPais: string | null;
  telefono: string | null;
  correo: string | null;
  fechaConstitucion: string | null;
  volumenMensualCentavos: number | null;
};

export type Representante = {
  id: string;
  clave: string;
  nombre: string;
  rfc: string | null;
  curp: string | null;
  cargo: Cargo;
  esAdministrador: boolean;
  designadoPor: string | null;
  pep: PepDeclarada;
};

export type Accionista = {
  id: string;
  clave: string;
  padreClave: string | null;
  tipoPersona: "fisica" | "moral";
  nombre: string;
  rfc: string | null;
  curp: string | null;
  nacionalidad: string | null;
  pais: string | null;
  documentoExtranjero: string | null;
  fechaNacimiento: string | null;
  capitalBp: number;
  votosBp: number;
  controlOtrosMedios: boolean;
  pep: PepDeclarada;
  capa: number;
};

export type DocumentoVigente = {
  id: string;
  tipo: TipoDocumento;
  representanteClave: string | null;
  nombreArchivo: string;
  sha256: string;
  emitidoEl: string | null;
  vigenteHasta: string | null;
  detalle: string | null;
  cargadoEn: Date;
  vencido: boolean;
};

export type Beneficiario = {
  clave: string;
  nombre: string;
  rfc: string | null;
  curp: string | null;
  pep: PepDeclarada;
  capitalPct: string;
  votosPct: string;
  votosControladosPct: string;
  motivo: string;
  capas: number;
};

export type Dictamen = {
  id: string;
  resultado: "aprobado" | "observado" | "rechazado";
  motivo: string | null;
  dictaminadoPor: string;
  dictaminadoEn: Date;
};

export type VersionExpediente = {
  id: string;
  numero: number;
  estado: "borrador" | "enviada";
  creadaEn: Date;
  enviadaPor: string | null;
  enviadaPorId: string | null;
  enviadaEn: Date | null;
  datos: DatosGenerales;
  representantes: Representante[];
  accionistas: Accionista[];
  documentos: DocumentoVigente[];
  beneficiarios: Beneficiario[];
  estructuraCompleta: boolean;
  dictamen: Dictamen | null;
};

/**
 * El grado y la fecha de revisión los ve todo el expediente. El desglose (factores, puntaje y
 * quién calificó) solo Cumplimiento y Auditoría: con la coincidencia oculta, un grado alto con
 * los demás factores en cero delataría la lista.
 */
export type CalificacionLeida = {
  grado: Grado;
  revisarAntesDe: string;
  vencida: boolean;
  desglose: {
    tipo: "alta" | "periodica";
    puntaje: number;
    factores: Record<string, { valor: string | number; puntos: number }>;
    calificadaPor: string;
    calificadaEl: string;
  } | null;
};

export type Expediente = {
  empresa: { id: string; razonSocial: string; rfc: string; estado: EstadoCliente };
  versiones: Array<{ id: string; numero: number; estado: "borrador" | "enviada"; enviadaEn: Date | null; resultado: string | null }>;
  vigente: VersionExpediente | null;
  borrador: VersionExpediente | null;
  riesgo: CalificacionLeida | null;
};

const LIMITE_ARCHIVO = TOPE_ARCHIVO_BYTES;

/**
 * Los bytes del archivo subido, leídos solo si el rol captura expedientes y si caben en el
 * tope: quien no puede capturar no hace que el servidor lea ni valide el archivo.
 */
export async function archivoDeDocumento(ctx: ContextoDePersonal, archivo: unknown): Promise<{ nombre: string; bytes: Uint8Array } | null> {
  exigirEnOperacion(ctx, "plataforma.expediente.capturar");
  // Un campo de archivo vacío llega como File sin nombre ni bytes: es «falta el archivo», no un PDF.
  if (!(archivo instanceof File) || archivo.size === 0) return null;
  if (archivo.size > LIMITE_ARCHIVO) throw new ErrorDeDominio("archivo_demasiado_grande");
  return { nombre: archivo.name, bytes: new Uint8Array(await archivo.arrayBuffer()) };
}

/**
 * Abre el expediente. La lectura deja su evento en la bitácora en la misma
 * transacción: quién, cuándo y de qué empresa.
 */
export async function leerExpediente(
  ctx: ContextoDePersonal,
  companyId: unknown,
  opciones: { ahora?: Date } = {},
): Promise<Expediente | null> {
  exigirEnOperacion(ctx, "plataforma.expediente.ver");
  if (!uuidValido(companyId)) return null;
  const ahora = opciones.ahora ?? new Date();
  const hoy = hoyEnMexico(ahora);
  return conContexto(basePlataforma(ctx, companyId), async (consulta) => {
    const empresa = await consulta.query("select id, razon_social, rfc, estado from companies where id = $1", [companyId]);
    const filaEmpresa = empresa.rows[0] as Record<string, unknown> | undefined;
    if (!filaEmpresa) return null;
    await auditarOperacion(consulta, ctx, { companyId, accion: "expediente_consultado", identificador: companyId, ocurridoEn: ahora });

    const versiones = await consulta.query(
      `select v.id, v.numero, v.estado, v.enviada_en, d.resultado
       from kyb_versiones v left join kyb_dictamenes d on d.version_id = v.id
       where v.company_id = $1 order by v.numero desc`,
      [companyId],
    );
    const lista = (versiones.rows as Array<Record<string, unknown>>).map((fila) => ({
      id: String(fila.id),
      numero: Number(fila.numero),
      estado: fila.estado === "enviada" ? ("enviada" as const) : ("borrador" as const),
      enviadaEn: fila.enviada_en ? fecha(fila.enviada_en) : null,
      resultado: typeof fila.resultado === "string" ? fila.resultado : null,
    }));
    const vigenteId = lista.find((version) => version.estado === "enviada")?.id ?? null;
    const borradorId = lista.find((version) => version.estado === "borrador")?.id ?? null;
    const vigente = vigenteId ? await leerVersion(consulta, vigenteId, hoy) : null;
    const borrador = borradorId ? await leerVersion(consulta, borradorId, hoy) : null;

    const riesgo = await consulta.query(
      `select k.tipo, k.puntaje, k.grado, k.factores, k.calificada_el::text as calificada_el,
              k.revisar_antes_de::text as revisar_antes_de, u.nombre as calificada_por
       from kyb_calificaciones_riesgo k join users u on u.id = k.calificada_por
       where k.company_id = $1 order by k.calificada_en desc, k.id desc limit 1`,
      [companyId],
    );
    const filaRiesgo = riesgo.rows[0] as Record<string, unknown> | undefined;
    return {
      empresa: {
        id: String(filaEmpresa.id),
        razonSocial: String(filaEmpresa.razon_social),
        rfc: String(filaEmpresa.rfc),
        estado: String(filaEmpresa.estado) as EstadoCliente,
      },
      versiones: lista,
      vigente,
      borrador,
      riesgo: filaRiesgo ? calificacionLeida(filaRiesgo, hoy, puedeEnOperacion(ctx, "plataforma.cumplimiento.bandeja")) : null,
    };
  });
}

async function leerVersion(consulta: Consulta, versionId: string, hoy: string): Promise<VersionExpediente> {
  const version = await consulta.query(
    `select v.*, v.fecha_constitucion::text as fecha_constitucion_texto, u.nombre as enviada_por_nombre
     from kyb_versiones v left join users u on u.id = v.enviada_por where v.id = $1`,
    [versionId],
  );
  const v = version.rows[0] as Record<string, unknown>;
  const representantes = await consulta.query(
    `select id, clave, nombre, rfc, curp, cargo, es_administrador, designado_por, pep
     from kyb_representantes where version_id = $1 and retirado_en is null order by creado_en, id`,
    [versionId],
  );
  const accionistas = await consulta.query(
    `with recursive arbol as (
       select a.*, 1 as capa, array[a.creado_en::text || a.id::text] as orden
       from kyb_accionistas a where a.version_id = $1 and a.retirado_en is null and a.padre_clave is null
       union all
       select h.*, arbol.capa + 1, arbol.orden || (h.creado_en::text || h.id::text)
       from kyb_accionistas h join arbol on h.version_id = $1 and h.retirado_en is null and h.padre_clave = arbol.clave
       where arbol.capa < 10
     )
     select id, clave, padre_clave, tipo_persona, nombre, rfc, curp, nacionalidad, pais, documento_extranjero,
            fecha_nacimiento::text as fecha_nacimiento, capital_bp, votos_bp, control_otros_medios, pep, capa
     from arbol order by orden`,
    [versionId],
  );
  const documentos = await consulta.query(
    `select d.id, d.tipo, d.representante_clave, d.nombre_archivo, d.sha256, d.emitido_el::text as emitido_el,
            d.vigente_hasta::text as vigente_hasta, d.detalle, d.cargado_en
     from kyb_documentos_de_version($1) x join kyb_documentos d on d.id = x.documento_id
     order by d.tipo, d.cargado_en`,
    [versionId],
  );
  const beneficiarios =
    v.estado === "enviada"
      ? await consulta.query(
          `select clave, nombre, rfc, curp, pep, capital_pct::text as capital_pct, votos_pct::text as votos_pct,
                  votos_controlados_pct::text as votos_controlados_pct, motivo, capas
           from kyb_beneficiarios where version_id = $1 order by capital_pct desc, nombre`,
          [versionId],
        )
      : await consulta.query(
          `select clave, nombre, rfc, curp, pep, capital_pct::text as capital_pct, votos_pct::text as votos_pct,
                  votos_controlados_pct::text as votos_controlados_pct, motivo, capas
           from kyb_calcular_beneficiarios($1) order by capital_pct desc, nombre`,
          [versionId],
        );
  const completa = await consulta.query("select kyb_estructura_completa($1) as completa", [versionId]);
  const dictamen = await consulta.query(
    `select d.id, d.resultado, d.motivo, d.dictaminado_en, u.nombre
     from kyb_dictamenes d join users u on u.id = d.dictaminado_por where d.version_id = $1`,
    [versionId],
  );
  const filaDictamen = dictamen.rows[0] as Record<string, unknown> | undefined;
  return {
    id: String(v.id),
    numero: Number(v.numero),
    estado: v.estado === "enviada" ? "enviada" : "borrador",
    creadaEn: fecha(v.creada_en),
    enviadaPor: typeof v.enviada_por_nombre === "string" ? v.enviada_por_nombre : null,
    enviadaPorId: typeof v.enviada_por === "string" ? v.enviada_por : null,
    enviadaEn: v.enviada_en ? fecha(v.enviada_en) : null,
    datos: {
      razonSocial: texto(v.razon_social),
      giro: texto(v.giro),
      nacionalidad: texto(v.nacionalidad),
      rfc: texto(v.rfc),
      serieEfirma: texto(v.serie_efirma),
      domicilioCalle: texto(v.domicilio_calle),
      domicilioExterior: texto(v.domicilio_exterior),
      domicilioInterior: texto(v.domicilio_interior),
      domicilioColonia: texto(v.domicilio_colonia),
      domicilioMunicipio: texto(v.domicilio_municipio),
      domicilioEntidad: texto(v.domicilio_entidad),
      domicilioCodigoPostal: texto(v.domicilio_codigo_postal),
      domicilioPais: texto(v.domicilio_pais),
      telefono: texto(v.telefono),
      correo: texto(v.correo),
      fechaConstitucion: texto(v.fecha_constitucion_texto),
      volumenMensualCentavos: v.volumen_mensual_centavos === null ? null : Number(v.volumen_mensual_centavos),
    },
    representantes: (representantes.rows as Array<Record<string, unknown>>).map((fila) => ({
      id: String(fila.id),
      clave: String(fila.clave),
      nombre: String(fila.nombre),
      rfc: texto(fila.rfc),
      curp: texto(fila.curp),
      cargo: String(fila.cargo) as Cargo,
      esAdministrador: fila.es_administrador === true,
      designadoPor: texto(fila.designado_por),
      pep: String(fila.pep) as PepDeclarada,
    })),
    accionistas: (accionistas.rows as Array<Record<string, unknown>>).map((fila) => ({
      id: String(fila.id),
      clave: String(fila.clave),
      padreClave: texto(fila.padre_clave),
      tipoPersona: fila.tipo_persona === "moral" ? "moral" : "fisica",
      nombre: String(fila.nombre),
      rfc: texto(fila.rfc),
      curp: texto(fila.curp),
      nacionalidad: texto(fila.nacionalidad),
      pais: texto(fila.pais),
      documentoExtranjero: texto(fila.documento_extranjero),
      fechaNacimiento: texto(fila.fecha_nacimiento),
      capitalBp: Number(fila.capital_bp),
      votosBp: Number(fila.votos_bp),
      controlOtrosMedios: fila.control_otros_medios === true,
      pep: String(fila.pep) as PepDeclarada,
      capa: Number(fila.capa),
    })),
    documentos: (documentos.rows as Array<Record<string, unknown>>).map((fila) => ({
      id: String(fila.id),
      tipo: String(fila.tipo) as TipoDocumento,
      representanteClave: texto(fila.representante_clave),
      nombreArchivo: String(fila.nombre_archivo),
      sha256: String(fila.sha256),
      emitidoEl: texto(fila.emitido_el),
      vigenteHasta: texto(fila.vigente_hasta),
      detalle: texto(fila.detalle),
      cargadoEn: fecha(fila.cargado_en),
      vencido: typeof fila.vigente_hasta === "string" && fila.vigente_hasta < hoy,
    })),
    beneficiarios: (beneficiarios.rows as Array<Record<string, unknown>>).map((fila) => ({
      clave: String(fila.clave),
      nombre: String(fila.nombre),
      rfc: texto(fila.rfc),
      curp: texto(fila.curp),
      pep: String(fila.pep) as PepDeclarada,
      capitalPct: String(fila.capital_pct),
      votosPct: String(fila.votos_pct),
      votosControladosPct: String(fila.votos_controlados_pct),
      motivo: String(fila.motivo),
      capas: Number(fila.capas),
    })),
    estructuraCompleta: (completa.rows[0] as { completa?: unknown } | undefined)?.completa === true,
    dictamen: filaDictamen
      ? {
          id: String(filaDictamen.id),
          resultado: String(filaDictamen.resultado) as Dictamen["resultado"],
          motivo: texto(filaDictamen.motivo),
          dictaminadoPor: String(filaDictamen.nombre),
          dictaminadoEn: fecha(filaDictamen.dictaminado_en),
        }
      : null,
  };
}

/** Abre un borrador. El primero parte de la razón social y el RFC de la empresa; los siguientes, de la versión anterior. */
export async function crearVersion(
  ctx: ContextoDePersonal,
  entrada: { companyId: unknown; formId: unknown },
  envolver: EnvolturaDeTransaccion = (consulta) => consulta,
): Promise<string> {
  exigirEnOperacion(ctx, "plataforma.expediente.capturar");
  if (!uuidValido(entrada.companyId)) throw new ErrorDeDominio("cliente_ausente");
  if (!uuidValido(entrada.formId)) throw new ErrorDeDominio("formulario_invalido");
  const companyId = entrada.companyId;
  const id = entrada.formId;
  const ahora = new Date();
  await unaVezPorFormulario(() => conContexto(basePlataforma(ctx, companyId), async (transaccion) => {
    const consulta = envolver(transaccion);
    // El formulario y el borrador de la empresa en una sola lectura, con la misma foto. Un segundo clic encuentra
    // su versión; un formulario de otra empresa no vale. Con dos lecturas, si la otra pestaña del mismo formulario
    // confirmaba entre ellas, la segunda veía su borrador sin haber visto su id y respondía «ya hay borrador»
    // (Vercel CI de b2db0b5). Si confirma después de esta lectura, el insert choca con la llave y se repite.
    const vistas = await consulta.query(
      "select id, company_id from kyb_versiones where id = $1 or (company_id = $2 and estado = 'borrador')",
      [id, companyId],
    );
    const filas = vistas.rows as Array<{ id: string; company_id: string }>;
    const propia = filas.find((fila) => fila.id === id);
    if (propia) {
      if (propia.company_id === companyId) return;
      throw new ErrorDeDominio("expediente_ausente");
    }
    if (filas.length > 0) throw new ErrorDeDominio("expediente_con_borrador");
    const empresa = await consulta.query("select razon_social, rfc from companies where id = $1", [companyId]);
    const filaEmpresa = empresa.rows[0] as { razon_social?: unknown; rfc?: unknown } | undefined;
    if (!filaEmpresa) throw new ErrorDeDominio("cliente_ausente");
    const ultimo = await consulta.query("select coalesce(max(numero), 0)::int as numero from kyb_versiones where company_id = $1", [companyId]);
    const numero = Number((ultimo.rows[0] as { numero: number }).numero) + 1;
    await consulta.query(
      `insert into kyb_versiones (id, operator_id, company_id, numero, razon_social, rfc, creada_por, creada_en)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, ctx.personal.operadorId, companyId, numero, numero === 1 ? filaEmpresa.razon_social : null,
        numero === 1 ? filaEmpresa.rfc : null, ctx.persona.id, ahora],
    );
    await auditarOperacion(consulta, ctx, {
      companyId, accion: "expediente_version_creada", identificador: id, ocurridoEn: ahora, cambio: { numero },
    });
  }));
  return id;
}

// El orden de CAMPOS_DATOS es el de los placeholders de ACTUALIZAR_DATOS ($2 en adelante).
const CAMPOS_DATOS: Array<[keyof DatosGenerales, string, (valor: unknown) => string | number | null | undefined]> = [
  // La razón social es una identidad: con un carácter invisible se rechaza antes, con su propio aviso (ver `guardarDatosGenerales`).
  ["razonSocial", "razon_social", (v) => opcional(v, (t) => textoOperativo(t, 300))],
  ["giro", "giro", (v) => opcional(v, (t) => textoOperativo(t, 200))],
  ["nacionalidad", "nacionalidad", (v) => opcional(v, (t) => textoOperativo(t, 80))],
  ["rfc", "rfc", (v) => opcional(v, (t) => (rfcMoralValido(t.toUpperCase()) ? t.toUpperCase() : null))],
  ["serieEfirma", "serie_efirma", (v) => opcional(v, (t) => (SERIE_EFIRMA.test(t) ? t : null))],
  ["domicilioCalle", "domicilio_calle", (v) => opcional(v, (t) => textoOperativo(t, 200))],
  ["domicilioExterior", "domicilio_exterior", (v) => opcional(v, (t) => textoOperativo(t, 40))],
  ["domicilioInterior", "domicilio_interior", (v) => opcional(v, (t) => textoOperativo(t, 40))],
  ["domicilioColonia", "domicilio_colonia", (v) => opcional(v, (t) => textoOperativo(t, 120))],
  ["domicilioMunicipio", "domicilio_municipio", (v) => opcional(v, (t) => textoOperativo(t, 120))],
  ["domicilioEntidad", "domicilio_entidad", (v) => opcional(v, (t) => textoOperativo(t, 80))],
  ["domicilioCodigoPostal", "domicilio_codigo_postal", (v) => opcional(v, (t) => (/^\d{5}$/.test(t) ? t : null))],
  ["domicilioPais", "domicilio_pais", (v) => opcional(v, (t) => textoOperativo(t, 80))],
  ["telefono", "telefono", (v) => opcional(v, (t) => { const solo = t.replace(/[\s()+-]/g, ""); return !conInvisible(t) && /^\d{10,15}$/.test(solo) ? solo : null; })],
  // En minúsculas antes de medir («İ» crece) y sin caracteres de control, como el CHECK `kyb_versiones_correo`.
  ["correo", "correo", (v) => opcional(v, (t) => {
    const correo = t.toLowerCase();
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo) && !INVISIBLE.test(correo) && [...correo].length <= 254 ? correo : null;
  })],
  ["fechaConstitucion", "fecha_constitucion", (v) => opcional(v, (t) => (fechaDeCalendario(t) && t <= hoyEnMexico(new Date()) ? t : null))],
  ["volumenMensualCentavos", "volumen_mensual_centavos", (v) => opcional(v, (t) => pesosACentavos(t))],
];

const ACTUALIZAR_DATOS = `update kyb_versiones set
  razon_social = $2, giro = $3, nacionalidad = $4, rfc = $5, serie_efirma = $6, domicilio_calle = $7,
  domicilio_exterior = $8, domicilio_interior = $9, domicilio_colonia = $10, domicilio_municipio = $11,
  domicilio_entidad = $12, domicilio_codigo_postal = $13, domicilio_pais = $14, telefono = $15, correo = $16,
  fecha_constitucion = $17, volumen_mensual_centavos = $18
  where id = $1 and estado = 'borrador'`;

/** Guarda los datos generales del borrador. Un campo vacío queda vacío; uno mal escrito devuelve su código. */
export async function guardarDatosGenerales(
  ctx: ContextoDePersonal,
  entrada: { versionId: unknown; datos: Record<string, unknown> },
): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.expediente.capturar");
  if (!uuidValido(entrada.versionId)) throw new ErrorDeDominio("expediente_ausente");
  if (conInvisible(entrada.datos.razonSocial)) throw new ErrorDeDominio("invisible_razonSocial");
  const valores: Array<string | number | null> = [];
  for (const [clave, , validar] of CAMPOS_DATOS) {
    const valor = validar(entrada.datos[clave]);
    if (valor === undefined) throw new ErrorDeDominio(`dato_invalido_${clave}`);
    valores.push(valor);
  }
  const ahora = new Date();
  await conBorrador(ctx, entrada.versionId, async (consulta, version) => {
    await consulta.query(ACTUALIZAR_DATOS, [version.id, ...valores]);
    await auditarOperacion(consulta, ctx, {
      companyId: version.companyId, accion: "expediente_datos_editados", identificador: version.id, ocurridoEn: ahora,
    });
  });
}

export async function agregarRepresentante(
  ctx: ContextoDePersonal,
  entrada: {
    versionId: unknown; formId: unknown; nombre: unknown; rfc: unknown; curp: unknown; cargo: unknown;
    esAdministrador: boolean; designadoPor: unknown; pep: unknown;
  },
): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.expediente.capturar");
  if (!uuidValido(entrada.versionId)) throw new ErrorDeDominio("expediente_ausente");
  if (!uuidValido(entrada.formId)) throw new ErrorDeDominio("formulario_invalido");
  if (conInvisible(entrada.nombre)) throw new ErrorDeDominio("invisible_nombre");
  const nombre = textoOperativo(entrada.nombre, 200);
  if (!nombre) throw new ErrorDeDominio("dato_invalido_nombre");
  const rfc = opcional(entrada.rfc, (t) => (rfcFisicaValido(t.toUpperCase()) ? t.toUpperCase() : null));
  if (rfc === undefined) throw new ErrorDeDominio("dato_invalido_rfc");
  const curp = opcional(entrada.curp, (t) => (curpValida(t.toUpperCase()) ? t.toUpperCase() : null));
  if (curp === undefined) throw new ErrorDeDominio("dato_invalido_curp");
  if (!(CARGOS as readonly unknown[]).includes(entrada.cargo)) throw new ErrorDeDominio("dato_invalido_cargo");
  if (!(PEPS as readonly unknown[]).includes(entrada.pep)) throw new ErrorDeDominio("dato_invalido_pep");
  const designadoPor = opcional(entrada.designadoPor, (t) => textoOperativo(t, 300));
  if (designadoPor === undefined) throw new ErrorDeDominio("dato_invalido_designadoPor");
  const id = entrada.formId;
  const ahora = new Date();
  await conBorrador(ctx, entrada.versionId, async (consulta, version) => {
    const insertado = await consulta.query(
      `insert into kyb_representantes (
         id, version_id, company_id, operator_id, clave, nombre, rfc, curp, cargo, es_administrador, designado_por, pep, creado_por, creado_en
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) on conflict (id) do nothing`,
      [id, version.id, version.companyId, ctx.personal.operadorId, randomUUID(), nombre, rfc, curp, entrada.cargo,
        entrada.esAdministrador, designadoPor, entrada.pep, ctx.persona.id, ahora],
    );
    if (insertado.rowCount !== 1) return mismoBorrador(consulta, "kyb_representantes", id, version.id);
    await auditarOperacion(consulta, ctx, {
      companyId: version.companyId, accion: "expediente_representante_agregado", identificador: id, ocurridoEn: ahora,
    });
  });
}

export async function agregarAccionista(
  ctx: ContextoDePersonal,
  entrada: {
    versionId: unknown; formId: unknown; padreClave: unknown; tipoPersona: unknown; nombre: unknown; rfc: unknown;
    curp: unknown; pais: unknown; documentoExtranjero: unknown; fechaNacimiento: unknown; capital: unknown; votos: unknown;
    controlOtrosMedios: boolean; pep: unknown;
  },
): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.expediente.capturar");
  if (!uuidValido(entrada.versionId)) throw new ErrorDeDominio("expediente_ausente");
  if (!uuidValido(entrada.formId)) throw new ErrorDeDominio("formulario_invalido");
  const tipo = entrada.tipoPersona === "moral" ? "moral" : entrada.tipoPersona === "fisica" ? "fisica" : null;
  if (!tipo) throw new ErrorDeDominio("dato_invalido_tipoPersona");
  if (conInvisible(entrada.nombre)) throw new ErrorDeDominio("invisible_nombre");
  const nombre = textoOperativo(entrada.nombre, 300);
  if (!nombre) throw new ErrorDeDominio("dato_invalido_nombre");
  const rfc = opcional(entrada.rfc, (t) => {
    const mayus = t.toUpperCase();
    return (tipo === "moral" ? rfcMoralValido(mayus) : rfcFisicaValido(mayus)) ? mayus : null;
  });
  if (rfc === undefined) throw new ErrorDeDominio("dato_invalido_rfc");
  const curp = tipo === "fisica" ? opcional(entrada.curp, (t) => (curpValida(t.toUpperCase()) ? t.toUpperCase() : null)) : null;
  if (curp === undefined) throw new ErrorDeDominio("dato_invalido_curp");
  // Sin país es mexicana: la física se identifica con su CURP y la moral con su RFC.
  // Con país, siempre con el número de su pasaporte o identificación oficial y su
  // fecha de nacimiento (física) o de su registro en su país (moral): con ellos suma
  // por varios caminos aunque traiga CURP o RFC.
  const pais = opcional(entrada.pais, (t) => (paisExtranjeroValido(t.toUpperCase()) ? t.toUpperCase() : null));
  if (pais === undefined) throw new ErrorDeDominio("dato_invalido_pais");
  const documentoExtranjero = pais ? opcional(entrada.documentoExtranjero, documentoExtranjeroNormalizado) : null;
  if (documentoExtranjero === undefined || (pais && !documentoExtranjero)) throw new ErrorDeDominio("dato_invalido_documentoExtranjero");
  const fechaNacimiento = pais && tipo === "fisica"
    ? opcional(entrada.fechaNacimiento, (t) => (fechaDeCalendario(t) && t >= "1900-01-01" && t <= hoyEnMexico(new Date()) ? t : null))
    : null;
  if (fechaNacimiento === undefined || (pais && tipo === "fisica" && !fechaNacimiento)) {
    throw new ErrorDeDominio("dato_invalido_fechaNacimiento");
  }
  const nacionalidad = pais ? nombreDePais(pais) : "Mexicana";
  const capital = porcentajeAPuntosBase(entrada.capital);
  if (capital === null) throw new ErrorDeDominio("dato_invalido_capital");
  const votos = porcentajeAPuntosBase(entrada.votos);
  if (votos === null) throw new ErrorDeDominio("dato_invalido_votos");
  const pep = tipo === "fisica" && (PEPS as readonly unknown[]).includes(entrada.pep) ? (entrada.pep as PepDeclarada) : "no";
  const control = tipo === "fisica" && entrada.controlOtrosMedios;
  if (capital === 0 && votos === 0 && !control) throw new ErrorDeDominio("dato_invalido_capital");
  const padre = entrada.padreClave === "" || entrada.padreClave === null || entrada.padreClave === undefined ? null : entrada.padreClave;
  if (padre !== null && !uuidValido(padre)) throw new ErrorDeDominio("dato_invalido_padreClave");
  const id = entrada.formId;
  const ahora = new Date();
  await conBorrador(ctx, entrada.versionId, async (consulta, version) => {
    const insertado = await consulta.query(
      `insert into kyb_accionistas (
         id, version_id, company_id, operator_id, clave, padre_clave, tipo_persona, nombre, rfc, curp, nacionalidad,
         pais, documento_extranjero, fecha_nacimiento, capital_bp, votos_bp, control_otros_medios, pep, creado_por, creado_en
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       on conflict (id) do nothing`,
      [id, version.id, version.companyId, ctx.personal.operadorId, randomUUID(), padre, tipo, nombre, rfc, curp,
        nacionalidad, pais, documentoExtranjero, fechaNacimiento, capital, votos, control, pep, ctx.persona.id, ahora],
    );
    if (insertado.rowCount !== 1) return mismoBorrador(consulta, "kyb_accionistas", id, version.id);
    await auditarOperacion(consulta, ctx, {
      companyId: version.companyId, accion: "expediente_accionista_agregado", identificador: id, ocurridoEn: ahora,
    });
  });
}

/** Retira a un representante o accionista del borrador. La fila se conserva con quién y cuándo. */
export async function retirarDelBorrador(
  ctx: ContextoDePersonal,
  entrada: { versionId: unknown; id: unknown; tipo: "representante" | "accionista" },
): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.expediente.capturar");
  if (!uuidValido(entrada.versionId) || !uuidValido(entrada.id)) throw new ErrorDeDominio("expediente_ausente");
  const ahora = new Date();
  await conBorrador(ctx, entrada.versionId, async (consulta, version) => {
    const parametros = [entrada.id, version.id, ahora, ctx.persona.id];
    const retirado = entrada.tipo === "representante"
      ? await consulta.query(
        "update kyb_representantes set retirado_en = $3, retirado_por = $4 where id = $1 and version_id = $2 and retirado_en is null",
        parametros,
      )
      : await consulta.query(
        "update kyb_accionistas set retirado_en = $3, retirado_por = $4 where id = $1 and version_id = $2 and retirado_en is null",
        parametros,
      );
    // Un segundo clic lo encuentra ya retirado; un id de otra versión no se da por hecho.
    if (retirado.rowCount !== 1) {
      return mismoBorrador(consulta, entrada.tipo === "representante" ? "kyb_representantes" : "kyb_accionistas", entrada.id as string, version.id);
    }
    await auditarOperacion(consulta, ctx, {
      companyId: version.companyId,
      accion: entrada.tipo === "representante" ? "expediente_representante_retirado" : "expediente_accionista_retirado",
      identificador: entrada.id as string,
      ocurridoEn: ahora,
    });
  });
}

/**
 * Sube un documento del expediente. El archivo va a Blob privado antes de la
 * transacción, con su SHA-256; la fila y el evento quedan juntos. Lever nunca
 * borra un archivo del expediente (61ª). Solo se borra el que no llegó a serlo:
 * si la fila no entró (otro envío del mismo formulario ganó) o la transacción
 * falló, ese archivo no tiene referencia y no se conserva.
 */
export async function cargarDocumento(
  ctx: ContextoDePersonal,
  entrada: {
    versionId: unknown; formId: unknown; tipo: unknown; representanteClave: unknown; emitidoEl: unknown;
    vigenteHasta: unknown; detalle: unknown; archivo: { nombre: string; bytes: Uint8Array } | null;
  },
  deps: { almacen: AlmacenConstancia; ahora?: () => Date },
): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.expediente.capturar");
  if (!uuidValido(entrada.versionId)) throw new ErrorDeDominio("expediente_ausente");
  if (!uuidValido(entrada.formId)) throw new ErrorDeDominio("formulario_invalido");
  if (!(TIPOS_DOCUMENTO as readonly unknown[]).includes(entrada.tipo)) throw new ErrorDeDominio("dato_invalido_tipo");
  const tipo = entrada.tipo as TipoDocumento;
  const ahora = deps.ahora?.() ?? new Date();
  const hoy = hoyEnMexico(ahora);
  const emitidoEl = opcional(entrada.emitidoEl, (t) => (fechaDeCalendario(t) && t <= hoy ? t : null));
  if (emitidoEl === undefined) throw new ErrorDeDominio("dato_invalido_emitidoEl");
  let vigenteHasta = opcional(entrada.vigenteHasta, (t) => (fechaDeCalendario(t) ? t : null));
  if (vigenteHasta === undefined) throw new ErrorDeDominio("dato_invalido_vigenteHasta");
  if (tipo === "comprobante_domicilio") {
    if (!emitidoEl) throw new ErrorDeDominio("dato_invalido_emitidoEl");
    vigenteHasta = vigenciaDeComprobante(emitidoEl);
  }
  if (tipo === "identificacion_representante" && !vigenteHasta) throw new ErrorDeDominio("dato_invalido_vigenteHasta");
  // La vigencia no termina antes de la emisión (CHECK `kyb_documentos_vigencia`): se avisa en el campo antes de subir nada.
  if (emitidoEl && vigenteHasta && vigenteHasta < emitidoEl) throw new ErrorDeDominio("dato_invalido_vigenteHasta");
  const detalle = opcional(entrada.detalle, (t) => textoOperativo(t, 300));
  if (detalle === undefined || (tipo === "acta_constitutiva" && !detalle)) throw new ErrorDeDominio("dato_invalido_detalle");
  const representante = tipo === "identificacion_representante" || tipo === "poder"
    ? (entrada.representanteClave === "" ? null : entrada.representanteClave)
    : null;
  if (tipo === "identificacion_representante" && !uuidValido(representante)) throw new ErrorDeDominio("dato_invalido_representanteClave");
  if (representante !== null && !uuidValido(representante)) throw new ErrorDeDominio("dato_invalido_representanteClave");
  const archivo = entrada.archivo;
  if (!archivo || archivo.bytes.byteLength === 0) throw new ErrorDeDominio("dato_invalido_archivo");
  if (archivo.bytes.byteLength > LIMITE_ARCHIVO) throw new ErrorDeDominio("archivo_demasiado_grande");
  const contenido = tipoDeContenido(archivo.bytes);
  if (!contenido) throw new ErrorDeDominio("archivo_no_admitido");
  const nombre = textoOperativo(archivo.nombre.replace(/[\\/]/g, "_"), 200) ?? `documento.${contenido.extension}`;
  const sha256 = createHash("sha256").update(archivo.bytes).digest("hex");
  const id = entrada.formId;

  // Un doble clic no sube dos veces lo que ya quedó guardado.
  const version = await conContexto(basePlataforma(ctx), async (consulta) => {
    const previo = await consulta.query("select id from kyb_documentos where id = $1", [id]);
    if (previo.rows.length > 0) {
      await documentoDeLaVersion(consulta, id, entrada.versionId as string, sha256);
      return null;
    }
    return versionEnBorrador(consulta, entrada.versionId as string);
  });
  if (!version) return;
  const guardado = await deps.almacen.guardar({
    clave: `expedientes/${version.companyId}/${id}-${randomUUID().slice(0, 8)}.${contenido.extension}`,
    bytes: archivo.bytes,
    tipo: contenido.tipo,
  });
  let referenciado = false;
  try {
    await conBorrador(ctx, version.id, async (consulta, enBorrador) => {
      referenciado = false;
      const insertado = await consulta.query(
        `insert into kyb_documentos (
           id, operator_id, company_id, tipo, representante_clave, nombre_archivo, tipo_contenido, tamano_bytes, sha256,
           clave_blob, emitido_el, vigente_hasta, detalle, cargado_por, cargado_en
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) on conflict (id) do nothing`,
        [id, ctx.personal.operadorId, enBorrador.companyId, tipo, representante, nombre, contenido.tipo, archivo.bytes.byteLength,
          sha256, guardado.clave, emitidoEl, vigenteHasta, detalle, ctx.persona.id, ahora],
      );
      if (insertado.rowCount !== 1) return documentoDeLaVersion(consulta, id, enBorrador.id, sha256);
      await consulta.query(
        "insert into kyb_version_documentos (version_id, documento_id, company_id, operator_id) values ($1, $2, $3, $4)",
        [enBorrador.id, id, enBorrador.companyId, ctx.personal.operadorId],
      );
      await auditarOperacion(consulta, ctx, {
        companyId: enBorrador.companyId, accion: "expediente_documento_cargado", identificador: id, ocurridoEn: ahora, cambio: { tipo },
      });
      referenciado = true;
    });
  } catch (error) {
    await deps.almacen.borrar(guardado.clave);
    throw error;
  }
  if (!referenciado) await deps.almacen.borrar(guardado.clave);
}

/** Envía el borrador: la base exige el expediente completo, calcula a los propietarios reales y coteja la lista. */
export async function enviarVersion(ctx: ContextoDePersonal, versionId: unknown): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.expediente.capturar");
  if (!uuidValido(versionId)) throw new ErrorDeDominio("expediente_ausente");
  const ahora = new Date();
  await conContexto(basePlataforma(ctx), async (consulta) => {
    const fila = await consulta.query("select company_id, estado from kyb_versiones where id = $1 for update", [versionId]);
    const version = fila.rows[0] as { company_id?: unknown; estado?: unknown } | undefined;
    if (!version) throw new ErrorDeDominio("expediente_ausente");
    // Un segundo clic encuentra la versión ya enviada: no es un error.
    if (version.estado === "enviada") return;
    await consulta.query(
      "update kyb_versiones set estado = 'enviada', enviada_por = $2, enviada_en = $3 where id = $1 and estado = 'borrador'",
      [versionId, ctx.persona.id, ahora],
    );
    await auditarOperacion(consulta, ctx, {
      companyId: String(version.company_id), accion: "expediente_enviado", identificador: versionId, ocurridoEn: ahora,
    });
  });
}

/** 23ª: Cumplimiento dictamina una versión enviada. Observado y rechazado llevan motivo. */
export async function dictaminarVersion(
  ctx: ContextoDePersonal,
  sesion: SesionConFactor,
  entrada: { versionId: unknown; formId: unknown; resultado: unknown; motivo: unknown },
): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.expediente.dictaminar");
  exigirAutenticacionReciente(sesion);
  if (!uuidValido(entrada.versionId)) throw new ErrorDeDominio("expediente_ausente");
  if (!uuidValido(entrada.formId)) throw new ErrorDeDominio("formulario_invalido");
  const resultado = entrada.resultado;
  if (resultado !== "aprobado" && resultado !== "observado" && resultado !== "rechazado") throw new ErrorDeDominio("dato_invalido_resultado");
  const motivo = resultado === "aprobado" ? opcional(entrada.motivo, (t) => textoMultilinea(t, 1000)) ?? null : motivoEscrito(entrada.motivo, 1000);
  const ahora = new Date();
  await unaVezPorFormulario(() => conContexto(basePlataforma(ctx), async (consulta) => {
    const fila = await consulta.query("select company_id, estado, enviada_por from kyb_versiones where id = $1", [entrada.versionId]);
    const version = fila.rows[0] as { company_id?: unknown; estado?: unknown; enviada_por?: unknown } | undefined;
    if (!version) throw new ErrorDeDominio("expediente_ausente");
    if (version.estado !== "enviada") throw new ErrorDeDominio("dictamen_sobre_borrador");
    if (version.enviada_por === ctx.persona.id) throw new ErrorDeDominio("misma_persona_en_dictamen");
    const previo = await consulta.query("select id from kyb_dictamenes where version_id = $1", [entrada.versionId]);
    if (previo.rows.length > 0) {
      if ((previo.rows[0] as { id: string }).id === entrada.formId) return;
      throw new ErrorDeDominio("dictamen_ya_registrado");
    }
    await consulta.query(
      `insert into kyb_dictamenes (id, version_id, company_id, operator_id, resultado, motivo, dictaminado_por, dictaminado_en)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [entrada.formId, entrada.versionId, version.company_id, ctx.personal.operadorId, resultado, motivo, ctx.persona.id, ahora],
    );
    await auditarOperacion(consulta, ctx, {
      companyId: String(version.company_id), accion: "expediente_dictaminado", identificador: entrada.formId as string,
      motivo, ocurridoEn: ahora, cambio: { resultado },
    });
  }));
}

/**
 * Califica el grado de riesgo con la matriz de src/dominio/operacion/riesgo.ts.
 * Actividad y zona las elige Cumplimiento; lo demás sale del expediente vigente
 * y de las coincidencias abiertas. La PEP es la declarada por el cliente.
 */
export async function calificarRiesgoEmpresa(
  ctx: ContextoDePersonal,
  entrada: { companyId: unknown; formId: unknown; actividad: unknown; zona: unknown },
  deps: { ahora?: () => Date } = {},
): Promise<{ grado: Grado; puntaje: number }> {
  exigirEnOperacion(ctx, "plataforma.riesgo.calificar");
  if (!uuidValido(entrada.companyId)) throw new ErrorDeDominio("cliente_ausente");
  if (!uuidValido(entrada.formId)) throw new ErrorDeDominio("formulario_invalido");
  const niveles: readonly unknown[] = ["baja", "media", "alta"];
  if (!niveles.includes(entrada.actividad)) throw new ErrorDeDominio("dato_invalido_actividad");
  if (!niveles.includes(entrada.zona)) throw new ErrorDeDominio("dato_invalido_zona");
  const ahora = deps.ahora?.() ?? new Date();
  const hoy = hoyEnMexico(ahora);
  const companyId = entrada.companyId;
  return unaVezPorFormulario(() => conContexto(basePlataforma(ctx, companyId), async (consulta) => {
    const previa = await consulta.query("select grado, puntaje, company_id from kyb_calificaciones_riesgo where id = $1", [entrada.formId]);
    if (previa.rows.length > 0) {
      const fila = previa.rows[0] as { grado: Grado; puntaje: number; company_id: string };
      if (fila.company_id !== companyId) throw new ErrorDeDominio("expediente_ausente");
      return { grado: fila.grado, puntaje: Number(fila.puntaje) };
    }
    const version = await consulta.query(
      `select id, fecha_constitucion::text as fecha_constitucion, volumen_mensual_centavos
       from kyb_versiones where company_id = $1 and estado = 'enviada' order by numero desc limit 1`,
      [companyId],
    );
    const filaVersion = version.rows[0] as { id: string; fecha_constitucion: string; volumen_mensual_centavos: string } | undefined;
    if (!filaVersion) throw new ErrorDeDominio("calificacion_sin_expediente");
    const datos = await consulta.query(
      `select
         (select coalesce(max(capa), 1) from (
            with recursive arbol as (
              select clave, 1 as capa from kyb_accionistas where version_id = $1 and retirado_en is null and padre_clave is null
              union all
              select h.clave, arbol.capa + 1 from kyb_accionistas h join arbol on h.padre_clave = arbol.clave
              where h.version_id = $1 and h.retirado_en is null and arbol.capa < 10
            ) select capa from arbol) capas) as capas,
         (select array_agg(pep) from (
            select pep from kyb_representantes where version_id = $1 and retirado_en is null
            union all select pep from kyb_accionistas where version_id = $1 and retirado_en is null
            union all select pep from kyb_beneficiarios where version_id = $1) peps) as peps,
         (select count(*)::int from lpb_coincidencias where company_id = $2 and sujeto_tipo <> 'contraparte'
            and estado in ('pendiente', 'confirmada') and (tipo = 'exacta' or estado = 'confirmada')) as exactas,
         (select count(*)::int from lpb_coincidencias where company_id = $2 and sujeto_tipo <> 'contraparte'
            and estado = 'pendiente' and tipo = 'posible') as posibles`,
      [filaVersion.id, companyId],
    );
    const fila = datos.rows[0] as { capas: number; peps: string[] | null; exactas: number; posibles: number };
    const peps = fila.peps ?? [];
    const pep: Pep = peps.includes("extranjera") ? "extranjera" : peps.includes("nacional") ? "nacional" : "no";
    const coincidencias: Coincidencias = fila.exactas > 0 ? "exacta" : fila.posibles > 0 ? "posible" : "ninguna";
    const calificacion = calificarRiesgo({
      actividad: entrada.actividad as Nivel,
      zona: entrada.zona as Nivel,
      fechaConstitucion: filaVersion.fecha_constitucion,
      hoy,
      capas: Number(fila.capas),
      pep,
      volumenMensualCentavos: Number(filaVersion.volumen_mensual_centavos),
      coincidencias,
    });
    await consulta.query(
      `insert into kyb_calificaciones_riesgo (
         id, operator_id, company_id, version_id, tipo, factores, puntaje, grado, pep_extranjera, coincidencia_exacta,
         calificada_por, calificada_el, calificada_en, revisar_antes_de
       ) values ($1, $2, $3, $4, 'alta', $5, $6, $7, false, false, $8, $9, $10, $11)`,
      [entrada.formId, ctx.personal.operadorId, companyId, filaVersion.id, JSON.stringify(calificacion.factores),
        calificacion.puntaje, calificacion.grado, ctx.persona.id, hoy, ahora, calificacion.revisarAntesDe],
    );
    await auditarOperacion(consulta, ctx, {
      companyId, accion: "riesgo_calificado", identificador: entrada.formId as string, ocurridoEn: ahora,
      cambio: { grado: calificacion.grado, puntaje: calificacion.puntaje },
    });
    return { grado: calificacion.grado, puntaje: calificacion.puntaje };
  }));
}

/**
 * La puerta de la base entrega la ruta del archivo y deja el evento de la descarga (lectura auditada).
 * El documento tiene que ser de la empresa de la dirección: si no, no hay evento ni archivo.
 */
export async function prepararDescargaDocumento(
  ctx: ContextoDePersonal,
  companyId: unknown,
  documentoId: unknown,
): Promise<{ clave: string; nombre: string; tipo: string; sha256: string; companyId: string }> {
  exigirEnOperacion(ctx, "plataforma.expediente.ver");
  if (!uuidValido(companyId) || !uuidValido(documentoId)) throw new ErrorDeDominio("documento_no_existe");
  const resultado = await conContexto(basePlataforma(ctx), (consulta) =>
    consulta.query("select clave_blob, nombre_archivo, tipo_contenido, sha256, company_id from kyb_documento_para_descarga($1, $2, $3)", [
      documentoId,
      companyId,
      ctx.peticionId,
    ]),
  );
  const fila = resultado.rows[0] as Record<string, unknown> | undefined;
  if (!fila) throw new ErrorDeDominio("documento_no_existe");
  return {
    clave: String(fila.clave_blob),
    nombre: String(fila.nombre_archivo),
    tipo: String(fila.tipo_contenido),
    sha256: String(fila.sha256),
    companyId: String(fila.company_id),
  };
}

/**
 * Descarga un documento del expediente: deja el evento, lee el archivo privado y
 * comprueba que su SHA-256 sea el que se guardó al cargarlo. Un archivo alterado
 * no se entrega: se registra y la pantalla dice que no está disponible.
 */
export async function descargarDocumentoExpediente(
  ctx: ContextoDePersonal,
  companyId: unknown,
  documentoId: unknown,
  deps: { leer?: (clave: string) => Promise<ReadableStream<Uint8Array>> } = {},
): Promise<{ bytes: Uint8Array; nombre: string; tipo: string }> {
  const documento = await prepararDescargaDocumento(ctx, companyId, documentoId);
  const stream = await (deps.leer ?? leerPrivado)(documento.clave);
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  if (bytes.byteLength > LIMITE_ARCHIVO || createHash("sha256").update(bytes).digest("hex") !== documento.sha256) {
    console.error(JSON.stringify({ evento: "expediente_documento_alterado", documentoId: documentoId as string, peticionId: ctx.peticionId }));
    throw new ErrorDeDominio("archivo_no_disponible");
  }
  return { bytes, nombre: documento.nombre, tipo: documento.tipo };
}

async function conBorrador(
  ctx: ContextoDePersonal,
  versionId: string,
  fn: (consulta: Consulta, version: { id: string; companyId: string }) => Promise<void>,
): Promise<void> {
  await conContexto(basePlataforma(ctx), async (consulta) => {
    const version = await versionEnBorrador(consulta, versionId, true);
    await fn(consulta, version);
  });
}

/** Doble clic: la fila ya está en este borrador. Si no, el id es de otra versión o de otra empresa. */
async function mismoBorrador(
  consulta: Consulta,
  tabla: "kyb_representantes" | "kyb_accionistas",
  id: string,
  versionId: string,
): Promise<void> {
  const fila = tabla === "kyb_representantes"
    ? await consulta.query("select 1 from kyb_representantes where id = $1 and version_id = $2", [id, versionId])
    : await consulta.query("select 1 from kyb_accionistas where id = $1 and version_id = $2", [id, versionId]);
  if (fila.rows.length !== 1) throw new ErrorDeDominio("expediente_ausente");
}

/**
 * Doble clic: el documento ya está en esta versión con el mismo archivo. Si el formulario es de
 * otra versión o de otra empresa, no está; si trae otro archivo, no se da por guardado.
 */
async function documentoDeLaVersion(consulta: Consulta, documentoId: string, versionId: string, sha256: string): Promise<void> {
  const fila = await consulta.query(
    `select d.sha256 from kyb_version_documentos v join kyb_documentos d on d.id = v.documento_id
     where v.documento_id = $1 and v.version_id = $2`,
    [documentoId, versionId],
  );
  if (fila.rows.length !== 1) throw new ErrorDeDominio("expediente_ausente");
  if ((fila.rows[0] as { sha256: string }).sha256 !== sha256) throw new ErrorDeDominio("formulario_invalido");
}

async function versionEnBorrador(consulta: Consulta, versionId: string, bloquear = false): Promise<{ id: string; companyId: string }> {
  const fila = bloquear
    ? await consulta.query("select id, company_id, estado from kyb_versiones where id = $1 for update", [versionId])
    : await consulta.query("select id, company_id, estado from kyb_versiones where id = $1", [versionId]);
  const version = fila.rows[0] as { id?: unknown; company_id?: unknown; estado?: unknown } | undefined;
  if (!version) throw new ErrorDeDominio("expediente_ausente");
  if (version.estado !== "borrador") throw new ErrorDeDominio("expediente_enviado_inmutable");
  return { id: String(version.id), companyId: String(version.company_id) };
}

function calificacionLeida(fila: Record<string, unknown>, hoy: string, veDesglose: boolean): CalificacionLeida {
  const revisarAntesDe = String(fila.revisar_antes_de);
  return {
    grado: String(fila.grado) as Grado,
    revisarAntesDe,
    vencida: revisionVencida(revisarAntesDe, hoy),
    desglose: veDesglose
      ? {
          tipo: fila.tipo === "periodica" ? "periodica" : "alta",
          puntaje: Number(fila.puntaje),
          factores: (fila.factores ?? {}) as NonNullable<CalificacionLeida["desglose"]>["factores"],
          calificadaPor: String(fila.calificada_por),
          calificadaEl: String(fila.calificada_el),
        }
      : null,
  };
}

/** Lo que el archivo dice ser por sus primeros bytes, no por su nombre. */
function tipoDeContenido(bytes: Uint8Array): { tipo: string; extension: string } | null {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) {
    return { tipo: "application/pdf", extension: "pdf" };
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { tipo: "image/png", extension: "png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { tipo: "image/jpeg", extension: "jpg" };
  return null;
}

/**
 * Una identidad (el nombre de un representante o de un socio, la razón social) se coteja contra la Lista por
 * nombre (`lpb_normalizar`); para un extranjero sin RFC ni CURP es la única llave. Con un carácter invisible
 * (`INVISIBLE`: un control o uno de formato como U+200B) no se limpia ni se transforma: se rechaza en su campo con
 * su propio aviso (`invisible_<campo>`), como el renglón de la Lista, los proveedores y los
 * nombres de Personas. Borrado, pegaría dos palabras («PedroRuiz Sol») y la Lista ya no lo encontraría. Solo
 * se recortan los espacios de las orillas, como en el RFC o la CURP.
 */
function conInvisible(valor: unknown): boolean {
  return typeof valor === "string" && INVISIBLE.test(valor.trim());
}

/** Vacío → null; inválido → undefined; válido → el valor limpio. */
function opcional<T>(valor: unknown, validar: (texto: string) => T | null): T | null | undefined {
  if (valor === null || valor === undefined) return null;
  if (typeof valor !== "string") return undefined;
  const limpio = valor.trim();
  if (limpio.length === 0) return null;
  const validado = validar(limpio);
  return validado === null ? undefined : validado;
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.length > 0 ? valor : null;
}

function fecha(valor: unknown): Date {
  const salida = valor instanceof Date ? valor : new Date(String(valor));
  if (Number.isNaN(salida.getTime())) throw new ErrorDeDominio("base_no_disponible");
  return salida;
}
