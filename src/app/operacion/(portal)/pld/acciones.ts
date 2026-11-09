"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { sesionSegura } from "@/server/entrada";
import { exigirContextoOperacion } from "@/server/operacion";
import {
  abrirCaso,
  agregarNota,
  archivoDelFormulario,
  cambiarModoDictamen,
  cambiarParametros,
  cargarActaFirmada,
  cargarDocumentoPld,
  declararPerfil,
  dictaminarCaso,
  emitirAviso,
  type EntradaIntegrante,
  ErrorDeIntegrante,
  marcarVeinticuatroHoras,
  registrarAuditor,
  registrarComunicacion,
  registrarEntidad,
  registrarEvaluacion,
  registrarIntegrantes,
  registrarPeriodico,
  registrarPropuesta,
  registrarReportePld,
  registrarSesion,
  registrarVoto,
  resolverPropuestaDePerfil,
  sumarAlertaAlCaso,
} from "@/server/pld";
import { almacenVercel } from "@/server/proveedores/constancia";
import { ErrorDeDominio } from "@/server/session";

/**
 * Acciones de PLD (Ola R2). Cada una vuelve a la pantalla de donde salió con un
 * aviso: el código del error o lo que quedó hecho. El servidor y la base exigen
 * otra vez el rol, la bitácora y el segundo factor; aquí solo se arma la entrada.
 */

function texto(formData: FormData, campo: string): string {
  const valor = formData.get(campo);
  return typeof valor === "string" ? valor : "";
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

const expediente = (companyId: string) => `/operacion/clientes/${encodeURIComponent(companyId)}/expediente`;
const caso = (casoId: string) => `/operacion/pld/casos/${encodeURIComponent(casoId)}`;
const sesionComite = (sesionId: string) => `/operacion/comite/sesiones/${encodeURIComponent(sesionId)}`;

async function sesionConFactor() {
  const sesion = await sesionSegura();
  if (!sesion) redirect("/operacion/entrar");
  return sesion;
}

/** Las decisiones de PLD piden el segundo factor de los últimos 30 minutos; la pantalla ofrece confirmarlo. */
function siPideFactor(error: unknown, ruta: string, ancla: string): void {
  if (error instanceof ErrorDeDominio && error.codigo === "reautenticacion_requerida") redirect(`${ruta}?aviso=pld_reautenticacion${ancla}`);
}

// Perfil transaccional y evaluación semestral (en el expediente).

export async function declararPerfilAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const companyId = texto(formData, "companyId");
  let resultado: "declarado" | "propuesto";
  try {
    resultado = await declararPerfil(ctx, {
      companyId, formId: formData.get("formId"), pagosMonto: texto(formData, "pagosMonto"), pagosOperaciones: texto(formData, "pagosOperaciones"),
      nominaMonto: texto(formData, "nominaMonto"), nominaOperaciones: texto(formData, "nominaOperaciones"), motivo: texto(formData, "motivo"),
    });
  } catch (error) {
    return fallo(error, expediente(companyId), "#perfil-titulo");
  }
  listo(expediente(companyId), resultado === "propuesto" ? "perfil_propuesto" : "perfil_declarado", "#perfil-titulo");
}

export async function resolverPropuestaDePerfilAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const companyId = texto(formData, "companyId");
  let decision: "aprobada" | "rechazada";
  try {
    decision = await resolverPropuestaDePerfil(ctx, {
      companyId, propuestaId: texto(formData, "propuestaId"), decision: texto(formData, "decision"), motivo: texto(formData, "motivo"),
    });
  } catch (error) {
    return fallo(error, expediente(companyId), "#perfil-titulo");
  }
  listo(expediente(companyId), decision === "aprobada" ? "perfil_aprobado" : "perfil_rechazado", "#perfil-titulo");
}

export async function registrarEvaluacionAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const companyId = texto(formData, "companyId");
  const perfil = texto(formData, "perfil");
  try {
    await registrarEvaluacion(ctx, {
      companyId, formId: formData.get("formId"), perfil, justificacion: texto(formData, "justificacion"),
      ...(perfil === "cambia"
        ? { pagosMonto: texto(formData, "pagosMonto"), pagosOperaciones: texto(formData, "pagosOperaciones"), nominaMonto: texto(formData, "nominaMonto"), nominaOperaciones: texto(formData, "nominaOperaciones") }
        : {}),
    });
  } catch (error) {
    return fallo(error, expediente(companyId), "#evaluacion-titulo");
  }
  listo(expediente(companyId), "evaluacion_registrada", "#evaluacion-titulo");
}

// Aviso del personal.

export async function emitirAvisoAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  try {
    await emitirAviso(ctx, {
      formId: formData.get("formId"), tipo: texto(formData, "tipo"), descripcion: texto(formData, "descripcion"),
      companyId: texto(formData, "companyId"), mencionada: texto(formData, "mencionada"), superior: texto(formData, "superior"),
    });
  } catch (error) {
    return fallo(error, "/operacion/avisos", "#aviso-titulo");
  }
  listo("/operacion/avisos", "pld_aviso_emitido", "#acuses-titulo");
}

// Alertas y análisis.

export async function abrirCasoAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  let id: string;
  try {
    id = await abrirCaso(ctx, { formId: formData.get("formId"), alertaId: formData.get("alertaId") });
  } catch (error) {
    return fallo(error, "/operacion/pld");
  }
  listo(caso(id), "pld_caso_abierto");
}

export async function sumarAlertaAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const casoId = texto(formData, "casoId");
  try {
    await sumarAlertaAlCaso(ctx, { casoId, alertaId: formData.get("alertaId") });
  } catch (error) {
    return fallo(error, caso(casoId), "#alertas-titulo");
  }
  listo(caso(casoId), "pld_alerta_sumada", "#alertas-titulo");
}

export async function agregarNotaAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const casoId = texto(formData, "casoId");
  try {
    await agregarNota(ctx, { casoId, formId: formData.get("formId"), texto: texto(formData, "texto") });
  } catch (error) {
    return fallo(error, caso(casoId), "#notas-titulo");
  }
  listo(caso(casoId), "pld_nota_agregada", "#notas-titulo");
}

export async function cargarDocumentoPldAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const casoId = texto(formData, "casoId");
  try {
    const archivo = await archivoDelFormulario(formData.get("archivo"));
    await cargarDocumentoPld(ctx, { casoId, formId: formData.get("formId"), archivo }, { almacen: almacenVercel() });
  } catch (error) {
    return fallo(error, caso(casoId), "#documentos-titulo");
  }
  listo(caso(casoId), "pld_documento_cargado", "#documentos-titulo");
}

export async function registrarPropuestaAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const casoId = texto(formData, "casoId");
  try {
    await registrarPropuesta(ctx, { casoId, formId: formData.get("formId"), propuesta: texto(formData, "propuesta"), justificacion: texto(formData, "justificacion") });
  } catch (error) {
    return fallo(error, caso(casoId), "#propuesta-titulo");
  }
  listo(caso(casoId), "pld_propuesta_registrada", "#propuesta-titulo");
}

export async function marcarVeinticuatroHorasAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const casoId = texto(formData, "casoId");
  try {
    await marcarVeinticuatroHoras(ctx, { casoId, motivo: texto(formData, "motivo") });
  } catch (error) {
    return fallo(error, caso(casoId), "#plazo-titulo");
  }
  listo(caso(casoId), "pld_caso_24_horas", "#plazo-titulo");
}

export async function dictaminarCasoAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const sesion = await sesionConFactor();
  const casoId = texto(formData, "casoId");
  let fueraDePlazo = false;
  try {
    ({ fueraDePlazo } = await dictaminarCaso(ctx, sesion, {
      formId: formData.get("formId"), casoId, via: texto(formData, "via"), sesionId: texto(formData, "sesionId"),
      propuestaId: texto(formData, "propuestaId"), resultado: texto(formData, "resultado"), justificacion: texto(formData, "justificacion"),
    }));
  } catch (error) {
    siPideFactor(error, caso(casoId), "#dictamen-titulo");
    return fallo(error, caso(casoId), "#dictamen-titulo");
  }
  listo(caso(casoId), fueraDePlazo ? "pld_dictamen_fuera_de_plazo" : "pld_dictamen_registrado", "#dictamen-titulo");
}

export async function registrarReportePldAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const casoId = texto(formData, "casoId");
  let fueraDePlazo = false;
  try {
    ({ fueraDePlazo } = await registrarReportePld(ctx, {
      formId: formData.get("formId"), casoId, folio: texto(formData, "folio"), periodo: texto(formData, "periodo"),
      recibidoEn: texto(formData, "recibidoEn"), registros: texto(formData, "registros"),
    }));
  } catch (error) {
    return fallo(error, caso(casoId), "#reporte-titulo");
  }
  listo(caso(casoId), fueraDePlazo ? "pld_reporte_fuera_de_plazo" : "pld_reporte_registrado", "#reporte-titulo");
}

export async function cambiarParametrosAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const sesion = await sesionConFactor();
  try {
    await cambiarParametros(ctx, sesion, {
      formId: formData.get("formId"), atipicoK: texto(formData, "atipicoK"), atipicoHistorialMinimo: texto(formData, "atipicoHistorialMinimo"),
      fraccionN: texto(formData, "fraccionN"), fraccionVentanaDias: texto(formData, "fraccionVentanaDias"), fraccionUmbral: texto(formData, "fraccionUmbral"),
      nominaPersonasPct: texto(formData, "nominaPersonasPct"), factorGradoAlto: texto(formData, "factorGradoAlto"), motivo: texto(formData, "motivo"),
    });
  } catch (error) {
    siPideFactor(error, "/operacion/pld/parametros", "#parametros-titulo");
    return fallo(error, "/operacion/pld/parametros", "#parametros-titulo");
  }
  listo("/operacion/pld/parametros", "pld_parametros_cambiados");
}

// Comité.

export async function cambiarModoAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const sesion = await sesionConFactor();
  try {
    await cambiarModoDictamen(ctx, sesion, { formId: formData.get("formId"), modo: texto(formData, "modo"), oficialId: texto(formData, "oficialId"), motivo: texto(formData, "motivo") });
  } catch (error) {
    siPideFactor(error, "/operacion/comite", "#modo-titulo");
    return fallo(error, "/operacion/comite", "#modo-titulo");
  }
  listo("/operacion/comite", "pld_modo_cambiado", "#modo-titulo");
}

/**
 * Lo que vuelve al formulario de integrantes cuando el servidor lo rechaza: el aviso, el renglón del formulario
 * que lo causó (null si es de la integración completa o de la sustitución) y lo capturado. Nada va en la dirección.
 */
export type EstadoDeIntegrantes = { aviso: string | null; renglon: number | null; valores: Record<string, string>; vuelta: number };

const CAMPOS_INTEGRANTE = [
  "nombres", "primerApellido", "segundoApellido", "cargo", "titularidad", "suplenteDe", "rfc", "curp", "area", "cargoEntidad",
  "designadoEl", "certificado", "esOficial",
] as const;

/** Los renglones con nombre son integrantes; los vacíos se ignoran. Toda la integración va en una transacción. */
export async function registrarIntegrantesAccion(previo: EstadoDeIntegrantes, formData: FormData): Promise<EstadoDeIntegrantes> {
  const ctx = await exigirContextoOperacion();
  const renglones = Math.min(Number(texto(formData, "renglones")) || 0, 12);
  const integrantes: EntradaIntegrante[] = [];
  const delFormulario: number[] = [];
  for (let i = 0; i < renglones; i++) {
    const campo = (nombre: string) => texto(formData, `${nombre}-${i}`);
    if (!campo("nombres").trim()) continue;
    delFormulario.push(i);
    integrantes.push({
      id: campo("id"), area: campo("area"), cargo: campo("cargo"), titularidad: campo("titularidad"), suplenteDe: campo("suplenteDe"),
      nombres: campo("nombres"), primerApellido: campo("primerApellido"), segundoApellido: campo("segundoApellido"), rfc: campo("rfc"),
      curp: campo("curp"), cargoEntidad: campo("cargoEntidad"), esOficial: campo("esOficial") === "si", designadoEl: campo("designadoEl"),
      certificado: campo("certificado"),
    });
  }
  const sustituido = texto(formData, "sustituye");
  try {
    await registrarIntegrantes(ctx, {
      integrantes,
      sustituye: sustituido ? { integranteId: sustituido, sustituidoEl: texto(formData, "sustituidoEl"), motivo: texto(formData, "motivo") } : null,
    });
  } catch (error) {
    // r2-serv-N1: vuelve sin recargar, con lo capturado de los 5 renglones y el renglón que falló.
    if (error instanceof ErrorDeDominio) {
      const valores: Record<string, string> = { sustituye: sustituido, sustituidoEl: texto(formData, "sustituidoEl"), motivo: texto(formData, "motivo") };
      for (let i = 0; i < renglones; i++) for (const campo of CAMPOS_INTEGRANTE) valores[`${campo}-${i}`] = texto(formData, `${campo}-${i}`);
      const renglon = error instanceof ErrorDeIntegrante ? (delFormulario[error.renglon] ?? null) : null;
      return { aviso: error.codigo, renglon, valores, vuelta: previo.vuelta + 1 };
    }
    throw error;
  }
  listo("/operacion/comite", "pld_integrantes_registrados", "#comunicaciones-titulo");
}

export async function registrarAuditorAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  try {
    await registrarAuditor(ctx, {
      formId: formData.get("formId"), nombre: texto(formData, "nombre"), cargoEntidad: texto(formData, "cargoEntidad"),
      rfc: texto(formData, "rfc"), curp: texto(formData, "curp"), designadoEl: texto(formData, "designadoEl"),
    });
  } catch (error) {
    return fallo(error, "/operacion/comite", "#auditor-titulo");
  }
  listo("/operacion/comite", "pld_auditor_registrado", "#auditor-titulo");
}

export async function registrarComunicacionAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  try {
    await registrarComunicacion(ctx, {
      formId: formData.get("formId"), folio: texto(formData, "folio"), recibidoEn: texto(formData, "recibidoEn"),
      integrantes: formData.getAll("integrantes"), bajas: formData.getAll("bajas"),
    });
  } catch (error) {
    return fallo(error, "/operacion/comite", "#comunicaciones-titulo");
  }
  listo("/operacion/comite", "pld_comunicacion_registrada", "#comunicaciones-titulo");
}

export async function registrarSesionAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const sesionId = texto(formData, "formId");
  let quorum = false;
  try {
    ({ quorum } = await registrarSesion(ctx, {
      formId: sesionId, celebradaEl: texto(formData, "celebradaEl"), presentes: formData.getAll("presentes"), auditorPresente: texto(formData, "auditorPresente"),
    }));
  } catch (error) {
    return fallo(error, "/operacion/comite", "#sesiones-titulo");
  }
  listo(sesionComite(sesionId), quorum ? "pld_sesion_registrada" : "pld_sesion_sin_quorum");
}

export async function registrarVotoAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const sesionId = texto(formData, "sesionId");
  try {
    await registrarVoto(ctx, {
      formId: formData.get("formId"), sesionId, propuestaId: formData.get("propuestaId"), integranteId: formData.get("integranteId"), voto: texto(formData, "voto"),
    });
  } catch (error) {
    return fallo(error, sesionComite(sesionId), "#votaciones-titulo");
  }
  listo(sesionComite(sesionId), "pld_voto_registrado", "#votaciones-titulo");
}

export async function cargarActaAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const sesionId = texto(formData, "sesionId");
  try {
    const archivo = await archivoDelFormulario(formData.get("archivo"));
    await cargarActaFirmada(ctx, { formId: formData.get("formId"), sesionId, archivo }, { almacen: almacenVercel() });
  } catch (error) {
    return fallo(error, sesionComite(sesionId), "#acta-titulo");
  }
  listo(sesionComite(sesionId), "pld_acta_cargada", "#acta-titulo");
}

// Reportes periódicos y clave de la entidad.

export async function registrarEntidadAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  try {
    await registrarEntidad(ctx, { formId: formData.get("formId"), claveCasfim: texto(formData, "claveCasfim"), claveOrganoSupervisor: texto(formData, "claveOrganoSupervisor") });
  } catch (error) {
    return fallo(error, "/operacion/reportes", "#entidad-titulo");
  }
  listo("/operacion/reportes", "pld_entidad_registrada", "#entidad-titulo");
}

export async function registrarPeriodicoAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const ancla = `#reporte-${texto(formData, "reporte")}-${texto(formData, "periodo")}`.replace(/[^#a-z0-9-]/gi, "");
  try {
    await registrarPeriodico(ctx, {
      formId: formData.get("formId"), reporte: texto(formData, "reporte"), periodo: texto(formData, "periodo"), folio: texto(formData, "folio"),
      recibidoEn: texto(formData, "recibidoEn"), registros: texto(formData, "registros"),
    });
  } catch (error) {
    return fallo(error, "/operacion/reportes", ancla);
  }
  listo("/operacion/reportes", "pld_periodico_registrado", ancla);
}
