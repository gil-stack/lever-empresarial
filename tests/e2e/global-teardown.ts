import { cerrarEntorno } from "./entorno";

export default async function globalTeardown(): Promise<void> {
  await cerrarEntorno();
}
