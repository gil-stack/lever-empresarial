"use client";

import { useActionState, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { enviarAlta } from "@/app/alta/acciones";
import { regimenesVisibles, usosVisibles } from "@/dominio/catalogos-fiscales";
import {
  ESTADO_INICIAL,
  leerAlta,
  ordenarErrores,
  validarAlta,
  type CampoAlta,
  type CodigoRechazo,
  type ErrorCampo,
} from "@/dominio/alta";
import { normalizarRfc, tipoDeRfc } from "@/dominio/rfc";

export type ContextoFormulario = {
  conSesion: boolean;
  nombre: string | null;
  rfc: string | null;
  libroDisponible: boolean;
};

const MENSAJE_CONTRASENA =
  "La contraseña necesita al menos 10 caracteres. Si es demasiado larga, elige otra.";

const RECHAZO: Record<CodigoRechazo, { titulo: string; texto: string }> = {
  segunda_razon_social: {
    titulo: "No entra",
    texto: "En esta cuenta no cabe un segundo RFC.",
  },
  rfc_duplicado: {
    titulo: "No entra",
    texto: "Ese RFC ya está registrado en otra cuenta.",
  },
  libro: {
    titulo: "No se guardó",
    texto: "No se pudo confirmar el alta. Vuelve a intentar.",
  },
  sesion: {
    titulo: "Hay que entrar",
    texto: "Vuelve a escribir correo y contraseña para guardar la razón social.",
  },
};

export function FormularioAlta({ contexto }: { contexto: ContextoFormulario }) {
  const [estado, accion, pendiente] = useActionState(enviarAlta, ESTADO_INICIAL);
  const [erroresLocales, setErroresLocales] = useState<ErrorCampo[] | null>(null);
  const [nombre, setNombre] = useState("");
  const [correo, setCorreo] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [rfc, setRfc] = useState("");
  const [razonSocial, setRazonSocial] = useState("");
  const [codigoPostal, setCodigoPostal] = useState("");
  const [regimen, setRegimen] = useState("");
  const [usoCfdi, setUsoCfdi] = useState("");
  const [confirmaRecorte, setConfirmaRecorte] = useState(false);
  const resumen = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (estado.tipo === "invalido") {
      const primero = ordenarErrores(estado.errores)[0];
      if (primero) document.getElementById(primero.campo)?.focus();
      return;
    }
    if (estado.tipo === "rechazado") resumen.current?.focus();
  }, [estado]);

  const errores = ordenarErrores(erroresLocales ?? (estado.tipo === "invalido" ? estado.errores : []));
  const tipo = tipoDeRfc(rfc);
  const regimenes = regimenesVisibles(tipo);
  const usos = usosVisibles(tipo, regimen);
  const rechazo = estado.tipo === "rechazado" ? RECHAZO[estado.codigo] : null;
  const regimenElegido = regimenes.find((item) => item.codigo === regimen);
  const usoElegido = usos.find((item) => item.codigo === usoCfdi);
  const cuentaLlena =
    Boolean(contexto.rfc) || (estado.tipo === "rechazado" && estado.codigo === "segunda_razon_social");

  function limpiarErrores() {
    setErroresLocales((prev) => (prev && prev.length === 0 ? prev : []));
  }

  function alCambiarRfc(valor: string) {
    const siguiente = normalizarRfc(valor).slice(0, 13);
    const tipoSiguiente = tipoDeRfc(siguiente);
    const regimenSiguiente =
      tipoSiguiente && regimen && !regimenesVisibles(tipoSiguiente).some((item) => item.codigo === regimen)
        ? ""
        : regimen;
    setRfc(siguiente);
    if (regimenSiguiente !== regimen) setRegimen(regimenSiguiente);
    if (usoCfdi && !usosVisibles(tipoSiguiente, regimenSiguiente).some((item) => item.codigo === usoCfdi)) {
      setUsoCfdi("");
    }
    limpiarErrores();
  }

  function alCambiarRegimen(valor: string) {
    setRegimen(valor);
    if (usoCfdi && !usosVisibles(tipo, valor).some((item) => item.codigo === usoCfdi)) {
      setUsoCfdi("");
    }
    limpiarErrores();
  }

  function alEnviar(event: FormEvent<HTMLFormElement>) {
    const encontrados = ordenarErrores([
      ...validarAlta(leerAlta(new FormData(event.currentTarget))).errores,
      ...(contexto.conSesion ? [] : revisarCuenta(new FormData(event.currentTarget))),
    ]);
    if (encontrados.length > 0) {
      event.preventDefault();
      setErroresLocales(encontrados);
      document.getElementById(encontrados[0]?.campo ?? "")?.focus();
      return;
    }
    setErroresLocales(null);
  }

  const mensaje = (campo: CampoAlta) => errores.find((error) => error.campo === campo)?.mensaje;

  if (!contexto.libroDisponible && estado.tipo === "inicial") {
    return (
      <div className="alerta" role="alert">
        <p className="alerta-titulo">No se pudo abrir el alta</p>
        <p>Vuelve a intentar en un momento.</p>
      </div>
    );
  }

  if (cuentaLlena) {
    return (
      <div className="estado-cuenta">
        <p className="alerta-titulo">Ya hay un RFC</p>
        <p>
          {contexto.rfc ? (
            <>
              Esta cuenta ya tiene el RFC <span className="rfc-cuenta">{contexto.rfc}</span>. Un segundo RFC no entra.
            </>
          ) : (
            "En esta cuenta no cabe un segundo RFC."
          )}
        </p>
        <Link className="boton" href="/consola">
          Ir a la consola
        </Link>
      </div>
    );
  }

  return (
    <form
      className="alta-formulario"
      action={accion}
      onSubmit={alEnviar}
      onReset={(event) => {
        event.preventDefault();
      }}
      noValidate
      aria-busy={pendiente}
    >
      {contexto.conSesion ? null : <p className="formulario-kicker">Quién entra</p>}

      {errores.length > 0 ? (
        <div className="alerta" role="alert">
          <p className="alerta-titulo">Revisa el alta</p>
          <ul>
            {errores.map((error) => (
              <li key={error.campo}>
                <a href={`#${error.campo}`}>{error.mensaje}</a>
              </li>
            ))}
          </ul>
        </div>
      ) : rechazo ? (
        <div className="alerta" role="alert" tabIndex={-1} ref={resumen}>
          <p className="alerta-titulo">{rechazo.titulo}</p>
          <p>{rechazo.texto}</p>
        </div>
      ) : null}

      {contexto.conSesion ? null : (
        <>
          <Campo
            id="nombre"
            etiqueta="Nombre"
            pista="Quien abre la cuenta. No es la razón social."
            error={mensaje("nombre")}
          >
            <input
              id="nombre"
              name="nombre"
              value={nombre}
              onChange={(event) => {
                setNombre(event.target.value);
                limpiarErrores();
              }}
              autoComplete="name"
              maxLength={120}
              aria-invalid={mensaje("nombre") ? true : undefined}
              aria-describedby={descritoPor("nombre", mensaje("nombre"))}
            />
          </Campo>
          <Campo id="correo" etiqueta="Correo" pista="Con este correo se abre la cuenta." error={mensaje("correo")}>
            <input
              id="correo"
              name="correo"
              type="email"
              value={correo}
              onChange={(event) => {
                setCorreo(event.target.value);
                limpiarErrores();
              }}
              autoComplete="email"
              maxLength={254}
              aria-invalid={mensaje("correo") ? true : undefined}
              aria-describedby={descritoPor("correo", mensaje("correo"))}
            />
          </Campo>
          <Campo id="contrasena" etiqueta="Contraseña" pista="Al menos 10 caracteres." error={mensaje("contrasena")}>
            <input
              id="contrasena"
              name="contrasena"
              type="password"
              value={contrasena}
              onChange={(event) => {
                setContrasena(event.target.value);
                limpiarErrores();
              }}
              autoComplete="new-password"
              aria-invalid={mensaje("contrasena") ? true : undefined}
              aria-describedby={descritoPor("contrasena", mensaje("contrasena"))}
            />
          </Campo>
          <p className="ya-tengo-cuenta">
            Si ya abriste la cuenta, <Link href="/entrar">entra con el correo</Link>.
          </p>
        </>
      )}

      <p className="formulario-kicker">Datos para pedir facturas</p>

      <Campo
        id="rfc"
        etiqueta="RFC"
        pista="12 caracteres si es persona moral, 13 si es persona física. Con homoclave."
        error={mensaje("rfc")}
      >
        <input
          id="rfc"
          name="rfc"
          value={rfc}
          onChange={(event) => alCambiarRfc(event.target.value)}
          className="entrada-rfc"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={13}
          inputMode="text"
          aria-invalid={mensaje("rfc") ? true : undefined}
          aria-describedby={descritoPor("rfc", mensaje("rfc"))}
        />
      </Campo>

      <Campo
        id="razonSocial"
        etiqueta="Razón social"
        pista="Como va a aparecer en el comprobante."
        error={mensaje("razonSocial")}
      >
        <input
          id="razonSocial"
          name="razonSocial"
          value={razonSocial}
          onChange={(event) => {
            setRazonSocial(event.target.value);
            limpiarErrores();
          }}
          autoComplete="organization"
          maxLength={254}
          aria-invalid={mensaje("razonSocial") ? true : undefined}
          aria-describedby={descritoPor("razonSocial", mensaje("razonSocial"))}
        />
      </Campo>

      <Campo
        id="codigoPostal"
        etiqueta="Código postal"
        pista="Cinco dígitos, los del domicilio fiscal."
        error={mensaje("codigoPostal")}
      >
        <input
          id="codigoPostal"
          name="codigoPostal"
          value={codigoPostal}
          onChange={(event) => {
            setCodigoPostal(event.target.value.replace(/\D/g, "").slice(0, 5));
            limpiarErrores();
          }}
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={5}
          aria-invalid={mensaje("codigoPostal") ? true : undefined}
          aria-describedby={descritoPor("codigoPostal", mensaje("codigoPostal"))}
        />
      </Campo>

      <Campo id="regimen" etiqueta="Régimen" pista="El del catálogo, según el RFC." error={mensaje("regimen")}>
        <select
          id="regimen"
          name="regimen"
          value={regimen}
          onChange={(event) => alCambiarRegimen(event.target.value)}
          className={regimen ? undefined : "select-vacio"}
          aria-invalid={mensaje("regimen") ? true : undefined}
          aria-describedby={descritoPor("regimen", mensaje("regimen"), Boolean(regimenElegido))}
        >
          <option value="">Elige</option>
          {regimenes.map((item) => (
            <option key={item.codigo} value={item.codigo}>
              {item.codigo} · {item.nombre}
            </option>
          ))}
        </select>
        {regimenElegido ? (
          <p className="elegido" id="regimen-elegido">
            {regimenElegido.codigo} · {regimenElegido.nombre}
          </p>
        ) : null}
      </Campo>

      <Campo
        id="usoCfdi"
        etiqueta="Uso de CFDI"
        pista="El que esta empresa va a dar cuando pida una factura."
        error={mensaje("usoCfdi")}
      >
        <select
          id="usoCfdi"
          name="usoCfdi"
          value={usoCfdi}
          onChange={(event) => {
            setUsoCfdi(event.target.value);
            limpiarErrores();
          }}
          className={usoCfdi ? undefined : "select-vacio"}
          aria-invalid={mensaje("usoCfdi") ? true : undefined}
          aria-describedby={descritoPor("usoCfdi", mensaje("usoCfdi"), Boolean(usoElegido))}
        >
          <option value="">Elige</option>
          {usos.map((item) => (
            <option key={item.codigo} value={item.codigo}>
              {item.codigo} · {item.nombre}
            </option>
          ))}
        </select>
        {usoElegido ? (
          <p className="elegido" id="usoCfdi-elegido">
            {usoElegido.codigo} · {usoElegido.nombre}
          </p>
        ) : null}
      </Campo>

      <div className="campo campo-confirmacion">
        <label className="confirmacion" htmlFor="confirmaRecorte">
          <input
            id="confirmaRecorte"
            name="confirmaRecorte"
            type="checkbox"
            value="si"
            checked={confirmaRecorte}
            onChange={(event) => {
              setConfirmaRecorte(event.target.checked);
              limpiarErrores();
            }}
            aria-invalid={mensaje("confirmaRecorte") ? true : undefined}
            aria-describedby={descritoPor("confirmaRecorte", mensaje("confirmaRecorte"))}
          />
          <span>
            Confirmo que esta cuenta es una sola razón social en México, que opera en pesos, y que podrá nombrar a dos
            personas distintas para pedir un pago y para liberarlo.
          </span>
        </label>
        <p id="confirmaRecorte-pista" className="pista">
          Esa lista se lee antes de la primera tarjeta.
        </p>
        {mensaje("confirmaRecorte") ? (
          <p id="confirmaRecorte-error" className="error-campo">
            {mensaje("confirmaRecorte")}
          </p>
        ) : null}
      </div>

      <div className="acciones">
        <button type="submit" className="boton" disabled={pendiente}>
          {pendiente
            ? "Guardando la razón social…"
            : estado.tipo === "rechazado" && estado.codigo === "libro"
              ? "Volver a intentar"
              : "Dar de alta"}
        </button>
        <p>Un segundo RFC no cabe en esta cuenta.</p>
      </div>
    </form>
  );
}

function revisarCuenta(formData: FormData): ErrorCampo[] {
  const errores: ErrorCampo[] = [];
  const nombre = String(formData.get("nombre") ?? "")
    .trim()
    .replace(/\s+/g, " ");
  const correo = String(formData.get("correo") ?? "")
    .trim()
    .toLowerCase();
  const contrasena = String(formData.get("contrasena") ?? "");
  if (nombre.length < 1 || nombre.length > 120 || !/[\p{L}\p{N}]/u.test(nombre)) {
    errores.push({ campo: "nombre", mensaje: "Escribe el nombre de quien abre la cuenta." });
  }
  if (correo.length > 254 || !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(correo)) {
    errores.push({ campo: "correo", mensaje: "Escribe un correo válido." });
  }
  const bytes = new TextEncoder().encode(contrasena).length;
  if (contrasena.length < 10 || contrasena.trim().length === 0 || bytes > 72) {
    errores.push({ campo: "contrasena", mensaje: MENSAJE_CONTRASENA });
  }
  return errores;
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

function descritoPor(id: string, error: string | undefined, elegido = false): string {
  const partes = [`${id}-pista`];
  if (elegido) partes.push(`${id}-elegido`);
  if (error) partes.push(`${id}-error`);
  return partes.join(" ");
}
