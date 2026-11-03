"use client";

import { useActionState, useEffect, useState, type FormEvent, type ReactNode } from "react";

import { enviarBaja, enviarCentro, enviarPersona } from "@/app/consola/personas/acciones";
import { clabeValida, clabeVisible } from "@/dominio/clabe";
import {
  erroresDeAltaPersona,
  ESTADO_MAESTRO_INICIAL,
  MENSAJE_RECHAZO,
  ordenarErroresPersona,
  pistaDelRol,
  ROLES_VISIBLES,
  validarCentro,
  type AccesoForma,
  type CampoPersona,
  type ErrorCampo,
  type RolCuenta,
} from "@/dominio/personas";

export function FormularioCentro() {
  const [estado, accion, pendiente] = useActionState(enviarCentro, ESTADO_MAESTRO_INICIAL);
  const [nombre, setNombre] = useState("");
  const [local, setLocal] = useState<ErrorCampo[] | null>(null);
  const [visto, setVisto] = useState(estado);
  if (visto !== estado) {
    setVisto(estado);
    if (estado.tipo === "listo") setNombre("");
  }

  const errores = ordenarErroresPersona(local ?? (estado.tipo === "invalido" ? estado.errores : []));
  const mensaje = errores.find((error) => error.campo === "centroNombre")?.mensaje;

  return (
    <form
      className="alta-formulario formulario-maestro"
      action={accion}
      noValidate
      aria-busy={pendiente}
      onSubmit={(event) => {
        const validado = validarCentro({ nombre: new FormData(event.currentTarget).get("centroNombre") });
        if (!validado.ok) {
          event.preventDefault();
          setLocal([{ campo: "centroNombre", mensaje: "Escribe el nombre del centro de costo." }]);
          document.getElementById("centroNombre")?.focus();
        } else {
          setLocal(null);
        }
      }}
    >
      <p className="formulario-kicker">Centro de costo</p>
      <Avisos errores={errores} estado={estado} />
      <Campo id="centroNombre" etiqueta="Nombre" pista="Obra, sucursal, nómina. El nombre es de esta empresa." error={mensaje}>
        <input
          id="centroNombre"
          name="centroNombre"
          value={nombre}
          maxLength={80}
          autoComplete="off"
          aria-invalid={mensaje ? true : undefined}
          aria-describedby={descritoPor("centroNombre", mensaje)}
          onChange={(event) => {
            setNombre(event.target.value);
            setLocal(null);
          }}
        />
      </Campo>
      <div className="acciones">
        <button type="submit" className="boton" disabled={pendiente}>
          {pendiente ? "Guardando…" : "Nombrar centro"}
        </button>
      </div>
    </form>
  );
}

export function FormularioPersona({
  hoy,
  centros,
  jefes,
}: {
  hoy: string;
  centros: { id: string; nombre: string }[];
  jefes: { id: string; nombre: string }[];
}) {
  const [estado, accion, pendiente] = useActionState(enviarPersona, ESTADO_MAESTRO_INICIAL);
  const [nombre, setNombre] = useState("");
  const [alta, setAlta] = useState(hoy);
  const [baja, setBaja] = useState("");
  const [centroId, setCentroId] = useState("");
  const [jefeId, setJefeId] = useState("");
  const [clabe, setClabe] = useState("");
  const [acceso, setAcceso] = useState<AccesoForma | "">("");
  const [correo, setCorreo] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [rol, setRol] = useState<RolCuenta | "">("");
  const [local, setLocal] = useState<ErrorCampo[] | null>(null);
  const [visto, setVisto] = useState(estado);
  if (visto !== estado) {
    setVisto(estado);
    if (estado.tipo === "listo") {
      setNombre("");
      setAlta(hoy);
      setBaja("");
      setCentroId("");
      setJefeId("");
      setClabe("");
      setAcceso("");
      setCorreo("");
      setContrasena("");
      setRol("");
      setLocal(null);
    }
  }

  useEffect(() => {
    if (estado.tipo === "invalido") {
      const primero = ordenarErroresPersona(estado.errores)[0];
      if (primero) document.getElementById(primero.campo)?.focus();
    }
  }, [estado]);

  const errores = ordenarErroresPersona(local ?? (estado.tipo === "invalido" ? estado.errores : []));
  const mensaje = (campo: CampoPersona) => errores.find((error) => error.campo === campo)?.mensaje;
  const digito = clabeValida(clabe);

  function alEnviar(event: FormEvent<HTMLFormElement>) {
    const encontrados = erroresDeAltaPersona(
      {
        nombre,
        alta,
        baja,
        centroId,
        jefeId,
        clabe,
        acceso,
        correo,
        contrasena,
        rol,
      },
      hoy,
    );
    if (encontrados.length > 0) {
      event.preventDefault();
      setLocal(encontrados);
      document.getElementById(encontrados[0]?.campo ?? "")?.focus();
      return;
    }
    setLocal(null);
  }

  return (
    <form className="alta-formulario formulario-maestro" action={accion} onSubmit={alEnviar} noValidate aria-busy={pendiente}>
      <p className="formulario-kicker">Alta de persona</p>
      <Avisos errores={errores} estado={estado} />
      <Campo id="nombre" etiqueta="Nombre" pista="Como va a aparecer en el maestro." error={mensaje("nombre")}>
        <input
          id="nombre"
          name="nombre"
          value={nombre}
          autoComplete="off"
          maxLength={120}
          aria-invalid={mensaje("nombre") ? true : undefined}
          aria-describedby={descritoPor("nombre", mensaje("nombre"))}
          onChange={(event) => {
            setNombre(event.target.value);
            setLocal(null);
          }}
        />
      </Campo>
      <Campo id="alta" etiqueta="Fecha de alta" pista="El día en que entra. No puede ser posterior a hoy." error={mensaje("alta")}>
        <input
          id="alta"
          name="alta"
          type="date"
          value={alta}
          max={hoy}
          required
          aria-invalid={mensaje("alta") ? true : undefined}
          aria-describedby={descritoPor("alta", mensaje("alta"))}
          onChange={(event) => {
            setAlta(event.target.value);
            setLocal(null);
          }}
        />
      </Campo>
      <Campo
        id="baja"
        etiqueta="Fecha de baja"
        pista="Opcional. Si ya se fue, o si la baja está acordada. No dispersa y no apaga una tarjeta."
        error={mensaje("baja")}
      >
        <input
          id="baja"
          name="baja"
          type="date"
          value={baja}
          min={alta || undefined}
          aria-invalid={mensaje("baja") ? true : undefined}
          aria-describedby={descritoPor("baja", mensaje("baja"))}
          onChange={(event) => {
            setBaja(event.target.value);
            setLocal(null);
          }}
        />
      </Campo>
      <Campo
        id="centro"
        etiqueta="Centro de costo"
        pista={centros.length === 0 ? "Primero nombra un centro de costo." : "Uno de los centros de esta empresa."}
        error={mensaje("centro")}
      >
        <select
          id="centro"
          name="centroId"
          value={centroId}
          className={centroId ? undefined : "select-vacio"}
          aria-invalid={mensaje("centro") ? true : undefined}
          aria-describedby={descritoPor("centro", mensaje("centro"))}
          onChange={(event) => {
            setCentroId(event.target.value);
            setLocal(null);
          }}
        >
          <option value="">Elige</option>
          {centros.map((centro) => (
            <option key={centro.id} value={centro.id}>
              {centro.nombre}
            </option>
          ))}
        </select>
      </Campo>
      <Campo id="jefe" etiqueta="Jefe" pista="Otra persona de esta empresa. La primera puede quedar sin jefe." error={mensaje("jefe")}>
        <select
          id="jefe"
          name="jefeId"
          value={jefeId}
          className={jefeId ? undefined : "select-vacio"}
          aria-invalid={mensaje("jefe") ? true : undefined}
          aria-describedby={descritoPor("jefe", mensaje("jefe"))}
          onChange={(event) => {
            setJefeId(event.target.value);
            setLocal(null);
          }}
        >
          <option value="">Sin jefe</option>
          {jefes.map((jefe) => (
            <option key={jefe.id} value={jefe.id}>
              {jefe.nombre}
            </option>
          ))}
        </select>
      </Campo>
      <Campo
        id="clabe"
        etiqueta="CLABE"
        pista="18 dígitos. El verificador usa la ponderación 3, 7 y 1. Se guarda completa."
        error={mensaje("clabe")}
      >
        <input
          id="clabe"
          name="clabe"
          value={clabe}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          maxLength={23}
          className="entrada-rfc"
          aria-invalid={mensaje("clabe") ? true : undefined}
          aria-describedby={descritoPor("clabe", mensaje("clabe"), digito.ok)}
          onChange={(event) => {
            setClabe(event.target.value);
            setLocal(null);
          }}
        />
      </Campo>
      {digito.ok ? (
        <p className="elegido" id="clabe-elegido">
          El dígito cierra. {clabeVisible(digito.clabe)}
        </p>
      ) : null}
      <Campo
        id="acceso"
        etiqueta="Acceso a la consola"
        pista="Sin acceso, la persona queda en el maestro y no suelta dinero."
        error={mensaje("acceso")}
      >
        <select
          id="acceso"
          name="acceso"
          value={acceso}
          className={acceso ? undefined : "select-vacio"}
          aria-invalid={mensaje("acceso") ? true : undefined}
          aria-describedby={descritoPor("acceso", mensaje("acceso"))}
          onChange={(event) => {
            setAcceso(event.target.value as AccesoForma | "");
            setLocal(null);
          }}
        >
          <option value="">Elige</option>
          <option value="no">No entra a la consola</option>
          <option value="nueva">Va a entrar, con un rol</option>
          <option value="ya">Ya entra a esta cuenta</option>
        </select>
      </Campo>
      {acceso === "ya" || acceso === "nueva" ? (
        <Campo
          id="correo"
          etiqueta="Correo"
          pista={
            acceso === "ya"
              ? "El correo con el que ya entra. No se cambia el rol ni la contraseña."
              : "Con este correo va a entrar."
          }
          error={mensaje("correo")}
        >
          <input
            id="correo"
            name="correo"
            type="email"
            value={correo}
            autoComplete="off"
            maxLength={254}
            aria-invalid={mensaje("correo") ? true : undefined}
            aria-describedby={descritoPor("correo", mensaje("correo"))}
            onChange={(event) => {
              setCorreo(event.target.value);
              setLocal(null);
            }}
          />
        </Campo>
      ) : null}
      {acceso === "nueva" ? (
        <>
          <Campo
            id="contrasena"
            etiqueta="Contraseña"
            pista="La de esta persona. Al menos 10 caracteres. No se vuelve a mostrar."
            error={mensaje("contrasena")}
          >
            <input
              id="contrasena"
              name="contrasena"
              type="password"
              value={contrasena}
              autoComplete="new-password"
              aria-invalid={mensaje("contrasena") ? true : undefined}
              aria-describedby={descritoPor("contrasena", mensaje("contrasena"))}
              onChange={(event) => {
                setContrasena(event.target.value);
                setLocal(null);
              }}
            />
          </Campo>
          <Campo
            id="rol"
            etiqueta="Rol"
            pista="Soltar dinero es el liberador, y tienen que ser dos. El contador no libera."
            error={mensaje("rol")}
          >
            <select
              id="rol"
              name="rol"
              value={rol}
              className={rol ? undefined : "select-vacio"}
              aria-invalid={mensaje("rol") ? true : undefined}
              aria-describedby={descritoPor("rol", mensaje("rol"), Boolean(rol))}
              onChange={(event) => {
                setRol(event.target.value as RolCuenta | "");
                setLocal(null);
              }}
            >
              <option value="">Elige</option>
              {ROLES_VISIBLES.map((item) => (
                <option key={item.valor} value={item.valor}>
                  {item.etiqueta}
                </option>
              ))}
            </select>
          </Campo>
          {rol ? (
            <p className="elegido" id="rol-elegido">
              {pistaDelRol(rol)}
            </p>
          ) : null}
        </>
      ) : null}
      <div className="acciones">
        <button type="submit" className="boton" disabled={pendiente}>
          {pendiente ? "Guardando…" : "Dar de alta a la persona"}
        </button>
        <p>La CLABE se guarda. No se dispersa.</p>
      </div>
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
        <div className="alerta" role="alert">
          <p className="alerta-titulo">Revisa la baja</p>
          <p>
            <a href={`#${id}`}>{mensaje}</a>
          </p>
        </div>
      ) : estado.tipo === "listo" ? (
        <div className="alerta" role="status">
          <p className="alerta-titulo">Quedó asentado</p>
          <p>{estado.mensaje}</p>
        </div>
      ) : rechazo ? (
        <div className="alerta" role="alert">
          <p className="alerta-titulo">{rechazo.titulo}</p>
          <p>{rechazo.texto}</p>
        </div>
      ) : null}
      <input type="hidden" name="personaId" value={personaId} />
      <Campo
        id={id}
        etiqueta={`Fecha de baja de ${nombre}`}
        pista="Queda en el maestro. No se dispersa dinero."
        error={mensaje}
      >
        <input
          id={id}
          name="baja"
          type="date"
          value={baja}
          required
          aria-invalid={mensaje ? true : undefined}
          aria-describedby={descritoPor(id, mensaje)}
          onChange={(event) => setBaja(event.target.value)}
        />
      </Campo>
      <div className="acciones">
        <button type="submit" className="boton" disabled={pendiente}>
          {pendiente ? "Guardando…" : bajaActual ? "Corregir la fecha de baja" : "Registrar la baja"}
        </button>
      </div>
    </form>
  );
}

function Avisos({
  errores,
  estado,
}: {
  errores: ErrorCampo[];
  estado: { tipo: string; mensaje?: string; codigo?: string };
}) {
  if (errores.length > 0) {
    return (
      <div className="alerta" role="alert">
        <p className="alerta-titulo">Revisa el maestro</p>
        <ul>
          {errores.map((error) => (
            <li key={error.campo}>
              <a href={`#${error.campo}`}>{error.mensaje}</a>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (estado.tipo === "listo" && estado.mensaje) {
    return (
      <div className="alerta" role="status">
        <p className="alerta-titulo">Quedó asentado</p>
        <p>{estado.mensaje}</p>
      </div>
    );
  }
  if (estado.tipo === "rechazado" && estado.codigo && esCodigo(estado.codigo)) {
    const rechazo = MENSAJE_RECHAZO[estado.codigo];
    return (
      <div className="alerta" role="alert">
        <p className="alerta-titulo">{rechazo.titulo}</p>
        <p>{rechazo.texto}</p>
      </div>
    );
  }
  return null;
}

function esCodigo(codigo: string): codigo is keyof typeof MENSAJE_RECHAZO {
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

function descritoPor(id: string, error: string | undefined, elegido = false): string {
  const partes = [`${id}-pista`];
  if (elegido) partes.push(`${id}-elegido`);
  if (error) partes.push(`${id}-error`);
  return partes.join(" ");
}
