"use client";

import { useActionState } from "react";

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

export function FormularioPlazo({ dias, vencidos }: { dias: number; vencidos: number }) {
  const [estado, accion, pendiente] = useActionState(guardarPlazoEmpresa, FORMULARIO_INICIAL);
  return (
    <form className="politica-forma" action={accion} noValidate>
      <Aviso estado={estado} />
      <div className="campo">
        <label htmlFor="dias-empresa">Días para pasar de «todavía no» a «ya se pasó»</label>
        <input
          id="dias-empresa"
          name="dias"
          inputMode="numeric"
          autoComplete="off"
          required
          defaultValue={String(dias)}
          aria-invalid={estado.tipo === "invalido" || undefined}
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
          aria-invalid={estado.tipo === "invalido" || undefined}
        />
      </div>
      <div className="acciones">
        <button type="submit" className="boton" disabled={pendiente}>
          {pendiente ? "Guardando…" : "Guardar el default"}
        </button>
      </div>
    </form>
  );
}

export function FormularioUmbral({ escrito }: { escrito: boolean }) {
  const [estado, accion, pendiente] = useActionState(guardarUmbral, FORMULARIO_INICIAL);
  return (
    <form className="politica-forma" action={accion} noValidate>
      <Aviso estado={estado} />
      <div className="campo">
        <label htmlFor="umbral-proveedores">Umbral en pesos, con centavos</label>
        <input
          id="umbral-proveedores"
          name="umbral"
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={estado.tipo === "invalido" || undefined}
        />
        <p className="pista" id="pista-umbral">
          Vacío no guarda un cero. El monto queda solo si lo escribes.
        </p>
      </div>
      <div className="acciones">
        <button type="submit" className="boton" name="intencion" value="escribir" disabled={pendiente}>
          {pendiente ? "Guardando…" : "Escribir umbral"}
        </button>
        {escrito ? (
          <button type="submit" className="boton-texto" name="intencion" value="quitar" disabled={pendiente}>
            Quitar el umbral
          </button>
        ) : null}
      </div>
    </form>
  );
}

export function FormularioPersona({
  userId,
  dias,
  vencidos,
  propio,
}: {
  userId: string;
  dias: number;
  vencidos: number;
  propio: boolean;
}) {
  const [estado, accion, pendiente] = useActionState(guardarPoliticaPersona, FORMULARIO_INICIAL);
  const diasId = `dias-${userId}`;
  const vencidosId = `vencidos-${userId}`;
  return (
    <form className="politica-forma" action={accion} noValidate>
      <Aviso estado={estado} />
      <input type="hidden" name="userId" value={userId} />
      <div className="campo">
        <label htmlFor={diasId}>Días de esta persona</label>
        <input
          id={diasId}
          name="dias"
          inputMode="numeric"
          autoComplete="off"
          required
          defaultValue={String(dias)}
          aria-invalid={estado.tipo === "invalido" || undefined}
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
          aria-invalid={estado.tipo === "invalido" || undefined}
        />
      </div>
      <div className="acciones">
        <button type="submit" className="boton" name="intencion" value="escribir" disabled={pendiente}>
          {pendiente ? "Guardando…" : "Guardar para esta persona"}
        </button>
        {propio ? (
          <button type="submit" className="boton-texto" name="intencion" value="quitar" disabled={pendiente}>
            Volver al default
          </button>
        ) : null}
      </div>
    </form>
  );
}

export function FormularioNuevaCategoria() {
  const [estado, accion, pendiente] = useActionState(agregarCategoria, FORMULARIO_INICIAL);
  return (
    <form className="politica-forma" action={accion} noValidate>
      <Aviso estado={estado} />
      <div className="campo">
        <label htmlFor="categoria-nombre">Nombre</label>
        <input
          id="categoria-nombre"
          name="nombre"
          autoComplete="off"
          required
          maxLength={80}
          aria-invalid={estado.tipo === "invalido" || undefined}
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
        <button type="submit" className="boton" disabled={pendiente}>
          {pendiente ? "Guardando…" : "Agregar categoría"}
        </button>
      </div>
    </form>
  );
}

export function FormularioTope({ categoriaId }: { categoriaId: string }) {
  const [estado, accion, pendiente] = useActionState(guardarTopeCategoria, FORMULARIO_INICIAL);
  const id = `tope-${categoriaId}`;
  return (
    <form className="politica-forma" action={accion} noValidate>
      <Aviso estado={estado} />
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
        />
      </div>
      <div className="acciones">
        <button type="submit" className="boton" disabled={pendiente}>
          {pendiente ? "Guardando…" : "Escribir el tope"}
        </button>
      </div>
    </form>
  );
}

export function BotonQuitarTope({ categoriaId }: { categoriaId: string }) {
  const [estado, accion, pendiente] = useActionState(dejarCategoriaSinTope, FORMULARIO_INICIAL);
  return (
    <form className="politica-forma" action={accion}>
      <Aviso estado={estado} />
      <input type="hidden" name="categoriaId" value={categoriaId} />
      <button type="submit" className="boton-texto" disabled={pendiente}>
        {pendiente ? "Guardando…" : "Dejar sin tope"}
      </button>
    </form>
  );
}

export function BotonBorrarCategoria({ categoriaId }: { categoriaId: string }) {
  const [estado, accion, pendiente] = useActionState(eliminarCategoria, FORMULARIO_INICIAL);
  return (
    <form className="politica-forma" action={accion}>
      <Aviso estado={estado} />
      <input type="hidden" name="categoriaId" value={categoriaId} />
      <button type="submit" className="boton-texto" disabled={pendiente}>
        {pendiente ? "Borrando…" : "Borrar categoría"}
      </button>
    </form>
  );
}

function Aviso({ estado }: { estado: EstadoFormulario }) {
  if (estado.tipo === "inicial") return null;
  if (estado.tipo === "guardado") {
    return (
      <p className="edad" role="status">
        {estado.mensaje}
      </p>
    );
  }
  return (
    <div className="alerta" role="alert">
      <p>{estado.mensaje}</p>
    </div>
  );
}
