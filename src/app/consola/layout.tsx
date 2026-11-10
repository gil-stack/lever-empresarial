import type { ReactNode } from "react";

import { AvisoEmpresaSuspendida } from "@/components/cromo/aviso-empresa-suspendida";

export default function LayoutConsola({ children }: { children: ReactNode }) {
  return (
    <>
      <AvisoEmpresaSuspendida />
      {children}
    </>
  );
}
