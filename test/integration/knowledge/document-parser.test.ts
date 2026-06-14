import t from 'tap';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DocumentParser } from '../../../electron/knowledge/DocumentParser';

const SAMPLE_DOCX_BASE64 =
  'UEsDBAoAAAAIAGiAzlzXeYTq8QAAALgBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2QzU7DMBCE730Ky9cqccoBIZSkB36OwKE8wMreJFb9J69b2rdn00KREOVozXwz62nXB+/EHjPZGDq5qhspMOhobBg7+b55ru6koALBgIsBO3lEkut+0W6OCUkwHKiTUynpXinSE3qgOiYMrAwxeyj8zKNKoLcworppmlulYygYSlXmDNkvhGgfcYCdK+LpwMr5loyOpHg4e+e6TkJKzmoorKt9ML+Kqq+SmsmThyabaMkGqa6VzOL1jh/0lSfK1qB4g1xewLNRfcRslIl65xmu/0/649o4DFbjhZ/TUo4aiXh77+qL4sGG71+06jR8/wlQSwMECgAAAAAAaIDOXAAAAAAAAAAAAAAAAAYAAABfcmVscy9QSwMECgAAAAgAaIDOXCAbhuqyAAAALgEAAAsAAABfcmVscy8ucmVsc43Puw6CMBQG4J2naM4uBQdjDIXFmLAafICmPZRGeklbL7y9HRzEODie23fyN93TzOSOIWpnGdRlBQStcFJbxeAynDZ7IDFxK/nsLDJYMELXFs0ZZ57yTZy0jyQjNjKYUvIHSqOY0PBYOo82T0YXDE+5DIp6Lq5cId1W1Y6GTwPagpAVS3rJIPSyBjIsHv/h3ThqgUcnbgZt+vHlayPLPChMDB4uSCrf7TKzQHNKuorZvgBQSwMECgAAAAAAaIDOXAAAAAAAAAAAAAAAAAUAAAB3b3JkL1BLAwQKAAAACABogM5c7GHtZfsAAACfAQAAEQAAAHdvcmQvZG9jdW1lbnQueG1sjVBNS8UwELz3Vyw5KbzXVA8ij7YPFAQvKn4geIvp2haT3Zqk1vrr3RYEwYNeJvvBzGam3H94B+8YYs9UqaO8UIBkuemprdTD/cX2VEFMhhrjmLBSM0a1r7Ny2jVsR4+UQBQo7qZKdSkNO62j7dCbmPOAJLsXDt4kaUOrJw7NENhijHLAO31cFCfam55UnQGI6jM3cy3vsEBYINW3PMPBXWf4TUiH8NSNpV7mC4YVh/VHPzmPJmFwzBu4vtrAuSHTmL9ZrqdXFO+5Za970oHn7ed/zp2NYkhcwSUldK5vJUSEaPzgEAJGSeq3iDAj2nQT9DpYrWdL9R1t/QVQSwECFAAKAAAACABogM5c13mE6vEAAAC4AQAAEwAAAAAAAAAAAAAAAAAAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAAoAAAAAAGiAzlwAAAAAAAAAAAAAAAAGAAAAAAAAAAAAEAAAACIBAABfcmVscy9QSwECFAAKAAAACABogM5cIBuG6rIAAAAuAQAACwAAAAAAAAAAAAAAAABGAQAAX3JlbHMvLnJlbHNQSwECFAAKAAAAAABogM5cAAAAAAAAAAAAAAAABQAAAAAAAAAAABAAAAAhAgAAd29yZC9QSwECFAAKAAAACABogM5c7GHtZfsAAACfAQAAEQAAAAAAAAAAAAAAAABEAgAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAUABQAgAQAAbgMAAAAA';

function writeSampleDocx(t: Tap.Test): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pika-docx-parser-'));
  t.teardown(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const fixturePath = path.join(tempDir, 'sample-resume.docx');
  fs.writeFileSync(fixturePath, Buffer.from(SAMPLE_DOCX_BASE64, 'base64'));
  return fixturePath;
}

t.test('DocumentParser parses the sample resume fixture', async (t) => {
  const parser = new DocumentParser();
  const fixturePath = writeSampleDocx(t);

  const result = await parser.parse(fixturePath);

  t.equal(result.metadata.format, 'docx', 'reports docx metadata');
  t.type(result.text, 'string', 'returns extracted text');
  t.ok(result.text.trim().length > 0, 'returns non-empty text');
  t.match(result.text, /Roy\s+\(Shaoqing\)\s+Zhu/i, 'extracts the candidate name from the fixture');
  t.match(result.text, /Waterloo, ON, Canada/i, 'extracts profile/location text');
  t.match(result.text, /linkedin\.com\/in\//i, 'extracts contact details from the fixture');
});
