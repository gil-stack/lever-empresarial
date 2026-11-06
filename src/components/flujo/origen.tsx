import type { OrigenCifra } from "@/dominio/flujo/proyeccion";

const TEXTO: Record<OrigenCifra, string> = {
  comprometido: "Comprometido",
  declarado: "Declarado por tu empresa",
  banco_demo: "Confirmado por el banco · demostración",
};

const TONO: Record<OrigenCifra, string> = {
  comprometido: "insignia",
  declarado: "insignia insignia-sello",
  banco_demo: "insignia insignia-aviso",
};

/**
 * De dónde sale una cifra. Comprometido: datos de la plataforma (nómina,
 * proveedores, cobros y obligaciones). Declarado: lo capturó una persona de la
 * empresa. Confirmado por el banco: hoy no existe; solo aparece en empresas de
 * demostración y lo dice.
 */
export function Origen({ de }: { de: OrigenCifra }) {
  return <span className={`${TONO[de]} flujo-origen`} data-origen={de}>{TEXTO[de]}</span>;
}
