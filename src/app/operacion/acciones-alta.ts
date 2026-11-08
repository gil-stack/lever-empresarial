"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { sesionSegura } from "@/server/entrada";
import {
  agregarAccionista,
  agregarRepresentante,
  archivoDeDocumento,
  calificarRiesgoEmpresa,
  cambiarRolPersonal,
  cargarDocumento,
  cargarListaBloqueadas,
  crearVersion,
  decidirCambioDeSuspension,
  dictaminarVersion,
  enviarVersion,
  exigirContextoOperacion,
  guardarDatosGenerales,
  leerArchivoDeLista,
  registrarReporte,
  resolverCoincidencia,
  retirarDelBorrador,
  solicitarCambioDeSuspension,
} from "@/server/operacion";
import { almacenVercel } from "@/server/proveedores/constancia";
import { ErrorDeDominio } from "@/server/session";

/**
 * Acciones de la Ola R1 (alta regulada). Cada una vuelve a la pantalla de donde salió con un
 * aviso: el código del error o lo que quedó hecho. El servidor y la base exigen otra vez el rol,
 * la doble firma y el segundo factor; aquí solo se arma la entrada.
 */

const CAMPOS_DATOS = [
  "razonSocial",
  "giro",
  "nacionalidad",
  "rfc",
  "serieEfirma",
  "domicilioCalle",
  "domicilioExterior",
  "domicilioInterior",
  "domicilioColonia",
  "domicilioMunicipio",
  "domicilioEntidad",
  "domicilioCodigoPostal",
  "domicilioPais",
  "telefono",
  "correo",
  "fechaConstitucion",
  "volumenMensualCentavos",
] as const;

function expediente(companyId: string): string {
  return `/operacion/clientes/${encodeURIComponent(companyId)}/expediente`;
}

function texto(formData: FormData, campo: string): string {
  const valor = formData.get(campo);
  return typeof valor === "string" ? valor : "";
}

export async function crearVersionAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const companyId = texto(formData, "companyId");
  try {
    await crearVersion(ctx, { companyId, formId: formData.get("formId") });
  } catch (error) {
    return fallo(error, expediente(companyId));
  }
  listo(expediente(companyId), "expediente_version_creada");
}

export async function guardarDatosAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const companyId = texto(formData, "companyId");
  try {
    await guardarDatosGenerales(ctx, {
      versionId: formData.get("versionId"),
      datos: Object.fromEntries(CAMPOS_DATOS.map((campo) => [campo, texto(formData, campo)])),
    });
  } catch (error) {
    return fallo(error, expediente(companyId), "#datos-titulo");
  }
  listo(expediente(companyId), "expediente_datos_guardados", "#datos-titulo");
}

export async function agregarRepresentanteAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const companyId = texto(formData, "companyId");
  try {
    await agregarRepresentante(ctx, {
      versionId: formData.get("versionId"),
      formId: formData.get("formId"),
      nombre: texto(formData, "nombre"),
      rfc: texto(formData, "rfc"),
      curp: texto(formData, "curp"),
      cargo: texto(formData, "cargo"),
      esAdministrador: formData.get("esAdministrador") === "si",
      designadoPor: texto(formData, "designadoPor"),
      pep: texto(formData, "pep"),
    });
  } catch (error) {
    return fallo(error, expediente(companyId), "#representantes-titulo");
  }
  listo(expediente(companyId), "expediente_representante_agregado", "#representantes-titulo");
}

/** Lo que vuelve al formulario del accionista cuando el servidor rechaza el socio: lo capturado y el aviso. */
export type EstadoDelSocio = { aviso: string | null; valores: Record<string, string>; vuelta: number };

const CAMPOS_SOCIO = [
  "padreClave",
  "tipoPersona",
  "nacionalidad",
  "nombre",
  "rfc",
  "curp",
  "pais",
  "documentoExtranjero",
  "fechaNacimiento",
  "capital",
  "votos",
  "pep",
  "controlOtrosMedios",
] as const;

export async function agregarAccionistaAccion(previo: EstadoDelSocio, formData: FormData): Promise<EstadoDelSocio> {
  const ctx = await exigirContextoOperacion();
  const companyId = texto(formData, "companyId");
  try {
    await agregarAccionista(ctx, {
      versionId: formData.get("versionId"),
      formId: formData.get("formId"),
      padreClave: texto(formData, "padreClave"),
      tipoPersona: texto(formData, "tipoPersona"),
      nombre: texto(formData, "nombre"),
      rfc: texto(formData, "rfc"),
      curp: texto(formData, "curp"),
      pais: texto(formData, "pais"),
      documentoExtranjero: texto(formData, "documentoExtranjero"),
      fechaNacimiento: texto(formData, "fechaNacimiento"),
      capital: texto(formData, "capital"),
      votos: texto(formData, "votos"),
      controlOtrosMedios: formData.get("controlOtrosMedios") === "si",
      pep: texto(formData, "pep") || "no",
    });
  } catch (error) {
    // El formulario vuelve con todo lo capturado y sin recargar: ningún dato del socio va en la dirección.
    if (error instanceof ErrorDeDominio) {
      return { aviso: error.codigo, valores: Object.fromEntries(CAMPOS_SOCIO.map((campo) => [campo, texto(formData, campo)])), vuelta: previo.vuelta + 1 };
    }
    throw error;
  }
  listo(expediente(companyId), "expediente_accionista_agregado", "#accionistas-titulo");
}

export async function retirarDelBorradorAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const companyId = texto(formData, "companyId");
  const tipo = formData.get("tipo") === "representante" ? "representante" : "accionista";
  try {
    await retirarDelBorrador(ctx, { versionId: formData.get("versionId"), id: formData.get("id"), tipo });
  } catch (error) {
    return fallo(error, expediente(companyId), tipo === "representante" ? "#representantes-titulo" : "#accionistas-titulo");
  }
  listo(expediente(companyId), "expediente_retirado", tipo === "representante" ? "#representantes-titulo" : "#accionistas-titulo");
}

export async function cargarDocumentoAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const companyId = texto(formData, "companyId");
  try {
    // El rol y el tope se revisan antes de leer el archivo.
    const subido = await archivoDeDocumento(ctx, formData.get("archivo"));
    await cargarDocumento(
      ctx,
      {
        versionId: formData.get("versionId"),
        formId: formData.get("formId"),
        tipo: texto(formData, "tipo"),
        representanteClave: texto(formData, "representanteClave"),
        emitidoEl: texto(formData, "emitidoEl"),
        vigenteHasta: texto(formData, "vigenteHasta"),
        detalle: texto(formData, "detalle"),
        archivo: subido,
      },
      { almacen: almacenVercel() },
    );
  } catch (error) {
    return fallo(error, expediente(companyId), "#documentos-titulo");
  }
  listo(expediente(companyId), "expediente_documento_cargado", "#documentos-titulo");
}

export async function enviarVersionAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const companyId = texto(formData, "companyId");
  try {
    await enviarVersion(ctx, formData.get("versionId"));
  } catch (error) {
    return fallo(error, expediente(companyId), "#enviar-titulo");
  }
  listo(expediente(companyId), "expediente_enviado");
}

export async function dictaminarAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const sesion = await sesionSegura();
  if (!sesion) redirect("/operacion/entrar");
  const companyId = texto(formData, "companyId");
  try {
    await dictaminarVersion(ctx, sesion, {
      versionId: formData.get("versionId"),
      formId: formData.get("formId"),
      resultado: texto(formData, "resultado"),
      motivo: texto(formData, "motivo"),
    });
  } catch (error) {
    return fallo(error, expediente(companyId), "#dictamen-titulo");
  }
  listo(expediente(companyId), "expediente_dictaminado", "#dictamen-titulo");
}

export async function calificarRiesgoAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const companyId = texto(formData, "companyId");
  try {
    await calificarRiesgoEmpresa(ctx, {
      companyId,
      formId: formData.get("formId"),
      actividad: texto(formData, "actividad"),
      zona: texto(formData, "zona"),
    });
  } catch (error) {
    return fallo(error, expediente(companyId), "#riesgo-titulo");
  }
  listo(expediente(companyId), "riesgo_calificado", "#riesgo-titulo");
}

export async function solicitarSuspensionAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const companyId = texto(formData, "companyId");
  const ficha = `/operacion/clientes/${encodeURIComponent(companyId)}`;
  const tipo = texto(formData, "tipo");
  try {
    await solicitarCambioDeSuspension(ctx, { companyId, formId: formData.get("formId"), tipo, motivo: texto(formData, "motivo") });
  } catch (error) {
    return fallo(error, ficha, "#suspension-titulo");
  }
  listo(ficha, tipo === "reactivacion" ? "reactivacion_solicitada" : "suspension_solicitada", "#suspension-titulo");
}

export async function decidirSuspensionAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const sesion = await sesionSegura();
  if (!sesion) redirect("/operacion/entrar");
  try {
    await decidirCambioDeSuspension(ctx, sesion, {
      id: formData.get("id"),
      aprobada: formData.get("decision") === "aprobar",
      motivo: formData.get("motivo"),
    });
  } catch (error) {
    return fallo(error, "/operacion/aprobaciones");
  }
  listo("/operacion/aprobaciones", "decision_registrada");
}

export async function cargarListaAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  // El rol se revisa antes de leer el archivo. La línea del renglón malo ayuda a corregirlo.
  let archivo: Awaited<ReturnType<typeof leerArchivoDeLista>>;
  try {
    archivo = await leerArchivoDeLista(ctx, formData.get("archivo"));
  } catch (error) {
    return fallo(error, "/operacion/lpb");
  }
  if (!archivo.ok) {
    const linea = archivo.linea !== undefined ? `&linea=${archivo.linea}` : "";
    redirect(`/operacion/lpb?aviso=${encodeURIComponent(archivo.codigo)}${linea}`);
  }
  let resultado: Awaited<ReturnType<typeof cargarListaBloqueadas>>;
  try {
    resultado = await cargarListaBloqueadas(ctx, { formId: formData.get("formId"), nombreArchivo: archivo.nombre, texto: archivo.texto });
  } catch (error) {
    return fallo(error, "/operacion/lpb");
  }
  revalidatePath("/operacion", "layout");
  redirect(`/operacion/lpb?aviso=lpb_cargada&filas=${resultado.filas}&coincidencias=${resultado.coincidencias}`);
}

export async function resolverCoincidenciaAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const sesion = await sesionSegura();
  if (!sesion) redirect("/operacion/entrar");
  const destino = formData.get("desde") === "cumplimiento" ? "/operacion/cumplimiento" : "/operacion/lpb";
  try {
    await resolverCoincidencia(ctx, sesion, { id: formData.get("id"), estado: texto(formData, "estado"), motivo: texto(formData, "motivo") });
  } catch (error) {
    return fallo(error, destino);
  }
  listo(destino, "coincidencia_resuelta");
}

export async function registrarReporteAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const destino = formData.get("desde") === "cumplimiento" ? "/operacion/cumplimiento" : "/operacion/lpb";
  try {
    await registrarReporte(ctx, {
      id: formData.get("id"),
      folio: texto(formData, "folio"),
      presentadoEl: texto(formData, "presentadoEl"),
      avisoClienteEl: texto(formData, "avisoClienteEl"),
    });
  } catch (error) {
    return fallo(error, destino);
  }
  listo(destino, "reporte_registrado");
}

export async function cambiarRolAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const sesion = await sesionSegura();
  if (!sesion) redirect("/operacion/entrar");
  const quitar = formData.get("quitar") === "si";
  try {
    await cambiarRolPersonal(ctx, sesion, { userId: formData.get("userId"), rol: formData.get("rol"), quitar });
  } catch (error) {
    if (error instanceof ErrorDeDominio && error.codigo === "reautenticacion_requerida") {
      redirect("/operacion/personal?aviso=reautenticacion_factor");
    }
    return fallo(error, "/operacion/personal");
  }
  listo("/operacion/personal", quitar ? "rol_retirado" : "rol_asignado");
}

function listo(destino: string, aviso: string, ancla = ""): never {
  revalidatePath("/operacion", "layout");
  redirect(`${destino}?aviso=${aviso}${ancla}`);
}

/** `en` dice qué formulario falló: la página liga el error solo a los campos de ese formulario. */
function fallo(error: unknown, destino: string, ancla = ""): never {
  if (error instanceof ErrorDeDominio) {
    redirect(`${destino}?aviso=${encodeURIComponent(error.codigo)}${ancla ? `&en=${ancla.slice(1)}` : ""}${ancla}`);
  }
  throw error;
}
