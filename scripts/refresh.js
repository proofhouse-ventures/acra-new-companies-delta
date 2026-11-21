'use strict';
// Refresh: re-download the 27 ACRA letter files from data.gov.sg (public v1
// poll-download API, no sign-in / no API key), re-ingest, report delta.
// ACRA updates the files monthly on day 16, running to roughly the end of
// the previous month. Run manually or from a scheduled job.
// Notes: the API returns HTTP 403 without a browser User-Agent, and
// connections occasionally drop mid-download — downloads go to a .part file
// with up to 5 attempts and are renamed only when complete.
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const FILES = {
  a: 'd_8575e84912df3c28995b8e6e0e05205a', b: 'd_3a3807c023c61ddfba947dc069eb53f2',
  c: 'd_c0650f23e94c42e7a20921f4c5b75c24', d: 'd_acbc938ec77af18f94cecc4a7c9ec720',
  e: 'd_124a9bd407c7a25f8335b93b86e50fdd', f: 'd_4526d47d6714d3b052eed4a30b8b1ed6',
  g: 'd_b58303c68e9cf0d2ae93b73ffdbfbfa1', h: 'd_fa2ed456cf2b8597bb7e064b08fc3c7c',
  i: 'd_85518d970b8178975850457f60f1e738', j: 'd_478f45a9c541cbe679ca55d1cd2b970b',
  k: 'd_5573b0db0575db32190a2ad27919a7aa', l: 'd_a2141adf93ec2a3c2ec2837b78d6d46e',
  m: 'd_9af9317c646a1c881bb5591c91817cc6', n: 'd_67e99e6eabc4aad9b5d48663b579746a',
  o: 'd_5c4ef48b025fdfbc80056401f06e3df9', p: 'd_181005ca270b45408b4cdfc954980ca2',
  q: 'd_4130f1d9d365d9f1633536e959f62bb7', r: 'd_2b8c54b2a490d2fa36b925289e5d9572',
  s: 'd_df7d2d661c0c11a7c367c9ee4bf896c1', t: 'd_72f37e5c5d192951ddc5513c2b134482',
  u: 'd_0cc5f52a1f298b916f317800251057f3', v: 'd_e97e8e7fc55b85a38babf66b0fa46b73',
  w: 'd_af2042c77ffaf0db5d75561ce9ef5688', x: 'd_1cd970d8351b42be4a308d628a6dd9d3',
  y: 'd_31af23fdb79119ed185c256f03cb5773', z: 'd_4e3db8955fdcda6f9944097bef3d2724',
  others: 'd_300ddc8da4e8f7bdc1bfc62d0d99e2e7',
};
function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': UA } }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}
function download(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) return download(res.headers.location, dest).then(resolve, reject);
      const ws = fs.createWriteStream(dest);
      res.pipe(ws);
      ws.on('finish', () => ws.close(resolve));
      ws.on('error', reject);
    }).on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const rawDir = path.join(__dirname, '..', '..', 'data', 'raw', 'acra');
  fs.mkdirSync(rawDir, { recursive: true });
  for (const [letter, id] of Object.entries(FILES)) {
    const dest = path.join(rawDir, `acra_${letter}.csv`);
    let done = false;
    for (let attempt = 0; attempt < 5 && !done; attempt++) {
      try {
        const d = await getJson(`https://api-open.data.gov.sg/v1/public/api/datasets/${id}/poll-download`);
        if (!d.data || !d.data.url) throw new Error(`poll-download failed for ${id}: ${JSON.stringify(d).slice(0, 200)}`);
        await download(d.data.url, dest + '.part');
        fs.renameSync(dest + '.part', dest);
        done = true;
        console.log(`downloaded acra_${letter}.csv (${fs.statSync(dest).size} bytes)`);
      } catch (e) {
        console.log(`acra_${letter} attempt ${attempt} failed: ${e.message}`);
        await sleep(5000 * (attempt + 1));
      }
    }
    if (!done) throw new Error(`download failed for acra_${letter}.csv after 5 attempts`);
  }
  execFileSync('node', [path.join(__dirname, 'ingest.js'), rawDir], { stdio: 'inherit' });
})().catch((e) => { console.error(e); process.exit(1); });
