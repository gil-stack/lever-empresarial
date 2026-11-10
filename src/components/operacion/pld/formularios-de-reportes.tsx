"use client";

import { registrarEntidadAccion, registrarPeriodicoAccion } from "@/app/operacion/(portal)/pld/acciones";
import { useConservaLoCapturado } from "@/components/operacion/pld/formularios-de-texto";
import { BotonEnviar } from "@/components/sistema";

/** Las claves CASFIM de la entidad y del órgano supervisor. Rechazadas, vuelven como se escribieron. */
export function FormularioEntidad({ formId, casfim, supervisor, nuevas }: { formId: string; casfim: string; supervisor: string; nuevas: boolean }) {
  const { estado, enviar, forma, valor, ligado, mensaje, aviso } = useConservaLoCapturado(registrarEntidadAccion, "aviso-entidad");
  return (
    <form key={estado.vuelta} ref={forma} action={enviar} className="formulario-pareja operacion-forma">
      <input type="hidden" name="formId" value={formId} />
      {aviso ? <div className="operacion-ancho">{aviso}</div> : null}
      <div className="campo">
        <label htmlFor="entidad-casfim">Clave CASFIM de la entidad (6 dígitos)</label>
        {mensaje("claveCasfim")}
        <input id="entidad-casfim" name="claveCasfim" required inputMode="numeric" pattern="[0-9]{6}" defaultValue={valor("claveCasfim", casfim)} {...ligado("claveCasfim")} />
      </div>
      <div className="campo">
        <label htmlFor="entidad-supervisor">Clave CASFIM del órgano supervisor (6 dígitos)</label>
        {mensaje("claveOrganoSupervisor")}
        <input id="entidad-supervisor" name="claveOrganoSupervisor" required inputMode="numeric" pattern="[0-9]{6}" defaultValue={valor("claveOrganoSupervisor", supervisor)} {...ligado("claveOrganoSupervisor")} />
      </div>
      <div className="acciones operacion-ancho">
        <BotonEnviar>{nuevas ? "Registrar claves nuevas" : "Registrar claves"}</BotonEnviar>
        <p>La clave de acceso al SITI es personal del Oficial de Cumplimiento: Lever no la pide ni la guarda.</p>
      </div>
    </form>
  );
}

/**
 * El registro de un periodo: el acuse del SITI de la 36ª o la constancia de la 38ª (sin campos). Rechazado, folio,
 * fecha y registros vuelven como se escribieron. `base` es el id de la tarjeta y prefija los de sus campos.
 */
export function FormularioPeriodico({
  formId,
  reporte,
  periodo,
  base,
  recibidoDesde,
  recibidoHasta,
}: {
  formId: string;
  reporte: string;
  periodo: string;
  base: string;
  recibidoDesde: string;
  recibidoHasta: string;
}) {
  const { estado, enviar, forma, valor, ligado, mensaje, aviso } = useConservaLoCapturado(registrarPeriodicoAccion, `aviso-${base}`);
  return (
    <form key={estado.vuelta} ref={forma} action={enviar} className="formulario-pareja operacion-forma">
      <input type="hidden" name="formId" value={formId} />
      <input type="hidden" name="reporte" value={reporte} />
      <input type="hidden" name="periodo" value={periodo} />
      {aviso ? <div className="operacion-ancho">{aviso}</div> : null}
      {reporte === "36" ? (
        <>
          <div className="campo">
            <label htmlFor={`${base}-folio`}>Folio del acuse del SITI</label>
            {mensaje("folio")}
            <input id={`${base}-folio`} name="folio" required maxLength={40} autoComplete="off" defaultValue={valor("folio")} {...ligado("folio")} />
          </div>
          <div className="campo">
            <label htmlFor={`${base}-recibido`}>Fecha y hora de recepción</label>
            {mensaje("recibidoEn")}
            <input id={`${base}-recibido`} name="recibidoEn" type="datetime-local" required min={recibidoDesde} max={recibidoHasta} defaultValue={valor("recibidoEn")} {...ligado("recibidoEn")} />
          </div>
          <div className="campo">
            <label htmlFor={`${base}-registros`}>Número de registros</label>
            {mensaje("registros")}
            <input id={`${base}-registros`} name="registros" required inputMode="numeric" defaultValue={valor("registros", "1")} {...ligado("registros")} />
          </div>
        </>
      ) : (
        <>
          <input type="hidden" name="folio" value="" />
          <input type="hidden" name="recibidoEn" value="" />
          <input type="hidden" name="registros" value="" />
        </>
      )}
      <div className="acciones operacion-ancho">
        <BotonEnviar>{reporte === "36" ? "Registrar envío" : "Registrar constancia"}</BotonEnviar>
        <p>Se guarda con la huella del archivo que generó Lever. No se puede modificar.</p>
      </div>
    </form>
  );
}
