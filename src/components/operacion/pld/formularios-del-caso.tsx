"use client";

import { agregarNotaAccion, marcarVeinticuatroHorasAccion, registrarReportePldAccion } from "@/app/operacion/(portal)/pld/acciones";
import { useConservaLoCapturado } from "@/components/operacion/pld/formularios-de-texto";
import { BotonEnviar } from "@/components/sistema";

/** 44ª: el caso pasa a reporte de 24 horas. Rechazado, el motivo vuelve como se escribió. */
export function FormularioVeinticuatroHoras({ casoId }: { casoId: string }) {
  const { estado, enviar, forma, valor, ligado, mensaje, aviso } = useConservaLoCapturado(marcarVeinticuatroHorasAccion, "aviso-plazo");
  return (
    <form key={estado.vuelta} ref={forma} action={enviar} className="operacion-forma">
      <input type="hidden" name="casoId" value={casoId} />
      {aviso}
      <div className="campo">
        <label htmlFor="plazo-motivo">Si hay información de que los recursos pueden venir de actividades ilícitas: qué se sabe</label>
        <textarea id="plazo-motivo" name="motivo" required minLength={10} maxLength={1000} defaultValue={valor("motivo")} {...ligado("motivo")} />
        {mensaje("motivo")}
      </div>
      <div className="acciones">
        <BotonEnviar>Marcar como reporte de 24 horas</BotonEnviar>
        <p>Desde esta marca, el reporte vence en 24 horas y lleva la leyenda «Reporte de 24 horas».</p>
      </div>
    </form>
  );
}

/** 41ª: una nota del análisis. Rechazada, el texto vuelve como se escribió. */
export function FormularioNota({ casoId, formId }: { casoId: string; formId: string }) {
  const { estado, enviar, forma, valor, ligado, mensaje, aviso } = useConservaLoCapturado(agregarNotaAccion, "aviso-nota");
  return (
    <form key={estado.vuelta} ref={forma} action={enviar} className="operacion-forma">
      <input type="hidden" name="casoId" value={casoId} />
      <input type="hidden" name="formId" value={formId} />
      {aviso}
      <div className="campo">
        <label htmlFor="nota-texto">Nota</label>
        <textarea id="nota-texto" name="texto" required maxLength={4000} defaultValue={valor("texto")} {...ligado("texto")} />
        {mensaje("texto")}
      </div>
      <div className="acciones">
        <BotonEnviar>Agregar nota</BotonEnviar>
      </div>
    </form>
  );
}

/** El acuse del SITI del reporte del caso. Rechazado, folio, periodo, fecha y registros vuelven como se escribieron. */
export function FormularioAcuseDelCaso({
  casoId,
  formId,
  periodo,
  recibidoDesde,
  recibidoHasta,
}: {
  casoId: string;
  formId: string;
  periodo: string;
  recibidoDesde: string;
  recibidoHasta: string;
}) {
  const { estado, enviar, forma, valor, ligado, mensaje, aviso } = useConservaLoCapturado(registrarReportePldAccion, "aviso-acuse");
  return (
    <form key={estado.vuelta} ref={forma} action={enviar} className="formulario-pareja operacion-forma">
      <input type="hidden" name="casoId" value={casoId} />
      <input type="hidden" name="formId" value={formId} />
      {aviso ? <div className="operacion-ancho">{aviso}</div> : null}
      <div className="campo">
        <label htmlFor="reporte-folio">Folio del acuse</label>
        <input id="reporte-folio" name="folio" required maxLength={40} autoComplete="off" defaultValue={valor("folio")} {...ligado("folio")} />
        {mensaje("folio")}
      </div>
      <div className="campo">
        <label htmlFor="reporte-periodo">Periodo (AAAAMMDD)</label>
        <input id="reporte-periodo" name="periodo" required inputMode="numeric" pattern="[0-9]{8}" defaultValue={valor("periodo", periodo)} {...ligado("periodo")} />
        {mensaje("periodo")}
      </div>
      <div className="campo">
        <label htmlFor="reporte-recibido">Fecha y hora de recepción (Ciudad de México)</label>
        <input id="reporte-recibido" name="recibidoEn" type="datetime-local" required min={recibidoDesde} max={recibidoHasta} defaultValue={valor("recibidoEn")} {...ligado("recibidoEn")} />
        {mensaje("recibidoEn")}
      </div>
      <div className="campo">
        <label htmlFor="reporte-registros">Número de registros</label>
        <input id="reporte-registros" name="registros" required inputMode="numeric" defaultValue={valor("registros", "1")} {...ligado("registros")} />
        {mensaje("registros")}
      </div>
      <div className="acciones operacion-ancho">
        <BotonEnviar>Registrar acuse</BotonEnviar>
        <p>El acuse no se puede modificar después, igual que en el SITI.</p>
      </div>
    </form>
  );
}
