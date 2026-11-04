export function LogoArco({
  inverso = false,
  soloSello = false,
  className = "",
}: {
  inverso?: boolean;
  soloSello?: boolean;
  className?: string;
}) {
  const clases = ["arco-logo", inverso ? "arco-logo-inverso" : "", className].filter(Boolean).join(" ");

  return (
    <span className={clases} role="img" aria-label="ARCO Banco">
      <span className="arco-logo-sello" aria-hidden="true">
        <svg viewBox="0 0 62 50" focusable="false">
          <path d="M3 25 53 3c7 13 7 31 0 44L3 25Z" />
          <path d="M53 4c6 13 6 29 0 42" />
        </svg>
        <span>ARCO</span>
      </span>
      {soloSello ? null : (
        <span className="arco-logo-texto" aria-hidden="true">
          <strong>ARCO</strong>
          <small>BANCO</small>
        </span>
      )}
    </span>
  );
}
