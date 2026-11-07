import { randomUUID } from "node:crypto";

import { hoyEnMexico } from "../../src/dominio/operacion/comisiones.ts";
import type { ContextoDePersonal } from "../../src/nucleo/contexto.ts";
import {
  agregarAccionista,
  agregarRepresentante,
  calificarRiesgoEmpresa,
  cargarDocumento,
  crearVersion,
  dictaminarVersion,
  enviarVersion,
  guardarDatosGenerales,
  leerExpediente,
} from "../../src/server/operacion/expediente.ts";
import type { AlmacenConstancia } from "../../src/server/proveedores/constancia.ts";

export const SESION_SOFIPO = { superficie: "sofipo" as const, segundoFactor: { metodo: "totp" as const, en: new Date() } };

/** Contexto del personal con sus roles de plataforma: las capacidades salen de ahí (permisos.ts). */
export function personal(operadorId: string, userId: string, roles: ContextoDePersonal["personal"]["roles"]): ContextoDePersonal {
  return {
    sesionId: randomUUID(), peticionId: null, superficie: "sofipo",
    persona: { id: userId, nombre: userId, correo: `${userId}@ejemplo.mx` }, segundoFactor: "totp",
    empresa: null, roles: [], personal: { operadorId, roles }, empresas: [], capacidades: [],
  };
}

/** Blob en memoria: guarda lo subido y nunca borra, como la app. */
export function almacenEnMemoria(): AlmacenConstancia & { guardados: Map<string, Uint8Array>; borrados: string[] } {
  const guardados = new Map<string, Uint8Array>();
  const borrados: string[] = [];
  return {
    guardados,
    borrados,
    async guardar({ clave, bytes }) {
      guardados.set(clave, bytes);
      return { clave };
    },
    async borrar(clave) {
      borrados.push(clave);
    },
  };
}

export const PDF = new TextEncoder().encode(`%PDF-1.4\n% expediente de prueba\n${"0".repeat(80)}\n%%EOF\n`);

export const DATOS_GENERALES = {
  giro: "Distribución de abarrotes",
  nacionalidad: "Mexicana",
  serieEfirma: "00001000000500000001",
  domicilioCalle: "Av. Reforma",
  domicilioExterior: "100",
  domicilioInterior: "",
  domicilioColonia: "Juárez",
  domicilioMunicipio: "Cuauhtémoc",
  domicilioEntidad: "Ciudad de México",
  domicilioCodigoPostal: "06600",
  domicilioPais: "México",
  telefono: "5512345678",
  correo: "contacto@empresa.mx",
  fechaConstitucion: "2015-03-01",
  volumenMensualCentavos: "100000",
};

export type SocioDePrueba = {
  nombre: string;
  tipoPersona: "fisica" | "moral";
  rfc?: string;
  curp?: string;
  capital: string;
  votos: string;
  pep?: "no" | "nacional" | "extranjera";
  hijos?: SocioDePrueba[];
};

export const SOCIO_UNICO: SocioDePrueba[] = [
  { nombre: "Laura Gómez Ruiz", tipoPersona: "fisica", rfc: "GORL750505QW1", curp: "GORL750505MDFMZR04", capital: "100", votos: "100" },
];

/**
 * Arma una versión del expediente por el camino del servidor: datos, un administrador
 * con su identificación, socios (en capas si traen hijos) y los cinco documentos de la 4ª fr. II.
 * Devuelve el borrador listo para enviar.
 */
export async function armarBorrador(
  origina: ContextoDePersonal,
  entrada: { companyId: string; razonSocial: string; rfc: string; socios?: SocioDePrueba[]; almacen?: AlmacenConstancia },
): Promise<{ versionId: string; representanteClave: string }> {
  const versionId = randomUUID();
  await crearVersion(origina, { companyId: entrada.companyId, formId: versionId });
  await guardarDatosGenerales(origina, { versionId, datos: { ...DATOS_GENERALES, razonSocial: entrada.razonSocial, rfc: entrada.rfc } });
  await agregarRepresentante(origina, {
    versionId, formId: randomUUID(), nombre: "Rosa Pérez Ríos", rfc: "PERR800101AB1", curp: "PERR800101MDFRSS09",
    cargo: "administrador_unico", esAdministrador: true, designadoPor: "Asamblea constitutiva", pep: "no",
  });
  const agregar = async (socios: SocioDePrueba[], padreClave: string | null): Promise<void> => {
    for (const socio of socios) {
      const id = randomUUID();
      await agregarAccionista(origina, {
        versionId, formId: id, padreClave: padreClave ?? "", tipoPersona: socio.tipoPersona, nombre: socio.nombre,
        rfc: socio.rfc ?? "", curp: socio.curp ?? "", nacionalidad: "Mexicana", capital: socio.capital, votos: socio.votos,
        controlOtrosMedios: false, pep: socio.pep ?? "no",
      });
      if (socio.hijos?.length) {
        const leido = await leerExpediente(origina, entrada.companyId);
        const clave = leido?.borrador?.accionistas.find((a) => a.id === id)?.clave;
        if (!clave) throw new Error("El accionista recién agregado no aparece en el borrador.");
        await agregar(socio.hijos, clave);
      }
    }
  };
  await agregar(entrada.socios ?? SOCIO_UNICO, null);
  const leido = await leerExpediente(origina, entrada.companyId);
  const representanteClave = leido?.borrador?.representantes[0]?.clave;
  if (!representanteClave) throw new Error("El representante recién agregado no aparece en el borrador.");
  const hoy = hoyEnMexico(new Date());
  const almacen = entrada.almacen ?? almacenEnMemoria();
  const documentos: Array<{ tipo: string; emitidoEl?: string; vigenteHasta?: string; detalle?: string; representanteClave?: string }> = [
    { tipo: "acta_constitutiva", detalle: "Folio mercantil 12345" },
    { tipo: "constancia_situacion_fiscal", emitidoEl: hoy },
    { tipo: "certificado_efirma" },
    { tipo: "comprobante_domicilio", emitidoEl: hoy },
    { tipo: "declaracion_propietarios", emitidoEl: hoy },
    { tipo: "identificacion_representante", vigenteHasta: "2031-12-31", representanteClave },
  ];
  for (const documento of documentos) {
    await cargarDocumento(origina, {
      versionId, formId: randomUUID(), tipo: documento.tipo, representanteClave: documento.representanteClave ?? "",
      emitidoEl: documento.emitidoEl ?? "", vigenteHasta: documento.vigenteHasta ?? "", detalle: documento.detalle ?? "",
      archivo: { nombre: `${documento.tipo}.pdf`, bytes: PDF },
    }, { almacen });
  }
  return { versionId, representanteClave };
}

/** Expediente enviado, aprobado por otra persona y con grado de riesgo vigente: lo que pide el candado. */
export async function expedienteEnRegla(
  origina: ContextoDePersonal,
  cumple: ContextoDePersonal,
  entrada: { companyId: string; razonSocial: string; rfc: string; socios?: SocioDePrueba[] },
): Promise<{ versionId: string }> {
  const { versionId } = await armarBorrador(origina, entrada);
  await enviarVersion(origina, versionId);
  await dictaminarVersion(cumple, SESION_SOFIPO, { versionId, formId: randomUUID(), resultado: "aprobado", motivo: "" });
  await calificarRiesgoEmpresa(cumple, { companyId: entrada.companyId, formId: randomUUID(), actividad: "baja", zona: "baja" });
  return { versionId };
}
