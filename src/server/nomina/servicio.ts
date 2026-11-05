import { randomUUID } from "node:crypto";

import { clabeValida } from "../../dominio/clabe";
import { siguientePago, sumarCentavos, validarConfiguracionNomina, type EntradaNomina } from "../../dominio/nomina";
import { estaDeBaja, fechaValida, hoyEnMexico } from "../../dominio/personas";
import { exigir, exigirEmpresa, puede, type ContextoDeTenant } from "../../nucleo/contexto";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { actorDeCliente, auditar as auditarPorDefecto, type Auditar } from "../bitacora/auditar";
import { repositorioPg } from "./repositorio";
import type { LecturaNomina, LoteItem, LoteResumen, RepositorioNomina } from "./tipos";

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
  return listo.repositorio.leer(conEmpresa, hoyEnMexico(listo.ahora()));
}

export async function leerLoteNomina(
  ctx: ContextoDeTenant | null | undefined,
  loteId: string,
  deps?: DependenciasNomina,
): Promise<{ lote: LoteResumen; items: LoteItem[] } | null> {
  const conEmpresa = exigirEmpresa(ctx);
  if (!puede(conEmpresa, "cliente.maestro.ver")) throw new ErrorDeDominio("maestro_no_disponible");
  if (!uuidValido(loteId)) throw new ErrorDeDominio("lote_ausente");
  const listo = resolver(deps);
  return listo.repositorio.lote(conEmpresa, loteId);
}

export async function configurarNomina(
  ctx: ContextoDeTenant | null | undefined,
  entrada: EntradaNomina & { personaId?: unknown; clabe?: unknown },
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
    let clabe = persona.clabe;
    if (typeof entrada.clabe === "string" && entrada.clabe.trim()) {
      const leida = clabeValida(entrada.clabe);
      if (!leida.ok) throw new ErrorDeDominio("clabe_invalida");
      clabe = leida.clabe;
    }
    if (nomina.destino === "clabe" && !clabe) throw new ErrorDeDominio("clabe_invalida");
    const actor = actorDeCliente(conEmpresa);
    if (clabe && clabe !== persona.clabe) {
      await listo.auditar(tx.consulta, actor, { accion: "editar_persona", identificador: personaId });
      await tx.actualizarClabe(personaId, clabe);
    }
    await listo.auditar(tx.consulta, actor, {
      accion: "configurar_nomina",
      identificador: personaId,
      cambio: { neto_anterior: anterior?.netoCentavos ?? null, neto_nuevo: nomina.netoCentavos },
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
  return listo.repositorio.conEmpresa(conEmpresa, async (tx) => {
    const fecha = typeof fechaEntrada === "string" && fechaEntrada
      ? fechaEntrada
      : await tx.primeraFechaVencida(hoy);
    if (!fecha) throw new ErrorDeDominio("nomina_sin_vencimientos");
    if (fecha > hoy) throw new ErrorDeDominio("nomina_aun_no_vence");
    const existente = await tx.lotePorFecha(fecha);
    if (existente) return { id: existente, repetida: true };
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
      const proximo = siguientePago(persona.proximoPagoEn, persona.frecuencia, persona.anclaDia);
      await listo.auditar(tx.consulta, actor, { accion: "avanzar_calendario_nomina", identificador: persona.id });
      await tx.avanzarPerfil(persona.id, proximo);
    }
    return { id, repetida: false };
  });
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
