export type ProductUpdate = {
  id: string;
  version: string;
  date: string;
  title: string;
  summary: string;
  highlights: string[];
};

export const APP_VERSION = "0.10.0-beta.22";
export const APP_VERSION_LABEL = `v${APP_VERSION}`;

export const CURRENT_UPDATE_ID = APP_VERSION;
export const UPDATE_READ_STORAGE_KEY = "oliam-last-read-update";

export function hasUnreadProductUpdate(lastReadId: string | null) {
  return lastReadId !== CURRENT_UPDATE_ID;
}
