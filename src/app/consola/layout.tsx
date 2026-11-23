import type { ReactNode } from "react";

import { AvisoClienteDePrueba } from "@/components/cromo/aviso-cliente-de-prueba";
import { AvisoEmpresaSuspendida } from "@/components/cromo/aviso-empresa-suspendida";

export default function LayoutConsola({ children }: { children: ReactNode }) {
  return (
    <>
      <AvisoClienteDePrueba />
      <AvisoEmpresaSuspendida />
      {children}
    </>
  );
}
