import type { Metadata } from "next";
import Link from "next/link";

import { soloTexto, type Parametros } from "@/nucleo/direccion";
import { asignarAlertaAccion } from "@/app/operacion/acciones";
import { guardarAjusteDeAlertaAccion } from "@/app/operacion/acciones-alertas";
import { etiquetaCategoria, etiquetaEstado, fechaHora } from "@/components/operacion/formato";
import { FormularioAlerta, FormularioCierre } from "@/components/operacion/formularios-alerta";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { BotonEnviar, Hoja, Insignia, NotaRegla, Rejilla, Vacio } from "@/components/sistema";
import {
  exigirContextoOperacion,
  listarAjustesDeAlertas,
  listarAlertas,
  listarClientes,
  listarPersonal,
} from "@/server/operacion";
import type { AjusteDeAlerta, CategoriaAutomatica } from "@/server/operacion/tipos";
import { puedeEnOperacion } from "@/server/operacion/permisos";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Alertas · Operación" };

export default async function AlertasOperacion({ searchParams }: { searchParams: Parametros<"aviso"> }) {
  const ctx = await exigirContextoOperacion();
  const [alertas, clientes, personal, ajustes, params] = await Promise.all([
    listarAlertas(ctx),
    listarClientes(ctx),
    listarPersonal(ctx),
    listarAjustesDeAlertas(ctx),
    soloTexto(searchParams),
  ]);
  const gestiona = puedeEnOperacion(ctx, "plataforma.empresa.alta");
  const abiertas = alertas.filter((alerta) => alerta.estado === "abierta").length;
  const seguimiento = alertas.length === 0 ? "Seguimiento" : `Seguimiento · ${abiertas} ${abiertas === 1 ? "abierta" : "abiertas"} de ${alertas.length}`;
  return (
    <PaginaOperacion titulo="Alertas" aviso={params.aviso}>
      <Rejilla
        principal={
          <Hoja id="seguimiento-titulo" titulo={seguimiento}>
            {alertas.length === 0 ? (
              <Vacio titulo="Sin alertas">Las alertas que crees aparecen aquí con su responsable.</Vacio>
            ) : (
              <ul className="operacion-lista">
                {alertas.map((alerta) => (
                  <li key={alerta.id}>
                    <div className="operacion-fila">
                      <div className="operacion-fila-cuerpo">
                        <h3>
                          <Link href={`/operacion/clientes/${alerta.companyId}`}>{alerta.titulo}</Link>
                        </h3>
                        <p className="operacion-meta">
                          <span>{alerta.razonSocial}</span>
                          <span>{etiquetaCategoria(alerta.categoria)}</span>
                          <span>Responsable: {alerta.responsable}</span>
                        </p>
                        <p className="operacion-detalle">{alerta.detalle}</p>
                      </div>
                      <Insignia tono={alerta.estado === "abierta" ? "aviso" : "neutro"}>{etiquetaEstado(alerta.estado)}</Insignia>
                    </div>
                    {alerta.estado === "abierta" ? (
                      gestiona ? (
                        <div className="operacion-acciones">
                          <form action={asignarAlertaAccion}>
                            <input type="hidden" name="id" value={alerta.id} />
                            <div className="campo">
                              <label htmlFor={`responsable-${alerta.id}`}>Reasignar</label>
                              <select id={`responsable-${alerta.id}`} name="responsableId" defaultValue={alerta.responsableId}>
                                {personal.map((persona) => (
                                  <option key={persona.id} value={persona.id}>{persona.nombre}</option>
                                ))}
                              </select>
                            </div>
                            <BotonEnviar className="boton-texto">Guardar responsable</BotonEnviar>
                          </form>
                          <FormularioCierre key={alerta.id} id={alerta.id} />
                        </div>
                      ) : null
                    ) : (
                      <p className="operacion-meta">
                        <span>Cerró {alerta.cerradaPor}{alerta.cerradaEn ? ` · ${fechaHora(alerta.cerradaEn)}` : ""}</span>
                        <span>Motivo: {alerta.motivoCierre}</span>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Hoja>
        }
        lateral={
          gestiona ? (
            <Hoja id="nueva-alerta-titulo" titulo="Nueva alerta">
              {clientes.length === 0 ? (
                <Vacio titulo="Sin clientes">Registra un cliente antes de crear una alerta.</Vacio>
              ) : (
                <FormularioAlerta
                  empresas={clientes.map((cliente) => ({ id: cliente.id, nombre: cliente.razonSocial }))}
                  personal={personal.map((persona) => ({ id: persona.id, nombre: persona.nombre }))}
                  responsable={ctx.persona.id}
                />
              )}
            </Hoja>
          ) : undefined
        }
      />
      <ConfigurarAlertas ajustes={ajustes} personal={personal} gestiona={gestiona} />
      <NotaRegla>Una alerta se cierra con un motivo, que no se puede reescribir.</NotaRegla>
    </PaginaOperacion>
  );
}

/** Qué hace cada alerta automática, en palabras: cuándo se abre y cuándo se cierra sola. */
const DESCRIPCION_AUTOMATICA: Record<CategoriaAutomatica, { titulo: string; cuando: string }> = {
  activacion: {
    titulo: "Prospecto nuevo por activar",
    cuando: "Se abre al registrar un prospecto y se cierra sola cuando se aprueba o rechaza su activación.",
  },
  comision: {
    titulo: "Comisión por autorizar",
    cuando: "Se abre al proponer una comisión y se cierra sola cuando otra persona la autoriza o la rechaza.",
  },
};

function ConfigurarAlertas({
  ajustes,
  personal,
  gestiona,
}: {
  ajustes: AjusteDeAlerta[];
  personal: Array<{ id: string; nombre: string }>;
  gestiona: boolean;
}) {
  return (
    <Hoja id="configurar-alertas-titulo" titulo="Configurar alertas automáticas">
      <p className="operacion-detalle">
        Elige qué alertas abre el sistema solo y a quién se le asignan. Los cambios aplican desde el próximo trámite; las
        alertas que ya existen no cambian. Las alertas se ven en esta pantalla: por ahora no se mandan por correo.
      </p>
      <ul className="operacion-lista">
        {ajustes.map((ajuste) => {
          const texto = DESCRIPCION_AUTOMATICA[ajuste.categoria];
          const responsableVigente = ajuste.responsableId !== null && personal.some((persona) => persona.id === ajuste.responsableId);
          const asignada = ajuste.responsableId === null
            ? "Quien hizo el trámite"
            : responsableVigente
              ? (ajuste.responsable ?? "Persona del personal")
              : "Quien hizo el trámite (la persona elegida ya no está activa)";
          return (
            <li key={ajuste.categoria}>
              <div className="operacion-fila">
                <div className="operacion-fila-cuerpo">
                  <h3>{texto.titulo}</h3>
                  <p className="operacion-detalle">{texto.cuando}</p>
                  <p className="operacion-meta">
                    <span>Responsable: {asignada}</span>
                    {ajuste.actualizadoPor && ajuste.actualizadoEn ? (
                      <span>Último cambio: {ajuste.actualizadoPor} · {fechaHora(ajuste.actualizadoEn)}</span>
                    ) : null}
                  </p>
                </div>
                <Insignia tono={ajuste.activa ? "sello" : "neutro"}>{ajuste.activa ? "Prendida" : "Apagada"}</Insignia>
              </div>
              {gestiona ? (
                <div className="operacion-acciones">
                  <form action={guardarAjusteDeAlertaAccion}>
                    <input type="hidden" name="categoria" value={ajuste.categoria} />
                    <div className="campo">
                      <label htmlFor={`activa-${ajuste.categoria}`}>Estado</label>
                      <select id={`activa-${ajuste.categoria}`} name="activa" defaultValue={ajuste.activa ? "si" : "no"}>
                        <option value="si">Prendida</option>
                        <option value="no">Apagada</option>
                      </select>
                    </div>
                    <div className="campo">
                      <label htmlFor={`responsable-ajuste-${ajuste.categoria}`}>Asignar a</label>
                      <select
                        id={`responsable-ajuste-${ajuste.categoria}`}
                        name="responsableId"
                        defaultValue={responsableVigente ? (ajuste.responsableId ?? "") : ""}
                      >
                        <option value="">Quien hizo el trámite</option>
                        {personal.map((persona) => (
                          <option key={persona.id} value={persona.id}>{persona.nombre}</option>
                        ))}
                      </select>
                    </div>
                    <BotonEnviar className="boton-texto">Guardar configuración</BotonEnviar>
                  </form>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Hoja>
  );
}
