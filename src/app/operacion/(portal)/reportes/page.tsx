import { randomUUID } from "node:crypto";

import type { Metadata } from "next";

import { registrarEntidadAccion, registrarPeriodicoAccion } from "@/app/operacion/(portal)/pld/acciones";
import { errorDelCampo } from "@/components/operacion/aviso";
import { fechaDia, fechaHora } from "@/components/operacion/formato";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { ahoraEnMexicoParaCampo, plazoEnDiasHabiles } from "@/components/operacion/pld/formato";
import { SinPermiso } from "@/components/operacion/sin-permiso";
import { BotonEnviar, EtiquetaMono, Hoja, Insignia, NotaRegla, Renglon, Renglones, Vacio } from "@/components/sistema";
import { exigirContextoOperacion, puedeEnOperacion } from "@/server/operacion";
import { ahoraPld, leerEntidad, leerPeriodicos, type Periodico } from "@/server/pld";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Reportes regulatorios · Operación" };

/**
 * Reportes periódicos: la 36ª (Relevantes, trimestral) con el archivo de 41
 * columnas, la 37ª sin formato oficial para SOFIPO y la constancia interna de la
 * 38ª (mensual). El contenido sale de los datos y los plazos se cuentan en días
 * hábiles al leer. Lever no transmite: Cumplimiento registra cada envío.
 */
export default async function ReportesRegulatorios({ searchParams }: { searchParams: Promise<{ aviso?: string; en?: string }> }) {
  const ctx = await exigirContextoOperacion();
  const params = await searchParams;
  if (!puedeEnOperacion(ctx, "plataforma.pld.ver")) {
    return (
      <PaginaOperacion titulo="Reportes regulatorios">
        <SinPermiso>Los reportes regulatorios los ven Cumplimiento y Auditoría.</SinPermiso>
      </PaginaOperacion>
    );
  }
  const ahora = ahoraPld();
  const [entidad, periodicos] = await Promise.all([leerEntidad(ctx), leerPeriodicos(ctx, { ahora })]);
  const reporta = puedeEnOperacion(ctx, "plataforma.pld.reportar");
  const error = (seccion: string, campo: string) => (params.en === seccion ? errorDelCampo(params.aviso, campo) : {});
  const faltaCalendario = periodicos.map((p) => p.faltaCalendario).find((anio): anio is number => anio !== null) ?? null;
  const ancla = (p: Periodico) => `reporte-${p.reporte}-${p.periodo}`;
  // El acuse es posterior al cierre del periodo: desde el primer día del mes siguiente.
  const desdeCierre = (p: Periodico) => {
    const anio = Number(p.periodo.slice(0, 4));
    const mes = Number(p.periodo.slice(4));
    return mes === 12 ? `${anio + 1}-01-01T00:00` : `${anio}-${String(mes + 1).padStart(2, "0")}-01T00:00`;
  };

  const tarjeta = (periodico: Periodico) => (
    <li key={ancla(periodico)} id={ancla(periodico)}>
      <div className="operacion-fila">
        <div className="operacion-fila-cuerpo">
          <h3>{periodico.nombre}</h3>
          <p className="operacion-meta">
            <span>Vence el {fechaDia(periodico.vence)}</span>
            {periodico.estado !== "registrado" ? <span>{plazoEnDiasHabiles(periodico.diasHabiles, periodico.estado === "vencido")}</span> : null}
          </p>
          <p>
            <a className="boton-texto" href={`/operacion/reportes/archivo?reporte=${periodico.reporte}&periodo=${periodico.periodo}`}>
              {periodico.reporte === "36" ? "Descargar el archivo de 41 columnas" : "Descargar la constancia interna"}
            </a>
          </p>
          {periodico.reporte === "36" ? (
            <p className="pista">Borrador según el layout del DOF; el Oficial confirma la mecánica del reporte vacío en el SITI.</p>
          ) : (
            <p className="pista">Constancia interna en ceros: no hay formato público para SOFIPO. El Oficial confirma en el SITI si existe uno.</p>
          )}
          {periodico.registro ? (
            <Renglones>
              {periodico.registro.folio ? <Renglon etiqueta="Folio del acuse">{periodico.registro.folio}</Renglon> : null}
              {periodico.registro.recibidoEn ? <Renglon etiqueta="Recibido">{fechaHora(periodico.registro.recibidoEn)}</Renglon> : null}
              <Renglon etiqueta="Registrado">{fechaHora(periodico.registro.registradoEn)}</Renglon>
              <Renglon etiqueta="Huella del archivo">
                <EtiquetaMono nombre="SHA-256">{periodico.registro.sha256.slice(0, 16)}…</EtiquetaMono>
              </Renglon>
            </Renglones>
          ) : reporta ? (
            <form action={registrarPeriodicoAccion} className="formulario-pareja operacion-forma">
              <input type="hidden" name="formId" value={randomUUID()} />
              <input type="hidden" name="reporte" value={periodico.reporte} />
              <input type="hidden" name="periodo" value={periodico.periodo} />
              {periodico.reporte === "36" ? (
                <>
                  <div className="campo">
                    <label htmlFor={`${ancla(periodico)}-folio`}>Folio del acuse del SITI</label>
                    <input id={`${ancla(periodico)}-folio`} name="folio" required maxLength={40} autoComplete="off" {...error(ancla(periodico), "folio")} />
                  </div>
                  <div className="campo">
                    <label htmlFor={`${ancla(periodico)}-recibido`}>Fecha y hora de recepción</label>
                    <input id={`${ancla(periodico)}-recibido`} name="recibidoEn" type="datetime-local" required min={desdeCierre(periodico)} max={ahoraEnMexicoParaCampo(new Date())} {...error(ancla(periodico), "recibidoEn")} />
                  </div>
                  <div className="campo">
                    <label htmlFor={`${ancla(periodico)}-registros`}>Número de registros</label>
                    <input id={`${ancla(periodico)}-registros`} name="registros" required inputMode="numeric" defaultValue="1" {...error(ancla(periodico), "registros")} />
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
                <BotonEnviar>{periodico.reporte === "36" ? "Registrar envío" : "Registrar constancia"}</BotonEnviar>
                <p>Se guarda con la huella del archivo que generó Lever. No se puede modificar.</p>
              </div>
            </form>
          ) : null}
        </div>
        <Insignia tono={periodico.estado === "registrado" ? "sello" : periodico.estado === "vencido" ? "aviso" : "neutro"}>
          {periodico.estado === "registrado" ? "Registrado" : periodico.estado === "vencido" ? "Vencido" : "Por vencer"}
        </Insignia>
      </div>
    </li>
  );

  return (
    <PaginaOperacion titulo="Reportes regulatorios" aviso={params.aviso}>
      {faltaCalendario ? (
        <div className="operacion-ficha-cabeza">
          <Insignia tono="aviso">Falta el calendario {faltaCalendario}</Insignia>
          <p className="pista">Mientras no se publiquen los días inhábiles de {faltaCalendario}, solo se descuentan sábados y domingos.</p>
        </div>
      ) : null}

      <Hoja id="entidad-titulo" titulo="Clave de la entidad">
        {entidad ? (
          <Renglones>
            <Renglon etiqueta="Clave CASFIM de la entidad">{entidad.claveCasfim}</Renglon>
            <Renglon etiqueta="Clave CASFIM del órgano supervisor">{entidad.claveOrganoSupervisor}</Renglon>
            <Renglon etiqueta="Registrada">{fechaHora(entidad.registradaEn)}</Renglon>
          </Renglones>
        ) : (
          <div className="operacion-ficha-cabeza">
            <Insignia tono="aviso">Falta la clave de la entidad</Insignia>
            <p className="pista">Sin ella no se genera el archivo de Relevantes. Se consulta en el catálogo «Instituciones» del SITI.</p>
          </div>
        )}
        {reporta ? (
          <form action={registrarEntidadAccion} className="formulario-pareja operacion-forma">
            <input type="hidden" name="formId" value={randomUUID()} />
            <div className="campo">
              <label htmlFor="entidad-casfim">Clave CASFIM de la entidad (6 dígitos)</label>
              <input id="entidad-casfim" name="claveCasfim" required inputMode="numeric" pattern="[0-9]{6}" defaultValue={entidad?.claveCasfim ?? ""} {...error("entidad-titulo", "claveCasfim")} />
            </div>
            <div className="campo">
              <label htmlFor="entidad-supervisor">Clave CASFIM del órgano supervisor (6 dígitos)</label>
              <input id="entidad-supervisor" name="claveOrganoSupervisor" required inputMode="numeric" pattern="[0-9]{6}" defaultValue={entidad?.claveOrganoSupervisor ?? ""} {...error("entidad-titulo", "claveCasfim")} />
            </div>
            <div className="acciones operacion-ancho">
              <BotonEnviar>{entidad ? "Registrar claves nuevas" : "Registrar claves"}</BotonEnviar>
              <p>La clave de acceso al SITI es personal del Oficial de Cumplimiento: Lever no la pide ni la guarda.</p>
            </div>
          </form>
        ) : null}
      </Hoja>

      <Hoja id="relevantes-titulo" titulo="Relevantes · trimestral">
        <p className="pista">Operaciones en efectivo de cierto monto. Se presenta en los primeros 10 días hábiles de enero, abril, julio y octubre.</p>
        <ul className="operacion-lista">{periodicos.filter((p) => p.reporte === "36").map(tarjeta)}</ul>
      </Hoja>

      <Hoja id="efectivo-titulo" titulo="Efectivo en dólares">
        <Vacio titulo="Sin formato oficial para SOFIPO">
          El reporte de operaciones en efectivo con dólares no tiene formato oficial para sociedades financieras populares (transitoria Séptima). No genera un
          reporte que presentar.
        </Vacio>
      </Hoja>

      <Hoja id="internacionales-titulo" titulo="Transferencias internacionales · mensual">
        <p className="pista">Plazo: 15 días hábiles desde el último día hábil del mes. Hoy Lever no hace transferencias internacionales.</p>
        <ul className="operacion-lista">{periodicos.filter((p) => p.reporte === "38").map(tarjeta)}</ul>
      </Hoja>

      <NotaRegla>El contenido sale de los datos: hoy no hay canal de efectivo ni de transferencias internacionales. Lever no transmite reportes a la UIF ni a la CNBV.</NotaRegla>
    </PaginaOperacion>
  );
}
