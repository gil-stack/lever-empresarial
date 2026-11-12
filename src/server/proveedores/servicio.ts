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
import { correoOpcional, fechaValida, textoPago } from "../../dominio/pagos-proveedores";
import { exigir, exigirEmpresa, puede, type ContextoDeTenant } from "../../nucleo/contexto";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { actorDeCliente, auditar as auditarPorDefecto, type Auditar } from "../bitacora/auditar";
import { almacenVercel, type AlmacenConstancia } from "./constancia";
import { repositorioPg } from "./repositorio";
import type { AltaGuardada, LecturaProveedores, RepositorioProveedores } from "./tipos";
import { INVISIBLE } from "../../dominio/control";

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
  nombreComercial?: unknown;
  contactoCorreo?: unknown;
  diasCredito?: unknown;
  contrato?: { nombre: string; bytes: Uint8Array } | null;
  contratoDesde?: unknown;
  contratoHasta?: unknown;
  /** Área opcional del proveedor (flujo de caja): sus pagos suman al presupuesto de esa área. */
  areaId?: unknown;
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
  const conEmpresa = exigir(ctx, "cliente.proveedores.alta");
  const preparado = prepararEntrada(entrada);
  const actor = actorDeCliente(conEmpresa);
  const listo = resolver(deps);
  const ahora = listo.ahora();
  const hash = createHash("sha256").update(preparado.bytes).digest("hex");
  const clavesGuardadas: string[] = [];

  const proveedorId = randomUUID();
  const documentoId = randomUUID();
  const contratoId = randomUUID();
  const carpeta = `${conEmpresa.empresa.operadorId}/${conEmpresa.empresa.id}`;

  try {
    // Lectura previa: un RFC ya dado de alta no sube archivos.
    if (await listo.repositorio.conEmpresa(conEmpresa, (ctx) => ctx.rfcOcupado(preparado.rfc))) {
      throw new ErrorDeDominio("proveedor_duplicado");
    }
    // Los archivos suben antes de abrir la transacción con candado de la empresa.
    const archivo = await listo.almacen.guardar({
      clave: `${carpeta}/constancias/${documentoId}`,
      bytes: preparado.bytes,
      tipo: "application/pdf",
    });
    clavesGuardadas.push(archivo.clave);
    const contrato = preparado.contrato
      ? await listo.almacen.guardar({
        clave: `${carpeta}/proveedores/${proveedorId}/contratos/${contratoId}`,
        bytes: preparado.contrato.bytes,
        tipo: "application/pdf",
      })
      : null;
    if (contrato) clavesGuardadas.push(contrato.clave);

    const guardado = await listo.repositorio.conEmpresa(conEmpresa, async (ctx) => {
      if (await ctx.rfcOcupado(preparado.rfc)) throw new ErrorDeDominio("proveedor_duplicado");
      const lectura = await ctx.leerLista(preparado.rfc);
      const decision = decidirPago(lectura);
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
        nombreComercial: preparado.nombreComercial,
        contactoCorreo: preparado.contactoCorreo,
        diasCredito: preparado.diasCredito,
        costCenterId: preparado.areaId,
        altaEn: ahora,
      });
      const clabeId = randomUUID();
      await ctx.insertarClabe({
        id: clabeId,
        supplierId: proveedorId,
        clabe: preparado.clabe,
        desde: ahora,
      });
      // El área inicial queda en el evento del alta, por nombre (quien da de alta puede elegirla).
      const area = preparado.areaId ? await ctx.nombreDeArea(preparado.areaId) : null;
      if (preparado.areaId && area === null) throw new ErrorDeDominio("area_ajena");
      await listo.auditar(ctx.consulta, actor, {
        accion: "alta_proveedor",
        identificador: proveedorId,
        ...(area ? { cambio: { area } } : {}),
      });
      await listo.auditar(ctx.consulta, actor, { accion: "clabe_proveedor", identificador: clabeId });
      if (contrato && preparado.contrato) {
        await ctx.insertarDocumento({
          id: contratoId,
          clave: contrato.clave,
          hash: createHash("sha256").update(preparado.contrato.bytes).digest("hex"),
          tipo: "application/pdf",
          nombre: preparado.contrato.nombre,
          creadoEn: ahora,
        });
        await ctx.vincularContrato(contratoId, proveedorId, preparado.contratoDesde, preparado.contratoHasta, ahora);
        await listo.auditar(ctx.consulta, actor, {
          accion: "documento_proveedor", identificador: contratoId, cambio: { tipo: "contrato" },
        });
      }
      return { id: proveedorId, decision };
    });
    return { ...guardado, mensaje: mensajeDeAlta(guardado.decision) };
  } catch (error) {
    for (const clave of clavesGuardadas) await listo.almacen.borrar(clave);
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
  nombreComercial: string | null;
  contactoCorreo: string | null;
  diasCredito: number;
  contrato: { nombre: string; bytes: Uint8Array } | null;
  contratoDesde: string | null;
  contratoHasta: string | null;
  areaId: string | null;
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

  const nombreComercial = entrada.nombreComercial === undefined || entrada.nombreComercial === ""
    ? null
    : textoPago(entrada.nombreComercial, 180);
  if (entrada.nombreComercial && !nombreComercial) throw new ErrorDeDominio("nombre_comercial_invalido");
  const correo = correoOpcional(entrada.contactoCorreo);
  if (correo === "invalido") throw new ErrorDeDominio("contacto_correo_invalido");
  const diasCredito = entrada.diasCredito === undefined || entrada.diasCredito === "" ? 30 : Number(entrada.diasCredito);
  if (!Number.isInteger(diasCredito) || diasCredito < 0 || diasCredito > 365) throw new ErrorDeDominio("dias_credito_invalido");
  const contratoDesde = entrada.contratoDesde ? String(entrada.contratoDesde) : null;
  const contratoHasta = entrada.contratoHasta ? String(entrada.contratoHasta) : null;
  if ((contratoDesde && !fechaValida(contratoDesde)) || (contratoHasta && !fechaValida(contratoHasta)) ||
    (contratoDesde && contratoHasta && contratoHasta < contratoDesde)) throw new ErrorDeDominio("fecha_invalida");
  let contrato: { nombre: string; bytes: Uint8Array } | null = null;
  if (entrada.contrato) {
    const validado = validarConstancia(entrada.contrato);
    if (!validado.ok) throw new ErrorDeDominio(validado.codigo);
    contrato = { nombre: validado.nombre, bytes: validado.bytes };
  }

  return {
    rfc, razonSocial, clabe: clabe.clabe, nombre: constancia.nombre, bytes: constancia.bytes,
    nombreComercial, contactoCorreo: correo, diasCredito, contrato, contratoDesde, contratoHasta, areaId: areaDeAlta(entrada.areaId),
  };
}

/** Vacío es «sin área». El área tiene que ser de la empresa: la llave (área, empresa) lo exige en la base. */
function areaDeAlta(valor: unknown): string | null {
  if (valor === undefined || valor === null || valor === "") return null;
  if (typeof valor !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor)) {
    throw new ErrorDeDominio("area_ajena");
  }
  return valor.toLowerCase();
}

function errorDeRazon(razon: string): string | null {
  if (razon.length === 0) return "razon_vacia";
  if (INVISIBLE.test(razon)) return "razon_control";
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
