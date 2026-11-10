import type { Metadata } from "next";
import Link from "next/link";

import { soloTexto, type Parametros } from "@/nucleo/direccion";
import { asignarAlertaAccion } from "@/app/operacion/acciones";
import { etiquetaCategoria, etiquetaEstado, fechaHora } from "@/components/operacion/formato";
import { FormularioAlerta, FormularioCierre } from "@/components/operacion/formularios-alerta";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { BotonEnviar, Hoja, Insignia, NotaRegla, Rejilla, Vacio } from "@/components/sistema";
import { exigirContextoOperacion, listarAlertas, listarClientes, listarPersonal } from "@/server/operacion";
import { puedeEnOperacion } from "@/server/operacion/permisos";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Alertas · Operación" };

export default async function AlertasOperacion({ searchParams }: { searchParams: Parametros<"aviso"> }) {
  const ctx = await exigirContextoOperacion();
  const [alertas, clientes, personal, params] = await Promise.all([listarAlertas(ctx), listarClientes(ctx), listarPersonal(ctx), soloTexto(searchParams)]);
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
      <NotaRegla>Una alerta se cierra con un motivo, que no se puede reescribir.</NotaRegla>
    </PaginaOperacion>
  );
}
