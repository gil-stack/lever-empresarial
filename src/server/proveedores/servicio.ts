import { createHash, randomUUID } from "node:crypto";

import { clabeValida } from "../../dominio/clabe";
import {
  decidirPago,
  mensajeDeAlta,
  puedeDarDeAltaProveedor,
  puedeVerProveedores,
  razonNormalizada,
  rfcDeProveedor,
  validarConstancia,
} from "../../dominio/proveedores";
import { validarRfc } from "../../dominio/rfc";
import type { Consulta } from "../session/db";
import { ErrorDeDominio } from "../session/error-de-dominio";
import type { Sesion } from "../session/tipos";
import { registrarHechoProveedor, type HechoProveedor } from "./auditar";
import { almacenVercel, type AlmacenConstancia } from "./constancia";
import { repositorioPg } from "./repositorio";
import type { AltaGuardada, LecturaProveedores, RepositorioProveedores } from "./tipos";
import { leerListado69b } from "../../dominio/lista-69b";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Auditar = (evento: HechoProveedor, consulta: Consulta) => Promise<void>;

export type DependenciasProveedores = {
  repositorio?: RepositorioProveedores;
  ahora?: () => Date;
  almacen?: AlmacenConstancia;
  auditar?: Auditar;
};

export type EntradaAltaProveedor = {
  rfc: unknown;
  razonSocial: unknown;
  clabe: unknown;
  constancia: { nombre: string; bytes: Uint8Array } | null;
};

export function usuarioDeSesion(sesion: Sesion | null | undefined): string {
  const id = sesion?.usuario?.id;
  if (typeof id !== "string" || !UUID.test(id)) throw new ErrorDeDominio("sesion_ausente");
  return id;
}

export async function leerProveedores(
  sesion: Sesion | null | undefined,
  deps?: DependenciasProveedores,
): Promise<LecturaProveedores> {
  const userId = usuarioDeSesion(sesion);
  const repo = resolver(deps).repositorio;
  const lectura = await repo.leer(userId);
  if (!lectura) throw new ErrorDeDominio("sin_empresa");
  if (!puedeVerProveedores(lectura.rol)) throw new ErrorDeDominio("proveedores_no_disponibles");
  return lectura;
}

export async function darDeAltaProveedor(
  sesion: Sesion | null | undefined,
  entrada: EntradaAltaProveedor,
  deps?: DependenciasProveedores,
): Promise<AltaGuardada & { mensaje: string }> {
  const userId = usuarioDeSesion(sesion);
  const preparado = prepararEntrada(entrada);
  const listo = resolver(deps);
  const ahora = listo.ahora();
  const hash = createHash("sha256").update(preparado.bytes).digest("hex");
  let claveGuardada: string | null = null;

  try {
    const guardado = await listo.repositorio.conEmpresa(userId, async (ctx) => {
      if (!puedeDarDeAltaProveedor(ctx.rol)) throw new ErrorDeDominio("sin_permiso");
      if (await ctx.rfcOcupado(preparado.rfc)) throw new ErrorDeDominio("proveedor_duplicado");
      const lectura = await ctx.leerLista(preparado.rfc);
      const decision = decidirPago(lectura);
      const proveedorId = randomUUID();
      const documentoId = randomUUID();
      const propuesta = `${ctx.companyId}/constancias/${documentoId}`;
      const archivo = await listo.almacen.guardar({
        clave: propuesta,
        bytes: preparado.bytes,
        tipo: "application/pdf",
      });
      claveGuardada = archivo.clave;
      await ctx.insertarDocumento({
        id: documentoId,
        clave: archivo.clave,
        hash,
        tipo: "application/pdf",
        nombre: preparado.nombre,
        creadoEn: ahora,
      });
      await ctx.insertarProveedor({
        id: proveedorId,
        documentId: documentoId,
        snapshotId: lectura.snapshotId,
        rfc: preparado.rfc,
        razonSocial: preparado.razonSocial,
        situacion: decision.situacion,
        fechaArchivo: decision.fechaArchivo,
        leidaEn: ahora,
        botonPago: decision.botonPago,
        altaEn: ahora,
      });
      const clabeId = randomUUID();
      await ctx.insertarClabe({
        id: clabeId,
        supplierId: proveedorId,
        clabe: preparado.clabe,
        desde: ahora,
      });
      await auditar(listo.auditar, ctx.consulta, {
        companyId: ctx.companyId,
        actorId: userId,
        accion: "alta_proveedor",
        entidad: "suppliers",
        identificador: proveedorId,
        ocurridoEn: ahora,
      });
      await auditar(listo.auditar, ctx.consulta, {
        companyId: ctx.companyId,
        actorId: userId,
        accion: "clabe_proveedor",
        entidad: "supplier_clabes",
        identificador: clabeId,
        ocurridoEn: ahora,
      });
      return { id: proveedorId, decision };
    });
    return { ...guardado, mensaje: mensajeDeAlta(guardado.decision) };
  } catch (error) {
    if (claveGuardada) await listo.almacen.borrar(claveGuardada);
    if (error instanceof ErrorDeDominio && error.codigo === "rfc_duplicado") {
      throw new ErrorDeDominio("proveedor_duplicado");
    }
    throw error;
  }
}

/**
 * Guarda un snapshot del listado 69-B. No es una acción de la empresa:
 * un cliente no sube el archivo, porque un listado vacío abriría el pago.
 * No hay ruta que lo llame.
 */
export async function guardarListado69b(
  texto: string,
  deps?: DependenciasProveedores,
): Promise<{ filas: number; fechaArchivo: string }> {
  const leido = leerListado69b(texto);
  if (!leido.ok) throw new ErrorDeDominio(leido.codigo);
  const listo = resolver(deps);
  await listo.repositorio.guardarSnapshot({
    id: randomUUID(),
    fechaArchivo: leido.fechaArchivo,
    cargadoEn: listo.ahora(),
    filas: leido.filas,
  });
  return { filas: leido.filas.length, fechaArchivo: leido.fechaArchivo };
}

function prepararEntrada(entrada: EntradaAltaProveedor): {
  rfc: string;
  razonSocial: string;
  clabe: string;
  nombre: string;
  bytes: Uint8Array;
} {
  if (typeof entrada.rfc !== "string") throw new ErrorDeDominio("rfc_vacio");
  const motivo = validarRfc(entrada.rfc);
  if (motivo === "vacio") throw new ErrorDeDominio("rfc_vacio");
  if (motivo === "longitud") throw new ErrorDeDominio("rfc_longitud");
  if (motivo === "patron") throw new ErrorDeDominio("rfc_patron");
  if (motivo === "generico") throw new ErrorDeDominio("rfc_generico");
  const rfc = rfcDeProveedor(entrada.rfc);
  if (!rfc) throw new ErrorDeDominio("rfc_patron");

  if (typeof entrada.razonSocial !== "string") throw new ErrorDeDominio("razon_vacia");
  const razonSocial = razonNormalizada(entrada.razonSocial);
  const razon = errorDeRazon(razonSocial);
  if (razon) throw new ErrorDeDominio(razon);

  const clabe = clabeValida(entrada.clabe);
  if (!clabe.ok) throw new ErrorDeDominio("clabe_invalida");

  if (!entrada.constancia) throw new ErrorDeDominio("constancia_ausente");
  const constancia = validarConstancia(entrada.constancia);
  if (!constancia.ok) throw new ErrorDeDominio(constancia.codigo);

  return { rfc, razonSocial, clabe: clabe.clabe, nombre: constancia.nombre, bytes: constancia.bytes };
}

function errorDeRazon(razon: string): string | null {
  if (razon.length === 0) return "razon_vacia";
  if (/[\u0000-\u001F\u007F]/.test(razon)) return "razon_control";
  if (razon.length > 254) return "razon_larga";
  return null;
}

async function auditar(fn: Auditar, consulta: Consulta, evento: HechoProveedor): Promise<void> {
  try {
    await fn(evento, consultaSinCierre(consulta));
  } catch (error) {
    if (error instanceof ErrorDeDominio) throw error;
    throw new ErrorDeDominio("auditoria_no_disponible");
  }
}

function consultaSinCierre(consulta: Consulta): Consulta {
  return {
    async query(sql, params) {
      const verbo = (sql.trim().toLowerCase().split(/\s+/)[0] ?? "").replace(/;$/, "");
      if (verbo === "begin" || verbo === "commit" || verbo === "rollback" || verbo === "start") {
        throw new ErrorDeDominio("auditoria_no_disponible");
      }
      return consulta.query(sql, params);
    },
  };
}

function resolver(deps?: DependenciasProveedores): {
  repositorio: RepositorioProveedores;
  ahora: () => Date;
  almacen: AlmacenConstancia;
  auditar: Auditar;
} {
  return {
    repositorio: deps?.repositorio ?? repositorioPg(),
    ahora: deps?.ahora ?? (() => new Date()),
    almacen: deps?.almacen ?? almacenVercel(),
    auditar: deps?.auditar ?? registrarHechoProveedor,
  };
}
