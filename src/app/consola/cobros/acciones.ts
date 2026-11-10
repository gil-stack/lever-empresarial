"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { avisoSinNuevos } from "@/dominio/cobranza/estado-cuenta";
import type { EstadoFlujo } from "@/dominio/flujo/entradas";
import { confirmarEstadoDeCuenta, prepararEstadoDeCuenta, type ResultadoPreparar, type VistaPrevia } from "@/server/cobranza/estado-cuenta";
import {
  agregarPlan,
  anularPago,
  aplicarPago,
  archivarCliente,
  cambiarRecordatorios,
  cancelarCargo,
  cancelarPlan,
  capturarMontoVariable,
  configurarCobranza,
  crearCargoUnico,
  darDeAltaCliente,
  editarCliente,
  editarPlan,
  enviarCobro,
  ErrorDeCaptura,
  pausarPlan,
  reanudarPlan,
  registrarPagoManual,
  revertirAplicacion,
  simularAbono,
} from "@/server/cobranza/servicio";
import type { ResultadoCorreo } from "@/server/cobranza/correo";
import { contextoDeAccion, errorConSecreto, sesionSegura } from "@/server/entrada";
import { ErrorDeDominio } from "@/server/session";

/**
 * Acciones de la cobranza. Cada una vuelve a pedir el contexto de la sesión;
 * el servicio exige cliente.flujo.editar aunque el formulario llegue armado a
 * mano, y la base lo vuelve a exigir.
 */

const RECHAZO: Record<string, { titulo: string; mensaje: string }> = {
  sin_permiso: { titulo: "Sin permiso para cambiar la cobranza", mensaje: "Tu rol puede ver la cobranza, pero la cambian administración o finanzas." },
  sesion_ausente: { titulo: "Tu sesión terminó", mensaje: "Vuelve a entrar y repite el cambio." },
  sin_empresa: { titulo: "Sin empresa elegida", mensaje: "Elige la empresa desde el menú y repite el cambio." },
  cobranza_sin_configurar: { titulo: "Primero configura dónde te pagan", mensaje: "Captura la CLABE donde tus clientes te depositan y el correo de contacto. Después da de alta al cliente." },
  reautenticacion_requerida: { titulo: "Confirma que eres tú", mensaje: "Cambiar la CLABE, el beneficiario o el correo de contacto exige un segundo factor de los últimos 30 minutos. Sal, vuelve a entrar y repite el cambio." },
  formulario_ya_enviado: { titulo: "Este formulario ya se envió con otros datos", mensaje: "Recarga la página para capturar uno nuevo." },
  entrada_invalida: { titulo: "No se entendió el cambio", mensaje: "Vuelve a intentar desde la página." },
  cliente_no_encontrado: { titulo: "No encontramos a ese cliente", mensaje: "Recarga la página. Si lo archivaron, ya no admite cambios." },
  cliente_archivado: { titulo: "Ese cliente está archivado", mensaje: "Un cliente archivado ya no admite cambios." },
  cliente_distinto: { titulo: "Ese pago es de otro cliente", mensaje: "Solo se aplica a un cargo del mismo cliente. Elige otro cargo." },
  plan_no_encontrado: { titulo: "No encontramos ese plan", mensaje: "Recarga la página." },
  plan_cancelado: { titulo: "Ese plan ya está cancelado", mensaje: "Para volver a cobrarle, agrega un plan nuevo." },
  plan_no_valido: { titulo: "Ese cambio no aplica al plan", mensaje: "Solo se pausa un plan activo y solo se reanuda uno en pausa. Recarga la página." },
  cargo_ausente: { titulo: "No encontrado", mensaje: "Recarga la lista." },
  cargo_ya_resuelto: { titulo: "Ese cargo ya cambió", mensaje: "Alguien lo pagó, lo canceló o le puso monto antes. Recarga la lista." },
  cargo_no_cancelable: { titulo: "Ese cargo no se puede cancelar", mensaje: "Un cargo con pagos aplicados no se cancela: revierte primero la aplicación." },
  cargo_no_valido: { titulo: "Ese cargo no es válido", mensaje: "Revisa los datos y vuelve a intentar." },
  reenvios_agotados: { titulo: "Ya se reenvió cinco veces", mensaje: "Ese cargo llegó al tope de reenvíos. Comunícate con el cliente por otro medio." },
  reenvio_reciente: { titulo: "Espera unos minutos", mensaje: "El último correo de ese cargo salió hace menos de 10 minutos." },
  correo_cerrado: { titulo: "Ese correo ya cambió", mensaje: "Recarga la página para ver cómo quedó." },
  pago_ausente: { titulo: "No encontramos ese pago", mensaje: "Recarga la lista." },
  pago_ya_aplicado: { titulo: "Ese pago ya no tiene saldo libre", mensaje: "Alguien lo aplicó antes. Recarga la lista." },
  pago_no_anulable: { titulo: "Ese pago no se puede anular", mensaje: "Solo se anula un pago registrado a mano y sin nada aplicado: revierte antes sus aplicaciones." },
  pago_anulado: { titulo: "Ese pago está anulado", mensaje: "Un pago anulado ya no admite cambios." },
  aplicacion_no_valida: { titulo: "Esa aplicación ya se revirtió", mensaje: "Recarga la página." },
  solo_demostracion: { titulo: "Solo en una empresa de demostración", mensaje: "El simulador de abonos no existe en una empresa real." },
  sin_abono_previo: { titulo: "No hay un abono que repetir", mensaje: "Primero simula un abono a ese cargo." },
  cobranza_inmutable: { titulo: "Ese dato no se cambia", mensaje: "Lo que ya quedó registrado no se reescribe." },
  archivo_no_disponible: { titulo: "No se guardó el comprobante", mensaje: "El almacén de archivos no respondió. No se registró el pago; vuelve a intentar." },
  importacion_ausente: { titulo: "No encontramos esa importación", mensaje: "Recarga la página." },
  importacion_ya_confirmada: { titulo: "Esa importación ya estaba confirmada", mensaje: "Recarga la página para ver cómo quedó." },
  renglon_ya_resuelto: { titulo: "Ese renglón ya estaba resuelto", mensaje: "Recarga la página." },
  auditoria_no_disponible: { titulo: "No se guardó", mensaje: "No se pudo dejar el registro en la bitácora, así que el cambio no se aplicó." },
  base_no_disponible: { titulo: "No se guardó", mensaje: "La base no respondió. No se aplicó ningún cambio; vuelve a intentar." },
};

const CORREO: Record<ResultadoCorreo, string> = {
  enviado: "El correo de cobro salió a los correos del cliente.",
  simulado: "Empresa de demostración: el correo quedó simulado y no salió.",
  fallido: "El correo no salió. La tarea diaria lo vuelve a intentar.",
  ya_enviado: "Ese correo ya había salido.",
  tope: "Llegaste al tope de 300 correos en 24 horas. Sale en la siguiente corrida.",
  no_aplica: "El cargo ya no está pendiente: no se mandó correo.",
};

function traducir(error: unknown): EstadoFlujo {
  if (error instanceof ErrorDeCaptura) return { tipo: "invalido", errores: error.errores };
  if (error instanceof ErrorDeDominio) {
    if (error.codigo === "rfc_duplicado") {
      return { tipo: "invalido", errores: [{ campo: "rfc", mensaje: "Ya tienes un cliente activo con ese RFC. Búscalo en la lista de clientes." }] };
    }
    const rechazo = RECHAZO[error.codigo] ?? RECHAZO.base_no_disponible!;
    return { tipo: "rechazado", ...rechazo };
  }
  if (errorConSecreto(error)) return { tipo: "rechazado", ...RECHAZO.base_no_disponible! };
  throw error;
}

function refrescar(): void {
  for (const ruta of ["/consola", "/consola/flujo", "/consola/cobros", "/consola/pendientes"]) revalidatePath(ruta);
  revalidatePath("/consola/cobros", "layout");
}

async function ejecutar(fn: () => Promise<string>): Promise<EstadoFlujo> {
  try {
    const mensaje = await fn();
    refrescar();
    return { tipo: "listo", mensaje };
  } catch (error) {
    return traducir(error);
  }
}

function campos(formData: FormData, nombres: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(nombres.map((nombre) => [nombre, formData.get(nombre) ?? undefined]));
}

async function leerArchivo(formData: FormData, nombre: string, tope: number, mensajeGrande: string): Promise<{ nombre: string; bytes: Uint8Array } | null> {
  const valor = formData.get(nombre);
  if (!(valor instanceof File) || valor.size === 0) return null;
  if (valor.size > tope) throw new ErrorDeCaptura([{ campo: nombre, mensaje: mensajeGrande }]);
  return { nombre: valor.name, bytes: new Uint8Array(await valor.arrayBuffer()) };
}

const CAMPOS_ALTA = ["nombre", "rfc", "correos", "concepto", "tipo", "monto", "periodicidad", "primerVencimiento", "fin", "altaId"] as const;

/** Alta de cliente con plan: si queda, lleva a su ficha con el resultado del primer correo. */
export async function enviarAlta(_previo: EstadoFlujo, formData: FormData): Promise<EstadoFlujo> {
  let destino: string;
  try {
    const ctx = await contextoDeAccion();
    const hecho = await darDeAltaCliente(ctx, campos(formData, CAMPOS_ALTA));
    refrescar();
    const empresa = ctx?.empresa?.id ?? "";
    const correo = hecho.correo ?? (hecho.cargos === 0 ? "programado" : "manual");
    destino = `/c/${empresa}/consola/cobros/clientes/${hecho.clienteId}?alta=${correo}`;
  } catch (error) {
    return traducir(error);
  }
  redirect(destino);
}

export async function enviarConfiguracion(_previo: EstadoFlujo, formData: FormData): Promise<EstadoFlujo> {
  return ejecutar(async () => {
    const sesion = await sesionSegura();
    if (!sesion) throw new ErrorDeDominio("reautenticacion_requerida");
    const hecho = await configurarCobranza(await contextoDeAccion(), campos(formData, [
      "clabe", "beneficiario", "correoContacto", "emitirDiasAntes", "antesDias", "avisoElDia", "despuesCadaDias", "despuesTope", "envioAutomatico",
    ]), sesion);
    const guardado = hecho.clabeCambio ? "La CLABE de cobranza quedó guardada." : "La configuración de cobranza quedó guardada.";
    return hecho.avisos > 0
      ? `${guardado} Avisamos del cambio a administración y finanzas (${hecho.avisos} ${hecho.avisos === 1 ? "correo" : "correos"}).`
      : guardado;
  });
}

export async function enviarEdicionCliente(_previo: EstadoFlujo, formData: FormData): Promise<EstadoFlujo> {
  return ejecutar(async () => {
    await editarCliente(await contextoDeAccion(), campos(formData, ["clienteId", "nombre", "rfc", "correos"]));
    return "Los datos del cliente quedaron guardados.";
  });
}

export async function enviarArchivo(_previo: EstadoFlujo, formData: FormData): Promise<EstadoFlujo> {
  return ejecutar(async () => {
    await archivarCliente(await contextoDeAccion(), campos(formData, ["clienteId", "motivo"]));
    return "El cliente quedó archivado y sus planes cancelados. Lo que ya debía se sigue viendo.";
  });
}

export async function enviarRecordatorios(_previo: EstadoFlujo, formData: FormData): Promise<EstadoFlujo> {
  return ejecutar(async () => {
    await cambiarRecordatorios(await contextoDeAccion(), campos(formData, ["clienteId", "activos"]));
    return formData.get("activos") === "si" ? "Los recordatorios del cliente quedaron encendidos." : "Los recordatorios del cliente quedaron apagados. El cobro de cada periodo le sigue llegando.";
  });
}

export async function enviarPlanNuevo(_previo: EstadoFlujo, formData: FormData): Promise<EstadoFlujo> {
  return ejecutar(async () => {
    const hecho = await agregarPlan(await contextoDeAccion(), campos(formData, ["clienteId", "altaId", "concepto", "tipo", "monto", "periodicidad", "primerVencimiento", "fin"]));
    return `El plan quedó dado de alta.${hecho.correo ? ` ${CORREO[hecho.correo]}` : ""}`;
  });
}

export async function enviarEdicionPlan(_previo: EstadoFlujo, formData: FormData): Promise<EstadoFlujo> {
  return ejecutar(async () => {
    await editarPlan(await contextoDeAccion(), campos(formData, ["planId", "concepto", "monto", "fin"]));
    return "El plan quedó actualizado. Los cargos ya emitidos no cambian; el cambio cuenta desde el siguiente periodo.";
  });
}

export async function enviarEstadoPlan(_previo: EstadoFlujo, formData: FormData): Promise<EstadoFlujo> {
  return ejecutar(async () => {
    const ctx = await contextoDeAccion();
    const accion = formData.get("accion");
    const entrada = campos(formData, ["planId", "motivo"]);
    if (accion === "pausar") {
      await pausarPlan(ctx, entrada);
      return "El plan quedó en pausa. No se generan cargos hasta que lo reanudes.";
    }
    if (accion === "reanudar") {
      const hecho = await reanudarPlan(ctx, entrada);
      return `El plan se reanudó desde hoy. Los periodos que vencieron en la pausa quedan omitidos.${hecho.correo ? ` ${CORREO[hecho.correo]}` : ""}`;
    }
    if (accion === "cancelar") {
      await cancelarPlan(ctx, entrada);
      return "El plan quedó cancelado. Lo ya emitido se sigue debiendo; los periodos sin monto se cancelaron.";
    }
    throw new ErrorDeDominio("entrada_invalida");
  });
}

export async function enviarCargoUnico(_previo: EstadoFlujo, formData: FormData): Promise<EstadoFlujo> {
  return ejecutar(async () => {
    const hecho = await crearCargoUnico(await contextoDeAccion(), campos(formData, ["clienteId", "altaId", "concepto", "monto", "vencimiento"]));
    return `El cargo quedó emitido.${hecho.correo ? ` ${CORREO[hecho.correo]}` : ""}`;
  });
}

export async function enviarMontoVariable(_previo: EstadoFlujo, formData: FormData): Promise<EstadoFlujo> {
  return ejecutar(async () => {
    const hecho = await capturarMontoVariable(await contextoDeAccion(), campos(formData, ["cargoId", "monto"]));
    return `El cargo quedó emitido con su monto.${hecho.correo ? ` ${CORREO[hecho.correo]}` : ""}`;
  });
}

export async function enviarCancelacionCargo(_previo: EstadoFlujo, formData: FormData): Promise<EstadoFlujo> {
  return ejecutar(async () => {
    await cancelarCargo(await contextoDeAccion(), campos(formData, ["cargoId", "motivo"]));
    return "El cargo quedó cancelado con su motivo.";
  });
}

export async function enviarCorreoDeCobro(_previo: EstadoFlujo, formData: FormData): Promise<EstadoFlujo> {
  return ejecutar(async () => CORREO[await enviarCobro(await contextoDeAccion(), campos(formData, ["cargoId"]))]);
}

export async function enviarPagoManual(_previo: EstadoFlujo, formData: FormData): Promise<EstadoFlujo> {
  return ejecutar(async () => {
    const comprobante = await leerArchivo(formData, "comprobante", 4 * 1024 * 1024, "El comprobante pesa más de 4 MB.");
    const hecho = await registrarPagoManual(await contextoDeAccion(), campos(formData, ["altaId", "cargoId", "clienteId", "monto", "recibidoEl", "claveRastreo"]), comprobante);
    if (hecho.parecido) return "El pago quedó registrado como posible duplicado: ya hay un pago de otra fuente con el mismo monto, la misma referencia y casi la misma fecha. Quedó en «Por conciliar» sin aplicarse.";
    if (hecho.posibleDuplicado) return "El pago quedó registrado como posible duplicado: esa clave de rastreo ya estaba en otro pago. Quedó en «Por conciliar» sin aplicarse.";
    return hecho.aplicadoCentavos > 0 ? "El pago quedó registrado y aplicado al cargo. Lo que sobre queda como saldo a favor del cliente." : "El pago quedó registrado. Aplícalo desde «Por conciliar».";
  });
}

export async function enviarAplicacion(_previo: EstadoFlujo, formData: FormData): Promise<EstadoFlujo> {
  return ejecutar(async () => {
    await aplicarPago(await contextoDeAccion(), campos(formData, ["pagoId", "cargoId"]));
    return "El pago quedó aplicado al cargo.";
  });
}

export async function enviarReversion(_previo: EstadoFlujo, formData: FormData): Promise<EstadoFlujo> {
  return ejecutar(async () => {
    await revertirAplicacion(await contextoDeAccion(), campos(formData, ["aplicacionId", "motivo"]));
    return "La aplicación quedó revertida: el cargo vuelve a deber y el pago queda libre para aplicarse.";
  });
}

export async function enviarAnulacion(_previo: EstadoFlujo, formData: FormData): Promise<EstadoFlujo> {
  return ejecutar(async () => {
    const hecho = await anularPago(await contextoDeAccion(), campos(formData, ["pagoId", "motivo"]));
    return hecho.descartado ? "El posible duplicado quedó descartado con su motivo: el depósito sigue contado una sola vez." : "El pago quedó anulado con su motivo.";
  });
}

const DEMO: Record<string, string> = {
  referencia: "El abono llegó con la referencia del cargo y se aplicó solo.",
  referencia_pagada: "Llegó otra transferencia con la referencia de un cargo ya pagado: quedó como posible duplicado, sin aplicarse.",
  clabe_y_monto: "Sin referencia, se identificó por la cuenta del cliente y el monto exacto, y se aplicó.",
  cliente_sin_coincidencia: "Se supo el cliente, pero el monto no coincide con un solo cargo: quedó en «Por conciliar».",
  sin_identificar: "No se pudo identificar: quedó en «Por conciliar».",
  rastreo_ya_registrado: "Esa clave de rastreo ya estaba registrada: quedó como posible duplicado.",
  parecido_de_otra_fuente: "Ya hay un pago de otra fuente con el mismo monto, la misma referencia y casi la misma fecha: quedó como posible duplicado, sin aplicarse.",
};

export async function enviarSimulacion(_previo: EstadoFlujo, formData: FormData): Promise<EstadoFlujo> {
  return ejecutar(async () => {
    const hecho = await simularAbono(await contextoDeAccion(), campos(formData, ["cargoId", "variante"]));
    if (hecho.repetido) return "Ese aviso ya había llegado: no se creó otro pago.";
    return DEMO[hecho.motivo ?? ""] ?? "El abono simulado quedó registrado.";
  });
}

// Estado de cuenta -------------------------------------------------------------------

export type EstadoEstadoDeCuenta = EstadoFlujo | { tipo: "empatar"; vista: VistaPrevia; mensaje?: string };

export async function enviarEstadoDeCuenta(_previo: EstadoEstadoDeCuenta, formData: FormData): Promise<EstadoEstadoDeCuenta> {
  let destino: string | null = null;
  let resultado: ResultadoPreparar;
  try {
    const ctx = await contextoDeAccion();
    const archivoSubido = await leerArchivo(formData, "archivo", 2 * 1024 * 1024, "El archivo pesa más de 2 MB. Exporta un periodo más corto.");
    resultado = await prepararEstadoDeCuenta(ctx, campos(formData, [
      "banco", "empatar", "filaEncabezado", "columnaFecha", "columnaAbono", "columnaConcepto", "columnaReferencia", "columnaRastreo",
    ]), archivoSubido);
    if (resultado.tipo === "importado") destino = `/c/${ctx?.empresa?.id ?? ""}/consola/cobros/estado-de-cuenta?importacion=${resultado.importacionId}&nuevos=${resultado.nuevos}&repetidos=${resultado.repetidos}`;
  } catch (error) {
    return traducir(error);
  }
  if (destino) {
    refrescar();
    redirect(destino);
  }
  if (resultado.tipo === "empatar") return { tipo: "empatar", vista: resultado.vista };
  return { tipo: "rechazado", ...avisoSinNuevos(resultado.repetidos) };
}

export async function enviarConfirmacionEstadoDeCuenta(_previo: EstadoFlujo, formData: FormData): Promise<EstadoFlujo> {
  return ejecutar(async () => {
    const hecho = await confirmarEstadoDeCuenta(await contextoDeAccion(), {
      importacionId: formData.get("importacionId"),
      descartar: formData.getAll("descartar"),
    });
    const partes = [
      hecho.aplicados > 0 ? `${hecho.aplicados} ${hecho.aplicados === 1 ? "aplicado" : "aplicados"} a su cargo` : "",
      hecho.porConciliar > 0 ? `${hecho.porConciliar} en «Por conciliar»` : "",
      hecho.yaRegistrados > 0 ? `${hecho.yaRegistrados} ya ${hecho.yaRegistrados === 1 ? "estaba registrado" : "estaban registrados"}` : "",
      hecho.descartados > 0 ? `${hecho.descartados} ${hecho.descartados === 1 ? "descartado" : "descartados"}` : "",
    ].filter(Boolean);
    return `La importación quedó confirmada: ${partes.join(", ")}.`;
  });
}
