/** Pictures the learner adds to an answer: kept as files in the data folder, shown again from there. */
import { attachmentDataUrl, saveAttachment } from '../store/attachments';

/** Keep an uploaded picture; answers the name it is stored under. */
export function keepPicture(dir: string, upload: unknown): { name: string } {
  return { name: saveAttachment(dir, upload) };
}

/** A kept picture as the window shows it. */
export function pictureForWindow(dir: string, name: string): string {
  return attachmentDataUrl(dir, name);
}
