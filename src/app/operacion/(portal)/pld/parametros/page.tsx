import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";

import { soloTexto, type Parametros } from "@/nucleo/direccion";
import { fechaHora } from "@/components/operacion/formato";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { ConfirmarParaDecidir } from "@/components/operacion/pld/confirmar";
import { FormularioParametros } from "@/components/operacion/pld/formularios-de-texto";
import { SinPermiso } from "@/components/operacion/sin-permiso";
import { Hoja, Insignia, NotaRegla, Renglon, Renglones } from "@/components/sistema";
import { formatoPesos } from "@/dominio/centavos";
import { exigirContextoOperacion, puedeEnOperacion } from "@/server/operacion";
import { leerParametros } from "@/server/pld";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Parámetros de PLD · Operación" };

const ETIQUETAS: Array<[string, string]> = [
  ["atipico_k", "Monto atípico: veces la mediana de 6 meses"],
  ["atipico_historial_minimo", "Monto atípico: operaciones previas mínimas"],
  ["fraccion_n", "Fraccionamiento: instrucciones mínimas"],
  ["fraccion_ventana_dias", "Fraccionamiento: ventana en días"],
  ["fraccion_umbral_centavos", "Fraccionamiento: umbral"],
  ["nomina_personas_pct", "Nómina atípica: aumento de personas"],
  ["factor_grado_alto", "Grado de riesgo alto: factor sobre cada límite"],
];

/**
 * Los parámetros de las reglas de alerta (54ª), versionados. Los iniciales llevan
 * su fuente y están por confirmar con el Manual de Cumplimiento. Cumplimiento los
 * cambia con motivo; Auditoría los consulta.
 */
export default async function ParametrosPld({ searchParams }: { searchParams: Parametros<"aviso"> }) {
  const ctx = await exigirContextoOperacion();
  const params = await soloTexto(searchParams);
  if (!puedeEnOperacion(ctx, "plataforma.pld.ver")) {
    return (
      <PaginaOperacion titulo="Parámetros de PLD">
        <SinPermiso>Los parámetros de las reglas los ven Cumplimiento y Auditoría.</SinPermiso>
      </PaginaOperacion>
    );
  }
  const p = await leerParametros(ctx);
  const cambia = puedeEnOperacion(ctx, "plataforma.pld.analizar");
  const valores: Record<string, string> = {
    atipico_k: `${p.atipicoK} veces`,
    atipico_historial_minimo: `${p.atipicoHistorialMinimo} operaciones`,
    fraccion_n: `${p.fraccionN} instrucciones`,
    fraccion_ventana_dias: `${p.fraccionVentanaDias} días`,
    fraccion_umbral_centavos: formatoPesos(p.fraccionUmbralCentavos),
    nomina_personas_pct: `${p.nominaPersonasPct} %`,
    factor_grado_alto: p.factorGradoAlto,
  };

  return (
    <PaginaOperacion
      titulo="Parámetros de PLD"
      aviso={params.aviso}
      accion={
        <Link className="boton-texto" href="/operacion/pld">
          ← Alertas PLD
        </Link>
      }
    >
      <Hoja id="vigentes-titulo" titulo={p.iniciales ? "Valores iniciales" : `Versión ${p.numero}`}>
        <div className="operacion-ficha-cabeza">
          {p.iniciales ? <Insignia tono="aviso">Por confirmar con el Manual de Cumplimiento</Insignia> : <Insignia tono="sello">Del operador</Insignia>}
          <p className="pista">{p.iniciales ? "Propuesta inicial de Lever." : `${p.registradoPor ?? "Cumplimiento"} · ${fechaHora(p.registradoEn)}`}</p>
        </div>
        <Renglones>
          {ETIQUETAS.map(([clave, etiqueta]) => (
            <Renglon key={clave} etiqueta={etiqueta}>
              {valores[clave]}
              {p.fuentes[clave] ?? p.fuentes.todos ? <span className="pista"> · {p.fuentes[clave] ?? p.fuentes.todos}</span> : null}
            </Renglon>
          ))}
          <Renglon etiqueta="Motivo">{p.motivo}</Renglon>
        </Renglones>
      </Hoja>

      {cambia ? (
        <Hoja id="parametros-titulo" titulo="Cambiar parámetros">
          <ConfirmarParaDecidir motivo="Antes de cambiar los parámetros de las alertas, prueba tu segundo factor. Vale 30 minutos." />
          <FormularioParametros
            formId={randomUUID()}
            iniciales={{
              atipicoK: p.atipicoK,
              atipicoHistorialMinimo: String(p.atipicoHistorialMinimo),
              fraccionN: String(p.fraccionN),
              fraccionVentanaDias: String(p.fraccionVentanaDias),
              fraccionUmbral: (p.fraccionUmbralCentavos / 100).toFixed(2),
              nominaPersonasPct: p.nominaPersonasPct,
              factorGradoAlto: p.factorGradoAlto,
            }}
          />
        </Hoja>
      ) : null}

      <NotaRegla>Las cifras de las reglas las fija el Manual de Cumplimiento; la DCG no las da.</NotaRegla>
    </PaginaOperacion>
  );
}
