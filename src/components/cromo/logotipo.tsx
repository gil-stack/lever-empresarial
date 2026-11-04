/*
 * El banderín es un sector macizo. Las letras van caladas, no en un trazo fino:
 * a 40 px se lee la masa de la identidad, no un alambre.
 */

const SECTOR = "M0 0 L93 -36.65 A100 100 0 0 1 93 36.65 Z";

export function Banderin({ className = "banderin" }: { className?: string }) {
  return (
    <svg className={className} viewBox="-8 -41 112 82" aria-hidden="true" focusable="false">
      <mask id="banderin-arco" maskUnits="userSpaceOnUse">
        <path fill="white" d={SECTOR} />
        <g fill="none" stroke="black" strokeLinecap="butt" strokeLinejoin="miter" strokeMiterlimit="2.2">
          <path d="M19.6 11 L25.5 -9.4 L31.4 11 M21.8 4.2 H29.2" strokeWidth="6.2" />
          <path d="M38.2 15 V-12.8 H42.6 A5 7 0 0 1 42.6 1.2 H38.2 M43.2 1.2 L49.4 15" strokeWidth="6.4" />
          <path d="M63.7 -13.4 A5 17.5 0 1 0 63.7 13.4" strokeWidth="7.2" />
          <ellipse cx="81" cy="0" rx="7.2" ry="20" strokeWidth="8" />
        </g>
      </mask>
      <path fill="currentColor" d={SECTOR} mask="url(#banderin-arco)" />
    </svg>
  );
}

export function PalabraArco({ className = "palabra-arco" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 -2 86 24" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="6.6" strokeLinejoin="miter" strokeMiterlimit="2.4">
        <path d="M2 21.2 L11 2.2 L20 21.2 M6.2 13.4 H15.8" />
        <path d="M26 21.2 V2.4 H32.2 A5.6 5.6 0 0 1 32.2 13 H26 M32.6 13 L39.2 21.2" />
        <path d="M60.2 4.4 A8.2 8.2 0 1 0 60.2 16.2" />
        <circle cx="76" cy="10.4" r="8.2" />
      </g>
    </svg>
  );
}
