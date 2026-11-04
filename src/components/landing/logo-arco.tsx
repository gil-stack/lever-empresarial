export function LogoArco({ inverso = false, className = "" }: { inverso?: boolean; className?: string }) {
  const clases = ["arco-logo", inverso ? "arco-logo-inverso" : "", className].filter(Boolean).join(" ");

  return (
    <span className={clases} role="img" aria-label="LEVER Pagos">
      <span className="arco-logo-texto" aria-hidden="true">
        <strong>LEVER</strong>
        <small>PAGOS</small>
      </span>
    </span>
  );
}
