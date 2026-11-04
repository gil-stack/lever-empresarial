import { useId } from "react";

export function SimboloLever({ className = "" }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  const azul = `lever-azul-${id}`;
  const cian = `lever-cian-${id}`;

  return (
    <svg className={className} viewBox="0 0 72 64" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={azul} x1="18" y1="57" x2="54" y2="4" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2474ff" />
          <stop offset="1" stopColor="#4b9cff" />
        </linearGradient>
        <linearGradient id={cian} x1="34" y1="56" x2="65" y2="35" gradientUnits="userSpaceOnUse">
          <stop stopColor="#36bffa" />
          <stop offset="1" stopColor="#63e6e2" />
        </linearGradient>
      </defs>
      <path
        d="M7 57C12 45 15 32 26 23L59 3C53 17 49 33 42 46C37 55 32 57 24 57H7Z"
        fill={`url(#${azul})`}
      />
      <path d="M30 57C36 43 42 37 53 37H68C63 48 59 57 52 57H30Z" fill={`url(#${cian})`} />
    </svg>
  );
}

export function LogoLever({ inverso = false, className = "" }: { inverso?: boolean; className?: string }) {
  const clases = ["arco-logo", inverso ? "arco-logo-inverso" : "", className].filter(Boolean).join(" ");

  return (
    <span className={clases} role="img" aria-label="LEVER">
      <SimboloLever className="arco-logo-sello" />
      <span className="arco-logo-texto" aria-hidden="true">
        <strong>LEVER</strong>
      </span>
    </span>
  );
}
