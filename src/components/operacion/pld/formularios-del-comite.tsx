"use client";

import { registrarAuditorAccion, registrarComunicacionAccion, registrarSesionAccion } from "@/app/operacion/(portal)/pld/acciones";
import { useConservaLoCapturado } from "@/components/operacion/pld/formularios-de-texto";
import { BotonEnviar } from "@/components/sistema";

/** 47ª: el auditor interno. Rechazado, nombre, cargo, RFC, CURP y fecha vuelven como se escribieron. */
export function FormularioAuditor({ formId, hoy, otro }: { formId: string; hoy: string; otro: boolean }) {
  const { estado, enviar, forma, valor, ligado, mensaje, aviso } = useConservaLoCapturado(registrarAuditorAccion, "aviso-auditor");
  return (
    <form key={estado.vuelta} ref={forma} action={enviar} className="formulario-pareja operacion-forma">
      <input type="hidden" name="formId" value={formId} />
      {aviso ? <div className="operacion-ancho">{aviso}</div> : null}
      <div className="campo">
        <label htmlFor="auditor-nombre">Nombre</label>
        <input id="auditor-nombre" name="nombre" required maxLength={200} autoComplete="off" defaultValue={valor("nombre")} {...ligado("nombre")} />
        {mensaje("nombre")}
      </div>
      <div className="campo">
        <label htmlFor="auditor-cargo">Cargo en la entidad</label>
        <input id="auditor-cargo" name="cargoEntidad" required maxLength={120} autoComplete="off" defaultValue={valor("cargoEntidad")} {...ligado("cargoEntidad")} />
        {mensaje("cargoEntidad")}
      </div>
      <div className="campo">
        <label htmlFor="auditor-rfc">RFC con homoclave</label>
        <input id="auditor-rfc" name="rfc" required maxLength={13} autoComplete="off" className="operacion-mono" defaultValue={valor("rfc")} {...ligado("rfc")} />
        {mensaje("rfc")}
      </div>
      <div className="campo">
        <label htmlFor="auditor-curp">CURP</label>
        <input id="auditor-curp" name="curp" required maxLength={18} autoComplete="off" className="operacion-mono" defaultValue={valor("curp")} {...ligado("curp")} />
        {mensaje("curp")}
      </div>
      <div className="campo">
        <label htmlFor="auditor-designado">Fecha de designación</label>
        <input id="auditor-designado" name="designadoEl" type="date" required max={hoy} defaultValue={valor("designadoEl", hoy)} {...ligado("designadoEl")} />
        {mensaje("designadoEl")}
      </div>
      <div className="acciones operacion-ancho">
        <BotonEnviar>{otro ? "Registrar otro auditor" : "Registrar auditor"}</BotonEnviar>
      </div>
    </form>
  );
}

type Pendiente = { integranteId: string; nombre: string };

/** 49ª: el acuse del SITI de las designaciones y bajas. Rechazado, folio, fecha y casillas vuelven como estaban. */
export function FormularioComunicacion({
  formId,
  recibidoHasta,
  designaciones,
  bajas,
}: {
  formId: string;
  recibidoHasta: string;
  designaciones: Pendiente[];
  bajas: Pendiente[];
}) {
  const { estado, enviar, forma, valor, marcada, ligado, mensaje, aviso } = useConservaLoCapturado(registrarComunicacionAccion, "aviso-comunicacion");
  return (
    <form key={estado.vuelta} ref={forma} action={enviar} className="formulario-pareja operacion-forma">
      <input type="hidden" name="formId" value={formId} />
      {aviso ? <div className="operacion-ancho">{aviso}</div> : null}
      <div className="campo">
        <label htmlFor="comunicacion-folio">Folio del acuse del SITI</label>
        <input id="comunicacion-folio" name="folio" required maxLength={40} autoComplete="off" defaultValue={valor("folio")} {...ligado("folio")} />
        {mensaje("folio")}
      </div>
      <div className="campo">
        <label htmlFor="comunicacion-recibido">Fecha y hora de recepción</label>
        <input id="comunicacion-recibido" name="recibidoEn" type="datetime-local" required max={recibidoHasta} defaultValue={valor("recibidoEn")} {...ligado("recibidoEn")} />
        {mensaje("recibidoEn")}
      </div>
      <fieldset className="opciones operacion-ancho">
        <legend>Qué cubre</legend>
        {designaciones.map((p) => (
          <label key={`d-${p.integranteId}`} className="confirmacion">
            <input type="checkbox" name="integrantes" value={p.integranteId} defaultChecked={marcada("integrantes", p.integranteId, true)} />
            <span>Designación de {p.nombre}</span>
          </label>
        ))}
        {bajas.map((p) => (
          <label key={`b-${p.integranteId}`} className="confirmacion">
            <input type="checkbox" name="bajas" value={p.integranteId} defaultChecked={marcada("bajas", p.integranteId, true)} />
            <span>Baja de {p.nombre}</span>
          </label>
        ))}
      </fieldset>
      <div className="acciones operacion-ancho">
        <BotonEnviar>Registrar comunicación</BotonEnviar>
      </div>
    </form>
  );
}

/** 47ª: una sesión del Comité. Rechazada, la fecha y las casillas de presentes vuelven como estaban. */
export function FormularioSesion({
  formId,
  hoy,
  integrantes,
  auditor,
}: {
  formId: string;
  hoy: string;
  integrantes: Array<{ id: string; etiqueta: string }>;
  auditor: string | null;
}) {
  const { estado, enviar, forma, valor, marcada, ligado, mensaje, aviso } = useConservaLoCapturado(registrarSesionAccion, "aviso-sesion");
  // r2-serv-N6: el fieldset no recibe el foco; con el aviso, lo toma la primera casilla.
  const { autoFocus, ...sinPresentes } = ligado("presentes") as { "aria-invalid"?: true; "aria-describedby"?: string; autoFocus?: true };
  return (
    <form key={estado.vuelta} ref={forma} action={enviar} className="formulario-pareja operacion-forma">
      <input type="hidden" name="formId" value={formId} />
      {aviso ? <div className="operacion-ancho">{aviso}</div> : null}
      <div className="campo">
        <label htmlFor="sesion-fecha">Fecha de la sesión</label>
        <input id="sesion-fecha" name="celebradaEl" type="date" required max={hoy} defaultValue={valor("celebradaEl", hoy)} {...ligado("celebradaEl")} />
        {mensaje("celebradaEl")}
      </div>
      <fieldset id="sesion-presentes" className="opciones operacion-ancho" {...sinPresentes}>
        <legend>Presentes</legend>
        {integrantes.map((integrante, indice) => (
          <label key={integrante.id} className="confirmacion">
            <input type="checkbox" name="presentes" value={integrante.id} defaultChecked={marcada("presentes", integrante.id, false)} autoFocus={indice === 0 && autoFocus === true} />
            <span>{integrante.etiqueta}</span>
          </label>
        ))}
        {auditor ? (
          <label className="confirmacion">
            <input type="checkbox" name="auditorPresente" value="si" defaultChecked={marcada("auditorPresente", "si", false)} />
            <span>{auditor} · auditor, con voz y sin voto</span>
          </label>
        ) : null}
        {mensaje("presentes")}
      </fieldset>
      <div className="acciones operacion-ancho">
        <BotonEnviar>Registrar sesión</BotonEnviar>
        <p>Sin la mayoría de los miembros, queda registrada «sin quórum» y no admite votos.</p>
      </div>
    </form>
  );
}
