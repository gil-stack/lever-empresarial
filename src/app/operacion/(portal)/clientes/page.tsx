import type { Metadata } from "next";
import Link from "next/link";

import { soloTexto, type Parametros } from "@/nucleo/direccion";
import { avanceDelAlta, type AvanceAlta } from "@/dominio/operacion";
import { AvanceCorto } from "@/components/operacion/avance-alta";
import { etiquetaEstado } from "@/components/operacion/formato";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { Hoja, Insignia, Metrica, Metricas, Vacio } from "@/components/sistema";
import { altaRapidaDisponible, exigirContextoOperacion, leerHechosDelAlta, listarClientes } from "@/server/operacion";
import { puedeEnOperacion } from "@/server/operacion/permisos";

import "@/estilo/alta-clientes.css";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Clientes · Operación" };

export default async function ClientesOperacion({ searchParams }: { searchParams: Parametros<"aviso"> }) {
  const ctx = await exigirContextoOperacion();
  const [clientes, hechos, params] = await Promise.all([listarClientes(ctx), leerHechosDelAlta(ctx), soloTexto(searchParams)]);
  const registra = puedeEnOperacion(ctx, "plataforma.prospecto.registrar");
  const avances = new Map<string, AvanceAlta>();
  for (const [id, h] of hechos) avances.set(id, avanceDelAlta(h));
  const reales = clientes.filter((cliente) => !cliente.dePrueba);
  const enAlta = reales.filter((cliente) => cliente.estado === "prospecto" || cliente.estado === "en_alta").length;
  const porDecidir = reales.filter((cliente) => cliente.estado === "en_alta").length;
  const activas = reales.filter((cliente) => cliente.estado === "activa").length;
  const atencion = reales.filter((cliente) => avances.get(cliente.id)?.siguiente?.estado === "atencion").length;
  // El alta rápida de prueba: solo Administración de la plataforma y solo con las tarjetas en su ambiente de pruebas.
  const prueba = puedeEnOperacion(ctx, "plataforma.empresa.alta") && altaRapidaDisponible();
  const alta =
    registra || prueba ? (
      <div className="prueba-acciones">
        {prueba ? (
          <Link className="boton-secundario" href="/operacion/clientes/prueba">
            Cliente de prueba
          </Link>
        ) : null}
        {registra ? (
          <Link className="boton" href="/operacion/clientes/nuevo">
            Dar de alta cliente
          </Link>
        ) : null}
      </div>
    ) : undefined;
  return (
    <PaginaOperacion titulo="Clientes" aviso={params.aviso} accion={alta}>
      <Metricas etiqueta="Resumen de la cartera">
        <Metrica rotulo="En alta" nota="Prospectos y empresas por activar">
          <span className="alta-cifra">{enAlta}</span>
        </Metrica>
        <Metrica rotulo="Activación por decidir" nota="Se deciden en Aprobaciones">
          <span className="alta-cifra">{porDecidir}</span>
        </Metrica>
        <Metrica rotulo="Activas">
          <span className="alta-cifra">{activas}</span>
        </Metrica>
        <Metrica rotulo="Requieren atención" nota="Algo que corregir en su alta">
          <span className="alta-cifra">{atencion}</span>
        </Metrica>
      </Metricas>
      <Hoja id="cartera-titulo" titulo={`Cartera · ${clientes.length}`}>
        {clientes.length === 0 ? (
          <Vacio titulo="Todavía no hay clientes">
            {registra ? (
              <>
                Empieza el alta del primero con su RFC. <Link href="/operacion/clientes/nuevo">Dar de alta cliente</Link>
              </>
            ) : (
              "El alta la hacen Administración de la plataforma u Originación."
            )}
          </Vacio>
        ) : (
          <div className="tabla-contenedor" tabIndex={0} role="region" aria-label="Tabla de la cartera de clientes">
            <table className="tabla operacion-tabla">
              <thead>
                <tr>
                  <th scope="col">Empresa</th>
                  <th scope="col">Avance del alta</th>
                  <th scope="col">Administrador</th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                {clientes.map((cliente) => {
                  const avance = avances.get(cliente.id);
                  return (
                    <tr key={cliente.id}>
                      <td>
                        <Link href={`/operacion/clientes/${cliente.id}`}>{cliente.razonSocial}</Link>
                        {cliente.dePrueba ? (
                          <>
                            {" "}
                            <Insignia tono="aviso">Prueba</Insignia>
                          </>
                        ) : null}
                        <small className="operacion-mono">{cliente.rfc}</small>
                      </td>
                      <td data-rotulo="Avance del alta">
                        {cliente.dePrueba ? (
                          <span className="pista">Alta rápida de prueba</span>
                        ) : avance ? (
                          <AvanceCorto avance={avance} />
                        ) : (
                          <span className="pista">Sin datos</span>
                        )}
                      </td>
                      <td data-rotulo="Administrador">{cliente.administrador ?? <span className="pista">Sin administrador</span>}</td>
                      <td data-rotulo="Estado">
                        <Insignia tono={cliente.estado === "activa" ? "sello" : cliente.estado === "suspendida" ? "aviso" : "neutro"}>
                          {etiquetaEstado(cliente.estado)}
                        </Insignia>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Hoja>
    </PaginaOperacion>
  );
}
