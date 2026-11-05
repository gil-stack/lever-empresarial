import { randomUUID } from "node:crypto";

import { siguientePago, sumarCentavos, validarConfiguracionNomina, type EntradaNomina, type FrecuenciaNomina } from "../../dominio/nomina";
import { estaDeBaja, fechaValida, hoyEnMexico } from "../../dominio/personas";
import { exigir, exigirEmpresa, puede, type ContextoDeTenant } from "../../nucleo/contexto";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { actorDeCliente, auditar as auditarPorDefecto, type Auditar } from "../bitacora/auditar";
import { repositorioPg } from "./repositorio";
import type { LecturaLote, LecturaNomina, LoteItem, RepositorioNomina, TransaccionNomina } from "./tipos";

export type DependenciasNomina = {
  repositorio?: RepositorioNomina;
  ahora?: () => Date;
  auditar?: Auditar;
};

export async function leerNomina(
  ctx: ContextoDeTenant | null | undefined,
  deps?: DependenciasNomina,
): Promise<LecturaNomina> {
  const conEmpresa = exigirEmpresa(ctx);
  if (!puede(conEmpresa, "cliente.maestro.ver")) throw new ErrorDeDominio("maestro_no_disponible");
  const listo = resolver(deps);
  const lectura = await listo.repositorio.leer(conEmpresa, hoyEnMexico(listo.ahora()));
  const detalle = puede(conEmpresa, "cliente.nomina.detalle.ver");
  // Quien no prepara ni autoriza ve totales y lotes, no el neto de cada persona.
  return { ...lectura, detalle, proximas: detalle ? lectura.proximas : [] };
}

export async function leerLoteNomina(
  ctx: ContextoDeTenant | null | undefined,
  loteId: string,
  deps?: DependenciasNomina,
): Promise<LecturaLote | null> {
  const conEmpresa = exigirEmpresa(ctx);
  if (!puede(conEmpresa, "cliente.maestro.ver")) throw new ErrorDeDominio("maestro_no_disponible");
  if (!uuidValido(loteId)) throw new ErrorDeDominio("lote_ausente");
  const listo = resolver(deps);
  const leido = await listo.repositorio.lote(conEmpresa, loteId);
  if (!leido) return null;
  const detalle = puede(conEmpresa, "cliente.nomina.detalle.ver");
  const veClabe = puede(conEmpresa, "cliente.personas.clabe.cambiar");
  const items: LoteItem[] = detalle
    ? leido.items.map((item) => (veClabe ? item : { ...item, clabe: null }))
    : [];
  return { lote: leido.lote, items, detalle };
}

/**
 * Programa neto, frecuencia, fecha y destino. No toca la CLABE: cambiarla
 * tiene su propio permiso, historial y reautenticación en Personas.
 */
export async function configurarNomina(
  ctx: ContextoDeTenant | null | undefined,
  entrada: EntradaNomina & { personaId?: unknown },
  deps?: DependenciasNomina,
): Promise<void> {
  const personaId = typeof entrada.personaId === "string" ? entrada.personaId.trim() : "";
  if (!uuidValido(personaId)) throw new ErrorDeDominio("persona_ausente");
  const conEmpresa = exigir(ctx, "cliente.maestro.editar");
  const listo = resolver(deps);
  const hoy = hoyEnMexico(listo.ahora());
  await listo.repositorio.conEmpresa(conEmpresa, async (tx) => {
    const persona = await tx.bloquearEmpleado(personaId);
    if (!persona) throw new ErrorDeDominio("persona_ausente");
    if (estaDeBaja(persona.bajaEn, hoy)) throw new ErrorDeDominio("persona_de_baja");
    const anterior = await tx.perfilAnterior(personaId);
    const validada = validarConfiguracionNomina(entrada, hoy, persona.altaEn, anterior?.proximoPagoEn);
    if (!validada.ok) throw new ErrorDeDominio("nomina_invalida");
    const nomina = validada.valor;
    if (await tx.lotePorFecha(nomina.proximoPagoEn)) throw new ErrorDeDominio("fecha_ya_preparada");
    if (nomina.destino === "clabe" && !persona.clabe) throw new ErrorDeDominio("clabe_requerida");
    const actor = actorDeCliente(conEmpresa);
    await listo.auditar(tx.consulta, actor, {
      accion: "configurar_nomina",
      identificador: personaId,
      cambio: {
        neto_anterior: anterior?.netoCentavos ?? null,
        neto_nuevo: nomina.netoCentavos,
        frecuencia_anterior: anterior?.frecuencia ?? null,
        frecuencia_nueva: nomina.frecuencia,
        destino_anterior: anterior?.destino ?? null,
        destino_nuevo: nomina.destino,
        pago_anterior: anterior?.proximoPagoEn ?? null,
        pago_nuevo: nomina.proximoPagoEn,
      },
    });
    await tx.guardarPerfil(personaId, nomina);
    if (nomina.destino === "tarjeta" && !await tx.tarjetaPendiente(personaId)) {
      const tarjetaId = randomUUID();
      await listo.auditar(tx.consulta, actor, { accion: "solicitar_tarjeta", identificador: tarjetaId });
      await tx.solicitarTarjeta(tarjetaId, personaId, conEmpresa.persona.id);
    }
  });
}

export async function prepararNomina(
  ctx: ContextoDeTenant | null | undefined,
  fechaEntrada?: unknown,
  deps?: DependenciasNomina,
): Promise<{ id: string; repetida: boolean }> {
  const conEmpresa = exigir(ctx, "cliente.pago.solicitar");
  if (!puede(conEmpresa, "cliente.maestro.ver")) throw new ErrorDeDominio("maestro_no_disponible");
  const listo = resolver(deps);
  const hoy = hoyEnMexico(listo.ahora());
  if (fechaEntrada !== undefined && fechaEntrada !== null && fechaEntrada !== "" && !fechaValida(fechaEntrada)) {
    throw new ErrorDeDominio("fecha_invalida");
  }
  const vista = typeof fechaEntrada === "string" && fechaEntrada ? fechaEntrada : null;
  return listo.repositorio.conEmpresa(conEmpresa, async (tx) => {
    // Un doble clic sobre la fecha que ya se preparó devuelve el mismo lote.
    if (vista) {
      const existente = await tx.lotePorFecha(vista);
      if (existente) return { id: existente, repetida: true };
    }
    // La fecha la decide el servidor: la más antigua vencida y sin lote. Una
    // fecha elegida por el cliente no puede adelantar ni saltar el calendario.
    const fecha = await tx.primeraFechaVencida(hoy);
    if (!fecha) throw new ErrorDeDominio(vista && vista > hoy ? "nomina_aun_no_vence" : "nomina_sin_vencimientos");
    if (vista && vista !== fecha) throw new ErrorDeDominio("nomina_fecha_distinta");
    const personas = await tx.personasParaPago(fecha);
    if (personas.length === 0) throw new ErrorDeDominio("nomina_sin_personas");
    if (personas.some((persona) => persona.destino === "clabe" && !persona.clabe)) {
      throw new ErrorDeDominio("destino_incompleto");
    }
    const id = randomUUID();
    const total = sumarCentavos(personas.map((persona) => persona.netoCentavos));
    const actor = actorDeCliente(conEmpresa);
    await listo.auditar(tx.consulta, actor, {
      accion: "preparar_nomina",
      identificador: id,
      cambio: { fecha_pago: fecha, total_centavos: total, personas: personas.length },
    });
    await tx.insertarLote({ id, fecha, total, actorId: conEmpresa.persona.id });
    for (const persona of personas) {
      await tx.insertarItem({
        id: randomUUID(),
        batchId: id,
        employeeId: persona.id,
        nombre: persona.nombre,
        neto: persona.netoCentavos,
        destino: persona.destino,
        clabe: persona.destino === "clabe" ? persona.clabe : null,
        destinoListo: persona.destino === "clabe" && persona.clabe !== null,
      });
      const proximo = await siguienteSinLote(tx, persona.proximoPagoEn, persona.frecuencia, persona.anclaDia);
      await listo.auditar(tx.consulta, actor, {
        accion: "avanzar_calendario_nomina",
        identificador: persona.id,
        cambio: { pago_anterior: persona.proximoPagoEn, pago_nuevo: proximo },
      });
      await tx.avanzarPerfil(persona.id, proximo);
    }
    return { id, repetida: false };
  });
}

/**
 * La siguiente fecha del calendario que todavía no tiene lote. Un lote ya
 * congelado no admite renglones nuevos; esa persona entra en el siguiente.
 */
async function siguienteSinLote(
  tx: Pick<TransaccionNomina, "lotePorFecha">,
  desde: string,
  frecuencia: FrecuenciaNomina,
  anclaDia: number,
): Promise<string> {
  let fecha = siguientePago(desde, frecuencia, anclaDia);
  for (let vuelta = 0; vuelta < 120 && await tx.lotePorFecha(fecha); vuelta += 1) {
    fecha = siguientePago(fecha, frecuencia, anclaDia);
  }
  return fecha;
}

function uuidValido(valor: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(valor);
}

function resolver(deps?: DependenciasNomina): Required<DependenciasNomina> {
  return {
    repositorio: deps?.repositorio ?? repositorioPg(),
    ahora: deps?.ahora ?? (() => new Date()),
    auditar: deps?.auditar ?? auditarPorDefecto,
  };
}
