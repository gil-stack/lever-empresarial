/*
 * El logotipo de Arco, redibujado de la identidad oficial: el banderín es un sector
 * de círculo (un arco) con ARCO condensado dentro, y la palabra va en geométrica gruesa.
 * Los dos pintan con `currentColor`; el color lo pone quien los usa.
 */

export function Banderin({ className = "banderin" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="-8 -41 112 82"
      fill="none"
      stroke="currentColor"
      strokeMiterlimit="2.5"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M0 0 L93 -36.65 A100 100 0 0 1 93 36.65 Z" strokeWidth="4.6" />
      <path d="M19.6 11 L25.5 -9.4 L31.4 11 M21.8 4.2 H29.2" strokeWidth="4" />
      <path d="M38.2 15 V-12.8 H42.6 A5 7 0 0 1 42.6 1.2 H38.2 M43.2 1.2 L49.4 15" strokeWidth="4.4" />
      <path d="M63.7 -13.4 A5 17.5 0 1 0 63.7 13.4" strokeWidth="5" />
      <ellipse cx="81" cy="0" rx="7.2" ry="22.2" strokeWidth="5.6" />
    </svg>
  );
}

export function PalabraArco({ className = "palabra-arco" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 -2 84 22"
      fill="none"
      stroke="currentColor"
      strokeWidth="4.2"
      strokeMiterlimit="3"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M1.4 21 L10 3.4 L18.6 21 M5.4 13.6 H14.6" />
      <path d="M25.1 21 V2.1 H31 A5.45 5.45 0 0 1 31 13 H25.1 M31.4 13 L37.6 21" />
      <path d="M58.05 4.92 A7.9 7.9 0 1 0 58.05 15.08" />
      <circle cx="73.9" cy="10" r="7.9" />
    </svg>
  );
}
