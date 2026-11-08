import { randomUUID } from "node:crypto";

import {
  cargarDocumentoAccion,
  enviarVersionAccion,
  guardarDatosAccion,
  retirarDelBorradorAccion,
} from "@/app/operacion/acciones-alta";
import { ARCHIVO_DEMASIADO_GRANDE } from "@/components/operacion/aviso";
import { CampoArchivo } from "@/components/operacion/campo-archivo";
import { FormularioAccionista } from "@/components/operacion/formulario-accionista";
import { FormularioRepresentante } from "@/components/operacion/formulario-representante";
import { BotonEnviar, Hoja, Insignia, Renglon, Renglones, Vacio } from "@/components/sistema";
import { TOPE_ARCHIVO_TEXTO } from "@/dominio/archivos";
import {
  ETIQUETA_CARGO,
  ETIQUETA_DOCUMENTO,
  ETIQUETA_MOTIVO_BENEFICIARIO,
  ETIQUETA_PEP,
  TIPOS_DOCUMENTO,
  paisesExtranjeros,
  puntosBaseATexto,
} from "@/dominio/operacion";
import type { Accionista, VersionExpediente } from "@/server/operacion";

import { fechaDia, fechaHora } from "./formato";

/** Liga un campo al aviso solo si el error vino de ese formulario. */
export type ErrorDeCampo = (seccion: string, campo: string) => Record<string, unknown>;

function pesos(centavos: number | null): string {
  return centavos === null ? "" : (centavos / 100).toFixed(2);
}

function domicilio(datos: VersionExpediente["datos"]): string {
  const partes = [
    [datos.domicilioCalle, datos.domicilioExterior, datos.domicilioInterior ? `int. ${datos.domicilioInterior}` : null].filter(Boolean).join(" "),
    datos.domicilioColonia,
    datos.domicilioMunicipio,
    datos.domicilioEntidad,
    datos.domicilioCodigoPostal ? `C.P. ${datos.domicilioCodigoPostal}` : null,
    datos.domicilioPais,
  ].filter((parte) => parte && parte.length > 0);
  return partes.length > 0 ? partes.join(", ") : "Sin capturar";
}

/** Los socios en orden de cadena: cada persona moral seguida de quienes la componen. */
/** La persona extranjera sin CURP se lee por su país, su documento y su fecha de nacimiento. */
function identidadExtranjera(accionista: Accionista): string {
  const partes = [accionista.nacionalidad ?? accionista.pais];
  if (accionista.documentoExtranjero) {
    partes.push(`${accionista.tipoPersona === "moral" ? "registro" : "identificación"} ${accionista.documentoExtranjero}`);
  }
  if (accionista.fechaNacimiento) partes.push(`nació el ${fechaDia(accionista.fechaNacimiento)}`);
  return partes.join(" · ");
}

function enCadena(accionistas: readonly Accionista[]): Accionista[] {
  const salida: Accionista[] = [];
  const agregar = (padre: string | null) => {
    for (const accionista of accionistas.filter((a) => a.padreClave === padre)) {
      salida.push(accionista);
      agregar(accionista.clave);
    }
  };
  agregar(null);
  return salida;
}

/** Una versión del expediente tal como quedó: datos, personas, estructura, propietarios reales y documentos. */
export function VistaVersion({ version, companyId }: { version: VersionExpediente; companyId: string }) {
  const accionistas = enCadena(version.accionistas);
  const representantes = new Map(version.representantes.map((r) => [r.clave, r.nombre]));
  return (
    <>
      <Hoja id={`datos-v${version.numero}-titulo`} titulo={`Datos generales · versión ${version.numero}`}>
        <Renglones>
          <Renglon etiqueta="Razón social">{version.datos.razonSocial ?? "Sin capturar"}</Renglon>
          <Renglon etiqueta="RFC">{version.datos.rfc ?? "Sin capturar"}</Renglon>
          <Renglon etiqueta="Giro">{version.datos.giro ?? "Sin capturar"}</Renglon>
          <Renglon etiqueta="Nacionalidad">{version.datos.nacionalidad ?? "Sin capturar"}</Renglon>
          <Renglon etiqueta="Constitución">{version.datos.fechaConstitucion ? fechaDia(version.datos.fechaConstitucion) : "Sin capturar"}</Renglon>
          <Renglon etiqueta="Serie de la e.firma">{version.datos.serieEfirma ?? "Sin capturar"}</Renglon>
          <Renglon etiqueta="Domicilio">{domicilio(version.datos)}</Renglon>
          <Renglon etiqueta="Teléfono y correo">
            {[version.datos.telefono, version.datos.correo].filter(Boolean).join(" · ") || "Sin capturar"}
          </Renglon>
          <Renglon etiqueta="Volumen mensual esperado">
            {version.datos.volumenMensualCentavos === null ? "Sin capturar" : `$${pesos(version.datos.volumenMensualCentavos)}`}
          </Renglon>
        </Renglones>
      </Hoja>
      <Hoja id={`personas-v${version.numero}-titulo`} titulo="Representantes y administración">
        {version.representantes.length === 0 ? (
          <Vacio titulo="Sin representantes" />
        ) : (
          <ul className="operacion-lista">
            {version.representantes.map((representante) => (
              <li key={representante.id}>
                <h3>{representante.nombre}</h3>
                <p className="operacion-meta">
                  <span>{ETIQUETA_CARGO[representante.cargo]}</span>
                  {representante.esAdministrador ? <span>Administra la empresa</span> : null}
                  {representante.rfc ? <span className="operacion-mono">{representante.rfc}</span> : null}
                  {representante.curp ? <span className="operacion-mono">{representante.curp}</span> : null}
                  <span>Persona expuesta políticamente: {ETIQUETA_PEP[representante.pep].toLowerCase()}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </Hoja>
      <Hoja id={`estructura-v${version.numero}-titulo`} titulo="Estructura accionaria">
        {accionistas.length === 0 ? (
          <Vacio titulo="Sin accionistas" />
        ) : (
          <ul className="operacion-lista">
            {accionistas.map((accionista) => (
              <li key={accionista.id} style={{ paddingInlineStart: `${(accionista.capa - 1) * 22}px` }}>
                <div className="operacion-fila">
                  <div className="operacion-fila-cuerpo">
                    <h3>{accionista.nombre}</h3>
                    <p className="operacion-meta">
                      <span>{accionista.tipoPersona === "moral" ? "Persona moral" : "Persona física"}</span>
                      <span>Capital {puntosBaseATexto(accionista.capitalBp)}</span>
                      <span>Votos {puntosBaseATexto(accionista.votosBp)}</span>
                      {accionista.capa > 1 ? <span>Capa {accionista.capa}</span> : null}
                      {accionista.controlOtrosMedios ? <span>Controla por otros medios</span> : null}
                      {accionista.pais ? <span>{identidadExtranjera(accionista)}</span> : null}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="pista">{version.estructuraCompleta ? "Suma 100 % y llega hasta personas físicas." : "Todavía no suma 100 % o falta desglosar una persona moral."}</p>
      </Hoja>
      <Hoja id={`propietarios-v${version.numero}-titulo`} titulo="Propietarios reales">
        {version.beneficiarios.length === 0 ? (
          <Vacio titulo="Sin propietarios reales calculados">Se calculan con la estructura accionaria: 25 % o más, control o, si nadie llega, quien administra.</Vacio>
        ) : (
          <ul className="operacion-lista">
            {version.beneficiarios.map((beneficiario) => (
              <li key={beneficiario.clave}>
                <h3>{beneficiario.nombre}</h3>
                <p className="operacion-meta">
                  <span>{ETIQUETA_MOTIVO_BENEFICIARIO[beneficiario.motivo] ?? beneficiario.motivo}</span>
                  <span>Capital {beneficiario.capitalPct} %</span>
                  <span>Votos {beneficiario.votosPct} %</span>
                  {beneficiario.capas > 1 ? <span>A través de {beneficiario.capas} capas</span> : null}
                  {beneficiario.pep !== "no" ? <span>Persona expuesta políticamente ({ETIQUETA_PEP[beneficiario.pep].toLowerCase()})</span> : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Hoja>
      <Hoja id={`documentos-v${version.numero}-titulo`} titulo="Documentos">
        {version.documentos.length === 0 ? (
          <Vacio titulo="Sin documentos" />
        ) : (
          <ul className="operacion-lista">
            {version.documentos.map((documento) => (
              <li key={documento.id}>
                <div className="operacion-fila">
                  <div className="operacion-fila-cuerpo">
                    <h3>
                      <a href={`/operacion/clientes/${companyId}/expediente/documento/${documento.id}`} download>
                        {ETIQUETA_DOCUMENTO[documento.tipo]}
                      </a>
                    </h3>
                    <p className="operacion-meta">
                      <span>{documento.nombreArchivo}</span>
                      {documento.representanteClave ? <span>{representantes.get(documento.representanteClave)}</span> : null}
                      {documento.emitidoEl ? <span>Emitido el {fechaDia(documento.emitidoEl)}</span> : null}
                      {documento.vigenteHasta ? <span>Vigente hasta el {fechaDia(documento.vigenteHasta)}</span> : null}
                      <span>Cargado {fechaHora(documento.cargadoEn)}</span>
                    </p>
                    <p className="operacion-meta operacion-mono">SHA-256 {documento.sha256}</p>
                  </div>
                  {documento.vencido ? <Insignia tono="aviso">Vencido</Insignia> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="pista">Cada descarga queda en la bitácora con tu nombre y la hora.</p>
      </Hoja>
    </>
  );
}

/** El borrador abierto: lo captura Originación y lo envía a Cumplimiento. */
export function FormulariosBorrador({
  version,
  companyId,
  error,
}: {
  version: VersionExpediente;
  companyId: string;
  error: ErrorDeCampo;
}) {
  const morales = version.accionistas.filter((accionista) => accionista.tipoPersona === "moral");
  // Cada vista nueva del borrador trae un formulario nuevo; tras un rechazo sigue el mismo (no se aplicó).
  const formAccionista = randomUUID();
  const formRepresentante = randomUUID();
  const base = (
    <>
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="versionId" value={version.id} />
    </>
  );
  const datos = version.datos;
  const campo = (nombre: string, etiqueta: string, valor: string | null, extra: Record<string, unknown> = {}) => (
    <div className="campo">
      <label htmlFor={`dato-${nombre}`}>{etiqueta}</label>
      <input id={`dato-${nombre}`} name={nombre} defaultValue={valor ?? ""} {...extra} {...error("datos-titulo", nombre)} />
    </div>
  );
  return (
    <>
      <Hoja id="datos-titulo" titulo={`Datos generales · borrador ${version.numero}`}>
        <form action={guardarDatosAccion} className="formulario-pareja operacion-forma">
          {base}
          {campo("razonSocial", "Razón social", datos.razonSocial, { maxLength: 300 })}
          {campo("rfc", "RFC", datos.rfc, { maxLength: 12, autoCapitalize: "characters", className: "entrada-rfc" })}
          {campo("giro", "Giro o actividad", datos.giro, { maxLength: 200 })}
          {campo("nacionalidad", "Nacionalidad", datos.nacionalidad, { maxLength: 80 })}
          {campo("fechaConstitucion", "Fecha de constitución", datos.fechaConstitucion, { type: "date" })}
          {campo("serieEfirma", "Número de serie de la e.firma", datos.serieEfirma, { inputMode: "numeric", maxLength: 20 })}
          {campo("domicilioCalle", "Calle", datos.domicilioCalle, { maxLength: 200 })}
          {campo("domicilioExterior", "Número exterior", datos.domicilioExterior, { maxLength: 40 })}
          {campo("domicilioInterior", "Número interior", datos.domicilioInterior, { maxLength: 40 })}
          {campo("domicilioColonia", "Colonia", datos.domicilioColonia, { maxLength: 120 })}
          {campo("domicilioMunicipio", "Municipio o alcaldía", datos.domicilioMunicipio, { maxLength: 120 })}
          {campo("domicilioEntidad", "Entidad", datos.domicilioEntidad, { maxLength: 80 })}
          {campo("domicilioCodigoPostal", "Código postal", datos.domicilioCodigoPostal, { inputMode: "numeric", maxLength: 5 })}
          {campo("domicilioPais", "País", datos.domicilioPais, { maxLength: 80 })}
          {campo("telefono", "Teléfono", datos.telefono, { inputMode: "tel", maxLength: 20 })}
          {campo("correo", "Correo", datos.correo, { type: "email", maxLength: 254 })}
          {campo("volumenMensualCentavos", "Volumen mensual esperado (pesos)", pesos(datos.volumenMensualCentavos), { inputMode: "decimal", maxLength: 20 })}
          <div className="acciones operacion-ancho">
            <BotonEnviar>Guardar datos</BotonEnviar>
          </div>
        </form>
      </Hoja>

      <Hoja id="representantes-titulo" titulo="Representantes y administración">
        {version.representantes.length === 0 ? (
          <Vacio titulo="Sin representantes">Agrega a quien administra la empresa y a cada apoderado.</Vacio>
        ) : (
          <ul className="operacion-lista">
            {version.representantes.map((representante) => (
              <li key={representante.id}>
                <div className="operacion-fila">
                  <div className="operacion-fila-cuerpo">
                    <h3>{representante.nombre}</h3>
                    <p className="operacion-meta">
                      <span>{ETIQUETA_CARGO[representante.cargo]}</span>
                      {representante.esAdministrador ? <span>Administra la empresa</span> : null}
                    </p>
                  </div>
                  <form action={retirarDelBorradorAccion}>
                    {base}
                    <input type="hidden" name="tipo" value="representante" />
                    <input type="hidden" name="id" value={representante.id} />
                    <BotonEnviar className="boton-texto">Quitar</BotonEnviar>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
        <FormularioRepresentante key={formRepresentante} companyId={companyId} versionId={version.id} formId={formRepresentante} />
      </Hoja>

      <Hoja id="accionistas-titulo" titulo="Estructura accionaria">
        {version.accionistas.length === 0 ? (
          <Vacio titulo="Sin accionistas">Cada persona moral se desglosa hasta llegar a personas físicas.</Vacio>
        ) : (
          <ul className="operacion-lista">
            {enCadena(version.accionistas).map((accionista) => (
              <li key={accionista.id} style={{ paddingInlineStart: `${(accionista.capa - 1) * 22}px` }}>
                <div className="operacion-fila">
                  <div className="operacion-fila-cuerpo">
                    <h3>{accionista.nombre}</h3>
                    <p className="operacion-meta">
                      <span>{accionista.tipoPersona === "moral" ? "Persona moral" : "Persona física"}</span>
                      <span>Capital {puntosBaseATexto(accionista.capitalBp)}</span>
                      <span>Votos {puntosBaseATexto(accionista.votosBp)}</span>
                      {accionista.pais ? <span>{identidadExtranjera(accionista)}</span> : null}
                    </p>
                  </div>
                  <form action={retirarDelBorradorAccion}>
                    {base}
                    <input type="hidden" name="tipo" value="accionista" />
                    <input type="hidden" name="id" value={accionista.id} />
                    <BotonEnviar className="boton-texto">Quitar</BotonEnviar>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="pista">{version.estructuraCompleta ? "La estructura suma 100 % y llega hasta personas físicas." : "Cada nivel debe sumar 100 % y cada persona moral desglosarse."}</p>
        <FormularioAccionista
          key={formAccionista}
          companyId={companyId}
          versionId={version.id}
          formId={formAccionista}
          morales={morales.map((moral) => ({ clave: moral.clave, nombre: moral.nombre }))}
          paises={paisesExtranjeros()}
        />
      </Hoja>

      <Hoja id="documentos-titulo" titulo="Documentos del borrador">
        {version.documentos.length === 0 ? (
          <Vacio titulo="Sin documentos">Acta, constancia fiscal, e.firma, comprobante de domicilio, declaración de propietarios reales e identificación de cada representante.</Vacio>
        ) : (
          <ul className="operacion-lista">
            {version.documentos.map((documento) => (
              <li key={documento.id}>
                <div className="operacion-fila">
                  <div className="operacion-fila-cuerpo">
                    <h3>
                      <a href={`/operacion/clientes/${companyId}/expediente/documento/${documento.id}`} download>
                        {ETIQUETA_DOCUMENTO[documento.tipo]}
                      </a>
                    </h3>
                    <p className="operacion-meta">
                      <span>{documento.nombreArchivo}</span>
                      {documento.vigenteHasta ? <span>Vigente hasta el {fechaDia(documento.vigenteHasta)}</span> : null}
                    </p>
                  </div>
                  {documento.vencido ? <Insignia tono="aviso">Vencido</Insignia> : <Insignia tono="sello">Guardado</Insignia>}
                </div>
              </li>
            ))}
          </ul>
        )}
        <form action={cargarDocumentoAccion} className="formulario-pareja operacion-forma">
          {base}
          <input type="hidden" name="formId" value={randomUUID()} />
          <div className="campo">
            <label htmlFor="doc-tipo">Documento</label>
            <select id="doc-tipo" name="tipo" defaultValue="acta_constitutiva" {...error("documentos-titulo", "tipo")}>
              {TIPOS_DOCUMENTO.map((tipo) => (
                <option key={tipo} value={tipo}>
                  {ETIQUETA_DOCUMENTO[tipo]}
                </option>
              ))}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="doc-representante">Representante (solo identificación y poder)</label>
            <select id="doc-representante" name="representanteClave" defaultValue="" {...error("documentos-titulo", "representanteClave")}>
              <option value="">No aplica</option>
              {version.representantes.map((representante) => (
                <option key={representante.clave} value={representante.clave}>
                  {representante.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="doc-emitido">Emitido el</label>
            <input id="doc-emitido" name="emitidoEl" type="date" {...error("documentos-titulo", "emitidoEl")} />
          </div>
          <div className="campo">
            <label htmlFor="doc-vigente">Vigente hasta</label>
            <input id="doc-vigente" name="vigenteHasta" type="date" {...error("documentos-titulo", "vigenteHasta")} />
          </div>
          <div className="campo operacion-ancho">
            <label htmlFor="doc-detalle">Detalle (folio mercantil, notaría…)</label>
            <input id="doc-detalle" name="detalle" maxLength={300} {...error("documentos-titulo", "detalle")} />
          </div>
          <div className="campo operacion-ancho">
            <label htmlFor="doc-archivo">Archivo (PDF, PNG o JPG, hasta {TOPE_ARCHIVO_TEXTO})</label>
            <CampoArchivo
              id="doc-archivo"
              name="archivo"
              accept="application/pdf,image/png,image/jpeg"
              mensaje={ARCHIVO_DEMASIADO_GRANDE}
              required
              ligado={error("documentos-titulo", "archivo")}
            />
          </div>
          <div className="acciones operacion-ancho">
            <BotonEnviar>Guardar documento</BotonEnviar>
            <p>Se guarda con su huella SHA-256 y no se borra.</p>
          </div>
        </form>
      </Hoja>

      <Hoja id="enviar-titulo" titulo="Enviar a Cumplimiento">
        <p>
          Al enviar, la versión {version.numero} queda fija: nadie la edita. Cumplimiento la aprueba, la observa con motivo o la
          rechaza, y quien la armó no puede dictaminarla.
        </p>
        <form action={enviarVersionAccion}>
          {base}
          <div className="acciones">
            <BotonEnviar>Enviar versión {version.numero}</BotonEnviar>
          </div>
        </form>
      </Hoja>
    </>
  );
}
