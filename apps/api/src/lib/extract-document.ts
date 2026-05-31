import { extractText as extractPdfText } from "unpdf";
import mammoth from "mammoth";
import { type Result, ok, err } from "@outrival/shared";

/**
 * In-memory text extraction for the "document" onboarding mode.
 *
 * ZERO-STORAGE GUARANTEE: this helper only ever sees the bytes already in memory.
 * It never writes to disk, never uploads to R2, and never logs the content. The
 * caller is expected to drop the buffer as soon as this returns.
 */
export type ExtractError = "unsupported_type" | "extract_failed" | "empty";

type Kind = "pdf" | "docx" | "text";

function detectKind(filename: string, mime: string | undefined, bytes: Uint8Array): Kind | null {
  const name = filename.toLowerCase();
  const m = (mime ?? "").toLowerCase();

  if (name.endsWith(".pdf") || m === "application/pdf") return "pdf";
  if (
    name.endsWith(".docx") ||
    m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  if (
    name.endsWith(".md") ||
    name.endsWith(".markdown") ||
    name.endsWith(".txt") ||
    m.startsWith("text/")
  ) {
    return "text";
  }
  // Magic-byte fallback when extension/mime are missing.
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "pdf"; // %PDF
  }
  return null;
}

export async function extractDocumentText(
  bytes: Uint8Array,
  filename: string,
  mime?: string,
): Promise<Result<string, ExtractError>> {
  const kind = detectKind(filename, mime, bytes);
  if (!kind) return err("unsupported_type");

  try {
    let text: string;
    if (kind === "pdf") {
      const { text: extracted } = await extractPdfText(bytes, { mergePages: true });
      text = extracted;
    } else if (kind === "docx") {
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      text = value;
    } else {
      text = Buffer.from(bytes).toString("utf-8");
    }

    if (!text || text.trim().length < 20) return err("empty");
    return ok(text);
  } catch {
    return err("extract_failed");
  }
}
