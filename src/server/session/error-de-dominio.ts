export class ErrorDeDominio extends Error {
  readonly codigo: string;

  constructor(codigo: string) {
    super(codigo);
    this.name = "ErrorDeDominio";
    this.codigo = codigo;
  }
}
