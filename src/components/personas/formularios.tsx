"use client";

import { useActionState, useState, type ReactNode } from "react";

import { enviarBaja, enviarFinanzas } from "@/app/consola/personas/acciones";
import { enviarSinReiniciar } from "@/components/proveedores/sin-reinicio";
import { BotonEnviar } from "@/components/sistema";
import {
  ESTADO_FINANZAS_INICIAL,
  ESTADO_MAESTRO_INICIAL,
  fechaDesdePartes,
  fechaLarga,
  fechaValida,
  partesDeFecha,
  MENSAJE_FINANZAS,
  MENSAJE_RECHAZO,
} from "@/dominio/personas";

export function FormularioFinanzas({ userId, habilitado }: { userId: string; habilitado: boolean }) {
  const [estado, accion, pendiente] = useActionState(enviarFinanzas, ESTADO_FINANZAS_INICIAL);
  const [verFinanzas, setVerFinanzas] = useState(habilitado);
  const [estadoVisto, setEstadoVisto] = useState(estado);
  // Cada respuesta trae el valor real: si el guardado falló, la casilla regresa.
  if (estado !== estadoVisto) {
    setEstadoVisto(estado);
    if (estado.tipo !== "inicial") setVerFinanzas(estado.habilitado);
  }
  const rechazo = estado.tipo === "rechazado" ? MENSAJE_FINANZAS[estado.codigo] : null;
  return (
    // Con `action`, React reinicia el formulario al terminar y la casilla volvería a su valor inicial.
    <form className="permiso-finanzas permiso-finanzas-edicion" onSubmit={enviarSinReiniciar(accion)} aria-busy={pendiente}>
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="verFinanzas" value={verFinanzas ? "si" : "no"} />
      <label className="confirmacion">
        <input type="checkbox" checked={verFinanzas} onChange={(event) => setVerFinanzas(event.target.checked)} />
        <span>Puede ver Inicio financiero</span>
      </label>
      <p className="pista">Consulta entradas, salidas y movimientos del libro. No cambia sus otros permisos.</p>
      <div className="acciones">
        <BotonEnviar className="boton-texto" pendiente={pendiente} enviando="Guardando…">Guardar acceso financiero</BotonEnviar>
      </div>
      {estado.tipo === "listo" ? (
        <div className="alerta alerta-asentado" role="status">
          <p className="alerta-titulo">Quedó asentado</p>
          <p>{estado.mensaje}</p>
        </div>
      ) : rechazo ? (
        <div className="alerta alerta-revisar" role="alert">
          <p className="alerta-titulo">{rechazo.titulo}</p>
          <p>{rechazo.texto}</p>
        </div>
      ) : null}
    </form>
  );
}

export function FormularioBaja({
  personaId,
  nombre,
  bajaActual,
}: {
  personaId: string;
  nombre: string;
  bajaActual: string | null;
}) {
  const [estado, accion, pendiente] = useActionState(enviarBaja, ESTADO_MAESTRO_INICIAL);
  const [baja, setBaja] = useState(bajaActual ?? "");
  const id = `baja-${personaId}`;
  const errores = estado.tipo === "invalido" ? estado.errores : [];
  const mensaje = errores.find((error) => error.campo === "baja")?.mensaje;
  const rechazo =
    estado.tipo === "rechazado" && esCodigo(estado.codigo) ? MENSAJE_RECHAZO[estado.codigo] : null;

  return (
    <form className="alta-formulario baja-formulario" action={accion} noValidate aria-busy={pendiente}>
      {mensaje ? (
        <div className="alerta alerta-revisar" role="alert">
          <p className="alerta-titulo">Revisa la baja</p>
          <p>
            <a href={`#${id}`}>{mensaje}</a>
          </p>
        </div>
      ) : estado.tipo === "listo" ? (
        <div className="alerta alerta-asentado" role="status">
          <p className="alerta-titulo">Quedó asentado</p>
          <p>{estado.mensaje}</p>
        </div>
      ) : rechazo ? (
        <div className="alerta alerta-revisar" role="alert">
          <p className="alerta-titulo">{rechazo.titulo}</p>
          <p>{rechazo.texto}</p>
        </div>
      ) : null}
      <input type="hidden" name="personaId" value={personaId} />
      <Campo
        id={id}
        etiqueta={`Fecha de baja de ${nombre}`}
        pista="La persona sigue en el directorio con su fecha de baja."
        error={mensaje}
      >
        <FechaLegible
          id={id}
          name="baja"
          valor={baja}
          requerido
          invalido={Boolean(mensaje)}
          describedBy={descritoPor(id, mensaje)}
          onChange={setBaja}
        />
      </Campo>
      <div className="acciones">
        <BotonEnviar pendiente={pendiente} enviando="Guardando…">{bajaActual ? "Corregir la fecha de baja" : "Registrar la baja"}</BotonEnviar>
      </div>
    </form>
  );
}

function esCodigo(codigo: string): codigo is keyof typeof MENSAJE_RECHAZO {
  return Object.hasOwn(MENSAJE_RECHAZO, codigo);
}

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

function FechaLegible({
  id,
  name,
  valor,
  onChange,
  requerido = false,
  invalido = false,
  describedBy,
}: {
  id: string;
  name: string;
  valor: string;
  onChange: (iso: string) => void;
  requerido?: boolean;
  invalido?: boolean;
  describedBy?: string;
}) {
  const partes = partesDeFecha(valor);
  function escribir(siguiente: { dia: string; mes: string; anio: string }) {
    onChange(fechaDesdePartes(siguiente));
  }
  const anios: string[] = [];
  for (let anio = 2100; anio >= 2000; anio -= 1) anios.push(String(anio));
  const iso = fechaDesdePartes(partes);
  const leida = fechaValida(iso);
  const imposible = Boolean(partes.dia && partes.mes && partes.anio && !leida);
  const errorId = `${id}-inexistente`;
  const descrito = [describedBy, imposible ? errorId : ""].filter(Boolean).join(" ");
  const marcado = invalido || imposible;
  return (
    <div className="fecha-partes">
      <select
        id={id}
        aria-label="Día"
        value={partes.dia}
        required={requerido}
        aria-invalid={marcado || undefined}
        aria-describedby={descrito || undefined}
        onChange={(event) => escribir({ ...partes, dia: event.target.value })}
      >
        <option value="">Día</option>
        {Array.from({ length: 31 }, (_, indice) => String(indice + 1)).map((dia) => (
          <option key={dia} value={dia}>
            {dia}
          </option>
        ))}
      </select>
      <select
        aria-label="Mes"
        value={partes.mes}
        aria-invalid={marcado || undefined}
        aria-describedby={descrito || undefined}
        onChange={(event) => escribir({ ...partes, mes: event.target.value })}
      >
        <option value="">Mes</option>
        {MESES.map((nombre, indice) => (
          <option key={nombre} value={String(indice + 1).padStart(2, "0")}>
            {nombre}
          </option>
        ))}
      </select>
      <select
        aria-label="Año"
        value={partes.anio}
        aria-invalid={marcado || undefined}
        aria-describedby={descrito || undefined}
        onChange={(event) => escribir({ ...partes, anio: event.target.value })}
      >
        <option value="">Año</option>
        {anios.map((anio) => (
          <option key={anio} value={anio}>
            {anio}
          </option>
        ))}
      </select>
      <input type="hidden" name={name} value={valor} />
      {imposible ? (
        <p id={errorId} className="error-campo" role="alert">
          Esa fecha no existe.
        </p>
      ) : null}
      {leida ? <p className="fecha-leida">{fechaLarga(leida)}</p> : null}
    </div>
  );
}

function Campo({
  id,
  etiqueta,
  pista,
  error,
  children,
}: {
  id: string;
  etiqueta: string;
  pista: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="campo">
      <label htmlFor={id}>{etiqueta}</label>
      {children}
      <p id={`${id}-pista`} className="pista">
        {pista}
      </p>
      {error ? (
        <p id={`${id}-error`} className="error-campo">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function descritoPor(id: string, error: string | undefined): string {
  const partes = [`${id}-pista`];
  if (error) partes.push(`${id}-error`);
  return partes.join(" ");
}
