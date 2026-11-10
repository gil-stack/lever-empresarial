"use server";

import { fragmentoDelError } from "@/components/operacion/aviso";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { rechazado as rechazadoEnOperacion } from "@/app/operacion/rechazo";
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

/**
 * r2-serv-N20: ninguna dirección de PLD lleva fragmento (`#seccion`), como en acciones-alta.ts. Sin JavaScript, el
 * siguiente envío va a la dirección del documento con todo y fragmento y, si la página que responde tiene ese destino,
 * el navegador descarta el autofocus del campo rechazado. El aviso de lo hecho va arriba de la página.
 */
function listo(destino: string, aviso: string): never {
  revalidatePath("/operacion", "layout");
  redirect(`${destino}?aviso=${aviso}`);
}

/** `en` dice qué formulario falló: la página liga el error solo a los campos de ese formulario. */
function fallo(error: unknown, destino: string, en = ""): never {
  // Sin JavaScript llega al mensaje del campo por su fragmento (fragmentoDelError); con JavaScript, MensajeJuntoAlCampo le da el foco.
  if (error instanceof ErrorDeDominio) redirect(`${destino}?aviso=${encodeURIComponent(error.codigo)}${en ? `&en=${en}` : ""}${fragmentoDelError(error.codigo)}`);
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

// Perfil transaccional y evaluación semestral (en el expediente).

export async function declararPerfilAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
  const ctx = await exigirContextoOperacion();
  const companyId = texto(formData, "companyId");
  let resultado: "declarado" | "propuesto";
  try {
    resultado = await declararPerfil(ctx, {
      companyId, formId: formData.get("formId"), pagosMonto: texto(formData, "pagosMonto"), pagosOperaciones: texto(formData, "pagosOperaciones"),
      nominaMonto: texto(formData, "nominaMonto"), nominaOperaciones: texto(formData, "nominaOperaciones"), motivo: texto(formData, "motivo"),
    });
  } catch (error) {
    return rechazado(error, previo, formData, ["pagosMonto", "pagosOperaciones", "nominaMonto", "nominaOperaciones", "motivo"]);
  }
  listo(expediente(companyId), resultado === "propuesto" ? "perfil_propuesto" : "perfil_declarado");
}

export async function resolverPropuestaDePerfilAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
  const ctx = await exigirContextoOperacion();
  const companyId = texto(formData, "companyId");
  let decision: "aprobada" | "rechazada";
  try {
    decision = await resolverPropuestaDePerfil(ctx, {
      companyId, propuestaId: texto(formData, "propuestaId"), decision: texto(formData, "decision"), motivo: texto(formData, "motivo"),
    });
  } catch (error) {
    return rechazado(error, previo, formData, ["motivo"]);
  }
  listo(expediente(companyId), decision === "aprobada" ? "perfil_aprobado" : "perfil_rechazado");
}

export async function registrarEvaluacionAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
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
    return rechazado(error, previo, formData, ["perfil", "pagosMonto", "pagosOperaciones", "nominaMonto", "nominaOperaciones", "justificacion"]);
  }
  listo(expediente(companyId), "evaluacion_registrada");
}

// Aviso del personal.

/**
 * Lo que vuelve a un formulario de PLD cuando el servidor lo rechaza: el aviso y lo capturado, sin recargar y sin pasar
 * por la dirección (r2-serv-N14 y el inventario de la ronda 12). Las casillas (`listas`) vuelven como sus valores
 * marcados separados por comas: son identificadores o «si».
 */
export type EstadoDelFormulario = { aviso: string | null; valores: Record<string, string>; vuelta: number };

/**
 * r2-serv-N21: el rechazo pasa por `rechazado` del #59, que deja el código en la cookie vencida de la respuesta. Si el
 * formulario ya no se pinta (otra pestaña registró el dictamen o el periódico), la página pinta el aviso arriba
 * (`PaginaOperacion`, `#aviso-rechazo`); si se pinta, su propio aviso lo sustituye.
 */
async function rechazado(error: unknown, previo: EstadoDelFormulario, formData: FormData, campos: readonly string[], listas: readonly string[] = []): Promise<EstadoDelFormulario> {
  const estado = await rechazadoEnOperacion(previo, error, formData, campos);
  for (const lista of listas) estado.valores[lista] = formData.getAll(lista).filter((valor) => typeof valor === "string").join(",");
  return { aviso: estado.aviso, valores: estado.valores, vuelta: estado.vuelta };
}

/**
 * Las decisiones de PLD (dictamen, parámetros y quién dictamina) piden el segundo factor de los últimos 30 minutos.
 * r2-serv-N17: si venció mientras escribía, no se redirige (se perdía lo capturado). Vuelve con lo capturado y la
 * página se vuelve a leer, ya con «Confirma que eres tú» arriba del formulario; al confirmar, router.refresh conserva
 * lo escrito. Nada va en la dirección.
 */
function rechazadoODecidir(error: unknown, previo: EstadoDelFormulario, formData: FormData, campos: readonly string[], ruta: string): Promise<EstadoDelFormulario> {
  if (error instanceof ErrorDeDominio && error.codigo === "reautenticacion_requerida") {
    revalidatePath(ruta);
    return rechazado(new ErrorDeDominio("pld_reautenticacion"), previo, formData, campos);
  }
  return rechazado(error, previo, formData, campos);
}

export async function emitirAvisoAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
  const ctx = await exigirContextoOperacion();
  try {
    await emitirAviso(ctx, {
      formId: formData.get("formId"), tipo: texto(formData, "tipo"), descripcion: texto(formData, "descripcion"),
      companyId: texto(formData, "companyId"), mencionada: texto(formData, "mencionada"), superior: texto(formData, "superior"),
    });
  } catch (error) {
    return rechazado(error, previo, formData, ["tipo", "companyId", "descripcion", "mencionada", "superior"]);
  }
  listo("/operacion/avisos", "pld_aviso_emitido");
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
    return fallo(error, caso(casoId), "alertas-titulo");
  }
  listo(caso(casoId), "pld_alerta_sumada");
}

export async function agregarNotaAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
  const ctx = await exigirContextoOperacion();
  const casoId = texto(formData, "casoId");
  try {
    await agregarNota(ctx, { casoId, formId: formData.get("formId"), texto: texto(formData, "texto") });
  } catch (error) {
    return rechazado(error, previo, formData, ["texto"]);
  }
  listo(caso(casoId), "pld_nota_agregada");
}

export async function cargarDocumentoPldAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const casoId = texto(formData, "casoId");
  try {
    const archivo = await archivoDelFormulario(formData.get("archivo"));
    await cargarDocumentoPld(ctx, { casoId, formId: formData.get("formId"), archivo }, { almacen: almacenVercel() });
  } catch (error) {
    return fallo(error, caso(casoId), "documentos-titulo");
  }
  listo(caso(casoId), "pld_documento_cargado");
}

export async function registrarPropuestaAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
  const ctx = await exigirContextoOperacion();
  const casoId = texto(formData, "casoId");
  try {
    await registrarPropuesta(ctx, { casoId, formId: formData.get("formId"), propuesta: texto(formData, "propuesta"), justificacion: texto(formData, "justificacion") });
  } catch (error) {
    return rechazado(error, previo, formData, ["propuesta", "justificacion"]);
  }
  listo(caso(casoId), "pld_propuesta_registrada");
}

export async function marcarVeinticuatroHorasAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
  const ctx = await exigirContextoOperacion();
  const casoId = texto(formData, "casoId");
  try {
    await marcarVeinticuatroHoras(ctx, { casoId, motivo: texto(formData, "motivo") });
  } catch (error) {
    return rechazado(error, previo, formData, ["motivo"]);
  }
  listo(caso(casoId), "pld_caso_24_horas");
}

export async function dictaminarCasoAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
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
    return rechazadoODecidir(error, previo, formData, ["resultado", "sesionId", "justificacion"], caso(casoId));
  }
  listo(caso(casoId), fueraDePlazo ? "pld_dictamen_fuera_de_plazo" : "pld_dictamen_registrado");
}

export async function registrarReportePldAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
  const ctx = await exigirContextoOperacion();
  const casoId = texto(formData, "casoId");
  let fueraDePlazo = false;
  try {
    ({ fueraDePlazo } = await registrarReportePld(ctx, {
      formId: formData.get("formId"), casoId, folio: texto(formData, "folio"), periodo: texto(formData, "periodo"),
      recibidoEn: texto(formData, "recibidoEn"), registros: texto(formData, "registros"),
    }));
  } catch (error) {
    return rechazado(error, previo, formData, ["folio", "periodo", "recibidoEn", "registros"]);
  }
  listo(caso(casoId), fueraDePlazo ? "pld_reporte_fuera_de_plazo" : "pld_reporte_registrado");
}

const CAMPOS_PARAMETROS = [
  "atipicoK", "atipicoHistorialMinimo", "fraccionN", "fraccionVentanaDias", "fraccionUmbral", "nominaPersonasPct", "factorGradoAlto", "motivo",
] as const;

export async function cambiarParametrosAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
  const ctx = await exigirContextoOperacion();
  const sesion = await sesionConFactor();
  try {
    await cambiarParametros(ctx, sesion, {
      formId: formData.get("formId"), atipicoK: texto(formData, "atipicoK"), atipicoHistorialMinimo: texto(formData, "atipicoHistorialMinimo"),
      fraccionN: texto(formData, "fraccionN"), fraccionVentanaDias: texto(formData, "fraccionVentanaDias"), fraccionUmbral: texto(formData, "fraccionUmbral"),
      nominaPersonasPct: texto(formData, "nominaPersonasPct"), factorGradoAlto: texto(formData, "factorGradoAlto"), motivo: texto(formData, "motivo"),
    });
  } catch (error) {
    return rechazadoODecidir(error, previo, formData, CAMPOS_PARAMETROS, "/operacion/pld/parametros");
  }
  listo("/operacion/pld/parametros", "pld_parametros_cambiados");
}

// Comité.

export async function cambiarModoAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
  const ctx = await exigirContextoOperacion();
  const sesion = await sesionConFactor();
  try {
    await cambiarModoDictamen(ctx, sesion, { formId: formData.get("formId"), modo: texto(formData, "modo"), oficialId: texto(formData, "oficialId"), motivo: texto(formData, "motivo") });
  } catch (error) {
    return rechazadoODecidir(error, previo, formData, ["modo", "oficialId", "motivo"], "/operacion/comite");
  }
  listo("/operacion/comite", "pld_modo_cambiado");
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
  listo("/operacion/comite", "pld_integrantes_registrados");
}

export async function registrarAuditorAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
  const ctx = await exigirContextoOperacion();
  try {
    await registrarAuditor(ctx, {
      formId: formData.get("formId"), nombre: texto(formData, "nombre"), cargoEntidad: texto(formData, "cargoEntidad"),
      rfc: texto(formData, "rfc"), curp: texto(formData, "curp"), designadoEl: texto(formData, "designadoEl"),
    });
  } catch (error) {
    return rechazado(error, previo, formData, ["nombre", "cargoEntidad", "rfc", "curp", "designadoEl"]);
  }
  listo("/operacion/comite", "pld_auditor_registrado");
}

export async function registrarComunicacionAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
  const ctx = await exigirContextoOperacion();
  try {
    await registrarComunicacion(ctx, {
      formId: formData.get("formId"), folio: texto(formData, "folio"), recibidoEn: texto(formData, "recibidoEn"),
      integrantes: formData.getAll("integrantes"), bajas: formData.getAll("bajas"),
    });
  } catch (error) {
    return rechazado(error, previo, formData, ["folio", "recibidoEn"], ["integrantes", "bajas"]);
  }
  listo("/operacion/comite", "pld_comunicacion_registrada");
}

export async function registrarSesionAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
  const ctx = await exigirContextoOperacion();
  const sesionId = texto(formData, "formId");
  let quorum = false;
  try {
    ({ quorum } = await registrarSesion(ctx, {
      formId: sesionId, celebradaEl: texto(formData, "celebradaEl"), presentes: formData.getAll("presentes"), auditorPresente: texto(formData, "auditorPresente"),
    }));
  } catch (error) {
    return rechazado(error, previo, formData, ["celebradaEl"], ["presentes", "auditorPresente"]);
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
    return fallo(error, sesionComite(sesionId), "votaciones-titulo");
  }
  listo(sesionComite(sesionId), "pld_voto_registrado");
}

export async function cargarActaAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const sesionId = texto(formData, "sesionId");
  try {
    const archivo = await archivoDelFormulario(formData.get("archivo"));
    await cargarActaFirmada(ctx, { formId: formData.get("formId"), sesionId, archivo }, { almacen: almacenVercel() });
  } catch (error) {
    return fallo(error, sesionComite(sesionId), "acta-titulo");
  }
  listo(sesionComite(sesionId), "pld_acta_cargada");
}

// Reportes periódicos y clave de la entidad.

export async function registrarEntidadAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
  const ctx = await exigirContextoOperacion();
  try {
    await registrarEntidad(ctx, { formId: formData.get("formId"), claveCasfim: texto(formData, "claveCasfim"), claveOrganoSupervisor: texto(formData, "claveOrganoSupervisor") });
  } catch (error) {
    return rechazado(error, previo, formData, ["claveCasfim", "claveOrganoSupervisor"]);
  }
  listo("/operacion/reportes", "pld_entidad_registrada");
}

export async function registrarPeriodicoAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
  const ctx = await exigirContextoOperacion();
  try {
    await registrarPeriodico(ctx, {
      formId: formData.get("formId"), reporte: texto(formData, "reporte"), periodo: texto(formData, "periodo"), folio: texto(formData, "folio"),
      recibidoEn: texto(formData, "recibidoEn"), registros: texto(formData, "registros"),
    });
  } catch (error) {
    return rechazado(error, previo, formData, ["folio", "recibidoEn", "registros"]);
  }
  listo("/operacion/reportes", "pld_periodico_registrado");
}
