export const samples = [
  ['Welcome to Bitcoin++ Seoul. This is our main stage.', '비트코인++ 서울에 오신 것을 환영합니다. 여기는 메인 무대입니다.'],
  ['Payjoin and Silent Payments improve Bitcoin transaction privacy.', 'Payjoin과 Silent Payments는 비트코인 거래의 프라이버시를 개선합니다.'],
  ['Fedimint uses FROST and ROAST. Cashu uses blind signatures.', 'Fedimint는 FROST와 ROAST를 사용합니다. Cashu는 블라인드 서명을 사용합니다.']
];
export function testTone() {
  const rate = 16000, count = 4000, buffer = Buffer.alloc(44 + count * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) buffer.writeInt16LE(Math.round(1700 * Math.sin(2 * Math.PI * 440 * i / rate) * Math.sin(Math.PI * i / count)), 44 + i * 2);
  return buffer;
}
export function createRehearsalProvider() {
  return { translate: async text => samples.find(s => s[0] === text)?.[1] || text,
    speak: async () => ({ data: testTone(), mime: 'audio/wav' }) };
}
