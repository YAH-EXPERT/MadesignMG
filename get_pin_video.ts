import { promises as fs } from 'fs';

async function fetchPinVideo(pinUrl: string) {
  try {
    const res = await fetch(pinUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      redirect: 'follow'
    });
    const html = await res.text();
    const mp4Matches = html.match(/https:\/\/[^"]+\.mp4[^"]*/g);
    if (mp4Matches && mp4Matches.length > 0) {
       console.log("Found mp4:", Array.from(new Set(mp4Matches)));
    } else {
       console.log("No mp4 found");
    }
  } catch (e: any) {
    console.error(pinUrl, "Error:", e.message);
  }
}

async function run() {
  await fetchPinVideo("https://fr.pinterest.com/pin/823595850654914876/");
}

run();
