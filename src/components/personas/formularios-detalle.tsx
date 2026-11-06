"use client";

import { useActionState, useState, type FormEvent } from "react";

import {
  enviarCancelacionBaja,
  enviarClabeNomina,
  enviarEdicionPersona,
  enviarNomina,
  enviarReenvioInvitacion,
} from "@/app/consola/personas/acciones";
import { clabeValida } from "@/dominio/clabe";
import { erroresDeConfiguracionNomina, type FrecuenciaNomina } from "@/dominio/nomina";
import {
  erroresDeAltaPersona,
  ESTADO_MAESTRO_INICIAL,
  type ErrorCampo,
} from "@/dominio/personas";
import type { PersonaVista } from "@/dominio/personas-vista";

import { AvisosFormulario, CampoFormulario } from "./estado-formulario";

/** Datos laborales. La CLABE y el destino no viajan aquí: tienen su propio formulario. */
export function FormularioEdicionPersona({
  persona,
  centros,
  jefes,
}: {
  persona: PersonaVista;
  centros: Array<{ id: string; nombre: string }>;
  jefes: Array<{ id: string; nombre: string }>;
}) {
  const [estado, accion, pendiente] = useActionState(enviarEdicionPersona, ESTADO_MAESTRO_INICIAL);
  const [local, setLocal] = useState<ErrorCampo[] | null>(null);
  const errores = local ?? (estado.tipo === "invalido" ? estado.errores : []);
  const mensaje = (campo: ErrorCampo["campo"]) => errores.find((error) => error.campo === campo)?.mensaje;

  function validar(event: FormEvent<HTMLFormElement>) {
    const datos = new FormData(event.currentTarget);
    const entrada = Object.fromEntries(datos.entries());
    const encontrados = erroresDeAltaPersona({ ...entrada, acceso: "no", nomina: "no" }, new Date().toISOString().slice(0, 10));
    if (encontrados.length > 0) {
      event.preventDefault();
      setLocal(encontrados);
      document.getElementById(encontrados[0]?.campo ?? "")?.focus();
    } else setLocal(null);
  }

  return (
    <form className="formulario-pareja" action={accion} onSubmit={validar} noValidate aria-busy={pendiente}>
      <input type="hidden" name="personaId" value={persona.id} />
      <div className="formulario-aviso-ancho"><AvisosFormulario estado={estado} errores={errores} /></div>
      <CampoFormulario id="nombre" etiqueta="Nombre" error={mensaje("nombre")}>
        <input id="nombre" name="nombre" defaultValue={persona.nombre} maxLength={120} required aria-invalid={mensaje("nombre") ? true : undefined} />
      </CampoFormulario>
      <CampoFormulario id="alta" etiqueta="Ingreso" error={mensaje("alta")}>
        <input id="alta" name="alta" type="date" defaultValue={persona.altaEn} required aria-invalid={mensaje("alta") ? true : undefined} />
      </CampoFormulario>
      <CampoFormulario id="centro" etiqueta="Área" error={mensaje("centro")}>
        <select id="centro" name="centroId" defaultValue={persona.centroId} required aria-invalid={mensaje("centro") ? true : undefined}>
          {centros.map((centro) => <option key={centro.id} value={centro.id}>{centro.nombre}</option>)}
        </select>
      </CampoFormulario>
      <CampoFormulario id="jefe" etiqueta="Jefe" pista="No se permiten ciclos jerárquicos." error={mensaje("jefe")}>
        <select id="jefe" name="jefeId" defaultValue={persona.jefeId ?? ""} aria-invalid={mensaje("jefe") ? true : undefined}>
          <option value="">Sin jefe</option>
          {jefes.map((jefe) => <option key={jefe.id} value={jefe.id}>{jefe.nombre}</option>)}
        </select>
      </CampoFormulario>
      <CampoFormulario id="presupuesto" etiqueta="Presupuesto individual mensual" error={mensaje("presupuesto")}>
        <input id="presupuesto" name="presupuesto" defaultValue={persona.presupuestoCentavos == null ? "" : (persona.presupuestoCentavos / 100).toFixed(2)} inputMode="decimal" aria-invalid={mensaje("presupuesto") ? true : undefined} />
      </CampoFormulario>
      <div className="acciones"><button className="boton" type="submit" disabled={pendiente}>{pendiente ? "Guardando…" : "Guardar datos laborales"}</button></div>
    </form>
  );
}

/** Neto, frecuencia, fecha y destino. Usa la CLABE vigente; no la cambia. */
export function FormularioNominaPersona({ persona, hoy }: { persona: PersonaVista; hoy: string }) {
  const nomina = persona.nomina;
  const [estado, accion, pendiente] = useActionState(enviarNomina, ESTADO_MAESTRO_INICIAL);
  const [destino, setDestino] = useState<"clabe" | "tarjeta">(nomina?.destino ?? (persona.clabeFinal ? "clabe" : "tarjeta"));
  const [frecuencia, setFrecuencia] = useState<FrecuenciaNomina>(nomina?.frecuencia ?? "quincenal");
  const [local, setLocal] = useState<ErrorCampo[] | null>(null);
  const errores = local ?? (estado.tipo === "invalido" ? estado.errores : []);
  const mensaje = (campo: ErrorCampo["campo"]) => errores.find((error) => error.campo === campo)?.mensaje;

  function validar(event: FormEvent<HTMLFormElement>) {
    const datos = new FormData(event.currentTarget);
    const entrada = Object.fromEntries(datos.entries());
    const encontrados = erroresDeConfiguracionNomina(entrada, hoy, persona.altaEn, nomina?.proximoPagoEn);
    if (destino === "clabe" && !persona.clabeFinal) {
      encontrados.push({ campo: "destino", mensaje: "Registra primero la CLABE de nómina." });
    }
    if (encontrados.length > 0) {
      event.preventDefault();
      setLocal(encontrados);
      document.getElementById(`nomina-${encontrados[0]?.campo ?? ""}`)?.focus();
    } else setLocal(null);
  }

  return (
    <form className="formulario-pareja" action={accion} onSubmit={validar} noValidate aria-busy={pendiente}>
      <input type="hidden" name="personaId" value={persona.id} />
      <input type="hidden" name="alta" value={persona.altaEn} />
      <input type="hidden" name="pagoAnterior" value={nomina?.proximoPagoEn ?? ""} />
      <div className="formulario-aviso-ancho"><AvisosFormulario estado={estado} errores={errores} prefijo="nomina-" /></div>
      <CampoFormulario id="nomina-neto" etiqueta="Neto por pago" pista="No calcula retenciones." error={mensaje("neto")}>
        <input id="nomina-neto" name="neto" defaultValue={nomina?.netoCentavos != null ? (nomina.netoCentavos / 100).toFixed(2) : ""} inputMode="decimal" required aria-invalid={mensaje("neto") ? true : undefined} />
      </CampoFormulario>
      <CampoFormulario id="nomina-frecuencia" etiqueta="Frecuencia" error={mensaje("frecuencia")}>
        <select id="nomina-frecuencia" name="frecuencia" value={frecuencia} onChange={(e) => setFrecuencia(e.target.value as FrecuenciaNomina)}>
          <option value="semanal">Semanal</option>
          <option value="quincenal">Quincenal · 15 y último</option>
          <option value="mensual">Mensual</option>
        </select>
      </CampoFormulario>
      <CampoFormulario id="nomina-primerPago" etiqueta={nomina ? "Próximo pago" : "Primer pago"} pista="Un lote ya preparado conserva su importe original." error={mensaje("primerPago")}>
        <input id="nomina-primerPago" name="primerPago" type="date" defaultValue={nomina?.proximoPagoEn ?? hoy} min={hoy} required aria-invalid={mensaje("primerPago") ? true : undefined} />
      </CampoFormulario>
      <CampoFormulario
        id="nomina-destino"
        etiqueta="Destino"
        pista={destino === "clabe" ? (persona.clabeFinal ? `Usa la CLABE vigente terminación ${persona.clabeFinal}.` : "Falta registrar la CLABE de nómina.") : "Acceso y tarjeta son independientes."}
        error={mensaje("destino")}
      >
        <select id="nomina-destino" name="destino" value={destino} onChange={(e) => setDestino(e.target.value as "clabe" | "tarjeta")}>
          <option value="clabe">CLABE externa</option>
          <option value="tarjeta">Tarjeta de nómina</option>
        </select>
      </CampoFormulario>
      <div className="acciones"><button className="boton" type="submit" disabled={pendiente}>{pendiente ? "Guardando…" : "Guardar programación"}</button></div>
    </form>
  );
}

/**
 * Cambia la CLABE de nómina. Exige el permiso propio y un segundo factor
 * verificado en los últimos 30 minutos; la persona recibe aviso por correo.
 */
export function FormularioClabeNomina({ persona }: { persona: PersonaVista }) {
  const [estado, accion, pendiente] = useActionState(enviarClabeNomina, ESTADO_MAESTRO_INICIAL);
  const [clabe, setClabe] = useState("");
  const [local, setLocal] = useState<ErrorCampo[] | null>(null);
  const errores = local ?? (estado.tipo === "invalido" ? estado.errores : []);
  const mensaje = errores.find((error) => error.campo === "clabe")?.mensaje;

  function validar(event: FormEvent<HTMLFormElement>) {
    if (!clabeValida(clabe).ok) {
      event.preventDefault();
      setLocal([{ campo: "clabe", mensaje: "Esa CLABE no cierra. El dígito usa la ponderación 3, 7 y 1." }]);
      document.getElementById("nomina-clabe")?.focus();
    } else setLocal(null);
  }

  return (
    <form className="formulario-pareja" action={accion} onSubmit={validar} noValidate aria-busy={pendiente}>
      <input type="hidden" name="personaId" value={persona.id} />
      <div className="formulario-aviso-ancho"><AvisosFormulario estado={estado} errores={errores} prefijo="nomina-" /></div>
      <CampoFormulario
        id="nomina-clabe"
        etiqueta={persona.clabeFinal ? "CLABE nueva" : "CLABE de nómina"}
        pista="18 dígitos. Exige haber confirmado tu segundo factor en los últimos 30 minutos."
        error={mensaje}
      >
        <input id="nomina-clabe" name="clabe" value={clabe} onChange={(e) => { setClabe(e.target.value); setLocal(null); }} inputMode="numeric" maxLength={23} className="entrada-rfc" autoComplete="off" required aria-invalid={mensaje ? true : undefined} />
      </CampoFormulario>
      <div className="acciones">
        <button className="boton" type="submit" disabled={pendiente}>
          {pendiente ? "Guardando…" : persona.clabeFinal ? "Cambiar CLABE de nómina" : "Registrar CLABE de nómina"}
        </button>
      </div>
    </form>
  );
}

export function BotonCancelarBaja({ personaId }: { personaId: string }) {
  const [estado, accion, pendiente] = useActionState(enviarCancelacionBaja, ESTADO_MAESTRO_INICIAL);
  return (
    <form action={accion} aria-busy={pendiente}>
      <input type="hidden" name="personaId" value={personaId} />
      <AvisosFormulario estado={estado} errores={[]} />
      <button className="boton-texto" type="submit" disabled={pendiente}>{pendiente ? "Cancelando…" : "Cancelar la baja programada"}</button>
    </form>
  );
}

export function BotonReenviarInvitacion({ personaId }: { personaId: string }) {
  const [estado, accion, pendiente] = useActionState(enviarReenvioInvitacion, ESTADO_MAESTRO_INICIAL);
  return (
    <form action={accion} aria-busy={pendiente}>
      <input type="hidden" name="personaId" value={personaId} />
      <AvisosFormulario estado={estado} errores={[]} />
      <button className="boton-texto" type="submit" disabled={pendiente}>{pendiente ? "Reenviando…" : "Renovar y reenviar invitación"}</button>
    </form>
  );
}
