import type * as XLSX from "xlsx";

type DenseWorksheet = XLSX.WorkSheet & { "!data"?: Array<Array<XLSX.CellObject | undefined>> };

export function worksheetCellAtAddress(
  worksheet: XLSX.WorkSheet,
  address: string,
): XLSX.CellObject | undefined {
  const dense = (worksheet as DenseWorksheet)["!data"];
  if (!dense) return worksheet[address] as XLSX.CellObject | undefined;
  const match = /^([A-Z]+)(\d+)$/i.exec(address);
  if (!match) return undefined;
  let column = 0;
  for (const char of match[1]!.toUpperCase()) column = column * 26 + char.charCodeAt(0) - 64;
  return dense[Number(match[2]) - 1]?.[column - 1];
}
