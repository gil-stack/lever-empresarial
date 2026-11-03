"use client";

import { useActionState, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { enviarAlta } from "@/app/alta/acciones";
import { regimenesVisibles, usosVisibles } from "@/dominio/catalogos-fiscales";
import {
  ESTADO_INICIAL,
  leerAlta,
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
    texto: "El libro no pudo confirmar el alta. Esta pantalla no muestra la configuración.",
  },
  sesion: {
    titulo: "Hay que entrar",
    texto: "La sesión no está. Vuelve a escribir correo y contraseña para guardar la razón social.",
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
    if (estado.tipo === "inicial") return;
    resumen.current?.focus();
  }, [estado]);

  const errores = erroresLocales ?? (estado.tipo === "invalido" ? estado.errores : []);
  const tipo = tipoDeRfc(rfc);
  const regimenes = regimenesVisibles(tipo);
  const usos = usosVisibles(tipo, regimen);
  const rechazo = estado.tipo === "rechazado" ? RECHAZO[estado.codigo] : null;

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
    const encontrados = validarAlta(leerAlta(new FormData(event.currentTarget))).errores;
    if (!contexto.conSesion) encontrados.push(...revisarCuenta(new FormData(event.currentTarget)));
    if (encontrados.length > 0) {
      event.preventDefault();
      setErroresLocales(encontrados);
      document.getElementById(encontrados[0]?.campo ?? "")?.focus();
      return;
    }
    setErroresLocales(null);
  }

  const mensaje = (campo: CampoAlta) => errores.find((error) => error.campo === campo)?.mensaje;

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
      {contexto.conSesion ? (
        <p className="formulario-kicker">Entraste como {contexto.nombre}</p>
      ) : (
        <p className="formulario-kicker">Quién entra</p>
      )}

      {contexto.rfc ? (
        <div className="aviso" role="status">
          <p className="aviso-titulo">Ya hay un RFC</p>
          <p>Esta cuenta ya tiene el RFC {contexto.rfc}. Un segundo RFC no entra.</p>
        </div>
      ) : null}

      {!contexto.libroDisponible && estado.tipo === "inicial" ? (
        <div className="aviso" role="status">
          <p className="aviso-titulo">El libro no respondió</p>
          <p>Sin el libro no se puede guardar la razón social. Esta pantalla no muestra la configuración.</p>
        </div>
      ) : null}

      {errores.length > 0 ? (
        <div className="aviso" role="alert" tabIndex={-1} ref={resumen}>
          <p className="aviso-titulo">Revisa el alta</p>
          <ul>
            {errores.map((error) => (
              <li key={error.campo}>
                <a href={`#${error.campo}`}>{error.mensaje}</a>
              </li>
            ))}
          </ul>
        </div>
      ) : rechazo ? (
        <div className="aviso" role="alert" tabIndex={-1} ref={resumen}>
          <p className="aviso-titulo">{rechazo.titulo}</p>
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
          <Campo id="correo" etiqueta="Correo" pista="Con este correo se vuelve a entrar." error={mensaje("correo")}>
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
          <Campo
            id="contrasena"
            etiqueta="Contraseña"
            pista="Entre 10 caracteres y 72 bytes. No se guarda en claro."
            error={mensaje("contrasena")}
          >
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
          aria-describedby={descritoPor("regimen", mensaje("regimen"))}
        >
          <option value="">Elige</option>
          {regimenes.map((item) => (
            <option key={item.codigo} value={item.codigo}>
              {item.codigo} · {item.nombre}
            </option>
          ))}
        </select>
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
          aria-describedby={descritoPor("usoCfdi", mensaje("usoCfdi"))}
        >
          <option value="">Elige</option>
          {usos.map((item) => (
            <option key={item.codigo} value={item.codigo}>
              {item.codigo} · {item.nombre}
            </option>
          ))}
        </select>
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
          {pendiente ? "Guardando la razón social…" : "Dar de alta"}
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
    errores.push({ campo: "contrasena", mensaje: "La contraseña tiene entre 10 caracteres y 72 bytes." });
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

function descritoPor(id: string, error: string | undefined): string {
  return error ? `${id}-pista ${id}-error` : `${id}-pista`;
}
