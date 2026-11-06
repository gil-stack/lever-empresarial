import type { Metadata } from "next";
import Link from "next/link";

import { asignarAlertaAccion, cerrarAlertaAccion, crearAlertaAccion } from "@/app/operacion/acciones";
import { etiquetaCategoria, etiquetaEstado, fechaHora } from "@/components/operacion/formato";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { Hoja, Insignia, NotaRegla, Rejilla, Vacio } from "@/components/sistema";
import { exigirContextoOperacion, listarAlertas, listarClientes, listarPersonal } from "@/server/operacion";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Alertas · Operación" };

export default async function AlertasOperacion({ searchParams }: { searchParams: Promise<{ aviso?: string }> }) {
  const ctx = await exigirContextoOperacion();
  const [alertas, clientes, personal, params] = await Promise.all([listarAlertas(ctx), listarClientes(ctx), listarPersonal(ctx), searchParams]);
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
                          <button className="boton-texto" type="submit">Guardar responsable</button>
                        </form>
                        <form action={cerrarAlertaAccion}>
                          <input type="hidden" name="id" value={alerta.id} />
                          <div className="campo">
                            <label htmlFor={`motivo-${alerta.id}`}>Motivo de cierre</label>
                            <input id={`motivo-${alerta.id}`} name="motivo" maxLength={500} required />
                          </div>
                          <button className="boton-texto" type="submit">Cerrar alerta</button>
                        </form>
                      </div>
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
          <Hoja id="nueva-alerta-titulo" titulo="Nueva alerta">
            {clientes.length === 0 ? (
              <Vacio titulo="Sin clientes">Registra un cliente antes de crear una alerta.</Vacio>
            ) : (
              <form action={crearAlertaAccion}>
                <div className="campo">
                  <label htmlFor="companyId">Empresa</label>
                  <select id="companyId" name="companyId" required>
                    {clientes.map((cliente) => (
                      <option key={cliente.id} value={cliente.id}>{cliente.razonSocial}</option>
                    ))}
                  </select>
                </div>
                <div className="campo">
                  <label htmlFor="responsableId">Responsable</label>
                  <select id="responsableId" name="responsableId" defaultValue={ctx.persona.id} required>
                    {personal.map((persona) => (
                      <option key={persona.id} value={persona.id}>{persona.nombre}</option>
                    ))}
                  </select>
                </div>
                <div className="campo">
                  <label htmlFor="titulo">Título</label>
                  <input id="titulo" name="titulo" maxLength={160} required />
                </div>
                <div className="campo">
                  <label htmlFor="detalle">Detalle</label>
                  <textarea id="detalle" name="detalle" maxLength={500} required />
                </div>
                <div className="acciones">
                  <button className="boton" type="submit">Crear alerta</button>
                </div>
              </form>
            )}
          </Hoja>
        }
      />
      <NotaRegla>Una alerta se cierra con un motivo, que no se puede reescribir.</NotaRegla>
    </PaginaOperacion>
  );
}
