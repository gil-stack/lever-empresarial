/** El banderín de Arco, sin la palabra Banco. */
export function Banderin() {
  return (
    <svg className="banderin" viewBox="0 0 78 56" role="img" aria-label="Arco">
      <path fill="currentColor" d="M2 3h50L76 28 52 53H2V3z" />
      <text
        x="9"
        y="33"
        fill="var(--sobre-banderin)"
        fontFamily="var(--fuente-sans), sans-serif"
        fontSize="15"
        fontWeight="700"
        letterSpacing="0.5"
      >
        ARCO
      </text>
    </svg>
  );
}
