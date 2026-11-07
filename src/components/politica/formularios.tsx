"use client";

import { useActionState, useEffect, useRef } from "react";

import {
  agregarCategoria,
  dejarCategoriaSinTope,
  eliminarCategoria,
  guardarPlazoEmpresa,
  guardarPoliticaPersona,
  guardarTopeCategoria,
  guardarUmbral,
} from "@/app/consola/politica/acciones";
import { FORMULARIO_INICIAL, type EstadoFormulario } from "@/app/consola/politica/estado";
import { enviarSinReiniciar, useEnvioConBoton } from "@/components/proveedores/sin-reinicio";
import { BotonEnviar } from "@/components/sistema";

// Los formularios envían sin el reinicio de `<form action>`: tras un error, el
// campo conserva lo que se escribió y el aviso queda ligado a él.

export function FormularioPlazo({ dias, vencidos }: { dias: number; vencidos: number }) {
  const [estado, accion, pendiente] = useActionState(guardarPlazoEmpresa, FORMULARIO_INICIAL);
  const aviso = "aviso-plazo-empresa";
  return (
    <form className="politica-forma" onSubmit={enviarSinReiniciar(accion)} noValidate aria-busy={pendiente}>
      <Aviso id={aviso} estado={estado} />
      <div className="campo">
        <label htmlFor="dias-empresa">Días para pasar de «todavía no» a «ya se pasó»</label>
        <input
          id="dias-empresa"
          name="dias"
          inputMode="numeric"
          autoComplete="off"
          required
          defaultValue={String(dias)}
          aria-invalid={invalidoEn(estado, "dias")}
          aria-describedby={ligado(estado, aviso, "dias")}
        />
      </div>
      <div className="campo">
        <label htmlFor="vencidos-empresa">Comprobantes vencidos antes de pausar la tarjeta</label>
        <input
          id="vencidos-empresa"
          name="vencidos"
          inputMode="numeric"
          autoComplete="off"
          required
          defaultValue={String(vencidos)}
          aria-invalid={invalidoEn(estado, "vencidos")}
          aria-describedby={ligado(estado, aviso, "vencidos")}
        />
      </div>
      <div className="acciones">
        <BotonEnviar pendiente={pendiente} enviando="Guardando…">Guardar el plazo</BotonEnviar>
      </div>
    </form>
  );
}

export function FormularioUmbral({ escrito }: { escrito: boolean }) {
  const [estado, accion, pendiente] = useActionState(guardarUmbral, FORMULARIO_INICIAL);
  const { enviar, oprimido } = useEnvioConBoton(accion);
  const aviso = "aviso-umbral";
  return (
    <form className="politica-forma" onSubmit={enviar} noValidate aria-busy={pendiente}>
      <Aviso id={aviso} estado={estado} />
      <div className="campo">
        <label htmlFor="umbral-proveedores">Umbral en pesos, con centavos</label>
        <input
          id="umbral-proveedores"
          name="umbral"
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={estado.tipo === "invalido" || undefined}
          aria-describedby={estado.tipo === "invalido" ? `pista-umbral ${aviso}` : "pista-umbral"}
        />
        <p className="pista" id="pista-umbral">
          Vacío no guarda un cero. El monto queda solo si lo escribes.
        </p>
      </div>
      <div className="acciones">
        <BotonEnviar name="intencion" value="escribir" pendiente={pendiente && oprimido === "escribir"} disabled={pendiente} enviando="Guardando…">Escribir umbral</BotonEnviar>
        {escrito ? (
          <BotonEnviar className="boton-texto" name="intencion" value="quitar" pendiente={pendiente && oprimido === "quitar"} disabled={pendiente} enviando="Quitando…">
            Quitar el umbral
          </BotonEnviar>
        ) : null}
      </div>
    </form>
  );
}

export function FormularioPersona({
  personaId,
  dias,
  vencidos,
  propio,
}: {
  personaId: string;
  dias: number;
  vencidos: number;
  propio: boolean;
}) {
  const [estado, accion, pendiente] = useActionState(guardarPoliticaPersona, FORMULARIO_INICIAL);
  const { enviar, oprimido } = useEnvioConBoton(accion);
  const diasId = `dias-${personaId}`;
  const vencidosId = `vencidos-${personaId}`;
  const aviso = `aviso-${personaId}`;
  return (
    <form className="politica-forma" onSubmit={enviar} noValidate aria-busy={pendiente}>
      <Aviso id={aviso} estado={estado} />
      <input type="hidden" name="personaId" value={personaId} />
      <div className="campo">
        <label htmlFor={diasId}>Días de esta persona</label>
        <input
          id={diasId}
          name="dias"
          inputMode="numeric"
          autoComplete="off"
          required
          defaultValue={String(dias)}
          aria-invalid={invalidoEn(estado, "dias")}
          aria-describedby={ligado(estado, aviso, "dias")}
        />
      </div>
      <div className="campo">
        <label htmlFor={vencidosId}>Comprobantes vencidos de esta persona</label>
        <input
          id={vencidosId}
          name="vencidos"
          inputMode="numeric"
          autoComplete="off"
          required
          defaultValue={String(vencidos)}
          aria-invalid={invalidoEn(estado, "vencidos")}
          aria-describedby={ligado(estado, aviso, "vencidos")}
        />
      </div>
      <div className="acciones">
        <BotonEnviar name="intencion" value="escribir" pendiente={pendiente && oprimido === "escribir"} disabled={pendiente} enviando="Guardando…">Guardar para esta persona</BotonEnviar>
        {propio ? (
          <BotonEnviar className="boton-texto" name="intencion" value="quitar" pendiente={pendiente && oprimido === "quitar"} disabled={pendiente} enviando="Guardando…">
            Volver al plazo de la empresa
          </BotonEnviar>
        ) : null}
      </div>
    </form>
  );
}

export function FormularioNuevaCategoria() {
  const [estado, accion, pendiente] = useActionState(agregarCategoria, FORMULARIO_INICIAL);
  const forma = useRef<HTMLFormElement>(null);
  const aviso = "aviso-categoria-nueva";
  // Al guardar, la forma queda lista para la siguiente categoría.
  useEffect(() => {
    if (estado.tipo === "guardado") forma.current?.reset();
  }, [estado]);
  return (
    <form ref={forma} className="politica-forma" onSubmit={enviarSinReiniciar(accion)} noValidate aria-busy={pendiente}>
      <Aviso id={aviso} estado={estado} />
      <div className="campo">
        <label htmlFor="categoria-nombre">Nombre</label>
        <input
          id="categoria-nombre"
          name="nombre"
          autoComplete="off"
          required
          maxLength={80}
          aria-invalid={estado.tipo === "invalido" || undefined}
          aria-describedby={estado.tipo === "invalido" ? aviso : undefined}
        />
      </div>
      <div className="campo">
        <label htmlFor="categoria-tope">Tope en pesos, con centavos</label>
        <input
          id="categoria-tope"
          name="tope"
          inputMode="decimal"
          autoComplete="off"
          aria-describedby="pista-tope-nuevo"
        />
        <p className="pista" id="pista-tope-nuevo">
          Déjalo vacío si la empresa todavía no escribe el tope.
        </p>
      </div>
      <div className="acciones">
        <BotonEnviar pendiente={pendiente} enviando="Guardando…">Agregar categoría</BotonEnviar>
      </div>
    </form>
  );
}

export function FormularioTope({ categoriaId }: { categoriaId: string }) {
  const [estado, accion, pendiente] = useActionState(guardarTopeCategoria, FORMULARIO_INICIAL);
  const id = `tope-${categoriaId}`;
  const aviso = `aviso-${id}`;
  return (
    <form className="politica-forma" onSubmit={enviarSinReiniciar(accion)} noValidate aria-busy={pendiente}>
      <Aviso id={aviso} estado={estado} />
      <input type="hidden" name="categoriaId" value={categoriaId} />
      <div className="campo">
        <label htmlFor={id}>Tope en pesos, con centavos</label>
        <input
          id={id}
          name="tope"
          inputMode="decimal"
          autoComplete="off"
          required
          aria-invalid={estado.tipo === "invalido" || undefined}
          aria-describedby={estado.tipo === "invalido" ? aviso : undefined}
        />
      </div>
      <div className="acciones">
        <BotonEnviar pendiente={pendiente} enviando="Guardando…">Escribir el tope</BotonEnviar>
      </div>
    </form>
  );
}

export function BotonQuitarTope({ categoriaId }: { categoriaId: string }) {
  const [estado, accion, pendiente] = useActionState(dejarCategoriaSinTope, FORMULARIO_INICIAL);
  return (
    <form className="politica-forma" action={accion} aria-busy={pendiente}>
      <Aviso id={`aviso-sin-tope-${categoriaId}`} estado={estado} />
      <input type="hidden" name="categoriaId" value={categoriaId} />
      <BotonEnviar className="boton-texto" pendiente={pendiente} enviando="Guardando…">Dejar sin tope</BotonEnviar>
    </form>
  );
}

export function BotonBorrarCategoria({ categoriaId }: { categoriaId: string }) {
  const [estado, accion, pendiente] = useActionState(eliminarCategoria, FORMULARIO_INICIAL);
  return (
    <form className="politica-forma" action={accion} aria-busy={pendiente}>
      <Aviso id={`aviso-borrar-${categoriaId}`} estado={estado} />
      <input type="hidden" name="categoriaId" value={categoriaId} />
      <BotonEnviar className="boton-texto" pendiente={pendiente} enviando="Borrando…">Borrar categoría</BotonEnviar>
    </form>
  );
}

function invalidoEn(estado: EstadoFormulario, campo: "dias" | "vencidos"): true | undefined {
  if (estado.tipo !== "invalido" || estado.campo !== campo) return undefined;
  return true;
}

/** El aviso de error describe el campo que lo causó. */
function ligado(estado: EstadoFormulario, aviso: string, campo: "dias" | "vencidos"): string | undefined {
  return invalidoEn(estado, campo) ? aviso : undefined;
}

function Aviso({ id, estado }: { id: string; estado: EstadoFormulario }) {
  if (estado.tipo === "inicial") return null;
  if (estado.tipo === "guardado") {
    return (
      <p className="edad" role="status" id={id}>
        {estado.mensaje}
      </p>
    );
  }
  return (
    <div className="alerta alerta-revisar" role="alert" id={id}>
      <p>{estado.mensaje}</p>
    </div>
  );
}
