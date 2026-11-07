import Link from "next/link";

import { InicioFlujo } from "@/components/flujo/inicio-flujo";
import { Origen } from "@/components/flujo/origen";
import { CifraGrande } from "@/components/sistema";
import { formatoPesos } from "@/dominio/centavos";
import type { PendienteInicio } from "@/dominio/inicio";
import { fechaMovimiento, type PeriodoResumen, type ResumenInicio } from "@/dominio/resumen";
import { enEmpresa } from "@/nucleo/rutas";
import type { FlujoInicio } from "@/server/flujo/servicio";

import { GraficaCategorias, GraficaMensual } from "./graficas";

export type CargaResumen =
  | { tipo: "lista"; flujo: FlujoInicio; libro: ResumenInicio | null }
  | { tipo: "error" }
  | { tipo: "sin_empresa" };

/**
 * Inicio: el flujo de caja primero (saldo declarado, lo comprometido y la
 * proyección). El libro de asientos solo aparece en empresas de demostración,
 * marcado como «Confirmado por el banco · demostración»: a un cliente real la
 * plataforma no le pinta un saldo de banco que no tiene.
 */
export function Resumen({ carga, empresaId, atajos }: { carga: CargaResumen; empresaId: string | null; atajos: PendienteInicio[] }) {
  if (carga.tipo !== "lista") {
    const sinEmpresa = carga.tipo === "sin_empresa";
    return (
      <div className="consola">
        <header className="pagina-cabeza">
          <p className="kicker">Inicio</p>
          <h1>{sinEmpresa ? "Todavía no hay una empresa activa." : "No se pudo consultar el resumen."}</h1>
          <p className="lede">{sinEmpresa ? "Pide una invitación a quien administra la empresa." : "No se muestran cifras supuestas. Vuelve a intentar."}</p>
        </header>
        {!sinEmpresa ? <div className="acciones"><Link className="boton" href={enEmpresa(empresaId, "/consola")}>Reintentar</Link></div> : null}
      </div>
    );
  }

  return (
    <div className="consola inicio-financiero">
      {/* El título vive en la barra del Marco; el h1 queda para el lector de pantalla. */}
      <h1 className="solo-lector">Inicio</h1>
      <InicioFlujo flujo={carga.flujo} empresaId={empresaId} />
      {carga.libro ? <LibroDemo resumen={carga.libro} empresaId={empresaId} /> : <SinMovimientos atajos={atajos} empresaId={empresaId} vacio={sinDatos(carga.flujo)} />}
    </div>
  );
}

function sinDatos(flujo: FlujoInicio): boolean {
  return !flujo.proyeccion.saldo && flujo.proyeccion.semanas.every((semana) => semana.movimientos.length === 0);
}

function LibroDemo({ resumen, empresaId }: { resumen: ResumenInicio; empresaId: string | null }) {
  return (
    <section className="flujo-libro-demo" aria-labelledby="libro-titulo" data-libro="demostracion">
      <header className="inicio-cabeza">
        <div>
          <h2 id="libro-titulo">Movimientos del banco <Origen de="banco_demo" /></h2>
          <p className="lede">Esta empresa es de demostración: sus asientos son de ejemplo y nunca se muestran a un cliente real.</p>
        </div>
        <Periodo periodo={resumen.periodo} empresaId={empresaId} />
      </header>

      <section className="inicio-hero" aria-labelledby="saldo-libro">
        <div className="inicio-saldo">
          <p className="rotulo" id="saldo-libro">Saldo confirmado por el banco <Origen de="banco_demo" /></p>
          <CifraGrande centavos={resumen.saldoCentavos} />
          <p>Suma de los asientos de demostración.</p>
        </div>
        <dl className="inicio-metricas">
          <Metrica rotulo="Entradas del mes" centavos={resumen.entradasMesCentavos} tono="ingreso" />
          <Metrica rotulo="Salidas del mes" centavos={resumen.salidasMesCentavos} tono="gasto" />
          <Metrica rotulo="Neto del mes" centavos={resumen.netoMesCentavos} tono="resultado" />
        </dl>
      </section>

      {resumen.tieneMovimientos ? (
        <>
          <div className="inicio-analisis">
            <section className="hoja inicio-grafica-principal" aria-labelledby="flujo-titulo">
              <header className="inicio-seccion-cabeza">
                <div><h2 id="flujo-titulo">Entradas y salidas</h2><p>Comparativa mensual de los asientos del libro.</p></div>
                <Leyenda />
              </header>
              <GraficaMensual meses={resumen.meses} />
            </section>
            <section className="hoja inicio-categorias" aria-labelledby="categorias-titulo">
              <header className="inicio-seccion-cabeza"><div><h2 id="categorias-titulo">Salidas por categoría</h2><p>Distribución del mes actual, por cajón.</p></div></header>
              <GraficaCategorias categorias={resumen.categorias} />
            </section>
          </div>
          <section className="hoja inicio-recientes" aria-labelledby="recientes-titulo">
            <header className="inicio-seccion-cabeza"><div><h2 id="recientes-titulo">Movimientos recientes</h2><p>Los últimos asientos registrados en la empresa.</p></div></header>
            <ul>
              {resumen.recientes.map((movimiento) => (
                <li key={movimiento.id}>
                  <span className={`movimiento-senal ${movimiento.centavos >= 0 ? "movimiento-ingreso" : "movimiento-gasto"}`} aria-hidden="true" />
                  <div><h3>{movimiento.motivo}</h3><p>{movimiento.categoria} · {fechaMovimiento(movimiento.ocurridoEn)}</p></div>
                  <strong className={movimiento.centavos >= 0 ? "cifra-ingreso" : "cifra-gasto"}>{movimiento.centavos > 0 ? "+" : ""}{formatoPesos(movimiento.centavos)}</strong>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
      <p className="inicio-fuente">Cifras de demostración calculadas con el signo de los asientos: entradas y salidas, no ingresos ni gastos fiscales.</p>
    </section>
  );
}

function Metrica({ rotulo, centavos, tono }: { rotulo: string; centavos: number; tono: "ingreso" | "gasto" | "resultado" }) {
  return <div><dt>{rotulo}</dt><dd className={`metrica-${tono}`}>{formatoPesos(centavos)}</dd></div>;
}

function Periodo({ periodo, empresaId }: { periodo: PeriodoResumen; empresaId: string | null }) {
  return (
    <nav className="periodo-resumen" aria-label="Periodo de las gráficas">
      {[6, 12].map((meses) => (
        <Link key={meses} href={enEmpresa(empresaId, `/consola?periodo=${meses}`)} aria-current={periodo === meses ? "page" : undefined}>{meses} meses</Link>
      ))}
    </nav>
  );
}

function Leyenda() {
  return <div className="grafica-leyenda" aria-label="Leyenda"><span><i className="leyenda-ingreso" />Entradas</span><span><i className="leyenda-gasto" />Salidas</span></div>;
}

function SinMovimientos({ atajos, empresaId, vacio }: { atajos: PendienteInicio[]; empresaId: string | null; vacio: boolean }) {
  if (!vacio || atajos.length === 0) return null;
  return (
    <section className="inicio-sin-movimientos" aria-labelledby="sin-movimientos-titulo">
      <div className="inicio-sin-movimientos-mensaje">
        <span aria-hidden="true">↗</span>
        <div><h2 id="sin-movimientos-titulo">Empieza por lo que ya sabes.</h2><p>Declara el saldo de tus cuentas y registra nómina, proveedores, cobros y obligaciones: la proyección se arma sola con eso.</p></div>
      </div>
      {atajos.length > 0 ? (
        <div className="atajos-inicio-rejilla">
          {atajos.slice(0, 3).map((atajo) => (
            <Link className="atajo-inicio" key={atajo.id} href={enEmpresa(empresaId, atajo.ruta)}>
              <div><h3>{atajo.titulo}</h3><p>{atajo.detalle}</p></div>
              <span className="atajo-inicio-accion">{atajo.accion}<span aria-hidden="true"> →</span></span>
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}
