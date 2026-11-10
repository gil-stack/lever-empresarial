import { createHash, randomUUID } from "node:crypto";

import { conciliar, type Decision } from "../../dominio/cobranza/conciliacion";
import {
  aplicarEmpate,
  BANCOS,
  esBanco,
  referenciaDeRenglon,
  sugerirEmpate,
  validarEmpate,
  type ClaveBanco,
  type Empate,
  type RenglonLeido,
} from "../../dominio/cobranza/estado-cuenta";
import { uuidValido } from "../../dominio/flujo/entradas";
import { fechaConAnio } from "../../dominio/flujo/fechas";
import { hoyEnMexico } from "../../dominio/personas";
import { baseCliente, exigir, puede, type ContextoDeTenant } from "../../nucleo/contexto";
import { aplicarSentencia, bloquearEmpresa, conContexto, type Consulta } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { actorDeCliente, auditar as auditarPorDefecto } from "../bitacora/auditar";
import { centavos, entero, registro, texto, textoONulo } from "../flujo/lectura";
import { recibirAbono } from "./abonos";
import { ErrorDeLectura, leerEstadoDeCuenta, type Tabla } from "./lector-estado-cuenta";
import { fechaDe, instanteONulo } from "./repositorio";
import { ErrorDeCaptura, type DependenciasCobranza } from "./servicio";

/**
 * Conciliación por estado de cuenta: la empresa sube el archivo de su banco,
 * empata las columnas una vez por banco, ve qué propone Lever para cada abono
 * y confirma. Las reglas son las mismas de `conciliar` (nunca se adivina). Cada
 * renglón lleva su huella: volver a subir el archivo no duplica nada.
 */

export type ArchivoSubido = { nombre: string; bytes: Uint8Array };

export type VistaPrevia = {
  banco: ClaveBanco;
  /** Los primeros renglones del archivo para elegir títulos y columnas. */
  renglones: string[][];
  columnas: number;
  sugerido: Empate | null;
  aviso: string | null;
};

export type ResultadoPreparar =
  | { tipo: "empatar"; vista: VistaPrevia }
  | { tipo: "importado"; importacionId: string; nuevos: number; repetidos: number; sinFecha: number; futuros: number }
  | { tipo: "sin_nuevos"; repetidos: number };

const RENGLONES_DE_MUESTRA = 15;

function hoyDe(deps?: DependenciasCobranza): string {
  return hoyEnMexico((deps?.ahora ?? (() => new Date()))());
}

function huella(clave: string): string {
  return createHash("sha256").update(clave).digest("hex");
}

/**
 * El mismo archivo (byte por byte) se importa una sola vez por empresa, con el
 * banco o el empate que sea (r63-N1). La base lo sostiene con UNIQUE (empresa,
 * huella del archivo); esto da el día de la importación para el aviso.
 */
async function diaDeImportacion(consulta: Consulta, empresaId: string, huellaArchivo: string): Promise<string | null> {
  const r = await aplicarSentencia(
    consulta,
    `select to_char(subido_en at time zone 'America/Mexico_City', 'YYYY-MM-DD') as dia
       from collection_statement_imports where company_id = $1 and huella_archivo = $2`,
    [empresaId, huellaArchivo],
  );
  return r.rows[0] ? texto(registro(r.rows[0]).dia) : null;
}

/** Se lanza fuera de la transacción: dentro, la base traduciría cualquier error a «base_no_disponible». */
function archivoYaImportado(dia: string): ErrorDeCaptura {
  return new ErrorDeCaptura([{ campo: "archivo", mensaje: `Ese archivo ya se importó el ${fechaConAnio(dia)}. Sus abonos ya están en la lista; no se volvieron a aplicar.` }]);
}

/**
 * La referencia de un abono del estado de cuenta: la de Lever si se reconoce y,
 * si no, el número corto tal como llegó, para que quede en «Por conciliar» como
 * referencia incompleta (r63-N2). Nunca se completa con ceros.
 */
function referenciaDelAbono(renglon: { referencia: string | null; concepto: string | null }): string | null {
  const corta = renglon.referencia?.trim() ?? "";
  return referenciaLever(renglon) ?? (/^[0-9]{1,7}$/.test(corta) ? corta : null);
}

/**
 * Lee el archivo y, si ya hay empate para ese banco (o la persona lo acaba de
 * escribir), lo importa. Si no, regresa la vista previa para empatar: el
 * archivo sigue en el formulario y se vuelve a enviar con el empate.
 */
export async function prepararEstadoDeCuenta(
  ctx: ContextoDeTenant | null | undefined,
  entrada: Record<string, unknown>,
  archivo: ArchivoSubido | null,
  deps?: DependenciasCobranza,
): Promise<ResultadoPreparar> {
  const c = exigir(ctx, "cliente.flujo.editar");
  const banco = esBanco(entrada.banco) ? entrada.banco : null;
  if (!banco) throw new ErrorDeCaptura([{ campo: "banco", mensaje: "Elige el banco del estado de cuenta." }]);
  if (!archivo || archivo.bytes.byteLength === 0) throw new ErrorDeCaptura([{ campo: "archivo", mensaje: "Elige el archivo del estado de cuenta (CSV o Excel)." }]);
  const nombre = archivo.nombre.replaceAll("\\", "/").split("/").pop()?.trim().slice(0, 180) || "estado-de-cuenta";
  const huellaArchivo = createHash("sha256").update(archivo.bytes).digest("hex");
  // Antes de leerlo: el mismo archivo ya importado se frena de entrada.
  const dia = await conContexto(baseCliente(c), (consulta) => diaDeImportacion(consulta, c.empresa.id, huellaArchivo));
  if (dia) throw archivoYaImportado(dia);
  let tabla: Tabla;
  try {
    tabla = leerEstadoDeCuenta(nombre, archivo.bytes);
  } catch (error) {
    if (error instanceof ErrorDeLectura) throw new ErrorDeCaptura([{ campo: "archivo", mensaje: error.mensaje }]);
    throw error;
  }
  const columnas = Math.max(...tabla.map((r) => r.length));
  const previa = (aviso: string | null, sugerido: Empate | null): ResultadoPreparar => ({
    tipo: "empatar",
    vista: {
      banco,
      renglones: tabla.slice(0, RENGLONES_DE_MUESTRA).map((r) => Array.from({ length: columnas }, (_, i) => (r[i] === null || r[i] === undefined ? "" : String(r[i])))),
      columnas,
      sugerido,
      aviso,
    },
  });
  // El empate que escribió la persona manda; si no hay, el guardado del banco.
  let empate: Empate | null = null;
  let escrito = false;
  if (entrada.empatar === "si") {
    const valido = validarEmpate(entrada, columnas, tabla.length);
    if ("error" in valido) throw new ErrorDeCaptura([{ campo: valido.campo, mensaje: valido.error }]);
    empate = valido;
    escrito = true;
  } else {
    empate = await conContexto(baseCliente(c), (consulta) => empateGuardado(consulta, c.empresa.id, banco));
    if (!empate) return previa(null, sugerirEmpate(tabla));
    if (empate.filaEncabezado >= tabla.length || Math.max(empate.columnas.fecha, empate.columnas.abono) >= columnas) {
      return previa("El archivo no tiene la forma del empate que guardaste para este banco. Revisa las columnas.", empate);
    }
  }
  const lectura = aplicarEmpate(tabla, empate, hoyDe(deps));
  if (lectura.abonos.length === 0) {
    if (escrito) {
      throw new ErrorDeCaptura([{ campo: "columnaAbono", mensaje: "Con ese empate no encontramos abonos con fecha y monto. Revisa la columna de la fecha y la del abono." }]);
    }
    return previa("Con el empate guardado no encontramos abonos en este archivo. Revisa las columnas.", empate);
  }
  const auditar = deps?.auditar ?? auditarPorDefecto;
  const actor = actorDeCliente(c);
  const resultado = await conContexto(baseCliente(c), async (consulta) => {
    await bloquearEmpresa(consulta, c.empresa.id);
    // Otra vez con la empresa bloqueada: dos subidas del mismo archivo a la vez, la segunda ya ve la primera.
    const diaPrevio = await diaDeImportacion(consulta, c.empresa.id, huellaArchivo);
    if (diaPrevio) return { tipo: "ya_importado" as const, dia: diaPrevio };
    if (escrito) {
      const previo = await empateGuardado(consulta, c.empresa.id, banco);
      if (!previo || JSON.stringify(previo) !== JSON.stringify(empate)) {
        await aplicarSentencia(
          consulta,
          `insert into collection_statement_mappings (company_id, banco, columnas, fila_encabezado, actualizado_por)
           values ($1, $2, $3::jsonb, $4, $5)
           on conflict (company_id, banco) do update set columnas = excluded.columnas, fila_encabezado = excluded.fila_encabezado,
             actualizado_por = excluded.actualizado_por, actualizado_en = now()`,
          [c.empresa.id, banco, JSON.stringify(empate!.columnas), empate!.filaEncabezado, c.persona.id],
        );
        await auditar(consulta, actor, { accion: "empate_estado_cuenta", identificador: c.empresa.id, cambio: { banco, fila_encabezado: empate!.filaEncabezado } });
      }
    }
    const conHuella = lectura.abonos.map((a) => ({ ...a, huella: huella(a.clave) }));
    const existentes = new Set((await aplicarSentencia(
      consulta,
      "select huella from collection_statement_rows where company_id = $1 and huella = any($2::text[])",
      [c.empresa.id, conHuella.map((a) => a.huella)],
    )).rows.map(registro).map((f) => texto(f.huella)));
    const nuevos = conHuella.filter((a) => !existentes.has(a.huella));
    if (nuevos.length === 0) return { tipo: "sin_nuevos" as const, repetidos: conHuella.length };
    const importacionId = randomUUID();
    await aplicarSentencia(
      consulta,
      `insert into collection_statement_imports (id, company_id, banco, nombre_archivo, huella_archivo, renglones, abonos, nuevos, subido_por)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [importacionId, c.empresa.id, banco, nombre, huellaArchivo, Math.min(lectura.renglones, 5000), conHuella.length, nuevos.length, c.persona.id],
    );
    await auditar(consulta, actor, {
      accion: "importar_estado_cuenta",
      identificador: importacionId,
      cambio: { banco, renglones: lectura.renglones, abonos: conHuella.length, nuevos: nuevos.length },
    });
    for (const a of nuevos) {
      const id = randomUUID();
      await aplicarSentencia(
        consulta,
        `insert into collection_statement_rows (id, company_id, import_id, huella, fecha, monto_centavos, concepto, referencia, clave_rastreo)
         values ($1, $2, $3, $4, $5::date, $6, $7, $8, $9)`,
        [id, c.empresa.id, importacionId, a.huella, a.fecha, a.montoCentavos, a.concepto, a.referencia, a.rastreo],
      );
      await auditar(consulta, actor, { accion: "renglon_estado_cuenta", identificador: id, cambio: { estado: "pendiente" } });
    }
    return { tipo: "importado" as const, importacionId, nuevos: nuevos.length, repetidos: conHuella.length - nuevos.length, sinFecha: lectura.sinFecha, futuros: lectura.futuros };
  });
  if (resultado.tipo === "ya_importado") throw archivoYaImportado(resultado.dia);
  return resultado;
}

async function empateGuardado(consulta: Consulta, empresaId: string, banco: ClaveBanco): Promise<Empate | null> {
  const r = await aplicarSentencia(
    consulta,
    "select columnas, fila_encabezado from collection_statement_mappings where company_id = $1 and banco = $2",
    [empresaId, banco],
  );
  const f = r.rows[0] ? registro(r.rows[0]) : null;
  if (!f) return null;
  const col = registro(f.columnas);
  const n = (v: unknown) => (typeof v === "number" ? v : null);
  const fecha = n(col.fecha);
  const abono = n(col.abono);
  if (fecha === null || abono === null) return null;
  return { filaEncabezado: entero(f.fila_encabezado), columnas: { fecha, abono, concepto: n(col.concepto), referencia: n(col.referencia), rastreo: n(col.rastreo) } };
}

// Propuestas ---------------------------------------------------------------------------

export type Propuesta =
  | { tipo: "aplicar"; cargoId: string; cliente: string; concepto: string; montoCentavos: number; motivo: Decision["motivo"] }
  | { tipo: "ya_registrado"; pagoId: string }
  | { tipo: "por_conciliar"; cliente: string | null; motivo: Decision["motivo"]; sugerencias: { cargoId: string; cliente: string; concepto: string; saldoCentavos: number; referencia: string }[] };

export type RenglonVista = {
  id: string;
  fecha: string;
  montoCentavos: number;
  concepto: string | null;
  referencia: string | null;
  rastreo: string | null;
  estado: "pendiente" | "aplicado" | "por_conciliar" | "ya_registrado" | "descartado";
  propuesta: Propuesta | null;
};

export type ImportacionVista = {
  id: string;
  banco: ClaveBanco;
  nombreArchivo: string;
  abonos: number;
  nuevos: number;
  estado: "propuesta" | "confirmada";
  subidoEn: string;
  subidoPor: string | null;
};

export type VistaEstadoDeCuenta = {
  bancos: typeof BANCOS;
  bancosConEmpate: ClaveBanco[];
  importaciones: ImportacionVista[];
  actual: (ImportacionVista & { renglones: RenglonVista[] }) | null;
  puedeEditar: boolean;
};

function referenciaLever(renglon: { referencia: string | null; concepto: string | null }): string | null {
  return referenciaDeRenglon(renglon.referencia, renglon.concepto);
}

/**
 * Lo que Lever propone para cada renglón pendiente, en lote: la misma regla que
 * aplicará `recibirAbono` al confirmar (referencia, clave de rastreo ya vista),
 * con sugerencias de cargos del mismo saldo cuando no hay coincidencia segura.
 */
async function proponer(consulta: Consulta, empresaId: string, renglones: { id: string; montoCentavos: number; referencia: string | null; concepto: string | null; rastreo: string | null }[]): Promise<Map<string, Propuesta>> {
  const refs = new Map(renglones.map((r) => [r.id, referenciaLever(r)]));
  const cargos = new Map((await aplicarSentencia(
    consulta,
    `select c.id, c.customer_id, k.nombre, c.concepto, c.referencia, c.estado, (coalesce(c.monto_centavos, 0) - c.pagado_centavos)::text as saldo
       from collection_charges c join collection_customers k on k.id = c.customer_id and k.company_id = c.company_id
      where c.company_id = $1 and c.referencia = any($2::text[])`,
    [empresaId, [...new Set([...refs.values()].filter((r): r is string => r !== null))]],
  )).rows.map(registro).map((f) => [texto(f.referencia), f] as const));
  const rastreos = new Map((await aplicarSentencia(
    consulta,
    "select upper(clave_rastreo) as rastreo, id from collection_payments where company_id = $1 and estado not in ('anulado', 'devuelto') and upper(clave_rastreo) = any($2::text[])",
    [empresaId, renglones.map((r) => r.rastreo).filter((r): r is string => r !== null)],
  )).rows.map(registro).map((f) => [texto(f.rastreo), texto(f.id)] as const));
  const abiertos = (await aplicarSentencia(
    consulta,
    `select c.id, k.nombre, c.concepto, c.referencia, (c.monto_centavos - c.pagado_centavos)::text as saldo
       from collection_charges c join collection_customers k on k.id = c.customer_id and k.company_id = c.company_id
      where c.company_id = $1 and c.estado = 'emitido' order by c.vencimiento limit 2000`,
    [empresaId],
  )).rows.map(registro).map((f) => ({ cargoId: texto(f.id), cliente: texto(f.nombre), concepto: texto(f.concepto), saldoCentavos: centavos(f.saldo), referencia: texto(f.referencia) }));
  const propuestas = new Map<string, Propuesta>();
  for (const r of renglones) {
    const pagoPrevio = r.rastreo ? rastreos.get(r.rastreo.toUpperCase()) : undefined;
    if (pagoPrevio) {
      propuestas.set(r.id, { tipo: "ya_registrado", pagoId: pagoPrevio });
      continue;
    }
    const ref = refs.get(r.id) ?? null;
    const f = ref ? cargos.get(ref) : undefined;
    const decision = conciliar({ montoCentavos: r.montoCentavos, referencia: ref ?? referenciaDelAbono(r), clabeOrdenante: null }, {
      rastreoYaRegistrado: false,
      clienteDeLaCuenta: null,
      cargoDeLaReferencia: f ? { id: texto(f.id), clienteId: texto(f.customer_id), estado: texto(f.estado) as "emitido", saldoCentavos: centavos(f.saldo) } : null,
      clientesDeLaClabe: [],
      cargosAbiertosDelCliente: [],
    });
    if (decision.aplicacion && f) {
      propuestas.set(r.id, { tipo: "aplicar", cargoId: decision.aplicacion.cargoId, cliente: texto(f.nombre), concepto: texto(f.concepto), montoCentavos: decision.aplicacion.montoCentavos, motivo: decision.motivo });
    } else {
      propuestas.set(r.id, {
        tipo: "por_conciliar",
        cliente: f ? texto(f.nombre) : null,
        motivo: decision.motivo,
        sugerencias: abiertos.filter((a) => a.saldoCentavos === r.montoCentavos).slice(0, 3),
      });
    }
  }
  return propuestas;
}

export async function leerVistaEstadoDeCuenta(ctx: ContextoDeTenant | null | undefined, importacionId: unknown): Promise<VistaEstadoDeCuenta> {
  const c = exigir(ctx, "cliente.flujo.ver");
  return conContexto(baseCliente(c), async (consulta) => {
    const importaciones = (await aplicarSentencia(
      consulta,
      `select i.id, i.banco, i.nombre_archivo, i.abonos, i.nuevos, i.estado, i.subido_en, u.nombre as autor
         from collection_statement_imports i left join users u on u.id = i.subido_por
        where i.company_id = $1 order by i.subido_en desc, i.id limit 12`,
      [c.empresa.id],
    )).rows.map(registro).map((f): ImportacionVista => ({
      id: texto(f.id),
      banco: esBanco(f.banco) ? f.banco : "otro",
      nombreArchivo: texto(f.nombre_archivo),
      abonos: entero(f.abonos),
      nuevos: entero(f.nuevos),
      estado: f.estado === "confirmada" ? "confirmada" : "propuesta",
      subidoEn: instanteONulo(f.subido_en) ?? "",
      subidoPor: textoONulo(f.autor),
    }));
    const elegida = uuidValido(importacionId)
      ? importaciones.find((i) => i.id === importacionId.toLowerCase())
      : importaciones.find((i) => i.estado === "propuesta");
    let actual: VistaEstadoDeCuenta["actual"] = null;
    if (elegida) {
      const filas = (await aplicarSentencia(
        consulta,
        `select id, fecha, monto_centavos::text as monto, concepto, referencia, clave_rastreo, estado
           from collection_statement_rows where company_id = $1 and import_id = $2 order by fecha, id`,
        [c.empresa.id, elegida.id],
      )).rows.map(registro).map((f) => ({
        id: texto(f.id),
        fecha: fechaDe(f.fecha),
        montoCentavos: centavos(f.monto),
        concepto: textoONulo(f.concepto),
        referencia: textoONulo(f.referencia),
        rastreo: textoONulo(f.clave_rastreo),
        estado: texto(f.estado) as RenglonVista["estado"],
      }));
      const propuestas = await proponer(consulta, c.empresa.id, filas.filter((f) => f.estado === "pendiente"));
      actual = { ...elegida, renglones: filas.map((f) => ({ ...f, propuesta: propuestas.get(f.id) ?? null })) };
    }
    const conEmpate = (await aplicarSentencia(consulta, "select banco from collection_statement_mappings where company_id = $1", [c.empresa.id]))
      .rows.map(registro).map((f) => texto(f.banco)).filter(esBanco);
    return { bancos: BANCOS, bancosConEmpate: conEmpate, importaciones, actual, puedeEditar: puede(c, "cliente.flujo.editar") };
  });
}

export type ResultadoConfirmar = { aplicados: number; porConciliar: number; yaRegistrados: number; descartados: number };

/**
 * Confirma la importación: cada renglón pendiente se vuelve un pago (fuente
 * estado_cuenta, id externo = su huella) que `recibirAbono` concilia con las
 * reglas de siempre; el que ya estaba registrado (misma clave de rastreo) se
 * reconoce; el que la persona marcó, se descarta. Todo en una transacción.
 */
export async function confirmarEstadoDeCuenta(
  ctx: ContextoDeTenant | null | undefined,
  entrada: { importacionId: unknown; descartar: readonly unknown[] },
  deps?: DependenciasCobranza,
): Promise<ResultadoConfirmar> {
  const c = exigir(ctx, "cliente.flujo.editar");
  if (!uuidValido(entrada.importacionId)) throw new ErrorDeDominio("importacion_ausente");
  const importacionId = entrada.importacionId.toLowerCase();
  const descartar = new Set(entrada.descartar.filter(uuidValido).map((d) => d.toLowerCase()));
  const auditar = deps?.auditar ?? auditarPorDefecto;
  const actor = actorDeCliente(c);
  return conContexto(baseCliente(c), async (consulta) => {
    await bloquearEmpresa(consulta, c.empresa.id);
    const imp = await aplicarSentencia(
      consulta,
      "select estado from collection_statement_imports where company_id = $1 and id = $2 for update",
      [c.empresa.id, importacionId],
    );
    const fila = imp.rows[0] ? registro(imp.rows[0]) : null;
    if (!fila) throw new ErrorDeDominio("importacion_ausente");
    if (fila.estado !== "propuesta") throw new ErrorDeDominio("importacion_ya_confirmada");
    const renglones = (await aplicarSentencia(
      consulta,
      `select id, huella, fecha, monto_centavos::text as monto, concepto, referencia, clave_rastreo
         from collection_statement_rows where company_id = $1 and import_id = $2 and estado = 'pendiente' order by fecha, id for update`,
      [c.empresa.id, importacionId],
    )).rows.map(registro);
    const resultado: ResultadoConfirmar = { aplicados: 0, porConciliar: 0, yaRegistrados: 0, descartados: 0 };
    for (const r of renglones) {
      const id = texto(r.id);
      const rastreo = textoONulo(r.clave_rastreo);
      let estado: "aplicado" | "por_conciliar" | "ya_registrado" | "descartado";
      let pagoId: string | null = null;
      if (descartar.has(id)) {
        estado = "descartado";
      } else {
        const previo = rastreo ? (await aplicarSentencia(
          consulta,
          "select id from collection_payments where company_id = $1 and upper(clave_rastreo) = upper($2) and estado not in ('anulado', 'devuelto') limit 1",
          [c.empresa.id, rastreo],
        )).rows[0] : undefined;
        if (previo) {
          estado = "ya_registrado";
          pagoId = texto(registro(previo).id);
        } else {
          const ref = referenciaDelAbono({ referencia: textoONulo(r.referencia), concepto: textoONulo(r.concepto) });
          const recibido = await recibirAbono(consulta, actor, auditar, "estado_cuenta", {
            idExterno: `edc:${texto(r.huella)}`,
            montoCentavos: centavos(r.monto),
            recibidoEl: fechaDe(r.fecha),
            claveRastreo: rastreo,
            referencia: ref,
            clabeOrdenante: null,
            nombreOrdenante: null,
            clienteDeLaCuenta: null,
          });
          pagoId = recibido.pagoId;
          estado = recibido.decision?.aplicacion ? "aplicado" : "por_conciliar";
        }
      }
      await aplicarSentencia(
        consulta,
        "update collection_statement_rows set estado = $3, payment_id = $4, resuelto_por = $5, resuelto_en = now() where company_id = $1 and id = $2",
        [c.empresa.id, id, estado, pagoId, c.persona.id],
      );
      await auditar(consulta, actor, { accion: "renglon_estado_cuenta", identificador: id, cambio: { estado } });
      if (estado === "aplicado") resultado.aplicados += 1;
      else if (estado === "por_conciliar") resultado.porConciliar += 1;
      else if (estado === "ya_registrado") resultado.yaRegistrados += 1;
      else resultado.descartados += 1;
    }
    await aplicarSentencia(
      consulta,
      "update collection_statement_imports set estado = 'confirmada', confirmado_por = $3, confirmado_en = now() where company_id = $1 and id = $2",
      [c.empresa.id, importacionId, c.persona.id],
    );
    await auditar(consulta, actor, {
      accion: "confirmar_estado_cuenta",
      identificador: importacionId,
      cambio: { aplicados: resultado.aplicados, por_conciliar: resultado.porConciliar, ya_registrados: resultado.yaRegistrados, descartados: resultado.descartados },
    });
    return resultado;
  });
}

export type { RenglonLeido };
