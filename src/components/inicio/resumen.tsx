import Link from "next/link";

import { CifraGrande } from "@/components/sistema";
import { formatoPesos } from "@/dominio/centavos";
import type { PendienteInicio } from "@/dominio/inicio";
import { fechaMovimiento, type PeriodoResumen, type ResumenInicio } from "@/dominio/resumen";
import { saludoEnMexico } from "@/dominio/reloj";
import { enEmpresa } from "@/nucleo/rutas";

import { GraficaCategorias, GraficaMensual } from "./graficas";

export type CargaResumen =
  | { tipo: "lista"; resumen: ResumenInicio }
  | { tipo: "error" }
  | { tipo: "sin_empresa" };

export function Resumen({ carga, empresaId, nombre, atajos }: { carga: CargaResumen; empresaId: string | null; nombre: string; atajos: PendienteInicio[] }) {
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

  const { resumen } = carga;
  return (
    <div className="consola inicio-financiero">
      <header className="inicio-cabeza">
        <div>
          <p className="kicker">Inicio</p>
          <h1>{saludoEnMexico(new Date(), nombre)}</h1>
          <p className="lede">Esta es la lectura global de los números de tu empresa.</p>
        </div>
        <Periodo periodo={resumen.periodo} empresaId={empresaId} />
      </header>

      <section className="inicio-hero" aria-labelledby="saldo-libro">
        <div className="inicio-saldo">
          <p className="rotulo" id="saldo-libro">Saldo en el libro</p>
          <CifraGrande centavos={resumen.saldoCentavos} />
          <p>Suma histórica de los asientos registrados.</p>
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
      ) : (
        <SinMovimientos atajos={atajos} empresaId={empresaId} />
      )}
      <p className="inicio-fuente">Cifras calculadas con el signo de los asientos del libro: entradas y salidas, no ingresos ni gastos fiscales. No representan el saldo del participante de la CLABE ni una conciliación bancaria.</p>
    </div>
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

function SinMovimientos({ atajos, empresaId }: { atajos: PendienteInicio[]; empresaId: string | null }) {
  return (
    <section className="inicio-sin-movimientos" aria-labelledby="sin-movimientos-titulo">
      <div className="inicio-sin-movimientos-mensaje">
        <span aria-hidden="true">↗</span>
        <div><h2 id="sin-movimientos-titulo">Todavía no hay movimientos.</h2><p>Las gráficas aparecerán cuando el primer asiento exista. Mientras tanto, puedes dejar lista la configuración de la empresa.</p></div>
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
