import Link from "next/link";
import type { ReactNode } from "react";

import "@/estilo/aprobaciones.css";

import { IconoPersonas, IconoPresupuestos, IconoProveedores } from "@/components/cromo/iconos";
import { AlertaFaltante } from "@/components/flujo/alerta-faltante";
import { BotonPrepararNomina } from "@/components/personas/boton-preparar";
import { Aviso, Bandeja, Vacio, type Decision } from "@/components/sistema";
import { formatoPesos } from "@/dominio/centavos";
import { clabeVisible } from "@/dominio/clabe";
import type { PendienteInicio } from "@/dominio/inicio";
import { fechaLegible } from "@/dominio/pagos-proveedores";
import type { PagoVista } from "@/dominio/pagos-vistas";
import { fechaLarga } from "@/dominio/personas";
import { horaEnMexico } from "@/dominio/reloj";
import { enEmpresa } from "@/nucleo/rutas";
import type { FaltanteDePendientes } from "@/server/flujo/servicio";
import type { ActividadVista } from "@/server/pagos-proveedores/tipos";
import type { LoteResumen } from "@/server/nomina/tipos";

import type { Aprobaciones } from "./armar";
import { ConAvisoDeDecision, DecisionPagoEnBandeja } from "./decision-pago";

export type VistaAprobaciones = "pendientes" | "historial";

export type HistorialAprobaciones = {
  /** Últimas decisiones sobre pagos a proveedores; `null` si el rol no ve Proveedores. */
  pagos: ActividadVista[] | null;
  /** Lotes de nómina ya preparados; `null` si el rol no ve la nómina. */
  lotes: LoteResumen[] | null;
};

export type CargaAprobaciones =
  | { tipo: "error" }
  | { tipo: "sin_empresa" }
  | {
      tipo: "lista";
      aprobaciones: Aprobaciones;
      atajos: PendienteInicio[];
      faltante: FaltanteDePendientes;
      destinoFaltante: { href: string; texto: string };
      historial: HistorialAprobaciones | null;
    };

const DECISIONES_DE_PAGO: Record<string, string> = {
  autorizar_pago_proveedor: "Autorizado para pagar",
  rechazar_pago_proveedor: "Rechazado",
  cancelar_pago_proveedor: "Cancelado",
  regresar_pago_proveedor: "De vuelta en revisión",
};

/**
 * plat-02: una sola bandeja con lo que espera la decisión de quien entra.
 * Reparte los mismos pendientes de siempre (los que cuenta el lateral):
 * pagos por autorizar y nómina por preparar se deciden aquí; presupuestos y
 * faltante son avisos; el resto lleva a su módulo.
 */
export function VistaDeAprobaciones({
  carga,
  vista,
  empresaId,
}: {
  carga: CargaAprobaciones;
  vista: VistaAprobaciones;
  empresaId: string | null;
}) {
  if (carga.tipo === "sin_empresa") {
    return (
      <Vacio titulo="Todavía no hay una empresa activa.">Pide una invitación a quien administra la empresa.</Vacio>
    );
  }
  if (carga.tipo === "error") {
    return (
      <div className="aprobaciones-estado">
        <Aviso titulo="No se pudieron consultar tus aprobaciones">
          <p>Vuelve a intentarlo en un momento.</p>
        </Aviso>
        <Link className="boton" href={enEmpresa(empresaId, "/consola/aprobaciones")}>
          Reintentar
        </Link>
      </div>
    );
  }
  const { aprobaciones } = carga;
  return (
    <>
      <nav className="segmentado aprobaciones-vistas" aria-label="Vista de aprobaciones">
        <Link href={enEmpresa(empresaId, "/consola/aprobaciones")} aria-current={vista === "pendientes" ? "page" : undefined}>
          Pendientes · {aprobaciones.total}
          <span className="solo-lector">{aprobaciones.total === 1 ? " pendiente" : " pendientes"}</span>
        </Link>
        <Link href={`${enEmpresa(empresaId, "/consola/aprobaciones")}?vista=historial`} aria-current={vista === "historial" ? "page" : undefined}>
          Historial
        </Link>
      </nav>
      {vista === "historial" ? (
        <Historial historial={carga.historial} empresaId={empresaId} />
      ) : (
        <ConAvisoDeDecision>
          <Pendientes carga={carga} empresaId={empresaId} />
        </ConAvisoDeDecision>
      )}
      <p className="aprobaciones-nota">
        Cada pago a proveedor lo solicita una persona y lo autoriza otra con permiso para liberar; autorizar pide tu segundo
        factor de los últimos 30 minutos. El lote de nómina se prepara en la fecha vencida más antigua que todavía no tiene lote.
      </p>
    </>
  );
}

function Pendientes({ carga, empresaId }: { carga: Extract<CargaAprobaciones, { tipo: "lista" }>; empresaId: string | null }) {
  const { aprobaciones, faltante } = carga;
  const decisiones: Decision[] = [
    ...(aprobaciones.pagos?.pagos.map((pago) => decisionDePago(pago, empresaId)) ?? []),
    ...(aprobaciones.nomina && empresaId ? [decisionDeNomina(aprobaciones.nomina, empresaId)] : []),
  ];
  const hayDecisiones = aprobaciones.pagos !== null || aprobaciones.nomina !== null;
  const hayAvisos = aprobaciones.avisos.length > 0 || faltante !== null;
  if (!hayDecisiones && !hayAvisos && aprobaciones.otros.length === 0) {
    return <AlCorriente atajos={carga.atajos} empresaId={empresaId} />;
  }
  return (
    <>
      {hayDecisiones ? (
        <>
          <Bandeja
            decisiones={decisiones}
            vacio={<Vacio titulo="Nada por decidir">Los pagos que pida otra persona y la nómina vencida aparecen aquí.</Vacio>}
          />
          {aprobaciones.pagos?.hayMas ? (
            <p className="aprobaciones-mas">
              Hay más pagos por autorizar.{" "}
              <Link href={`${enEmpresa(empresaId, "/consola/proveedores")}?estado=por_autorizar`}>Verlos todos en Proveedores</Link>
            </p>
          ) : null}
        </>
      ) : null}
      {hayAvisos ? (
        <section className="hoja aprobaciones-tarjeta" aria-labelledby="aprobaciones-avisos">
          <header className="aprobaciones-cabeza">
            <h2 id="aprobaciones-avisos">Avisos de tu equipo</h2>
            <small>No requieren aprobación</small>
          </header>
          {faltante === "no_disponible" ? (
            <div data-alerta="faltante-no-disponible">
              <Aviso titulo="No se pudo calcular si te alcanza el dinero">
                <p>
                  Revisa <Link href={enEmpresa(empresaId, "/consola/flujo")}>Saldo y alertas</Link>.
                </p>
              </Aviso>
            </div>
          ) : faltante ? (
            <AlertaFaltante faltante={faltante.faltante} colchonCentavos={faltante.colchonCentavos} enlace={carga.destinoFaltante} />
          ) : null}
          {aprobaciones.avisos.length > 0 ? (
            <Renglones pendientes={aprobaciones.avisos} empresaId={empresaId} icono={<IconoPresupuestos />} />
          ) : null}
        </section>
      ) : null}
      {aprobaciones.otros.length > 0 ? (
        <section className="hoja aprobaciones-tarjeta" aria-labelledby="aprobaciones-otros">
          <header className="aprobaciones-cabeza">
            <h2 id="aprobaciones-otros">Otros pendientes</h2>
            <small>Se atienden en su módulo</small>
          </header>
          <Renglones pendientes={aprobaciones.otros} empresaId={empresaId} />
        </section>
      ) : null}
    </>
  );
}

function decisionDePago(pago: PagoVista, empresaId: string | null): Decision {
  return {
    id: pago.id,
    titulo: `Pago a proveedor · ${pago.proveedor}`,
    icono: <IconoProveedores />,
    detalle: (
      <>
        {formatoPesos(pago.totalCentavos)} · {pago.referencia}
        <br />
        Vence el {fechaLegible(pago.venceEl)} · fecha prevista {fechaLegible(pago.programadaEl)}
      </>
    ),
    contexto: [
      `Lo solicitó ${pago.solicitante}`,
      pago.clabe ? `CLABE ${clabeVisible(pago.clabe)}` : `CLABE terminación ${pago.clabeFinal}`,
      pago.origen === "cfdi" ? "Con factura CFDI" : "Excepción sin CFDI",
      ...(pago.bloqueo === "clabe_cambiada"
        ? [<strong key="bloqueo">La CLABE cambió después de la solicitud: solo se puede rechazar</strong>]
        : pago.bloqueo === "proveedor_bloqueado"
          ? [<strong key="bloqueo">Proveedor bloqueado (69-B o inactivo): solo se puede rechazar</strong>]
          : []),
    ],
    acciones: (
      <>
        <Link className="boton-texto" href={`${enEmpresa(empresaId, "/consola/proveedores")}?pago=${pago.id}`}>
          Ver detalle
        </Link>
        <DecisionPagoEnBandeja
          requestId={pago.id}
          version={pago.version}
          totalCentavos={pago.totalCentavos}
          proveedor={pago.proveedor}
          soloRechazo={pago.bloqueo !== null}
        />
      </>
    ),
  };
}

function decisionDeNomina(nomina: NonNullable<Aprobaciones["nomina"]>, empresaId: string): Decision {
  return {
    id: nomina.pendiente.id,
    titulo: `Lote de nómina · ${fechaLarga(nomina.fecha)}`,
    icono: <IconoPersonas />,
    detalle: nomina.pendiente.detalle,
    contexto: ["La fecha la calcula el servidor: la más antigua vencida y sin lote"],
    acciones: <BotonPrepararNomina empresaId={empresaId} fechaPago={nomina.fecha} />,
  };
}

function Renglones({
  pendientes,
  empresaId,
  icono = null,
}: {
  pendientes: PendienteInicio[];
  empresaId: string | null;
  icono?: ReactNode;
}) {
  return (
    <ul className="aprobaciones-renglones">
      {pendientes.map((pendiente) => (
        <li key={pendiente.id}>
          {icono ? (
            <span className="decision-icono" aria-hidden="true">
              {icono}
            </span>
          ) : (
            <span className={`pendiente-senal pendiente-senal-${pendiente.area}`} aria-hidden="true" />
          )}
          <div>
            <h3>{pendiente.titulo}</h3>
            <p>{pendiente.detalle}</p>
          </div>
          <Link className="boton-texto boton-chico" href={enEmpresa(empresaId, pendiente.ruta)}>
            {pendiente.accion}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function AlCorriente({ atajos, empresaId }: { atajos: PendienteInicio[]; empresaId: string | null }) {
  return (
    <section className="hoja aprobaciones-tarjeta" aria-labelledby="aprobaciones-vacio">
      <header className="aprobaciones-cabeza">
        <h2 id="aprobaciones-vacio">Estás al corriente</h2>
        <small>Nada espera tu decisión</small>
      </header>
      <p className="aprobaciones-tenue">
        Cuando alguien de tu equipo pida un pago o venza una nómina que tu rol pueda atender, aparecerá aquí.
      </p>
      {atajos.length > 0 ? <Renglones pendientes={atajos} empresaId={empresaId} /> : null}
    </section>
  );
}

function Historial({ historial, empresaId }: { historial: HistorialAprobaciones | null; empresaId: string | null }) {
  if (!historial) {
    return (
      <div className="aprobaciones-estado">
        <Aviso titulo="No se pudo consultar el historial">
          <p>Vuelve a intentarlo en un momento.</p>
        </Aviso>
      </div>
    );
  }
  const pagos = (historial.pagos ?? []).filter((evento) => evento.accion in DECISIONES_DE_PAGO);
  const lotes = historial.lotes ?? [];
  if (pagos.length === 0 && lotes.length === 0) {
    return (
      <section className="hoja aprobaciones-tarjeta" aria-labelledby="aprobaciones-historial-vacio">
        <header className="aprobaciones-cabeza">
          <h2 id="aprobaciones-historial-vacio">Sin decisiones todavía</h2>
        </header>
        <p className="aprobaciones-tenue">Aquí quedan las decisiones de pagos y los lotes de nómina que tu rol puede ver.</p>
      </section>
    );
  }
  return (
    <>
      {pagos.length > 0 ? (
        <section className="hoja aprobaciones-tarjeta" aria-labelledby="aprobaciones-historial-pagos">
          <header className="aprobaciones-cabeza">
            <h2 id="aprobaciones-historial-pagos">Decisiones de pagos a proveedores</h2>
            <small>Las más recientes · el historial completo vive en cada pago</small>
          </header>
          <div className="tabla-contenedor">
            <table className="tabla">
              <thead>
                <tr>
                  <th scope="col">Decisión</th>
                  <th scope="col">Quién</th>
                  <th scope="col">Cuándo</th>
                  <th scope="col">
                    <span className="solo-lector">Pago</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pagos.map((evento) => (
                  <tr key={evento.id}>
                    <td>{DECISIONES_DE_PAGO[evento.accion]}</td>
                    <td>{evento.actor}</td>
                    <td>{horaEnMexico(new Date(evento.ocurridoEn))}</td>
                    <td className="derecha">
                      {evento.identificador ? (
                        <Link href={`${enEmpresa(empresaId, "/consola/proveedores")}?pago=${evento.identificador}`}>Ver el pago</Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {lotes.length > 0 ? (
        <section className="hoja aprobaciones-tarjeta" aria-labelledby="aprobaciones-historial-lotes">
          <header className="aprobaciones-cabeza">
            <h2 id="aprobaciones-historial-lotes">Lotes de nómina preparados</h2>
            <small>Importes y destinos congelados al preparar</small>
          </header>
          <div className="tabla-contenedor">
            <table className="tabla">
              <thead>
                <tr>
                  <th scope="col">Fecha de pago</th>
                  <th scope="col">Personas</th>
                  <th scope="col">Preparado</th>
                  <th scope="col">
                    <span className="solo-lector">Lote</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lotes.map((lote) => (
                  <tr key={lote.id}>
                    <td>{fechaLarga(lote.fechaPago)}</td>
                    <td>{lote.personas}</td>
                    <td>{horaEnMexico(new Date(lote.preparadaEn))}</td>
                    <td className="derecha">
                      <Link href={enEmpresa(empresaId, `/consola/personas/nomina/${lote.id}`)}>Abrir el lote</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
