import { iniciarEntorno } from "./entorno";

export default async function globalSetup(): Promise<void> {
  await iniciarEntorno();
}
