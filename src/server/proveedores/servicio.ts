import { createHash, randomUUID } from "node:crypto";

import { clabeValida } from "../../dominio/clabe";
import {
  decidirPago,
  mensajeDeAlta,
  razonNormalizada,
  rfcDeProveedor,
  validarConstancia,
} from "../../dominio/proveedores";
import { validarRfc } from "../../dominio/rfc";
import { exigir, exigirEmpresa, puede, type ContextoDeTenant } from "../../nucleo/contexto";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { actorDeCliente, auditar as auditarPorDefecto, type Auditar } from "../bitacora/auditar";
import { almacenVercel, type AlmacenConstancia } from "./constancia";
import { repositorioPg } from "./repositorio";
import type { AltaGuardada, LecturaProveedores, RepositorioProveedores } from "./tipos";

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

export async function leerProveedores(
  ctx: ContextoDeTenant | null | undefined,
  deps?: DependenciasProveedores,
): Promise<LecturaProveedores> {
  const conEmpresa = exigirEmpresa(ctx);
  if (!puede(conEmpresa, "cliente.proveedores.ver")) throw new ErrorDeDominio("proveedores_no_disponibles");
  return resolver(deps).repositorio.leer(conEmpresa);
}

export async function darDeAltaProveedor(
  ctx: ContextoDeTenant | null | undefined,
  entrada: EntradaAltaProveedor,
  deps?: DependenciasProveedores,
): Promise<AltaGuardada & { mensaje: string }> {
  const preparado = prepararEntrada(entrada);
  const conEmpresa = exigir(ctx, "cliente.proveedores.alta");
  const actor = actorDeCliente(conEmpresa);
  const listo = resolver(deps);
  const ahora = listo.ahora();
  const hash = createHash("sha256").update(preparado.bytes).digest("hex");
  let claveGuardada: string | null = null;

  try {
    const guardado = await listo.repositorio.conEmpresa(conEmpresa, async (ctx) => {
      if (await ctx.rfcOcupado(preparado.rfc)) throw new ErrorDeDominio("proveedor_duplicado");
      const lectura = await ctx.leerLista(preparado.rfc);
      const decision = decidirPago(lectura);
      const proveedorId = randomUUID();
      const documentoId = randomUUID();
      const propuesta = `${conEmpresa.empresa.operadorId}/${ctx.companyId}/constancias/${documentoId}`;
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
      await listo.auditar(ctx.consulta, actor, { accion: "alta_proveedor", identificador: proveedorId });
      await listo.auditar(ctx.consulta, actor, { accion: "clabe_proveedor", identificador: clabeId });
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
    auditar: deps?.auditar ?? auditarPorDefecto,
  };
}
