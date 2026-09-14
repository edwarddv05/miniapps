import QRCode from 'qrcode';

const [url, output = 'expo-go-qr.png'] = process.argv.slice(2);

if (!url) {
  console.error('Usage: node scripts/generate-expo-qr.mjs <expo-url> [output]');
  process.exit(1);
}

await QRCode.toFile(output, url, {
  errorCorrectionLevel: 'M',
  margin: 2,
  width: 720,
  color: {
    dark: '#16181D',
    light: '#FFFFFF',
  },
});

console.log(`QR generado: ${output}`);
