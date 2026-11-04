const SECTOR = "M0 0 L93 -36.65 A100 100 0 0 1 93 36.65 Z";

export function Banderin({ className = "banderin" }: { className?: string }) {
  return (
    <svg className={className} viewBox="-8 -41 112 82" aria-hidden="true" focusable="false">
      <mask id="banderin-lever" maskUnits="userSpaceOnUse">
        <path fill="white" d={SECTOR} />
        <path d="M40 -17 V17 H68" fill="none" stroke="black" strokeWidth="10" strokeLinecap="butt" strokeLinejoin="miter" />
      </mask>
      <path fill="currentColor" d={SECTOR} mask="url(#banderin-lever)" />
    </svg>
  );
}

export function PalabraLever({ className = "palabra-arco" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 24" aria-hidden="true" focusable="false">
      <text
        x="1"
        y="19"
        fill="currentColor"
        fontSize="20"
        fontWeight="600"
        letterSpacing="-1"
        style={{ fontFamily: "var(--font-arco), sans-serif" }}
      >
        LEVER
      </text>
    </svg>
  );
}
