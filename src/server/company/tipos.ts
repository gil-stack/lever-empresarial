export type Empresa = {
  id: string;
  rfc: string;
  razonSocial: string;
  codigoPostal: string;
  regimen: string;
  usoCfdi: string;
  altaEn: Date;
};

export type AltaEmpresaEntrada = {
  rfc: string;
  razonSocial: string;
  codigoPostal: string;
  regimen: string;
  usoCfdi: string;
};

export type EmpresaNormalizada = Omit<Empresa, "id" | "altaEn">;
