import { NextResponse } from "next/server";
import { assertTrustedRequest } from "@/lib/requestSafety";

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_TEXT_CHARS = 80_000;

export async function POST(request) {
  try {
    assertTrustedRequest(request);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Choose a PDF file." }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      return NextResponse.json({ error: "The previous scorecard must be a PDF." }, { status: 400 });
    }
    if (file.size > MAX_PDF_BYTES) {
      return NextResponse.json({ error: "The PDF is larger than 25 MB." }, { status: 413 });
    }

    const pdfModule = await import("pdf-parse");
    const parsePdf = pdfModule.default || pdfModule;
    const parsed = await parsePdf(Buffer.from(await file.arrayBuffer()));
    const fullText = String(parsed.text || "").replace(/\u0000/g, "").trim();
    if (!fullText) {
      return NextResponse.json({ error: "No selectable text was found in this PDF. Export it with text recognition and try again." }, { status: 422 });
    }

    return NextResponse.json({
      filename: file.name,
      pages: parsed.numpages || null,
      text: fullText.slice(0, MAX_TEXT_CHARS),
      truncated: fullText.length > MAX_TEXT_CHARS,
      characters: fullText.length,
    });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Could not read the PDF." }, { status: error?.status || 500 });
  }
}
