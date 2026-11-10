import { useId, type CSSProperties } from "react";

/** El trazo del lazo de Lever, tal cual el diseño (caja de 40 × 40). */
const LAZO =
  "M12.058 25.034L10.653 27.148A3.042 3.042 0 1 1 8.978 22.548L25.559 27.426A9.703 9.703 0 1 0 20.214 12.75L15.595 19.707L18.686 20.616L22.778 14.453A6.625 6.625 0 1 1 26.427 24.474L9.847 19.595A6.119 6.119 0 1 0 13.217 28.851L15.148 25.943Z";

/**
 * El lazo coral. Cada tema escoge su relleno en CSS (`.lazo path`): el degradado
 * oscuro, el claro (más hondo para leerse sobre marfil) o el marfil del tema Lever.
 * Los degradados viven dentro de cada SVG con su propio id: así el lazo pinta aunque
 * otro logotipo de la página esté oculto.
 */
export function Lazo({ className = "lazo" }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  const oscuro = `lazo-oscuro-${id}`;
  const claro = `lazo-claro-${id}`;
  const rellenos = { "--lazo-oscuro": `url(#${oscuro})`, "--lazo-claro": `url(#${claro})` } as CSSProperties;
  return (
    // El diseño recorta la caja al trazo para que el lazo respire igual que la palabra.
    <svg className={className} viewBox="2.6 8.1 35.7 23.4" aria-hidden="true" focusable="false" style={rellenos}>
      <defs>
        <linearGradient id={claro} gradientUnits="userSpaceOnUse" x1="6" y1="5" x2="34" y2="35">
          <stop offset="0" stopColor="#FF7A6F" />
          <stop offset=".55" stopColor="#F04A3E" />
          <stop offset="1" stopColor="#DC4135" />
        </linearGradient>
        <linearGradient id={oscuro} gradientUnits="userSpaceOnUse" x1="6" y1="5" x2="34" y2="35">
          <stop offset="0" stopColor="#FF7A6F" />
          <stop offset=".5" stopColor="#FF5A4E" />
          <stop offset="1" stopColor="#FF5A4E" />
        </linearGradient>
      </defs>
      <path d={LAZO} />
    </svg>
  );
}

/**
 * El logotipo de Lever Empresas: el lazo y la palabra «lever» en Sora 600, con la
 * línea del portal debajo («Empresas», «Operación SOFIPO»). Sin línea, solo la palabra.
 * Lleva su nombre para el lector de pantalla; el contenedor decide si es enlace. Con
 * `decorativo` no lo lleva: lo nombra el texto que lo acompaña (un enlace que dice a dónde va).
 */
export function Logotipo({
  linea = "Empresas",
  className,
  decorativo = false,
}: {
  linea?: string | null;
  className?: string;
  decorativo?: boolean;
}) {
  const nombre = decorativo ? { "aria-hidden": true } : { role: "img", "aria-label": linea ? `Lever ${linea}` : "Lever" };
  return (
    <span className={className ? `logotipo ${className}` : "logotipo"} {...nombre}>
      <Lazo />
      <span className="logotipo-texto" aria-hidden="true">
        <span className="logotipo-palabra">lever</span>
        {linea ? <span className="logotipo-linea">{linea}</span> : null}
      </span>
    </span>
  );
}
