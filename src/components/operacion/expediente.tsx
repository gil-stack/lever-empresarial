import { randomUUID } from "node:crypto";

import { enviarVersionAccion, retirarDelBorradorAccion } from "@/app/operacion/acciones-alta";
import { FormularioAccionista } from "@/components/operacion/formulario-accionista";
import { FormularioDatos } from "@/components/operacion/formulario-datos";
import { FormularioDocumento } from "@/components/operacion/formulario-documento";
import { FormularioRepresentante } from "@/components/operacion/formulario-representante";
import { BotonEnviar, Hoja, Insignia, Renglon, Renglones, Vacio } from "@/components/sistema";
import {
  ETIQUETA_CARGO,
  ETIQUETA_DOCUMENTO,
  ETIQUETA_MOTIVO_BENEFICIARIO,
  ETIQUETA_PEP,
  paisesExtranjeros,
  puntosBaseATexto,
} from "@/dominio/operacion";
import type { Accionista, VersionExpediente } from "@/server/operacion";

import { fechaDia, fechaHora } from "./formato";

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

/**
 * El borrador abierto: lo captura Originación y lo envía a Cumplimiento. Cada formulario con algo capturado vuelve
 * con lo escrito, su aviso y el campo marcado si el servidor lo rechaza.
 */
export function FormulariosBorrador({ version, companyId }: { version: VersionExpediente; companyId: string }) {
  const morales = version.accionistas.filter((accionista) => accionista.tipoPersona === "moral");
  // Cada vista nueva del borrador trae un formulario nuevo; tras un rechazo sigue el mismo (no se aplicó).
  const formAccionista = randomUUID();
  const formRepresentante = randomUUID();
  // La clave de cada formulario cambia solo cuando entra uno: tras agregarlo empieza en blanco, y tras un rechazo es el
  // mismo formulario. Sin JavaScript eso importa: React le devuelve el estado de la acción (aviso y lo capturado) solo
  // al formulario con la misma clave; con una clave nueva en cada vista volvía en blanco.
  const claveRepresentante = `${version.id}-${version.representantes.length}`;
  const claveAccionista = `${version.id}-${version.accionistas.length}`;
  const base = (
    <>
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="versionId" value={version.id} />
    </>
  );
  const { volumenMensualCentavos, ...textos } = version.datos;
  const guardados = { ...Object.fromEntries(Object.entries(textos).map(([campo, valor]) => [campo, valor ?? ""])), volumenMensualCentavos: pesos(volumenMensualCentavos) };
  return (
    <>
      <Hoja id="datos-titulo" titulo={`Datos generales · borrador ${version.numero}`}>
        <FormularioDatos companyId={companyId} versionId={version.id} guardados={guardados} />
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
        <FormularioRepresentante key={claveRepresentante} companyId={companyId} versionId={version.id} formId={formRepresentante} />
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
          key={claveAccionista}
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
        <FormularioDocumento
          companyId={companyId}
          versionId={version.id}
          formId={randomUUID()}
          representantes={version.representantes.map((representante) => ({ clave: representante.clave, nombre: representante.nombre }))}
        />
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
