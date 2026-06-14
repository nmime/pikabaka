import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as mammoth from 'mammoth';

export class DocumentParser {
  /**
   * Parse a document file and extract text content.
   * Supports: .md, .txt (native), .pdf (via pdftotext CLI), .docx (via mammoth with macOS textutil fallback)
   */
  async parse(filePath: string): Promise<{ text: string; metadata: { format: string; pages?: number } }> {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.md':
      case '.txt':
        return this.parsePlainText(filePath, ext.slice(1));
      case '.pdf':
        return this.parsePDF(filePath);
      case '.docx':
        return this.parseDOCX(filePath);
      default:
        throw new Error(`Unsupported file format: ${ext}. Please use .md, .txt, .pdf, or .docx`);
    }
  }

  private async parsePlainText(filePath: string, format: string) {
    const text = fs.readFileSync(filePath, 'utf-8');
    return { text, metadata: { format } };
  }

  private async parsePDF(filePath: string) {
    try {
      // Use execFileSync to avoid shell injection — arguments passed as array
      const text = execFileSync('pdftotext', [filePath, '-'], { encoding: 'utf-8', timeout: 30000 });
      return { text: text.trim(), metadata: { format: 'pdf' } };
    } catch {
      throw new Error(
        'PDF parsing failed. Please install pdftotext (brew install poppler) or convert your resume to .md/.txt format.'
      );
    }
  }

  private async parseDOCX(filePath: string) {
    try {
      const result = await mammoth.extractRawText({ path: filePath });
      const text = result.value.trim();
      if (text) return { text, metadata: { format: 'docx' } };
    } catch {
      // Fall through to the platform converter below. Mammoth is portable and
      // deterministic for normal .docx files, but textutil can still rescue
      // some macOS-readable edge cases.
    }

    const tmpDir = fs.mkdtempSync(path.join(path.dirname(filePath), '.docx-parse-'));
    const tmpFile = path.join(tmpDir, 'document.txt');
    try {
      // Use execFileSync to avoid shell injection — arguments passed as array
      execFileSync('textutil', ['-convert', 'txt', '-output', tmpFile, filePath], { timeout: 30000 });
      const text = fs.readFileSync(tmpFile, 'utf-8').trim();
      if (text) return { text, metadata: { format: 'docx' } };
      throw new Error('DOCX contained no extractable text');
    } catch {
      throw new Error(
        'DOCX parsing failed. Please convert your resume to .md/.txt format.'
      );
    } finally {
      // Clean up temp file regardless of success/failure
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      try { fs.rmdirSync(tmpDir); } catch { /* ignore */ }
    }
  }
}
