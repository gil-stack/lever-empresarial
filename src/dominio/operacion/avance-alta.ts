import type { EstadoCliente } from "./estados";

/**
 * El alta de un cliente como recorrido: seis pasos en el orden en que pasan, cada uno con el rol que lo hace. Es solo la
 * lectura de lo que ya hay en la base (expediente, dictamen, riesgo, activación, invitación); las reglas siguen en la
 * base y en sus servicios (dos personas, el candado de activación, la invitación solo con la empresa activa).
 */
export type ClavePasoAlta = "registro" | "expediente" | "dictamen" | "riesgo" | "activacion" | "administrador";

/** hecho · en_curso (alguien ya lo empezó o lo está esperando) · atencion (hay que corregir algo) · pendiente. */
export type EstadoPasoAlta = "hecho" | "en_curso" | "atencion" | "pendiente";

export type PasoAlta = {
  clave: ClavePasoAlta;
  titulo: string;
  /** El rol que lo hace, como lo nombra la pantalla Personal. */
  rol: string;
  estado: EstadoPasoAlta;
  /** Una frase de dónde está o qué falta. */
  detalle: string;
};

export type HechosDelAlta = {
  estado: EstadoCliente;
  /** Hay un borrador del expediente abierto. */
  borrador: boolean;
  /** La última versión enviada del expediente y su dictamen (null mientras Cumplimiento no la dictamina). */
  enviada: { resultado: "aprobado" | "observado" | "rechazado" | null } | null;
  /** La última calificación de riesgo de la versión enviada: vigente o vencida. */
  riesgo: "vigente" | "vencida" | null;
  /** La última solicitud de activación. */
  activacion: "pendiente" | "aprobada" | "rechazada" | null;
  /** La última invitación del primer administrador. */
  invitacion: "vigente" | "usada" | "vencida" | "revocada" | null;
  /** El primer administrador ya entró. */
  administradorActivo: boolean;
};

export type AvanceAlta = {
  pasos: PasoAlta[];
  hechos: number;
  total: number;
  /** El primer paso que falta, o null si el alta terminó. */
  siguiente: PasoAlta | null;
};

export const PASOS_ALTA: ReadonlyArray<{ clave: ClavePasoAlta; titulo: string; rol: string; explica: string }> = [
  { clave: "registro", titulo: "Registro", rol: "Administración u Originación", explica: "Razón social, RFC, datos fiscales y quién será el administrador." },
  {
    clave: "expediente",
    titulo: "Expediente",
    rol: "Originación",
    explica: "Datos generales, representantes, accionistas y documentos. Se envía a revisión.",
  },
  { clave: "dictamen", titulo: "Dictamen", rol: "Cumplimiento", explica: "Otra persona revisa el expediente y lo aprueba, observa o rechaza." },
  { clave: "riesgo", titulo: "Grado de riesgo", rol: "Cumplimiento", explica: "Califica la actividad y la zona del cliente." },
  {
    clave: "activacion",
    titulo: "Activación",
    rol: "Originación pide · Aprobación decide",
    explica: "Con el expediente aprobado y el riesgo vigente, otra persona activa la empresa.",
  },
  {
    clave: "administrador",
    titulo: "Primer administrador",
    rol: "Administración",
    explica: "Se le envía la invitación; al aceptarla crea su contraseña y su segundo factor.",
  },
];

const YA_ACTIVADA: ReadonlySet<EstadoCliente> = new Set(["activa", "suspendida"]);

export function avanceDelAlta(h: HechosDelAlta): AvanceAlta {
  const activada = YA_ACTIVADA.has(h.estado);
  const resultado = h.enviada?.resultado ?? null;

  const expediente = ((): [EstadoPasoAlta, string] => {
    if (activada) return ["hecho", "Enviado y aprobado."];
    if (h.borrador && (resultado === "observado" || resultado === "rechazado")) return ["en_curso", "Hay un borrador nuevo con las correcciones."];
    if (h.enviada && resultado !== "observado" && resultado !== "rechazado") return ["hecho", "Enviado a revisión."];
    if (h.enviada) return ["atencion", "Cumplimiento pidió cambios: abre un borrador nuevo y corrígelo."];
    if (h.borrador) return ["en_curso", "En captura: falta enviarlo a revisión."];
    return ["pendiente", "Todavía no se abre."];
  })();

  const dictamen = ((): [EstadoPasoAlta, string] => {
    if (activada || resultado === "aprobado") return ["hecho", "Aprobado por Cumplimiento."];
    if (resultado === "observado") return ["atencion", "Observado: falta corregir el expediente."];
    if (resultado === "rechazado") return ["atencion", "Rechazado: revisa el motivo en el expediente."];
    if (h.enviada) return ["en_curso", "Esperando a Cumplimiento."];
    return ["pendiente", "Empieza cuando se envíe el expediente."];
  })();

  const riesgo = ((): [EstadoPasoAlta, string] => {
    if (h.riesgo === "vigente") return ["hecho", "Calificado y vigente."];
    if (h.riesgo === "vencida") return activada ? ["atencion", "La calificación venció: toca revisarla."] : ["atencion", "La calificación venció: califícalo otra vez."];
    if (activada) return ["hecho", "Calificado."];
    if (resultado === "aprobado") return ["en_curso", "Falta que Cumplimiento lo califique."];
    return ["pendiente", "Después del dictamen."];
  })();

  const activacion = ((): [EstadoPasoAlta, string] => {
    if (activada) return h.estado === "suspendida" ? ["hecho", "Activada; hoy está suspendida."] : ["hecho", "Empresa activa."];
    if (h.estado === "en_alta") return ["en_curso", "Pedida: la decide otra persona en Aprobaciones."];
    if (h.activacion === "rechazada") return ["atencion", "La activación se rechazó: revisa el motivo y vuelve a pedirla."];
    if (resultado === "aprobado" && h.riesgo === "vigente") return ["en_curso", "Lista para pedirse."];
    return ["pendiente", "Con el expediente aprobado y el riesgo vigente."];
  })();

  const administrador = ((): [EstadoPasoAlta, string] => {
    if (h.administradorActivo) return ["hecho", "Ya entró a Lever."];
    if (h.estado === "suspendida") return ["atencion", "Mientras esté suspendida no salen invitaciones."];
    if (!activada) return ["pendiente", "La invitación sale cuando la empresa esté activa."];
    if (h.invitacion === "vigente") return ["en_curso", "Invitado: falta que acepte."];
    if (h.invitacion === "vencida" || h.invitacion === "revocada") return ["atencion", "La invitación ya no sirve: envía otra."];
    return ["en_curso", "Lista para enviarle la invitación."];
  })();

  const estados: Record<ClavePasoAlta, [EstadoPasoAlta, string]> = {
    registro: ["hecho", "Registrado como prospecto."],
    expediente,
    dictamen,
    riesgo,
    activacion,
    administrador,
  };
  const pasos = PASOS_ALTA.map(({ clave, titulo, rol }) => ({ clave, titulo, rol, estado: estados[clave][0], detalle: estados[clave][1] }));
  const hechos = pasos.filter((paso) => paso.estado === "hecho").length;
  return { pasos, hechos, total: pasos.length, siguiente: pasos.find((paso) => paso.estado !== "hecho") ?? null };
}
