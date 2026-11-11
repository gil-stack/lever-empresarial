"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { capturado, rechazado, type EstadoDelFormulario } from "@/app/operacion/rechazo";
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
  ExpedienteIncompleto,
  guardarDatosGenerales,
  leerArchivoDeLista,
  registrarReporte,
  resolverCoincidencia,
  retirarDelBorrador,
  solicitarCambioDeSuspension,
} from "@/server/operacion";
import { auditar } from "@/server/bitacora/auditar";
import { procesarRetenidos } from "@/server/cobranza/fintoc";
import { almacenVercel } from "@/server/proveedores/constancia";
import { ErrorDeDominio } from "@/server/session";

/**
 * Acciones de la Ola R1 (alta regulada). Lo que queda hecho vuelve a la pantalla con su aviso en la dirección. Un
 * formulario con algo capturado que el servidor rechaza vuelve sin recargar con su aviso y lo capturado
 * (`rechazado`); los de solo botones vuelven con el aviso del error en la dirección. El servidor y la base exigen otra
 * vez el rol, la doble firma y el segundo factor; aquí solo se arma la entrada.
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

export async function guardarDatosAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
  const ctx = await exigirContextoOperacion();
  const companyId = texto(formData, "companyId");
  try {
    await guardarDatosGenerales(ctx, { versionId: formData.get("versionId"), datos: capturado(formData, CAMPOS_DATOS) });
  } catch (error) {
    return rechazado(previo, error, formData, CAMPOS_DATOS);
  }
  listo(expediente(companyId), "expediente_datos_guardados");
}

/** Lo que vuelve al formulario del representante cuando el servidor lo rechaza: lo capturado y el aviso. */
export type EstadoDelRepresentante = { aviso: string | null; valores: Record<string, string>; vuelta: number };

const CAMPOS_REPRESENTANTE = ["nombre", "rfc", "curp", "cargo", "pep", "designadoPor", "esAdministrador"] as const;

export async function agregarRepresentanteAccion(previo: EstadoDelRepresentante, formData: FormData): Promise<EstadoDelRepresentante> {
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
    // Como el del socio: vuelve con lo capturado y sin recargar; ningún dato del representante va en la dirección.
    if (error instanceof ErrorDeDominio) {
      return { aviso: error.codigo, valores: Object.fromEntries(CAMPOS_REPRESENTANTE.map((campo) => [campo, texto(formData, campo)])), vuelta: previo.vuelta + 1 };
    }
    throw error;
  }
  listo(expediente(companyId), "expediente_representante_agregado");
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
  listo(expediente(companyId), "expediente_accionista_agregado");
}

export async function retirarDelBorradorAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const companyId = texto(formData, "companyId");
  const tipo = formData.get("tipo") === "representante" ? "representante" : "accionista";
  try {
    await retirarDelBorrador(ctx, { versionId: formData.get("versionId"), id: formData.get("id"), tipo });
  } catch (error) {
    return fallo(error, expediente(companyId));
  }
  listo(expediente(companyId), "expediente_retirado");
}

/** Lo que vuelve del documento tras un rechazo: todo menos el archivo, que el navegador no deja rellenar. */
const CAMPOS_DOCUMENTO = ["tipo", "representanteClave", "emitidoEl", "vigenteHasta", "detalle"] as const;

export async function cargarDocumentoAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
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
    return rechazado(previo, error, formData, CAMPOS_DOCUMENTO);
  }
  listo(expediente(companyId), "expediente_documento_cargado");
}

export async function enviarVersionAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const companyId = texto(formData, "companyId");
  try {
    await enviarVersion(ctx, formData.get("versionId"));
  } catch (error) {
    // Lo que falta viaja como claves conocidas (giro, domicilio…), nunca como datos de la empresa.
    if (error instanceof ExpedienteIncompleto) {
      redirect(`${expediente(companyId)}?aviso=${error.codigo}&faltan=${error.faltan.join(",")}`);
    }
    return fallo(error, expediente(companyId));
  }
  listo(expediente(companyId), "expediente_enviado");
}

export async function dictaminarAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
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
    return rechazado(previo, error, formData, ["resultado", "motivo"]);
  }
  listo(expediente(companyId), "expediente_dictaminado");
}

export async function calificarRiesgoAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
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
    return rechazado(previo, error, formData, ["actividad", "zona"]);
  }
  listo(expediente(companyId), "riesgo_calificado");
}

export async function solicitarSuspensionAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
  const ctx = await exigirContextoOperacion();
  const companyId = texto(formData, "companyId");
  const ficha = `/operacion/clientes/${encodeURIComponent(companyId)}`;
  const tipo = texto(formData, "tipo");
  try {
    await solicitarCambioDeSuspension(ctx, { companyId, formId: formData.get("formId"), tipo, motivo: texto(formData, "motivo") });
  } catch (error) {
    return rechazado(previo, error, formData, ["motivo"]);
  }
  listo(ficha, tipo === "reactivacion" ? "reactivacion_solicitada" : "suspension_solicitada");
}

export async function decidirSuspensionAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const sesion = await sesionSegura();
  if (!sesion) redirect("/operacion/entrar");
  let decidida: Awaited<ReturnType<typeof decidirCambioDeSuspension>>;
  try {
    decidida = await decidirCambioDeSuspension(ctx, sesion, {
      id: formData.get("id"),
      aprobada: formData.get("decision") === "aprobar",
      motivo: formData.get("motivo"),
    });
  } catch (error) {
    return fallo(error, "/operacion/aprobaciones");
  }
  // r63i-N1: los abonos de Fintoc que llegaron mientras estuvo suspendida, por el camino normal. La reactivación ya
  // confirmó: si esto falla, la tarea diaria de cobranza los vuelve a intentar.
  if (decidida.reactivada) {
    try {
      await procesarRetenidos(decidida.companyId, ctx.personal.operadorId, { auditar });
    } catch {
      console.error(JSON.stringify({ nivel: "error", origen: "cobranza.fintoc", evento: "retenidos_pendientes" }));
    }
  }
  listo("/operacion/aprobaciones", "decision_registrada");
}

export async function cargarListaAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
  const ctx = await exigirContextoOperacion();
  // El rol se revisa antes de leer el archivo. La línea del renglón malo ayuda a corregirlo.
  let archivo: Awaited<ReturnType<typeof leerArchivoDeLista>>;
  try {
    archivo = await leerArchivoDeLista(ctx, formData.get("archivo"));
  } catch (error) {
    return rechazado(previo, error, formData, []);
  }
  if (!archivo.ok) {
    const linea =
      archivo.codigo === "lpb_renglon_invalido" && archivo.linea !== undefined
        ? `Revisa la línea ${archivo.linea} del archivo: nombre obligatorio, RFC de 12 o 13 caracteres, CURP de 18, tipo «fisica» o «moral» y fecha AAAA-MM-DD.`
        : undefined;
    return { ...(await rechazado(previo, new ErrorDeDominio(archivo.codigo), formData, [])), detalle: linea };
  }
  let resultado: Awaited<ReturnType<typeof cargarListaBloqueadas>>;
  try {
    resultado = await cargarListaBloqueadas(ctx, { formId: formData.get("formId"), nombreArchivo: archivo.nombre, texto: archivo.texto });
  } catch (error) {
    return rechazado(previo, error, formData, []);
  }
  revalidatePath("/operacion", "layout");
  redirect(`/operacion/lpb?aviso=lpb_cargada&filas=${resultado.filas}&coincidencias=${resultado.coincidencias}`);
}

export async function resolverCoincidenciaAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
  const ctx = await exigirContextoOperacion();
  const sesion = await sesionSegura();
  if (!sesion) redirect("/operacion/entrar");
  const destino = formData.get("desde") === "cumplimiento" ? "/operacion/cumplimiento" : "/operacion/lpb";
  try {
    await resolverCoincidencia(ctx, sesion, { id: formData.get("id"), estado: texto(formData, "estado"), motivo: texto(formData, "motivo") });
  } catch (error) {
    // Cada coincidencia lleva su formulario: el aviso vuelve a esa tarjeta, con su dictamen y su motivo.
    return rechazado(previo, error, formData, ["estado", "motivo"]);
  }
  listo(destino, "coincidencia_resuelta");
}

export async function registrarReporteAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
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
    return rechazado(previo, error, formData, ["folio", "presentadoEl", "avisoClienteEl"]);
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

/**
 * Sin fragmento (#sección) a propósito: sin JavaScript, el siguiente envío va a la dirección del documento con todo y
 * fragmento, y con un fragmento el navegador descarta el autofocus; un rechazo posterior ya no llevaría el foco al campo.
 */
function listo(destino: string, aviso: string): never {
  revalidatePath("/operacion", "layout");
  redirect(`${destino}?aviso=${aviso}`);
}

/** Los formularios de solo botones: el aviso del error va en la dirección, sin fragmento (ver `listo`). */
function fallo(error: unknown, destino: string): never {
  if (error instanceof ErrorDeDominio) redirect(`${destino}?aviso=${encodeURIComponent(error.codigo)}`);
  throw error;
}
