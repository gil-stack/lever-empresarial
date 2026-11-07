"use client";

import { useActionState, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { enviarProveedor } from "@/app/consola/proveedores/acciones";
import { FRASE_INSTITUCION_PENDIENTE, institucionTradicional } from "@/dominio/clabe-proveedor";
import { clabeValida, clabeVisible } from "@/dominio/clabe";
import {
  erroresDeAltaProveedor,
  ESTADO_ALTA_INICIAL,
  MENSAJE_RECHAZO,
  ordenarErroresProveedor,
  type CampoProveedor,
  type CodigoRechazoProveedor,
} from "@/dominio/proveedores";
import { rfcAlEscribir } from "@/dominio/rfc";
import { Aviso, BotonEnviar, EtiquetaMono } from "@/components/sistema";

import { enviarSinReiniciar } from "./sin-reinicio";

export function FormularioProveedor({ areas = [] }: { areas?: readonly { id: string; nombre: string }[] }) {
  const [estado, accion, pendiente] = useActionState(enviarProveedor, ESTADO_ALTA_INICIAL);
  const [rfc, setRfc] = useState("");
  const [razonSocial, setRazonSocial] = useState("");
  const [clabe, setClabe] = useState("");
  const [archivoNombre, setArchivoNombre] = useState("");
  const [contratoNombre, setContratoNombre] = useState("");
  const [local, setLocal] = useState<ReturnType<typeof erroresDeAltaProveedor> | null>(null);
  const [visto, setVisto] = useState(estado);
  const formulario = useRef<HTMLFormElement>(null);

  if (visto !== estado) {
    setVisto(estado);
    if (estado.tipo === "listo") {
      setRfc("");
      setRazonSocial("");
      setClabe("");
      setArchivoNombre("");
      setContratoNombre("");
      setLocal(null);
    }
  }

  useEffect(() => {
    if (estado.tipo === "listo") formulario.current?.reset();
    if (estado.tipo === "invalido") {
      const primero = ordenarErroresProveedor(estado.errores)[0];
      if (primero) document.getElementById(primero.campo)?.focus();
    }
  }, [estado]);

  const errores = ordenarErroresProveedor(local ?? (estado.tipo === "invalido" ? estado.errores : []));
  const mensaje = (campo: CampoProveedor) => errores.find((error) => error.campo === campo)?.mensaje;
  const digito = clabeValida(clabe);
  const institucion = digito.ok
    ? (institucionTradicional(digito.clabe.slice(0, 3)) ?? FRASE_INSTITUCION_PENDIENTE)
    : null;

  function alEnviar(event: FormEvent<HTMLFormElement>) {
    const entrada = new FormData(event.currentTarget).get("constancia");
    const archivo = metaDe(entrada);
    const encontrados = erroresDeAltaProveedor({ rfc, razonSocial, clabe, archivo });
    if (encontrados.length > 0) {
      event.preventDefault();
      setLocal(encontrados);
      document.getElementById(encontrados[0]?.campo ?? "")?.focus();
      return;
    }
    setLocal(null);
    enviarSinReiniciar(accion)(event);
  }

  return (
    <form
      ref={formulario}
      className="alta-formulario formulario-pareja"
      onSubmit={alEnviar}
      noValidate
      aria-busy={pendiente}
    >
      <Avisos errores={errores} estado={estado} />
      <Campo
        id="rfc"
        etiqueta="RFC"
        pista="12 o 13 caracteres."
        error={mensaje("rfc")}
      >
        <input
          id="rfc"
          name="rfc"
          className="entrada-rfc"
          value={rfc}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={40}
          aria-invalid={mensaje("rfc") ? true : undefined}
          aria-describedby={descritoPor("rfc", mensaje("rfc"))}
          onChange={(event) => {
            setRfc(rfcAlEscribir(event.target.value));
            setLocal(null);
          }}
        />
      </Campo>
      <Campo
        id="razonSocial"
        etiqueta="Razón social"
        pista="Como en la constancia."
        error={mensaje("razonSocial")}
      >
        <input
          id="razonSocial"
          name="razonSocial"
          value={razonSocial}
          autoComplete="off"
          maxLength={254}
          aria-invalid={mensaje("razonSocial") ? true : undefined}
          aria-describedby={descritoPor("razonSocial", mensaje("razonSocial"))}
          onChange={(event) => {
            setRazonSocial(event.target.value);
            setLocal(null);
          }}
        />
      </Campo>
      <Campo id="nombreComercial" etiqueta="Nombre comercial" pista="Cómo lo reconoce tu equipo. Opcional." error={mensaje("nombreComercial")}>
        <input id="nombreComercial" name="nombreComercial" maxLength={180} autoComplete="off" aria-describedby={descritoPor("nombreComercial", mensaje("nombreComercial"))} aria-invalid={mensaje("nombreComercial") ? true : undefined} />
      </Campo>
      <Campo id="contactoCorreo" etiqueta="Correo de contacto" pista="Para facturas y seguimiento. Opcional." error={mensaje("contactoCorreo")}>
        <input id="contactoCorreo" name="contactoCorreo" type="email" maxLength={254} autoComplete="off" aria-describedby={descritoPor("contactoCorreo", mensaje("contactoCorreo"))} aria-invalid={mensaje("contactoCorreo") ? true : undefined} />
      </Campo>
      <Campo id="diasCredito" etiqueta="Días de crédito" pista="Se usa como sugerencia al programar facturas." error={mensaje("diasCredito")}>
        <input id="diasCredito" name="diasCredito" type="number" min={0} max={365} step={1} defaultValue={30} inputMode="numeric" aria-describedby={descritoPor("diasCredito", mensaje("diasCredito"))} aria-invalid={mensaje("diasCredito") ? true : undefined} />
      </Campo>
      {areas.length > 0 ? (
        <Campo id="areaId" etiqueta="Área" pista="Sus pagos cuentan en el presupuesto de esa área. Opcional." error={mensaje("areaId")}>
          <select id="areaId" name="areaId" defaultValue="" aria-invalid={mensaje("areaId") ? true : undefined}>
            <option value="">Sin área</option>
            {areas.map((area) => <option key={area.id} value={area.id}>{area.nombre}</option>)}
          </select>
        </Campo>
      ) : null}
      <Campo
        id="clabe"
        etiqueta="CLABE"
        pista="18 dígitos. Se muestran todos."
        error={mensaje("clabe")}
      >
        <input
          id="clabe"
          name="clabe"
          className="entrada-rfc"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          value={clabe}
          maxLength={32}
          aria-invalid={mensaje("clabe") ? true : undefined}
          aria-describedby={descritoPor("clabe", mensaje("clabe"), clabe.length === 18, Boolean(institucion))}
          onChange={(event) => {
            setClabe(event.target.value.replace(/\D/g, "").slice(0, 18));
            setLocal(null);
          }}
        />
        {clabe.length === 18 ? (
          <div id="clabe-elegido">
            <EtiquetaMono nombre="CLABE">{clabeVisible(clabe)}</EtiquetaMono>
          </div>
        ) : null}
        {institucion ? (
          <p id="clabe-banco" className="pista">
            {institucion}
          </p>
        ) : null}
      </Campo>
      <Campo
        id="constancia"
        etiqueta="Constancia"
        pista="PDF del SAT."
        error={mensaje("constancia")}
      >
        <div className="archivo">
          <input
            id="constancia"
            name="constancia"
            className="archivo-nativo"
            type="file"
            accept="application/pdf,.pdf"
            aria-invalid={mensaje("constancia") ? true : undefined}
            aria-describedby={descritoPor("constancia", mensaje("constancia"))}
            onChange={(event) => {
              setArchivoNombre(event.target.files?.[0]?.name ?? "");
              setLocal(null);
            }}
          />
          <label htmlFor="constancia" className="boton-texto boton-archivo">
            Elegir PDF
          </label>
          <span className={archivoNombre ? "elegido archivo-nombre" : "pista archivo-nombre"}>
            {archivoNombre || "Ningún PDF elegido"}
          </span>
        </div>
      </Campo>
      <Campo id="contrato" etiqueta="Contrato" pista="PDF privado, opcional. Puedes agregar otros después." error={mensaje("contrato")}>
        <div className="archivo">
          <input id="contrato" name="contrato" className="archivo-nativo" type="file" accept="application/pdf,.pdf"
            aria-describedby={descritoPor("contrato", mensaje("contrato"))} aria-invalid={mensaje("contrato") ? true : undefined}
            onChange={(event) => setContratoNombre(event.target.files?.[0]?.name ?? "")} />
          <label htmlFor="contrato" className="boton-texto boton-archivo">Elegir contrato</label>
          <span className={contratoNombre ? "elegido archivo-nombre" : "pista archivo-nombre"}>{contratoNombre || "Sin contrato todavía"}</span>
        </div>
      </Campo>
      <Campo id="contratoDesde" etiqueta="Vigente desde" pista="Si el contrato trae fecha de inicio.">
        <input id="contratoDesde" name="contratoDesde" type="date" aria-describedby="contratoDesde-pista" />
      </Campo>
      <Campo id="contratoHasta" etiqueta="Vigente hasta" pista="Si el contrato trae fecha de fin.">
        <input id="contratoHasta" name="contratoHasta" type="date" aria-describedby="contratoHasta-pista" />
      </Campo>
      <div className="acciones">
        <BotonEnviar pendiente={pendiente}>Dar de alta</BotonEnviar>
      </div>
    </form>
  );
}

function Avisos({
  errores,
  estado,
}: {
  errores: { campo: string; mensaje: string }[];
  estado: { tipo: string; mensaje?: string; codigo?: string };
}) {
  if (errores.length > 0) {
    return (
      <Aviso tono="revisar" titulo="Revisa el alta">
        <ul>
          {errores.map((error) => (
            <li key={error.campo}>
              <a href={`#${error.campo}`}>{error.mensaje}</a>
            </li>
          ))}
        </ul>
      </Aviso>
    );
  }
  if (estado.tipo === "listo" && estado.mensaje) {
    return (
      <Aviso tono="asentado" titulo="Quedó asentado">
        <p>{estado.mensaje}</p>
      </Aviso>
    );
  }
  if (estado.tipo === "rechazado" && estado.codigo && esCodigo(estado.codigo)) {
    const rechazo = MENSAJE_RECHAZO[estado.codigo];
    return (
      <Aviso tono="revisar" titulo={rechazo.titulo}>
        <p>{rechazo.texto}</p>
      </Aviso>
    );
  }
  return null;
}

function esCodigo(codigo: string): codigo is CodigoRechazoProveedor {
  return Object.hasOwn(MENSAJE_RECHAZO, codigo);
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

function descritoPor(id: string, error: string | undefined, conLectura = false, conBanco = false): string {
  const partes = [`${id}-pista`];
  if (conLectura) partes.push("clabe-elegido");
  if (conBanco) partes.push("clabe-banco");
  if (error) partes.push(`${id}-error`);
  return partes.join(" ");
}

function metaDe(valor: unknown): { nombre: string; tipo: string; peso: number } | null {
  if (typeof valor !== "object" || valor === null || !("size" in valor)) return null;
  const archivo = valor as { name?: unknown; type?: unknown; size?: unknown };
  const peso = typeof archivo.size === "number" ? archivo.size : 0;
  const nombre = typeof archivo.name === "string" ? archivo.name : "";
  if (peso === 0 && nombre.trim() === "") return null;
  return { nombre, tipo: typeof archivo.type === "string" ? archivo.type : "", peso };
}
