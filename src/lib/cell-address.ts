export function encodeCellAddress(row: number, column: number): string {
  if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0) {
    throw new Error("Linha e coluna precisam ser inteiros não negativos.");
  }
  let value = column + 1;
  let letters = "";
  while (value > 0) {
    value -= 1;
    letters = String.fromCharCode(65 + (value % 26)) + letters;
    value = Math.floor(value / 26);
  }
  return `${letters}${row + 1}`;
}

export function decodeCellAddress(address: string): { row: number; column: number } {
  const match = /^\$?([A-Z]+)\$?([1-9]\d*)$/i.exec(address.trim());
  if (!match?.[1] || !match[2]) throw new Error("Endereço de célula inválido.");
  let column = 0;
  for (const letter of match[1].toUpperCase()) {
    column = column * 26 + letter.charCodeAt(0) - 64;
  }
  return { row: Number(match[2]) - 1, column: column - 1 };
}
