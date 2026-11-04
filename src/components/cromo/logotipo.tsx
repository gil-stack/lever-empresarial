import { SimboloLever } from "@/components/landing/logo-lever";

export function Banderin({ className = "banderin" }: { className?: string }) {
  return <SimboloLever className={className} />;
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
