import Link from "next/link";

import { Hoja, Insignia, NotaRegla, Vacio } from "@/components/sistema";
import { formatoPesos } from "@/dominio/centavos";
import type { ClaseTarjeta, InventarioTarjetas, TarjetaDelInventario } from "@/server/efevoo/inventario";

import { fechaHora } from "./formato";

/** Los filtros del tablero: cada cifra lleva a la lista de sus tarjetas. */
export const FILTROS = ["todas", "sin_asignar", "asignada", "activa", "con_saldo", "sin_saldo", "bloqueada", "cancelada"] as const;
export type Filtro = (typeof FILTROS)[number];

export function filtroDe(valor: string | undefined): Filtro {
  return (FILTROS as readonly string[]).includes(valor ?? "") ? (valor as Filtro) : "todas";
}

const DEL_FILTRO: Record<Filtro, (c: ClaseTarjeta) => boolean> = {
  todas: (c) => c !== "cancelada",
  sin_asignar: (c) => c === "sin_asignar",
  asignada: (c) => c === "asignada",
  activa: (c) => c === "activa_con_saldo" || c === "activa_sin_saldo",
  con_saldo: (c) => c === "activa_con_saldo",
  sin_saldo: (c) => c === "activa_sin_saldo",
  bloqueada: (c) => c === "bloqueada",
  cancelada: (c) => c === "cancelada",
};

export function tarjetasDelFiltro(tarjetas: readonly TarjetaDelInventario[], filtro: Filtro) {
  return tarjetas.filter((t) => DEL_FILTRO[filtro](t.clase));
}

const TITULO_LISTA: Record<Filtro, string> = {
  todas: "Todo el stock",
  sin_asignar: "Sin asignar",
  asignada: "Asignadas sin activar",
  activa: "Activas",
  con_saldo: "Activas con saldo",
  sin_saldo: "Activas sin saldo",
  bloqueada: "Bloqueadas",
  cancelada: "Canceladas",
};

const ESTADO: Record<ClaseTarjeta, { texto: string; tono: "neutro" | "sello" | "aviso" }> = {
  sin_asignar: { texto: "Sin asignar", tono: "neutro" },
  asignada: { texto: "Asignada", tono: "neutro" },
  activa_con_saldo: { texto: "Activa", tono: "sello" },
  activa_sin_saldo: { texto: "Activa", tono: "sello" },
  bloqueada: { texto: "Bloqueada", tono: "aviso" },
  cancelada: { texto: "Cancelada", tono: "aviso" },
};

const ERRORES: Record<string, string> = {
  efevoo_incierto: "Efevoo no respondió.",
  efevoo_no_autorizado: "Efevoo rechazó las credenciales.",
  efevoo_rechazo: "Efevoo rechazó la consulta.",
};

function plural(n: number, uno: string, varios: string) {
  return `${n} ${n === 1 ? uno : varios}`;
}

function porcentaje(parte: number, total: number) {
  return total > 0 ? Math.round((parte / total) * 100) : 0;
}

/** Una cifra del tablero: enlace a su lista, marcada cuando es la que se ve. */
function Cifra({
  filtro,
  actual,
  rotulo,
  valor,
  nota,
  tono,
}: {
  filtro: Filtro;
  actual: Filtro;
  rotulo: string;
  valor: string;
  nota: string;
  tono?: Segmento;
}) {
  return (
    <li>
      <Link
        href={filtro === "todas" ? "/operacion/tarjetas" : `/operacion/tarjetas?ver=${filtro}`}
        className={`inventario-cifra${tono ? ` inventario-cifra-${tono}` : ""}`}
        aria-current={filtro === actual ? "true" : undefined}
        scroll={false}
      >
        <span className="rotulo">{rotulo}</span>
        <span className="inventario-valor">{valor}</span>
        <span className="pista">{nota}</span>
      </Link>
    </li>
  );
}

type Segmento = "libre" | "asignada" | "saldo" | "vacia" | "bloqueada";

/** La barra del stock: cuánto está libre, entregado sin activar, activo con y sin saldo, y bloqueado. */
function Reparto({ inventario }: { inventario: InventarioTarjetas }) {
  const c = inventario.conteos;
  const partes: { clave: Segmento; rotulo: string; n: number }[] = [
    { clave: "libre", rotulo: "Sin asignar", n: c.sinAsignar },
    { clave: "asignada", rotulo: "Asignadas sin activar", n: c.asignadas },
    { clave: "saldo", rotulo: inventario.fuente === "efevoo" ? "Activas con saldo" : "Activas", n: c.conSaldo + (inventario.fuente === "efevoo" ? 0 : c.sinSaldo) },
    ...(inventario.fuente === "efevoo" ? [{ clave: "vacia" as const, rotulo: "Activas sin saldo", n: c.sinSaldo }] : []),
    { clave: "bloqueada", rotulo: "Bloqueadas", n: c.bloqueadas },
  ];
  if (c.stock === 0) return null;
  return (
    <figure className="inventario-reparto">
      <div className="inventario-barra" role="img" aria-label={partes.map((p) => `${p.rotulo}: ${p.n}`).join(", ")}>
        {partes.filter((p) => p.n > 0).map((p) => (
          <i key={p.clave} className={`inventario-tramo-${p.clave}`} style={{ flexGrow: p.n }} />
        ))}
      </div>
      <figcaption>
        <ul className="inventario-leyenda">
          {partes.map((p) => (
            <li key={p.clave}>
              <i className={`inventario-tramo-${p.clave}`} aria-hidden="true" />
              {p.rotulo} <strong>{p.n}</strong> <span className="pista">{porcentaje(p.n, c.stock)} %</span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

function Empresa({ t }: { t: TarjetaDelInventario }) {
  if (t.empresa) return <Link href={`/operacion/clientes/${t.empresa.id}`}>{t.empresa.razonSocial}</Link>;
  if (t.idepClienteAjeno !== null) return <span className="pista">Fuera de Lever (cliente {t.idepClienteAjeno} en Efevoo)</span>;
  return <span className="pista">Sin empresa</span>;
}

export function TableroTarjetas({ inventario, filtro }: { inventario: InventarioTarjetas; filtro: Filtro }) {
  const c = inventario.conteos;
  const conEfevoo = inventario.fuente === "efevoo";
  const lista = tarjetasDelFiltro(inventario.tarjetas, filtro);
  const sinDato = "—";
  return (
    <div className="inventario">
      {!conEfevoo ? (
        <NotaRegla>
          {inventario.errorEfevoo
            ? `${ERRORES[inventario.errorEfevoo] ?? "No se pudo leer Efevoo."} Se muestran las tarjetas que Lever ya entregó; el stock libre y los saldos llegan de Efevoo.`
            : "Este entorno todavía no está conectado con Efevoo. Se muestran las tarjetas que Lever ya entregó; el stock libre y los saldos aparecerán al conectar las llaves de Efevoo."}
        </NotaRegla>
      ) : null}

      <section aria-labelledby="inventario-cifras" className="inventario-cabeza">
        <h2 id="inventario-cifras" className="solo-lector">Cifras del inventario</h2>
        <div className="inventario-total">
          <p className="rotulo">Stock total</p>
          <p className="inventario-total-valor">{c.stock}</p>
          <p className="pista">
            {conEfevoo ? "Plásticos en Efevoo, sin contar cancelados" : "Tarjetas entregadas por Lever, sin contar canceladas"}
            {inventario.ambiente === "sandbox" ? " · ambiente de pruebas" : ""}
          </p>
          {conEfevoo && c.saldoTotalCentavos !== null ? (
            <p className="inventario-saldo">
              <span className="rotulo">Saldo en tarjetas</span>
              <span className="monto">{formatoPesos(c.saldoTotalCentavos)}</span>
            </p>
          ) : null}
        </div>
        <Reparto inventario={inventario} />
      </section>

      <nav aria-label="Filtrar tarjetas">
        <ul className="inventario-cifras">
          <Cifra filtro="sin_asignar" actual={filtro} tono="libre" rotulo="Sin asignar" valor={conEfevoo ? String(c.sinAsignar) : sinDato} nota={conEfevoo ? "Listas para entregar" : "Se lee de Efevoo"} />
          <Cifra filtro="activa" actual={filtro} rotulo="Activas" valor={String(c.activas)} nota={`${porcentaje(c.activas, c.stock)} % del stock`} />
          <Cifra filtro="con_saldo" actual={filtro} tono="saldo" rotulo="Con saldo" valor={conEfevoo ? String(c.conSaldo) : sinDato} nota={conEfevoo ? "Activas con dinero" : "Se lee de Efevoo"} />
          <Cifra filtro="sin_saldo" actual={filtro} tono="vacia" rotulo="Sin saldo" valor={conEfevoo ? String(c.sinSaldo) : sinDato} nota={conEfevoo ? "Activas en $0.00" : "Se lee de Efevoo"} />
          <Cifra filtro="asignada" actual={filtro} tono="asignada" rotulo="Por activar" valor={String(c.asignadas)} nota="Asignadas, sin activar" />
          <Cifra filtro="bloqueada" actual={filtro} tono="bloqueada" rotulo="Bloqueadas" valor={String(c.bloqueadas)} nota={plural(c.canceladas, "cancelada aparte", "canceladas aparte")} />
        </ul>
      </nav>

      <Hoja id="inventario-lista" titulo={`${TITULO_LISTA[filtro]} · ${lista.length}`} className="inventario-lista">
        <div className="inventario-pestanas">
          {filtro !== "todas" ? (
            <Link href="/operacion/tarjetas" className="enlace-texto" scroll={false}>Ver todo el stock</Link>
          ) : null}
          {filtro !== "cancelada" && c.canceladas > 0 ? (
            <Link href="/operacion/tarjetas?ver=cancelada" className="enlace-texto" scroll={false}>Ver canceladas ({c.canceladas})</Link>
          ) : null}
        </div>
        {lista.length === 0 ? (
          <Vacio titulo="No hay tarjetas aquí">
            {inventario.tarjetas.length === 0
              ? conEfevoo
                ? "Efevoo no tiene plásticos registrados para esta cuenta."
                : "Lever todavía no ha entregado tarjetas."
              : "Ninguna tarjeta está en este estado."}
          </Vacio>
        ) : (
          <div className="tabla-contenedor" tabIndex={0} role="region" aria-label="Tabla de tarjetas">
            <table className="tabla operacion-tabla">
              <thead>
                <tr>
                  <th scope="col">Tarjeta</th>
                  <th scope="col">Estado</th>
                  <th scope="col" className="inventario-num">Saldo</th>
                  <th scope="col">Empresa</th>
                  <th scope="col">Entregada</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((t) => (
                  <tr key={t.clave}>
                    <td>
                      <span className="operacion-mono">•••• {t.terminacion}</span>
                      {t.nombreTarjeta ? <small>{t.nombreTarjeta}</small> : null}
                    </td>
                    <td data-rotulo="Estado">
                      <Insignia tono={ESTADO[t.clase].tono}>{ESTADO[t.clase].texto}</Insignia>
                    </td>
                    <td data-rotulo="Saldo" className="inventario-num">
                      {t.saldoCentavos === null ? <span className="pista">{conEfevoo ? "Sin dato" : sinDato}</span> : formatoPesos(t.saldoCentavos)}
                    </td>
                    <td data-rotulo="Empresa"><Empresa t={t} /></td>
                    <td data-rotulo="Entregada">{t.entregadaEn ? fechaHora(new Date(t.entregadaEn)) : <span className="pista">{sinDato}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {inventario.incompleto ? <NotaRegla>Se muestran los primeros 2,000 plásticos de Efevoo.</NotaRegla> : null}
      </Hoja>

      <NotaRegla>
        Para asignar, activar o cancelar una tarjeta, entra a la empresa en Clientes: ahí está su sección de Tarjetas (Efevoo).
      </NotaRegla>
    </div>
  );
}
