import Link from "next/link";

import { Hoja, Insignia, NotaRegla, Vacio } from "@/components/sistema";
import { formatoPesos } from "@/dominio/centavos";
import { contar, type Afiliacion, type ClaseTarjeta, type InventarioTarjetas, type TarjetaDelInventario } from "@/server/efevoo/inventario";

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

/** La empresa elegida en la dirección (`?empresa=`): el id de una empresa de Lever, «p» + el número de un cliente del procesador o «ninguna» (stock libre). */
export function empresaDe(valor: string | undefined): string | null {
  const v = valor?.trim().toLowerCase() ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v) || /^p[1-9][0-9]{0,9}$/.test(v) || v === "ninguna" ? v : null;
}

export const SIN_EMPRESA = "ninguna";

export function tarjetasDeEmpresa(tarjetas: readonly TarjetaDelInventario[], empresa: string | null) {
  if (empresa === null) return [...tarjetas];
  return tarjetas.filter((t) => (t.afiliacion?.clave ?? SIN_EMPRESA) === empresa);
}

export type FilaEmpresa = Afiliacion & { tarjetas: number; activas: number; conSaldo: number; saldoCentavos: number | null };

/** Las tarjetas agrupadas por la empresa por la que se afiliaron (sin las canceladas), de la que más tiene a la que menos. El stock libre va al final. */
export function porEmpresa(inventario: InventarioTarjetas): FilaEmpresa[] {
  const filas = new Map<string, FilaEmpresa>();
  for (const t of inventario.tarjetas) {
    if (t.clase === "cancelada") continue;
    const af: Afiliacion = t.afiliacion ?? { clave: SIN_EMPRESA, nombre: "Sin empresa (stock libre)", enLever: false, companyId: null };
    const fila = filas.get(af.clave) ?? { ...af, tarjetas: 0, activas: 0, conSaldo: 0, saldoCentavos: inventario.fuente === "efevoo" ? 0 : null };
    fila.tarjetas += 1;
    if (t.clase === "activa_con_saldo" || t.clase === "activa_sin_saldo") fila.activas += 1;
    if (t.clase === "activa_con_saldo") fila.conSaldo += 1;
    if (fila.saldoCentavos !== null) fila.saldoCentavos += t.saldoCentavos ?? 0;
    filas.set(af.clave, fila);
  }
  return [...filas.values()].sort((a, b) =>
    (a.clave === SIN_EMPRESA ? 1 : 0) - (b.clave === SIN_EMPRESA ? 1 : 0) || b.tarjetas - a.tarjetas || a.nombre.localeCompare(b.nombre, "es"),
  );
}

/** La dirección del tablero con un filtro y una empresa. */
export function enlaceTablero(filtro: Filtro, empresa: string | null): string {
  const q = new URLSearchParams();
  if (filtro !== "todas") q.set("ver", filtro);
  if (empresa) q.set("empresa", empresa);
  const s = q.toString();
  return s ? `/operacion/tarjetas?${s}` : "/operacion/tarjetas";
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

export const ESTADO: Record<ClaseTarjeta, { texto: string; tono: "neutro" | "sello" | "aviso" }> = {
  sin_asignar: { texto: "Sin asignar", tono: "neutro" },
  asignada: { texto: "Asignada", tono: "neutro" },
  activa_con_saldo: { texto: "Activa", tono: "sello" },
  activa_sin_saldo: { texto: "Activa", tono: "sello" },
  bloqueada: { texto: "Bloqueada", tono: "aviso" },
  cancelada: { texto: "Cancelada", tono: "aviso" },
};

const ERRORES: Record<string, string> = {
  efevoo_incierto: "El procesador no respondió.",
  efevoo_no_autorizado: "El procesador rechazó las credenciales.",
  efevoo_rechazo: "El procesador rechazó la consulta.",
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
  empresa,
  rotulo,
  valor,
  nota,
  tono,
}: {
  filtro: Filtro;
  actual: Filtro;
  empresa: string | null;
  rotulo: string;
  valor: string;
  nota: string;
  tono?: Segmento;
}) {
  return (
    <li>
      <Link
        href={enlaceTablero(filtro, empresa)}
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
function Reparto({ inventario, c }: { inventario: InventarioTarjetas; c: InventarioTarjetas["conteos"] }) {
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

function Empresa({ t, filtro }: { t: TarjetaDelInventario; filtro: Filtro }) {
  if (!t.afiliacion) return <Link href={enlaceTablero(filtro, SIN_EMPRESA)} scroll={false} className="pista">Sin empresa (stock libre)</Link>;
  return (
    <>
      <Link href={enlaceTablero(filtro, t.afiliacion.clave)} scroll={false}>{t.afiliacion.nombre}</Link>
      {t.afiliacion.enLever ? null : <small>Fuera de Lever</small>}
    </>
  );
}

/** Las empresas con tarjetas: cada renglón filtra el tablero a las suyas. */
function TablaEmpresas({ inventario, empresa, filtro }: { inventario: InventarioTarjetas; empresa: string | null; filtro: Filtro }) {
  const filas = porEmpresa(inventario);
  if (filas.length === 0) return null;
  const conSaldos = inventario.fuente === "efevoo";
  return (
    <Hoja id="inventario-empresas" titulo={`Por empresa · ${filas.length}`} className="inventario-lista">
      <div className="tabla-contenedor" tabIndex={0} role="region" aria-label="Tabla de tarjetas por empresa">
        <table className="tabla operacion-tabla">
          <thead>
            <tr>
              <th scope="col">Empresa</th>
              <th scope="col" className="inventario-num">Tarjetas</th>
              <th scope="col" className="inventario-num">Activas</th>
              <th scope="col" className="inventario-num">Con saldo</th>
              <th scope="col" className="inventario-num">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.clave} aria-current={f.clave === empresa ? "true" : undefined} className={f.clave === empresa ? "inventario-fila-actual" : undefined}>
                <td>
                  <Link href={enlaceTablero(filtro, f.clave)} scroll={false}>{f.nombre}</Link>
                  {f.clave === SIN_EMPRESA ? null : f.enLever ? null : <small>Fuera de Lever</small>}
                </td>
                <td data-rotulo="Tarjetas" className="inventario-num">{f.tarjetas}</td>
                <td data-rotulo="Activas" className="inventario-num">{f.activas}</td>
                <td data-rotulo="Con saldo" className="inventario-num">{conSaldos ? f.conSaldo : "—"}</td>
                <td data-rotulo="Saldo" className="inventario-num">{f.saldoCentavos === null ? "—" : formatoPesos(f.saldoCentavos)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Hoja>
  );
}

export function TableroTarjetas({ inventario, filtro, empresa = null }: { inventario: InventarioTarjetas; filtro: Filtro; empresa?: string | null }) {
  const conEfevoo = inventario.fuente === "efevoo";
  const deEmpresa = tarjetasDeEmpresa(inventario.tarjetas, empresa);
  const c = empresa === null ? inventario.conteos : contar(deEmpresa, conEfevoo);
  const lista = tarjetasDelFiltro(deEmpresa, filtro);
  const nombreEmpresa = empresa === null ? null : empresa === SIN_EMPRESA ? "Sin empresa (stock libre)" : deEmpresa[0]?.afiliacion?.nombre ?? "Empresa sin tarjetas";
  const sinDato = "—";
  return (
    <div className="inventario">
      {!conEfevoo ? (
        <NotaRegla>
          {inventario.errorEfevoo
            ? `${ERRORES[inventario.errorEfevoo] ?? "No se pudo leer el procesador."} Se muestran las tarjetas que Lever ya entregó; el stock libre y los saldos llegan del procesador.`
            : "Este entorno todavía no está conectado con el procesador. Se muestran las tarjetas que Lever ya entregó; el stock libre y los saldos aparecerán al conectar las llaves del procesador."}
        </NotaRegla>
      ) : null}

      <section aria-labelledby="inventario-cifras" className="inventario-cabeza">
        <h2 id="inventario-cifras" className="solo-lector">Cifras del inventario</h2>
        <div className="inventario-total">
          <p className="rotulo">{nombreEmpresa ? `Tarjetas de ${nombreEmpresa}` : "Stock total"}</p>
          <p className="inventario-total-valor">{c.stock}</p>
          <p className="pista">
            {conEfevoo ? "Plásticos en el procesador, sin contar cancelados" : "Tarjetas entregadas por Lever, sin contar canceladas"}
            {inventario.ambiente === "sandbox" ? " · ambiente de pruebas" : ""}
          </p>
          {conEfevoo && c.saldoTotalCentavos !== null ? (
            <p className="inventario-saldo">
              <span className="rotulo">Saldo en tarjetas</span>
              <span className="monto">{formatoPesos(c.saldoTotalCentavos)}</span>
            </p>
          ) : null}
        </div>
        <Reparto inventario={inventario} c={c} />
      </section>

      <nav aria-label="Filtrar tarjetas">
        <ul className="inventario-cifras">
          <Cifra filtro="sin_asignar" actual={filtro} empresa={empresa} tono="libre" rotulo="Sin asignar" valor={conEfevoo ? String(c.sinAsignar) : sinDato} nota={conEfevoo ? "Listas para entregar" : "Se lee del procesador"} />
          <Cifra filtro="activa" actual={filtro} empresa={empresa} rotulo="Activas" valor={String(c.activas)} nota={`${porcentaje(c.activas, c.stock)} % del stock`} />
          <Cifra filtro="con_saldo" actual={filtro} empresa={empresa} tono="saldo" rotulo="Con saldo" valor={conEfevoo ? String(c.conSaldo) : sinDato} nota={conEfevoo ? "Activas con dinero" : "Se lee del procesador"} />
          <Cifra filtro="sin_saldo" actual={filtro} empresa={empresa} tono="vacia" rotulo="Sin saldo" valor={conEfevoo ? String(c.sinSaldo) : sinDato} nota={conEfevoo ? "Activas en $0.00" : "Se lee del procesador"} />
          <Cifra filtro="asignada" actual={filtro} empresa={empresa} tono="asignada" rotulo="Por activar" valor={String(c.asignadas)} nota="Asignadas, sin activar" />
          <Cifra filtro="bloqueada" actual={filtro} empresa={empresa} tono="bloqueada" rotulo="Bloqueadas" valor={String(c.bloqueadas)} nota={plural(c.canceladas, "cancelada aparte", "canceladas aparte")} />
        </ul>
      </nav>

      <TablaEmpresas inventario={inventario} empresa={empresa} filtro={filtro} />

      <Hoja id="inventario-lista" titulo={`${TITULO_LISTA[filtro]}${nombreEmpresa ? ` de ${nombreEmpresa}` : ""} · ${lista.length}`} className="inventario-lista">
        <div className="inventario-pestanas">
          {filtro !== "todas" ? (
            <Link href={enlaceTablero("todas", empresa)} className="enlace-texto" scroll={false}>Ver todo el stock</Link>
          ) : null}
          {filtro !== "cancelada" && c.canceladas > 0 ? (
            <Link href={enlaceTablero("cancelada", empresa)} className="enlace-texto" scroll={false}>Ver canceladas ({c.canceladas})</Link>
          ) : null}
          {empresa ? <Link href={enlaceTablero(filtro, null)} className="enlace-texto" scroll={false}>Quitar el filtro de empresa</Link> : null}
        </div>
        {lista.length === 0 ? (
          <Vacio titulo="No hay tarjetas aquí">
            {deEmpresa.length === 0
              ? conEfevoo
                ? empresa ? "Esta empresa no tiene tarjetas." : "El procesador no tiene plásticos registrados para esta cuenta."
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
                      <Link href={`/operacion/tarjetas/${t.idEfevoo}`} className="inventario-tarjeta" aria-label={`Ver la tarjeta terminada en ${t.terminacion}`}>
                        <span className="operacion-mono">•••• {t.terminacion}</span>
                        <span aria-hidden="true"> →</span>
                      </Link>
                      {t.nombreTarjeta ? <small>{t.nombreTarjeta}</small> : null}
                    </td>
                    <td data-rotulo="Estado">
                      <Insignia tono={ESTADO[t.clase].tono}>{ESTADO[t.clase].texto}</Insignia>
                    </td>
                    <td data-rotulo="Saldo" className="inventario-num">
                      {t.saldoCentavos === null ? <span className="pista">{conEfevoo ? "Sin dato" : sinDato}</span> : formatoPesos(t.saldoCentavos)}
                    </td>
                    <td data-rotulo="Empresa"><Empresa t={t} filtro={filtro} /></td>
                    <td data-rotulo="Entregada">{t.entregadaEn ? fechaHora(new Date(t.entregadaEn)) : <span className="pista">{sinDato}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {inventario.incompleto ? <NotaRegla>Se muestran los primeros 2,000 plásticos del procesador.</NotaRegla> : null}
      </Hoja>

      <NotaRegla>
        Toca una tarjeta para ver su resumen y sus movimientos. Para asignar, activar o cancelar una, entra a la empresa en Clientes: ahí está su sección de Tarjetas.
      </NotaRegla>
    </div>
  );
}
